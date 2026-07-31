-- Hide the imported ORDERS too, and close a hole 0052 left open.
--
-- Two jobs in one migration because they are the same bug seen twice.
--
-- ===========================================================================
-- THE HOLE 0052 LEFT
-- ===========================================================================
-- 0052 hid `customers` with a row policy, and verified it: a signed-in admin
-- reading `customers` gets zero rows. That verification was not enough.
--
-- `loads_full` and `loads_full_contact` are declared `security_barrier` and NOT
-- `security_invoker`. A non-invoker view runs as its OWNER, so RLS on the tables
-- it reads is evaluated as the owner -- and the owner is the table owner, who is
-- not subject to it. Measured on production before this migration:
--
--   service role: customers with last_sms_at set              2657
--   ADMIN via loads_full_contact, customer_last_sms_at set    2767
--
-- The customer rows were hidden on a direct read and served through the view.
--
-- `loads_full` is non-invoker ON PURPOSE and must stay that way: it is how a
-- manager reads carrier_pay at all, since 0013 revokes that column from
-- `authenticated` and a security_invoker view would hit the revoke. So the fix
-- is not to flip the flag -- that would break margin, the first rule in
-- STATUS.md. The fix is to put the condition inside the view.
--
-- (loads_sales_safe and loads_sales_safe_contact are security_invoker, so sales
-- reps never saw this. It was a manager-only leak.)
--
-- ===========================================================================
-- WHAT THIS MIGRATION HIDES
-- ===========================================================================
-- Every load, and everything hanging off a load. Nothing is deleted. Carriers,
-- their contacts, their COI and their authority documents stay visible, as
-- instructed -- `documents` is filtered on entity_type so a carrier's insurance
-- certificate is untouched while a load's BOL is not.
--
-- TO BRING IT ALL BACK, as the service role:
--
--   update loads     set hidden_at = null;
--   update customers set hidden_at = null;
--   update messages  set hidden_at = null;

-- ---------------------------------------------------------------------------
-- 1. The marker, and the backfill
-- ---------------------------------------------------------------------------
alter table loads add column if not exists hidden_at timestamptz;

comment on column loads.hidden_at is
  'Set = hidden from every logged-in user, and every child row follows it. Null = visible. Never deleted; clearing this column restores the load and its children.';

create index if not exists idx_loads_visible on loads (hidden_at) where hidden_at is null;

update loads set hidden_at = now() where hidden_at is null;

-- ---------------------------------------------------------------------------
-- 2. The base policy
--
-- Replaced, not added beside: permissive policies are ORed, so a second policy
-- would widen access back to everything.
-- ---------------------------------------------------------------------------
drop policy if exists "loads_select_scoped" on loads;
create policy "loads_select_scoped"
  on loads for select
  using (
    hidden_at is null
    and public.is_active_staff()
  );

-- ---------------------------------------------------------------------------
-- 3. The manager views — where the leak was
--
-- `select *` is expanded and frozen at creation, so each of these must be
-- recreated in dependency order, and _contact must come after the view it
-- wraps. 0029 is the story of getting that wrong.
-- ---------------------------------------------------------------------------
drop view if exists loads_full_contact;
drop view if exists loads_full;

create view loads_full
  with (security_barrier = true) as
select * from loads
where public.current_profile_role() in ('admin', 'dispatcher')
  -- The row filter the view cannot inherit, because it does not run the
  -- caller's RLS. Without this line a manager reads every hidden load.
  and hidden_at is null;

revoke all on loads_full from anon, authenticated;
grant select on loads_full to authenticated;

create view loads_full_contact
  with (security_barrier = true) as
select l.*, c.last_sms_at as customer_last_sms_at, c.last_email_at as customer_last_email_at
  from loads_full l
  -- THE 0052 LEAK. This join does not run the caller's RLS either, so a hidden
  -- customer arrived here in full. Filtered explicitly.
  left join customers c on c.id = l.customer_id and c.hidden_at is null;

revoke all on loads_full_contact from anon, authenticated;
grant select on loads_full_contact to authenticated;

-- security_invoker, so the caller's RLS already filters this join. The
-- condition is repeated anyway: the next person to read these two definitions
-- side by side should not have to work out why only one of them is guarded.
drop view if exists loads_sales_safe_contact;
create view loads_sales_safe_contact
  with (security_invoker = on) as
select l.*, c.last_sms_at as customer_last_sms_at, c.last_email_at as customer_last_email_at
  from loads_sales_safe l
  left join customers c on c.id = l.customer_id and c.hidden_at is null;

revoke all on loads_sales_safe_contact from anon, authenticated;
grant select on loads_sales_safe_contact to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Children follow the parent
--
-- Each child asks "does my parent load exist?" and that EXISTS runs under the
-- CALLER's RLS, so a hidden parent makes the child unreadable with no second
-- marker to keep in step. It also re-states the invariant 0037 already relied
-- on: a child row cannot exist without a load.
--
-- This is what stops someone reading 26,137 VIN/make/model rows straight off
-- /rest/v1/load_vehicles while the orders page shows nothing.
-- ---------------------------------------------------------------------------
drop policy if exists "load_vehicles_select_scoped" on load_vehicles;
create policy "load_vehicles_select_scoped"
  on load_vehicles for select
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = load_vehicles.load_id)
  );

-- 0013 left a FOR ALL policy here. FOR ALL covers SELECT, and permissive
-- policies are ORed, so it hands back every read the policy above just took
-- away. Split into the three commands it was actually for.
drop policy if exists "load_vehicles_write_scoped" on load_vehicles;
create policy "load_vehicles_insert_scoped"
  on load_vehicles for insert
  with check (public.user_can_access_load(load_id));
create policy "load_vehicles_update_scoped"
  on load_vehicles for update
  using (public.user_can_access_load(load_id))
  with check (public.user_can_access_load(load_id));
create policy "load_vehicles_delete_scoped"
  on load_vehicles for delete
  using (public.user_can_access_load(load_id));

drop policy if exists "load_notes_select_scoped" on load_notes;
create policy "load_notes_select_scoped"
  on load_notes for select
  to authenticated
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = load_notes.load_id)
  );

drop policy if exists "load_requests_select_scoped" on load_requests;
create policy "load_requests_select_scoped"
  on load_requests for select
  to authenticated
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = load_requests.load_id)
  );

drop policy if exists "contract_versions_select_scoped" on contract_versions;
create policy "contract_versions_select_scoped"
  on contract_versions for select
  to authenticated
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = contract_versions.load_id)
  );

-- 0049. load_status_history is a security_invoker VIEW over this table, so it
-- follows automatically.
drop policy if exists "load_events_select_scoped" on load_events;
create policy "load_events_select_scoped"
  on load_events for select
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = load_events.load_id)
  );

-- 0050.
drop policy if exists "shipment_locations_select_scoped" on shipment_locations;
create policy "shipment_locations_select_scoped"
  on shipment_locations for select
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = shipment_locations.load_id)
  );

drop policy if exists "geofence_events_select_scoped" on geofence_events;
create policy "geofence_events_select_scoped"
  on geofence_events for select
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = geofence_events.load_id)
  );

drop policy if exists "load_geofences_select_scoped" on load_geofences;
create policy "load_geofences_select_scoped"
  on load_geofences for select
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = load_geofences.load_id)
  );

-- ---------------------------------------------------------------------------
-- 5. Documents — the one table where the carrier exception lives
--
-- doc_entity_type is ('carrier', 'load'). A carrier's COI, W-9 and MC authority
-- are entity_type = 'carrier' and stay exactly as they are. A load's BOL and
-- condition photos follow their load.
-- ---------------------------------------------------------------------------
drop policy if exists "documents_select_staff" on documents;
create policy "documents_select_staff"
  on documents for select
  using (
    public.is_active_staff()
    and (
      entity_type <> 'load'
      or exists (select 1 from loads l where l.id = documents.entity_id)
    )
  );

-- Same FOR ALL problem as load_vehicles, and the one 0049 called out by name:
-- a bare `for all` here means any staff session can read -- and wipe -- the
-- entire file index. Split, so SELECT is governed only by the policy above.
drop policy if exists "documents_write_staff" on documents;
create policy "documents_insert_staff"
  on documents for insert
  with check (public.is_active_staff());
create policy "documents_update_staff"
  on documents for update
  using (public.is_active_staff())
  with check (public.is_active_staff());
create policy "documents_delete_staff"
  on documents for delete
  using (public.is_active_staff());
