-- Loadboard preference on the order, matching the old system's header select
-- (All / Central / Super). It records WHERE this order should be posted, so
-- the Post action can default to it instead of asking every time.
--
-- Also clears campaign values that came in as raw UUIDs: the old system's
-- campaign_id is a foreign key, not a label, and a UUID is meaningless to a
-- rep reading the header.

alter table loads
  add column if not exists loadboard text;

update loads
   set campaign = null
 where campaign ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

grant select (loadboard), insert (loadboard), update (loadboard)
  on public.loads to authenticated;

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
  campaign, loadboard, shipper_info, notes, lost_reason,
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
