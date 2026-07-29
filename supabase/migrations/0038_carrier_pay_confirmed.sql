-- carrier_pay has never been a recorded fact. createLoad derives it as
-- customer_rate - deposit_amount and writes the result into the SAME column
-- that later holds the number actually agreed with a carrier. Nothing marks
-- which is which, so every margin figure the business reads is an average of
-- settlements and arithmetic.
--
-- Measured on the live database before this migration:
--
--   * 18,539 of 25,403 priced loads (73%) carry a spread of exactly $100 --
--     to the cent. That is msgplane's default reservation fee coming through
--     the formula, not a negotiation.
--   * Loads created in May, June and July 2026 -- current, real usage -- have
--     a MEDIAN recorded fee of 0.0%. A blank reservation fee makes
--     carrier_pay equal customer_rate, so the system records a load on which
--     the brokerage earned nothing. The house fee is ~20%.
--
-- The estimate itself has to stay: it is the figure posted to Central
-- Dispatch and Super Dispatch before any carrier has been found. What it must
-- not do is masquerade as the settled number once one has.

alter table loads
  add column if not exists carrier_pay_confirmed boolean not null default false;

comment on column loads.carrier_pay_confirmed is
  'True once carrier_pay holds a figure a human agreed with a carrier. False means it is still customer_rate - deposit_amount, i.e. an offer, not a settlement. Margin reporting must filter on this.';

-- Backfill. A load whose carrier_pay still equals customer_rate - deposit is
-- untouched arithmetic. Anything that DIFFERS was overridden by a person, or
-- by the import repair in scripts/import-fixes/03-carrier-pay.mjs, which
-- restored the real "Carrier:$N" figures printed on msgplane's list rows --
-- either way, a real number.
update loads
   set carrier_pay_confirmed = true
 where carrier_pay is not null
   and customer_rate is not null
   and abs(carrier_pay - (customer_rate - coalesce(deposit_amount, 0))) > 0.005;

-- No column grant to `authenticated`, deliberately, and this is the one case
-- where 0013's checklist does NOT apply. carrier_pay_confirmed is written only
-- through the service role (same path as carrier_pay itself) and read only
-- through loads_full, which is a definer view gated on role -- neither touches
-- the caller's column grants. It stays OUT of loads_sales_safe because sales
-- cannot see carrier_pay at all, so its provenance means nothing to them.
--
-- loads_full still has to be recreated: `select *` is expanded and frozen at
-- creation, so without this the new column simply is not in the view. That is
-- the exact defect 0029 was written to fix.
drop view if exists loads_full;
create view loads_full
  with (security_barrier = true) as
select * from loads
where public.current_profile_role() in ('admin', 'dispatcher');

revoke all on loads_full from anon, authenticated;
grant select on loads_full to authenticated;
