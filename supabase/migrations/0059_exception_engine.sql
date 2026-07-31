-- Phase 7a: the exception engine, minus the parts that need credentials.
--
-- The brief asks for three things: compare live GPS and routing ETA against the
-- promised window, score risk per active order and surface an at-risk queue,
-- and draft the customer notification for a human to approve.
--
-- The first needs GPS switched on (Phase 2 is still dark and has never run on a
-- phone) and a routing API. The third needs the AI key. Both are parked, so
-- this ships the middle one — which is the part that actually changes what
-- somebody does on a Tuesday morning.
--
-- WHERE THE SCORE LIVES, AND WHY NOT HERE
-- ---------------------------------------
-- There is no scoring function in this migration on purpose. Every risk signal
-- is already a column on `loads`, and the app reads loads through the role
-- views (loads_full / loads_sales_safe), which apply the caller's RLS and the
-- 0013 column grants for free. Computing the score in TypeScript against those
-- views means it CANNOT become the sixth thing that quietly bypasses a row
-- policy — see the 0053/0054/0055/0056 table in STATUS.md. A SECURITY DEFINER
-- scorer would have been faster to write and would have needed its own
-- hidden_at clause, its own margin handling, and its own review.
--
-- So this migration is one table: the place where somebody says "I know, it's
-- handled." Without it the queue nags forever and gets ignored, which is the
-- normal way an alerting feature dies.

create table risk_acknowledgements (
  id             uuid primary key default gen_random_uuid(),
  brokerage_id   uuid,
  load_id        uuid not null references loads (id) on delete cascade,

  -- Which specific worry is being dismissed, e.g. 'pickup_overdue'. Null means
  -- the whole order. Per-factor rather than per-order because "I know it has no
  -- carrier" must not also silence "it is now three days past delivery".
  factor         text,
  note           text,

  -- Comes back after this. Null = acknowledged indefinitely, which is what you
  -- want for "this one is genuinely fine"; a date is what you want for "chasing
  -- it Thursday".
  snoozed_until  timestamptz,

  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now()
);

create index idx_risk_ack_load on risk_acknowledgements (load_id);
create index idx_risk_ack_active on risk_acknowledgements (load_id, factor)
  where snoozed_until is null;

alter table risk_acknowledgements enable row level security;

-- Follows the parent load, same as every load child since 0053: the EXISTS runs
-- under the caller's RLS, so a hidden load hides its acknowledgements too.
create policy "risk_ack_select_scoped"
  on risk_acknowledgements for select
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = risk_acknowledgements.load_id)
  );

create policy "risk_ack_insert_scoped"
  on risk_acknowledgements for insert
  with check (public.is_active_staff() and public.user_can_access_load(load_id));

-- Un-acknowledging is a delete, and it is allowed: unlike an audit trail, this
-- table is a working state, and "actually, that is not handled" has to be
-- expressible. Deleting one restores the warning, which is the point.
create policy "risk_ack_delete_scoped"
  on risk_acknowledgements for delete
  using (public.is_active_staff() and public.user_can_access_load(load_id));

revoke all on risk_acknowledgements from anon, authenticated;
grant select, insert, delete on risk_acknowledgements to authenticated;

insert into feature_flags (key, enabled, note) values
  ('exception_engine', false, 'Phase 7a: risk score and at-risk queue from dates, carrier and paperwork. No GPS or AI yet.')
on conflict (key) do nothing;
