-- Ownership becomes an EDIT boundary instead of a VISIBILITY one.
--
-- Reported from the floor: a newly created rep searched another rep's order
-- number and got "0 orders, 0 shippers, 0 carriers". The record was not
-- locked, it was INVISIBLE — loads_select_scoped and customers_select_scoped
-- restricted sales to sales_owner_id = auth.uid(), so search, the shipper
-- lookup and the whole record simply did not exist for anybody else.
--
-- That is not how the desk runs. Whoever picks up the phone has to be able to
-- pull up any order by number, by the shipper's name or phone, or by the
-- carrier hauling it. What they must NOT be able to do is change it.
--
-- WHAT CHANGES: select policies on loads, customers and the children of a
-- load widen to "any active member of staff".
--
-- WHAT DOES NOT CHANGE:
--   * Every insert/update/delete policy. A sales rep still writes only rows
--     they own; managers still write anything.
--   * Margin. carrier_pay / carrier_received / cod_to_carrier are hidden by
--     COLUMN grants (0013), which are orthogonal to which ROWS are visible.
--     Sales read through loads_sales_safe, which has no such column, and
--     loads_full stays gated to admin/dispatcher. A rep browsing somebody
--     else's order sees the tariff, never the spread.
--   * messages. The SMS/email thread with a shipper stays with the rep who
--     owns that shipper — a shared record is not a shared inbox.
--   * contract_cards. Masked, but it still carries the signer's name and
--     billing address; a passing reader has no business with it.
--
-- Why widening SELECT cannot widen writes: for UPDATE and DELETE, Postgres
-- requires the row to satisfy the UPDATE/DELETE policy, AND — because the
-- statement reads the row, which PostgREST's WHERE clause always makes it do
-- — a SELECT policy as well. The two are ANDed, so a broader SELECT policy
-- only ever adds rows a write policy then still has to accept. (Migration
-- 0013 leaned on the same rule in the opposite direction: v1 of it REMOVED
-- sales' select on loads and silently broke every sales write.)
--
-- The app has to carry the other half of this: with RLS no longer scoping a
-- rep's own lists, the pipelines, dashboard and bulk sends now say
-- sales_owner_id = me in the query itself.

-- ============================================================
-- 1. Loads and shippers: readable by any active staff
-- ============================================================
drop policy if exists "loads_select_scoped" on loads;
create policy "loads_select_scoped"
  on loads for select
  using (public.is_active_staff());

drop policy if exists "customers_select_scoped" on customers;
create policy "customers_select_scoped"
  on customers for select
  using (public.is_active_staff());

-- ============================================================
-- 2. Children of a load follow the load
-- ============================================================
-- These all used public.user_can_access_load(), which answers "may I WORK
-- this load" — still the right question for writing them, and still what
-- their insert/update/delete policies ask. Reading only needs "am I staff":
-- a row cannot exist without a parent load, and every load is now readable.
--
-- Note that load_vehicles also carries a FOR ALL policy whose USING clause
-- covers select. Permissive policies are ORed, so the broader select policy
-- below decides reads; the FOR ALL one still governs writes on its own.
drop policy if exists "load_vehicles_select_scoped" on load_vehicles;
create policy "load_vehicles_select_scoped"
  on load_vehicles for select
  using (public.is_active_staff());

drop policy if exists "load_status_history_select_scoped" on load_status_history;
create policy "load_status_history_select_scoped"
  on load_status_history for select
  using (public.is_active_staff());

drop policy if exists "load_notes_select_scoped" on load_notes;
create policy "load_notes_select_scoped"
  on load_notes for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists "load_requests_select_scoped" on load_requests;
create policy "load_requests_select_scoped"
  on load_requests for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists "contract_versions_select_scoped" on contract_versions;
create policy "contract_versions_select_scoped"
  on contract_versions for select
  to authenticated
  using (public.is_active_staff());
