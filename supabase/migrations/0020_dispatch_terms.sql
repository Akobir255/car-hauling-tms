-- Dispatch terms + driver + vehicle detail fields, learned from the msgplane
-- order-edit and Edit Dispatch Sheet pages (2026-07-26 live tour). Option
-- lists for the *_terms columns live in app code (src/lib/dispatch-terms.ts);
-- the columns are free text so historical imports can't violate a CHECK.

alter table loads
  add column if not exists balance_paid_by text,
  add column if not exists cod_method text,
  add column if not exists payment_terms text,
  add column if not exists terms_begin text,
  add column if not exists payment_method text,
  add column if not exists invoice_payment_method text,
  add column if not exists driver_first_name text,
  add column if not exists driver_last_name text,
  add column if not exists driver_phone text,
  add column if not exists cd_note text,
  add column if not exists dispatch_instructions text,
  add column if not exists pickup_buyer_number text,
  add column if not exists delivery_buyer_number text;

-- Per 0013's rule: loads grants are column-scoped, so new user-client columns
-- must be granted explicitly. None of these are margin data.
grant select (balance_paid_by, cod_method, payment_terms, terms_begin,
    payment_method, invoice_payment_method, driver_first_name,
    driver_last_name, driver_phone, cd_note, dispatch_instructions,
    pickup_buyer_number, delivery_buyer_number),
  insert (balance_paid_by, cod_method, payment_terms, terms_begin,
    payment_method, invoice_payment_method, driver_first_name,
    driver_last_name, driver_phone, cd_note, dispatch_instructions,
    pickup_buyer_number, delivery_buyer_number),
  update (balance_paid_by, cod_method, payment_terms, terms_begin,
    payment_method, invoice_payment_method, driver_first_name,
    driver_last_name, driver_phone, cd_note, dispatch_instructions,
    pickup_buyer_number, delivery_buyer_number)
  on public.loads to authenticated;

-- Vehicle details msgplane carries per unit (auction workflows need
-- plate/lot; deposit is per-vehicle there, order-level total stays derived).
alter table load_vehicles
  add column if not exists plate text,
  add column if not exists plate_state text,
  add column if not exists lot_number text,
  add column if not exists color text,
  add column if not exists deposit numeric(10, 2);

-- Views snapshot their column list — recreate both so the new loads columns
-- flow through.
drop view if exists loads_sales_safe;
create view loads_sales_safe
  with (security_invoker = on) as
select
  id, load_number, customer_id, carrier_id, dispatcher_id, status,
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
