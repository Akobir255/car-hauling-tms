-- The old system's status word, kept verbatim on imported records.
--
-- Their Archived tab mixes "completed" and "lost"; their Issues tab is
-- "incomplete"; Hold shows "on-hold-order". Our own `status` drives the
-- pipeline, but the lists must READ exactly like the system they replace,
-- so the original word travels with the record and is displayed when set.
-- Null for anything created in this system.

alter table loads
  add column if not exists msgplane_status text;

-- 0013 made loads grants column-scoped: new user-client columns need an
-- explicit grant. Not margin data.
grant select (msgplane_status), insert (msgplane_status), update (msgplane_status)
  on public.loads to authenticated;

-- Views snapshot their column list — recreate both.
drop view if exists loads_sales_safe;
create view loads_sales_safe
  with (security_invoker = on) as
select
  id, load_number, customer_id, carrier_id, dispatcher_id, status, msgplane_status,
  pickup_address, pickup_city, pickup_state, pickup_zip,
  pickup_contact_name, pickup_contact_phone, pickup_company, pickup_contact_cell,
  pickup_ready_date, pickup_buyer_number,
  delivery_address, delivery_city, delivery_state, delivery_zip,
  delivery_contact_name, delivery_contact_phone, delivery_company, delivery_contact_cell,
  delivery_eta, delivery_buyer_number,
  transport_type, distance_miles,
  customer_rate, deposit_amount, balance_due, received_amount,
  date_signed, dispatched_at, picked_up_at, delivered_at,
  posted_to_central_dispatch_at, cd_external_id,
  posted_to_super_dispatch_at, sd_external_id,
  campaign, shipper_info, notes, lost_reason,
  sales_owner_id, follow_up_at, follow_up_note,
  contract_token, contract_sent_at, contract_signed_name, contract_signed_email,
  contract_requires_card,
  balance_paid_by, cod_method, payment_terms, terms_begin,
  payment_method, invoice_payment_method,
  driver_first_name, driver_last_name, driver_phone,
  cd_note, dispatch_instructions,
  created_at, updated_at
from loads;

revoke all on loads_sales_safe from anon, authenticated;
grant select on loads_sales_safe to authenticated;

drop view if exists loads_full;
create view loads_full
  with (security_barrier = true) as
select * from loads
where public.current_profile_role() in ('admin', 'dispatcher');

revoke all on loads_full from anon, authenticated;
grant select on loads_full to authenticated;

-- Imported history is browsed by number and by status; keep both quick.
create index if not exists idx_loads_msgplane_status on loads (msgplane_status);
