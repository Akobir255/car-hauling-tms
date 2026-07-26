-- Phone numbers were entered inconsistently over time — some rows hold raw
-- digits ("3463819554"), others formatted text ("(865) 328-7418"). Searching
-- either way used to miss half the table.
--
-- A stored generated column normalises to digits once, at write time, so the
-- global search can match on digits regardless of how the number was typed.
-- Generated (not a trigger) so it can never drift from `phone`.

alter table customers
  add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored;

alter table carriers
  add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored;

-- Searches are "ends with these digits" / "contains these digits", so a
-- trigram index is what serves them.
create index if not exists idx_customers_phone_digits_trgm
  on customers using gin (phone_digits gin_trgm_ops);

create index if not exists idx_carriers_phone_digits_trgm
  on carriers using gin (phone_digits gin_trgm_ops);
