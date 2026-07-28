-- Paperwork filter: "Sent, not signed" and "Never sent" returned 0 rows on
-- every tab, on every list. Measured on Archived: 484 records, Signed = 212,
-- the other two options = 0. 272 records matched nothing at all.
--
-- 0027 added loads.contract_sent and stopped there. 0013 spells out what else
-- a new loads column needs, because SELECT/INSERT/UPDATE on loads are
-- column-scoped and the app never reads the table directly:
--
--   1. column grants to `authenticated`
--   2. the column added to loads_sales_safe / loads_full
--
-- Neither happened, so no view the app reads had the column, and a filter on
-- a column the view does not have fails the whole request. It failed quietly:
-- the list renders `data ?? []`, so a broken query and an empty result look
-- identical — "0 matching" instead of an error.
--
-- A view's `select *` is expanded and frozen when the view is created, which
-- is why loads_full needs recreating even though its body is unchanged.

grant select (contract_sent), insert (contract_sent), update (contract_sent)
  on table public.loads to authenticated;

-- security_invoker: the caller's own RLS and column grants apply through it,
-- which is what keeps margin off the sales read path.
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
  contract_token, contract_sent_at, contract_sent, contract_signed_name,
  contract_signed_email, contract_requires_card,
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
