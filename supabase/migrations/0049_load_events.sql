-- Phase 1: the event spine.
--
-- Every later phase (GPS, AI intake, calls/SMS, exceptions) writes what it did
-- onto the order through ONE table and ONE helper, so an order's story is in a
-- single place instead of five. Today this record already keeps four separate
-- timelines -- load_status_history, messages, load_notes, contract_events --
-- and the newest one always wins the reader's attention while the others rot.
--
-- The table is named load_events, not order_events: there is no `orders` table
-- here. Lead, quote and order are pipeline_stage VALUES on `loads`, and every
-- child table in this schema is load_*.
--
-- APPEND-ONLY, and enforced twice: no update/delete policy, and no update/delete
-- GRANT. Policy alone was not enough -- `documents` has a bare `for all` policy
-- and any staff session can wipe the entire file index with one PostgREST call.
-- An audit trail that a user can rewrite is not an audit trail.

create table load_events (
  id            uuid primary key default gen_random_uuid(),
  load_id       uuid not null references loads (id) on delete cascade,
  brokerage_id  uuid,
  event_type    text not null,
  payload       jsonb not null default '{}'::jsonb,
  source        text not null check (source in ('user', 'gps', 'sms', 'call', 'ai', 'integration')),
  actor_user_id uuid references profiles (id),
  -- occurred_at is when the thing HAPPENED; created_at is when we heard about
  -- it. They differ the moment a phone comes back into signal and posts an
  -- hour of buffered GPS, which is Phase 2's normal case, not its edge case.
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on column load_events.brokerage_id is
  'Forward-compat for multi-tenancy. Deliberately nullable, with no foreign key, no index and NO reference from any policy: this app is single-tenant and RLS is by role plus load ownership (current_profile_role / user_can_access_load). It exists so a future brokerages table is a backfill rather than a redesign. Do not write it or read it until that table exists.';

-- CONSEQUENCE OF THE READ RULE ABOVE, and it binds every later phase:
-- `payload` is readable by ANY active staff member, sales included. Margin is
-- hidden from sales by column grants on `loads` (0013), and a jsonb blob routes
-- around that completely. Never put carrier_pay, carrier_received or
-- cod_to_carrier in an event payload. If a phase needs a margin-bearing event,
-- it needs its own table with its own grants -- not a key in here.

comment on table load_events is
  'Append-only order timeline. Written only through recordEvent() in src/lib/events/record-event.ts. No update or delete is granted to `authenticated` by design; authorship is cleared by the service role when a user is deleted (see admin/users/actions.ts AUTHORSHIP).';

create index idx_load_events_load_occurred on load_events (load_id, occurred_at desc);

alter table load_events enable row level security;

-- READ and WRITE are different questions here, and 0037 is the migration that
-- decided so. It dropped user_can_access_load from the SELECT policy of every
-- child of a load -- load_vehicles, load_status_history, load_notes,
-- load_requests, contract_versions -- and replaced it with is_active_staff(),
-- because a rep pulling up a colleague's order to answer a phone call got a
-- blank record. Any staff member may READ this timeline, for the same reason.
--
-- Getting this wrong is silent: PostgREST returns zero rows, not an error, so a
-- filtered read and an empty history render identically.
create policy "load_events_select_scoped"
  on load_events for select
  using (public.is_active_staff());

-- WRITING is still owner-scoped: reading somebody else's order is allowed,
-- putting an event on it is not.
create policy "load_events_insert_scoped"
  on load_events for insert
  with check (public.is_active_staff() and public.user_can_access_load(load_id));

-- No update policy and no delete policy. That is the point of the table.

revoke all on load_events from anon, authenticated;
grant select, insert on load_events to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill, then turn the old table into a view over this one.
--
-- The ids are carried across unchanged, so anything holding a history row's id
-- still resolves after the swap.
-- ---------------------------------------------------------------------------

insert into load_events (id, load_id, event_type, payload, source, actor_user_id, occurred_at, created_at)
select
  h.id,
  h.load_id,
  'status_changed',
  jsonb_strip_nulls(jsonb_build_object('status', h.status::text, 'note', h.note)),
  -- A history row with no author was written by the system: the msgplane
  -- importer, the booking sweep, or a contract signed on the public page.
  case when h.changed_by is null then 'integration' else 'user' end,
  h.changed_by,
  h.created_at,
  h.created_at
from load_status_history h;

-- The old table is KEPT for one release as a rollback path -- but locked in
-- this same migration, not left for a TODO. The last snapshot table created
-- this way (messages_backup_pre_0013) is still sitting in the schema more than
-- a year later, holding every SMS and email body, protected only by an RLS flag
-- that no migration ever set. Once is enough.
alter table load_status_history rename to load_status_history_pre_0049;

drop policy if exists "load_status_history_select_scoped" on load_status_history_pre_0049;
drop policy if exists "load_status_history_insert_scoped" on load_status_history_pre_0049;
revoke all on load_status_history_pre_0049 from anon, authenticated;
-- RLS on with zero policies: nothing but the service role can read it, which is
-- exactly what a rollback copy should be.
alter table load_status_history_pre_0049 enable row level security;

comment on table load_status_history_pre_0049 is
  'Rollback copy of the pre-0049 status history. Byte-identical rows (same ids) now live in load_events where event_type = ''status_changed''. DROP THIS in the migration after 0049 has been verified in production -- it is deliberately not dropped here so one release can roll back.';

-- security_invoker: without it the view runs with its owner''s rights and every
-- caller sees every load''s history. security_barrier keeps a cheap user
-- function from being pushed under the RLS predicate, same as loads_full.
create view load_status_history with (security_invoker = true, security_barrier = true) as
  select
    e.id,
    e.load_id,
    (e.payload ->> 'status')::load_status as status,
    e.actor_user_id                       as changed_by,
    e.payload ->> 'note'                  as note,
    e.occurred_at                         as created_at
  from load_events e
  where e.event_type = 'status_changed'
    and e.payload ? 'status';

revoke all on load_status_history from anon, authenticated;
grant select, insert on load_status_history to authenticated;

-- The view is not auto-updatable (status is an expression over jsonb), and
-- fifteen call sites still insert into it -- fourteen in loads/actions.ts and
-- one in sign/[token]/sign-actions.ts. Rather than a flag day, they keep
-- working through this trigger and move to recordEvent() one at a time. Drop
-- the trigger in the migration that retires the last writer.
create or replace function public.load_status_history_insert()
returns trigger
language plpgsql
as $$
begin
  insert into public.load_events (load_id, event_type, payload, source, actor_user_id, occurred_at)
  values (
    new.load_id,
    'status_changed',
    jsonb_strip_nulls(jsonb_build_object('status', new.status::text, 'note', new.note)),
    case when new.changed_by is null then 'integration' else 'user' end,
    new.changed_by,
    -- A view applies no column defaults, so an insert that omits created_at
    -- arrives here as NULL rather than now().
    coalesce(new.created_at, now())
  );
  return new;
end;
$$;

create trigger load_status_history_insert_trg
  instead of insert on load_status_history
  for each row execute function public.load_status_history_insert();
