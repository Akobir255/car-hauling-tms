-- Make lead assignment a strict rotation: agent 1, 2, 3, ... N, then back to 1.
--
-- ===========================================================================
-- WHY THIS REPLACES 0069's next_lead_owner()
-- ===========================================================================
-- 0069 assigned each lead to the active rep who had gone LONGEST without one.
-- That spreads leads evenly in the steady state, but it is not the cycle the
-- business asked for, and it has two edges that a cycle does not:
--
--   * a brand-new hire has never had a lead, so "longest waited" is always
--     them -- they get every incoming lead in a row until they catch up. A
--     rotation just slots them into the ring and gives them one lap at a time.
--   * two leads arriving at the same instant both read the state before either
--     writes it, so both can pick the same rep. There was no lock.
--
-- This is a true round-robin: a pointer remembers who got the last lead, and
-- the next lead goes to the next active sales rep in a stable order, wrapping
-- at the end. The order is by created_at then id -- i.e. the order reps were
-- added, so "the first agent" is the first one hired.
--
-- Membership changes take care of themselves:
--   * deactivate a rep  -> they are simply skipped on the next lap (the pointer
--     still remembers them by id, so "the next one after" is computed correctly
--     even while they are inactive);
--   * add a rep         -> they join in their created_at position and get their
--     turn once per lap, no flood;
--   * no active sales reps at all -> returns null, and the lead lands unassigned
--     (createLeadFromNormalized already handles a null owner).

-- ---------------------------------------------------------------------------
-- 1. The pointer -- a single row holding who got the last lead
-- ---------------------------------------------------------------------------
-- The `id boolean primary key default true check (id)` trick pins the table to
-- exactly one row: only `true` is allowed and it is the primary key, so a
-- second insert conflicts.
create table if not exists lead_rotation (
  id         boolean primary key default true check (id),
  last_owner uuid references profiles (id),
  updated_at timestamptz not null default now()
);

insert into lead_rotation (id) values (true) on conflict (id) do nothing;

comment on table lead_rotation is
  'Single-row round-robin pointer for lead assignment: last_owner is the sales rep who received the most recent lead. next_lead_owner() reads and advances it under a row lock. Service role / definer only.';

alter table lead_rotation enable row level security;
-- No policy and no grant: only the definer function touches it.
revoke all on lead_rotation from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The rotation itself
-- ---------------------------------------------------------------------------
create or replace function public.next_lead_owner()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last uuid;
  v_next uuid;
begin
  -- Lock the single pointer row for the length of this call. Two leads that
  -- arrive together serialize here: the second waits, then reads the pointer
  -- the first already advanced, so no two consecutive leads share a rep.
  select last_owner into v_last from lead_rotation where id = true for update;
  if not found then
    insert into lead_rotation (id) values (true) on conflict (id) do nothing;
    select last_owner into v_last from lead_rotation where id = true for update;
  end if;

  -- The next active sales rep AFTER the last one, in the stable ring order.
  -- The comparison is on (created_at, id) so ties on created_at still have a
  -- total order. A deactivated last_owner still exists in profiles, so "after
  -- them" is well defined even though they are skipped as a candidate.
  select p.id
    into v_next
    from profiles p
   where p.active
     and p.role = 'sales'
     and (
       v_last is null
       or (p.created_at, p.id) >
          (select lp.created_at, lp.id from profiles lp where lp.id = v_last)
     )
   order by p.created_at, p.id
   limit 1;

  -- Nobody after the last one (we were at the end of the ring, or last_owner
  -- is gone/unknown): wrap to the first active rep.
  if v_next is null then
    select p.id
      into v_next
      from profiles p
     where p.active and p.role = 'sales'
     order by p.created_at, p.id
     limit 1;
  end if;

  -- Advance the pointer only when we actually landed on someone. If there are
  -- no active sales reps, v_next is null and the lead lands unassigned.
  if v_next is not null then
    update lead_rotation set last_owner = v_next, updated_at = now() where id = true;
  end if;

  return v_next;
end $$;

comment on function public.next_lead_owner() is
  'Strict round-robin: returns the active sales rep after the last-assigned one, by created_at then id, wrapping at the end, and advances the lead_rotation pointer under a row lock. Null when there are no active sales reps. Called by the lead webhooks.';

-- The pointer advances inside this function''s own transaction (the RPC call),
-- which commits before the load insert that follows. So a lead whose insert
-- later fails will have advanced the ring by one -- one agent is skipped that
-- lap, never double-served. That is the right trade: fairness bends by at most
-- one slot on an error, and no rep ever gets someone else''s lead.

revoke execute on function public.next_lead_owner() from public, anon, authenticated;
grant execute on function public.next_lead_owner() to service_role;
