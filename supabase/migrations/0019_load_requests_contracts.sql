-- Load Requests + contract versioning + card-on-contract.
--
-- 1. load_requests: the manual carrier-offer log msgplane shows at the top of
--    every order — a dispatcher types the price/carrier/dates a carrier called
--    in with, tagged CD or SD. No external API involved; it's a notebook.
-- 2. contract_versions: each "send" of the customer contract is a version with
--    its own token. "Change terms & send" supersedes the old version;
--    "make current" restores one. loads.* stays the pipeline's source of truth
--    and always mirrors the CURRENT version.
-- 3. contract_cards: what the customer entered on a card-required contract.
--    THE FULL CARD NUMBER AND CVV ARE NEVER STORED OR EVEN SENT TO THE SERVER —
--    the signing page keeps them client-side and submits brand/last4/expiry/
--    billing only. Real vaulting arrives with the payment processor (Phase 3).
-- 4. loads.contract_requires_card: whether the current contract's signing page
--    asks for card details.

-- ============================================================
-- 1. Load Requests
-- ============================================================
create table if not exists load_requests (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id) on delete cascade,
  price numeric(10, 2),
  requested_on date not null default current_date,
  carrier_id uuid references carriers (id) on delete set null,
  carrier_name text not null,
  phone text,
  city text,
  state text,
  pickup_date date,
  delivery_date date,
  source text check (source in ('cd', 'sd')),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_load_requests_load
  on load_requests (load_id, created_at desc);

alter table load_requests enable row level security;

create policy "load_requests_select_scoped"
  on load_requests for select
  to authenticated
  using (public.user_can_access_load(load_id));

create policy "load_requests_insert_scoped"
  on load_requests for insert
  to authenticated
  with check (public.user_can_access_load(load_id) and created_by = auth.uid());

create policy "load_requests_delete_own_or_manager"
  on load_requests for delete
  to authenticated
  using (
    public.user_can_access_load(load_id)
    and (created_by = auth.uid() or public.current_profile_role() in ('admin', 'dispatcher'))
  );

-- ============================================================
-- 2. Contract versions
-- ============================================================
create table if not exists contract_versions (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id) on delete cascade,
  token uuid not null unique,
  requires_card boolean not null default false,
  tariff numeric(10, 2),
  deposit numeric(10, 2),
  note text,
  sent_at timestamptz,
  sent_via text,
  superseded_at timestamptz,
  signed_at timestamptz,
  signed_name text,
  -- Drawn-signature PNG data URL, written only by the sign flow (service
  -- role). Lives here rather than on loads so list queries never drag it in.
  signature_image text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_versions_load
  on contract_versions (load_id, created_at desc);

alter table contract_versions enable row level security;

create policy "contract_versions_select_scoped"
  on contract_versions for select
  to authenticated
  using (public.user_can_access_load(load_id));

create policy "contract_versions_insert_scoped"
  on contract_versions for insert
  to authenticated
  with check (public.user_can_access_load(load_id) and created_by = auth.uid());

-- Superseding / restoring a version — any staff who can see the load; the
-- sensitive part (which token the sign page honors) lives on loads anyway.
create policy "contract_versions_update_scoped"
  on contract_versions for update
  to authenticated
  using (public.user_can_access_load(load_id))
  with check (public.user_can_access_load(load_id));

-- ============================================================
-- 3. Card-on-contract (masked; service-role writes only)
-- ============================================================
create table if not exists contract_cards (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id) on delete cascade,
  contract_version_id uuid references contract_versions (id) on delete set null,
  cardholder_first text not null default '',
  cardholder_last text not null default '',
  brand text,
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  exp_month int check (exp_month between 1 and 12),
  exp_year int check (exp_year between 2020 and 2100),
  billing_address text,
  billing_city text,
  billing_state text,
  billing_zip text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_cards_load
  on contract_cards (load_id, created_at desc);

alter table contract_cards enable row level security;

-- Staff may READ (to verify a deposit method exists). There is deliberately
-- NO insert/update policy for authenticated: rows are written exclusively by
-- the public signing action through the service role.
create policy "contract_cards_select_scoped"
  on contract_cards for select
  to authenticated
  using (public.user_can_access_load(load_id));

create policy "contract_cards_delete_manager"
  on contract_cards for delete
  to authenticated
  using (public.current_profile_role() in ('admin', 'dispatcher'));

-- ============================================================
-- 4. loads.contract_requires_card (+ view/grant upkeep per 0013's rules)
-- ============================================================
alter table loads
  add column if not exists contract_requires_card boolean not null default false;

-- 0013 made loads grants column-scoped, so a new column must be granted
-- explicitly for the user client (it is not margin data).
grant select (contract_requires_card), insert (contract_requires_card),
  update (contract_requires_card) on public.loads to authenticated;

-- Views capture their column list at creation time — recreate both so the
-- new column flows through (loads_full is SELECT * but still snapshots).
drop view if exists loads_sales_safe;
create view loads_sales_safe
  with (security_invoker = on) as
select
  id, load_number, customer_id, carrier_id, dispatcher_id, status,
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
  sales_owner_id, follow_up_at, follow_up_note,
  contract_token, contract_sent_at, contract_signed_name, contract_signed_email,
  contract_requires_card,
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
