-- Phase 1.5 — follow-up scheduling on loads (msgplane-style 1/2/3-day quick
-- follow-ups) + let all staff read teammate names (needed for status history
-- attribution and rep filters; previously only admins could list profiles).

alter table loads
  add column follow_up_at timestamptz,
  add column follow_up_note text;

create index idx_loads_follow_up_at on loads (follow_up_at);

-- Recreate the sales-safe view to include the new columns (still excludes
-- carrier_pay / margin).
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
  sales_owner_id, dispatcher_id, follow_up_at, follow_up_note,
  created_at, updated_at
from loads;

-- All staff may read profiles (names/roles are not sensitive internally);
-- updates remain admin-only.
drop policy "profiles_select_own_or_admin" on profiles;
create policy "profiles_select_staff"
  on profiles for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));
