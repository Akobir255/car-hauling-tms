-- An access log, and two policies that were wider than the thing they guard.
--
-- ===========================================================================
-- 1. access_events -- who read what
-- ===========================================================================
-- This system has no read logging of any kind. `load_events` (0049) is a
-- business timeline -- status changed, contract sent -- not an access log, and
-- nothing anywhere records that a person LOOKED at something. If the customer
-- book walked out tomorrow there would be nothing to point at anyone.
--
-- Append-only, and append-only TWICE, per the recipe in docs/STATUS.md: no
-- update or delete policy AND no update or delete grant. Policy alone is what
-- left `documents` wipeable by anybody (fixed below) -- a policy only filters
-- rows for a role that already holds the privilege, so the privilege has to go
-- as well.
--
-- Staff cannot write this through the user client either. Writes go through
-- the service role from the server, so a rep cannot forge, suppress or thin
-- out their own trail.

create table if not exists access_events (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references profiles (id),
  action       text not null,
  entity_type  text,
  entity_id    uuid,
  result_count integer,
  term         text,
  ip           text,
  created_at   timestamptz not null default now()
);

comment on table access_events is
  'Append-only record of staff READS of customer data: who, what action, how many rows came back, the search term, and the IP. Written by the server with the service role only -- never through the user client. Nothing margin-bearing and no PII rows belong here: ids, counts and the search term only.';

create index if not exists idx_access_events_actor_time
  on access_events (actor_id, created_at desc);
create index if not exists idx_access_events_time
  on access_events (created_at desc);

alter table access_events enable row level security;

-- Admins may read the log. Nobody -- including admins -- may change it, which
-- is the point of a log: there is deliberately no update or delete policy.
drop policy if exists "access_events_select_admin" on access_events;
create policy "access_events_select_admin"
  on access_events for select
  using ((select current_profile_role()) = 'admin');

-- Belt and braces: even if a permissive policy is added here by mistake later,
-- the privilege to modify is not there to be filtered.
revoke all on access_events from anon, authenticated;
grant select on access_events to authenticated;

-- ===========================================================================
-- 2. documents: any staff member could delete any document row
-- ===========================================================================
-- `documents_delete_staff` was `using (is_active_staff())` -- one request from
-- any active account deletes any row, including the carrier COI / W-9 /
-- authority index. The files survive in storage but become unreachable, and
-- COI expiry tracking then points at paperwork nobody can produce.
--
-- 0049 named this exact risk in its own header and 0053 reinstated the wide
-- version. Scope it to the people who own the paperwork, plus whoever
-- uploaded it.
drop policy if exists "documents_delete_staff" on documents;
create policy "documents_delete_scoped"
  on documents for delete
  using (
    (select current_profile_role()) in ('admin', 'dispatcher')
    or uploaded_by = (select auth.uid())
  );

-- ===========================================================================
-- 3. load_requests.price -- the carrier's number, on the sales side of the line
-- ===========================================================================
-- `price` on a load request is what a carrier offered to haul the car. That is
-- the same quantity 0013 spent a whole migration hiding: put it beside the
-- customer rate a rep already sees and you have the margin, per lane.
--
-- `load_requests_select_scoped` was staff-level, so the number was readable by
-- everyone, and src/app/(app)/loads/[id]/load-requests.tsx prints it to every
-- viewer of an order.
--
-- The table has ZERO rows today, so this costs nothing now and closes the door
-- before the first dispatcher logs a carrier's phone offer in it. Same
-- boundary as carrier_pay: admin and dispatcher only.
drop policy if exists "load_requests_select_scoped" on load_requests;
create policy "load_requests_select_manager"
  on load_requests for select
  using (
    (select current_profile_role()) in ('admin', 'dispatcher')
    and exists (select 1 from loads l where l.id = load_requests.load_id)
  );
