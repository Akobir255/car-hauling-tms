-- Let lead generators post leads straight into the book.
--
-- ===========================================================================
-- WHAT THIS IS FOR
-- ===========================================================================
-- Today every lead is typed in by hand. The only inbound webhook is
-- RingCentral, so a lead that arrives as a text becomes a MESSAGE and someone
-- still has to read it and key the order. This adds the door a lead provider
-- can post to, and the two things you need around it: a per-provider secret,
-- and attribution.
--
-- Attribution is the part people skip and regret. Without a record of which
-- provider sent which lead you cannot tell which one actually closes, so you
-- keep paying the worst one. `lead_intake` is that record, and it joins to
-- quote_outcomes and the lane tables that already exist.
--
-- ===========================================================================
-- WHY NOT COLUMNS ON `loads`
-- ===========================================================================
-- Because `loads_full` and `loads_full_contact` are `select *`, expanded and
-- FROZEN at create time (0030, 0038), so a new column on `loads` means
-- recreating four views and re-deriving the 0013 column grants -- the exact
-- checklist STATUS.md warns about, and a chance to reinstate a stale view body
-- while doing it. A child table keyed by load_id costs one join and touches
-- nothing that guards margin.
--
-- The raw provider payload is NOT stored here. `webhook_events` (0007) already
-- exists for that, is already service-role-only, and already has a `raw`
-- column and a `source` column with a default rather than a constraint -- so
-- lead deliveries log there as source = 'lead:<key>' beside the RingCentral
-- ones. One receipt log, not two.

-- ---------------------------------------------------------------------------
-- 1. The providers, and their secrets
-- ---------------------------------------------------------------------------
-- One row per lead generator. The secret is stored as a SHA-256 hash, never in
-- the clear: this table is a list of keys to your front door, and a hash means
-- a copy of the table is not a set of working credentials.
create table if not exists lead_sources (
  key         text primary key,
  name        text not null,
  secret_hash text not null,
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table lead_sources is
  'One row per lead generator that may POST to /api/webhooks/leads/<key>. secret_hash is the SHA-256 of the shared token -- the token itself is shown once when the source is created (scripts/add-lead-source.mjs) and is not recoverable. Service role only: this is the list of keys to the front door.';

alter table lead_sources enable row level security;
-- No policy, and no grant. Only the service role reads this, which is all the
-- webhook handler needs. Both locks, per 0067 -- a policy alone would still
-- leave the privilege in place.
revoke all on lead_sources from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Where each lead came from
-- ---------------------------------------------------------------------------
create table if not exists lead_intake (
  load_id     uuid primary key references loads (id) on delete cascade,
  source      text not null references lead_sources (key),
  source_ref  text,
  received_at timestamptz not null default now()
);

comment on table lead_intake is
  'Which lead generator produced which load, and their own id for it. Join to loads for close-rate and cost-per-lead by provider. No PII and nothing margin-bearing: the raw payload stays in webhook_events.';

-- The dedupe. A provider that retries a delivery -- or sends the same lead
-- twice, which they all do -- must not create a second order. Partial, because
-- source_ref is optional: a provider that sends no id of its own gets deduped
-- on contact details in the handler instead, which is fuzzier and cannot be a
-- constraint.
create unique index if not exists idx_lead_intake_source_ref
  on lead_intake (source, source_ref)
  where source_ref is not null;

create index if not exists idx_lead_intake_source_time
  on lead_intake (source, received_at desc);

alter table lead_intake enable row level security;

-- Staff may read where a lead came from -- it belongs on the order screen.
-- Writes come from the server with the service role, so a rep cannot re-badge
-- a lead as having come from a cheaper provider.
drop policy if exists "lead_intake_select_staff" on lead_intake;
create policy "lead_intake_select_staff"
  on lead_intake for select
  using ((select is_active_staff()));

revoke all on lead_intake from anon, authenticated;
grant select on lead_intake to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who gets the lead
-- ---------------------------------------------------------------------------
-- Round-robin by recency: the active sales rep who has waited longest for one.
-- A rep who has never had a lead sorts first, so a new hire is not starved.
--
-- SECURITY DEFINER with a pinned search_path, same shape as 0013's helpers --
-- it reads `profiles`, which the caller may not be entitled to read in full.
create or replace function public.next_lead_owner()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select p.id
    from profiles p
    left join lateral (
      select max(li.received_at) as last_at
        from lead_intake li
        join loads l on l.id = li.load_id
       where l.sales_owner_id = p.id
    ) x on true
   where p.active and p.role = 'sales'
   order by x.last_at asc nulls first, p.id
   limit 1
$$;

comment on function public.next_lead_owner() is
  'The active sales rep who has gone longest without an inbound lead; never-assigned reps sort first. Used by the lead webhook to place a new lead in someone''s queue instead of nowhere.';

-- Revoking from PUBLIC removes the implicit grant every role gets, so the
-- service role needs its own -- the webhook handler is the only caller.
revoke execute on function public.next_lead_owner() from public, anon, authenticated;
grant execute on function public.next_lead_owner() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Reporting: which provider actually pays for itself
-- ---------------------------------------------------------------------------
-- Deliberately a view over lead_intake and loads rather than a stored total,
-- so it cannot drift. Margin is NOT here: customer_rate is the sales-side
-- number that reps already see, and carrier_pay stays behind 0013's column
-- grants where it belongs.
drop view if exists lead_source_performance;

create view lead_source_performance with (security_invoker = true) as
select
  li.source,
  count(*)                                                        as leads,
  count(*) filter (where l.date_signed is not null)                as signed,
  round(
    100.0 * count(*) filter (where l.date_signed is not null)
    / nullif(count(*), 0)
  , 1)                                                            as close_rate_pct,
  sum(l.customer_rate) filter (where l.date_signed is not null)    as signed_revenue,
  min(li.received_at)                                             as first_lead,
  max(li.received_at)                                             as last_lead
from lead_intake li
join loads l on l.id = li.load_id
group by li.source;

-- Supabase's default privileges grant new objects in `public` to anon and
-- authenticated, and 0068 only swept base tables -- a view created after it
-- arrives with the anon grant back on. Take it off explicitly.
revoke all on lead_source_performance from anon, authenticated;
grant select on lead_source_performance to authenticated;

comment on view lead_source_performance is
  'Leads, signed count, close rate and signed revenue per lead generator. security_invoker, so it shows the caller exactly what their own row policies allow and nothing more.';
