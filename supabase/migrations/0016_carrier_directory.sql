-- Carrier directory: the fields needed to hold US Star's real carrier list,
-- imported from the old system (~4.7k companies sourced from Central Dispatch
-- and Super Dispatch).
--
-- `source` records which loadboard the row came from ('cd' | 'sd' | null for
-- carriers we add ourselves) — the same tag the old system showed, and the
-- reason the same company can legitimately appear twice with different
-- contact details.

alter table carriers
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists source text;

-- Dispatch searches this list by company name constantly, and the import
-- itself dedupes on it.
create index if not exists idx_carriers_company_name_lower
  on carriers (lower(company_name));

create index if not exists idx_carriers_phone on carriers (phone);

-- Trigram index so "vip trans" finds "VIP TRANS EXPRESS INC" mid-string;
-- a plain b-tree can't serve leading-wildcard ILIKE.
create extension if not exists pg_trgm;

create index if not exists idx_carriers_company_name_trgm
  on carriers using gin (company_name gin_trgm_ops);

-- Global search hits customers by name/email/phone too.
create index if not exists idx_customers_contact_name_trgm
  on customers using gin (contact_name gin_trgm_ops);

create index if not exists idx_customers_email_lower on customers (lower(email));
create index if not exists idx_customers_phone on customers (phone);
