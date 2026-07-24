-- Leads → Quotes → Orders pipeline (msgplane parity).
-- Lifecycle: lead (no price) → quote (priced) → ready (converted order) →
-- posted_cd / posted_sd (on a load board) → dispatched → picked_up →
-- delivered.  Side states: hold, archived, lost.
--
-- NOTE on enums: `alter type ... add value` must be committed before the new
-- value is used. If the SQL editor complains about running these together,
-- run the seven add-value lines first, then the rest.

alter type load_status add value if not exists 'lead';
alter type load_status add value if not exists 'ready';
alter type load_status add value if not exists 'posted_cd';
alter type load_status add value if not exists 'posted_sd';
alter type load_status add value if not exists 'hold';
alter type load_status add value if not exists 'archived';
alter type load_status add value if not exists 'lost';

-- Lifecycle columns. carrier_received and cod_to_carrier are carrier money —
-- kept out of the sales-safe view below.
alter table loads
  add column if not exists received_amount numeric(10, 2),
  add column if not exists carrier_received numeric(10, 2),
  add column if not exists cod_to_carrier numeric(10, 2),
  add column if not exists date_signed date,
  add column if not exists dispatched_at date,
  add column if not exists picked_up_at date,
  add column if not exists delivered_at date,
  add column if not exists lost_reason text,
  add column if not exists campaign text,
  add column if not exists shipper_info text,
  add column if not exists pickup_company text,
  add column if not exists pickup_contact_cell text,
  add column if not exists delivery_company text,
  add column if not exists delivery_contact_cell text;

-- Recreate the sales-safe view with the new non-margin columns. Excludes
-- carrier_pay, carrier_received, cod_to_carrier.
drop view if exists loads_sales_safe;
create view loads_sales_safe
  with (security_invoker = on) as
select
  id, load_number, customer_id, carrier_id, status,
  pickup_address, pickup_city, pickup_state, pickup_zip,
  pickup_contact_name, pickup_contact_phone, pickup_company, pickup_contact_cell,
  pickup_ready_date,
  delivery_address, delivery_city, delivery_state, delivery_zip,
  delivery_contact_name, delivery_contact_phone, delivery_company, delivery_contact_cell,
  delivery_eta,
  transport_type, distance_miles,
  customer_rate, deposit_amount, balance_due, received_amount,
  date_signed, dispatched_at, picked_up_at, delivered_at,
  posted_to_central_dispatch_at, cd_external_id,
  posted_to_super_dispatch_at, sd_external_id,
  campaign, shipper_info, notes, lost_reason,
  sales_owner_id, dispatcher_id, follow_up_at, follow_up_note,
  created_at, updated_at
from loads;
