-- Quote form parity with msgplane: per-vehicle tariff, shipper notes on the
-- load, and driveaway as a transport option. The route map / auto-mileage is
-- purely client-side (OpenStreetMap + OSRM) and fills the existing
-- distance_miles column, so no schema needed for it.

alter table load_vehicles
  add column tariff numeric(10, 2);

alter table loads
  add column notes text;

alter type transport_type add value if not exists 'driveaway';

-- Recreate the sales-safe view to carry the new notes column (still
-- excludes carrier_pay / margin).
drop view loads_sales_safe;
create view loads_sales_safe
  with (security_invoker = on) as
select
  id, load_number, customer_id, carrier_id, status,
  pickup_address, pickup_city, pickup_state, pickup_zip,
  pickup_contact_name, pickup_contact_phone, pickup_ready_date,
  delivery_address, delivery_city, delivery_state, delivery_zip,
  delivery_contact_name, delivery_contact_phone, delivery_eta,
  transport_type, distance_miles, customer_rate, deposit_amount, balance_due,
  sales_owner_id, dispatcher_id, follow_up_at, follow_up_note, notes,
  created_at, updated_at
from loads;
