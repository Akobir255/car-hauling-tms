-- Car-Hauling Broker TMS — initial schema
-- Tables, enums, RLS policies, and the sales-safe loads view.
-- See C:\Users\User\.claude\plans\zippy-growing-sloth.md for the design this implements.

-- ============================================================
-- Enums
-- ============================================================
create type user_role as enum ('admin', 'dispatcher', 'sales');
create type load_status as enum (
  'quote', 'booked', 'dispatched', 'picked_up', 'in_transit',
  'delivered', 'invoiced', 'paid', 'cancelled'
);
create type transport_type as enum ('open', 'enclosed');
create type vehicle_type as enum ('sedan', 'suv', 'pickup', 'van', 'motorcycle', 'other');
create type vehicle_condition as enum ('running', 'non_running');
create type doc_entity_type as enum ('carrier', 'load');
create type doc_type as enum (
  'coi_insurance', 'w9', 'mc_authority', 'bol_pickup', 'bol_delivery',
  'condition_photo_pickup', 'condition_photo_delivery', 'other'
);
create type message_channel as enum ('sms', 'email', 'internal_note');
create type message_direction as enum ('inbound', 'outbound');
create type message_status as enum ('queued', 'sent', 'delivered', 'failed');
create type invoice_status as enum ('draft', 'sent', 'paid', 'overdue', 'void');
create type payout_status as enum ('pending', 'scheduled', 'paid');

-- ============================================================
-- Tables
-- ============================================================

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role user_role not null default 'sales',
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table carriers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  mc_number text,
  dot_number text,
  contact_name text,
  phone text,
  email text,
  address text,
  insurance_carrier text,
  insurance_policy_number text,
  coi_expiry_date date,
  equipment_types text[] not null default '{}',
  safety_rating text,
  preferred boolean not null default false,
  blacklisted boolean not null default false,
  notes text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  contact_name text not null,
  phone text,
  email text,
  billing_address text,
  sales_owner_id uuid references profiles (id),
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table loads (
  id uuid primary key default gen_random_uuid(),
  load_number text not null unique,
  customer_id uuid not null references customers (id),
  carrier_id uuid references carriers (id),
  status load_status not null default 'quote',
  pickup_address text,
  pickup_city text,
  pickup_state text,
  pickup_zip text,
  pickup_contact_name text,
  pickup_contact_phone text,
  pickup_ready_date date,
  delivery_address text,
  delivery_city text,
  delivery_state text,
  delivery_zip text,
  delivery_contact_name text,
  delivery_contact_phone text,
  delivery_eta date,
  transport_type transport_type not null default 'open',
  distance_miles integer,
  customer_rate numeric(10, 2),
  carrier_pay numeric(10, 2),
  deposit_amount numeric(10, 2),
  balance_due numeric(10, 2),
  sales_owner_id uuid references profiles (id),
  dispatcher_id uuid references profiles (id),
  posted_to_central_dispatch_at timestamptz,
  cd_external_id text,
  posted_to_super_dispatch_at timestamptz,
  sd_external_id text,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table load_vehicles (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id) on delete cascade,
  year integer,
  make text,
  model text,
  vin text,
  vehicle_type vehicle_type not null default 'sedan',
  condition vehicle_condition not null default 'running',
  notes text,
  created_at timestamptz not null default now()
);

create table load_status_history (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id) on delete cascade,
  status load_status not null,
  changed_by uuid references profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  entity_type doc_entity_type not null,
  entity_id uuid not null,
  doc_type doc_type not null,
  storage_path text not null,
  file_name text,
  content_type text,
  expires_at date,
  uploaded_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  load_id uuid references loads (id) on delete cascade,
  carrier_id uuid references carriers (id),
  customer_id uuid references customers (id),
  channel message_channel not null,
  direction message_direction not null,
  from_addr text,
  to_addr text,
  body text not null,
  provider_message_id text,
  status message_status not null default 'queued',
  sent_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id),
  customer_id uuid not null references customers (id),
  invoice_number text not null unique,
  amount numeric(10, 2) not null,
  status invoice_status not null default 'draft',
  due_date date,
  paid_at timestamptz,
  payment_method text,
  external_ref text,
  created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id),
  carrier_id uuid not null references carriers (id),
  amount numeric(10, 2) not null,
  status payout_status not null default 'pending',
  payment_method text,
  paid_at timestamptz,
  reference_number text,
  external_ref text,
  created_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id),
  customer_id uuid not null references customers (id),
  rating integer check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================
create index idx_loads_customer_id on loads (customer_id);
create index idx_loads_carrier_id on loads (carrier_id);
create index idx_loads_status on loads (status);
create index idx_loads_sales_owner_id on loads (sales_owner_id);
create index idx_carriers_coi_expiry on carriers (coi_expiry_date);
create index idx_load_vehicles_load_id on load_vehicles (load_id);
create index idx_load_status_history_load_id on load_status_history (load_id);
create index idx_customers_sales_owner_id on customers (sales_owner_id);
create index idx_documents_entity on documents (entity_type, entity_id);
create index idx_messages_load_id on messages (load_id);

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_carriers_updated_at
  before update on carriers
  for each row execute function public.set_updated_at();

create trigger trg_customers_updated_at
  before update on customers
  for each row execute function public.set_updated_at();

create trigger trg_loads_updated_at
  before update on loads
  for each row execute function public.set_updated_at();

-- ============================================================
-- Auto-create a profile row whenever a Supabase Auth user is created.
-- Admin creates users via the Supabase Admin API (service role, server-side
-- only) passing { full_name, role } in user_metadata.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'sales')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Role helper — security definer so it can read `profiles` without
-- recursing into the RLS policies defined on that same table.
-- ============================================================
create or replace function public.current_profile_role()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table carriers enable row level security;
alter table customers enable row level security;
alter table loads enable row level security;
alter table load_vehicles enable row level security;
alter table load_status_history enable row level security;
alter table documents enable row level security;
alter table messages enable row level security;
alter table invoices enable row level security;
alter table payouts enable row level security;
alter table reviews enable row level security;

-- profiles: everyone can read their own row; admin reads/updates all.
create policy "profiles_select_own_or_admin"
  on profiles for select
  using (id = auth.uid() or public.current_profile_role() = 'admin');

create policy "profiles_update_admin"
  on profiles for update
  using (public.current_profile_role() = 'admin');

-- carriers: all staff can read; admin/dispatcher manage.
create policy "carriers_select_staff"
  on carriers for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "carriers_insert_admin_dispatcher"
  on carriers for insert
  with check (public.current_profile_role() in ('admin', 'dispatcher'));

create policy "carriers_update_admin_dispatcher"
  on carriers for update
  using (public.current_profile_role() in ('admin', 'dispatcher'));

create policy "carriers_delete_admin"
  on carriers for delete
  using (public.current_profile_role() = 'admin');

-- customers: admin/dispatcher see all; sales see only their own.
create policy "customers_select_scoped"
  on customers for select
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or sales_owner_id = auth.uid()
  );

create policy "customers_insert_staff"
  on customers for insert
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "customers_update_scoped"
  on customers for update
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or sales_owner_id = auth.uid()
  );

create policy "customers_delete_admin"
  on customers for delete
  using (public.current_profile_role() = 'admin');

-- loads: admin/dispatcher see all; sales see only their own.
-- NOTE: this grants row-level access to the full `loads` row, including
-- carrier_pay. RLS does not do column-level security — app code for the
-- `sales` role must query the `loads_sales_safe` view (below) instead of
-- this table directly whenever margin must stay hidden from that role.
create policy "loads_select_scoped"
  on loads for select
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or sales_owner_id = auth.uid()
  );

create policy "loads_insert_staff"
  on loads for insert
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "loads_update_scoped"
  on loads for update
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or sales_owner_id = auth.uid()
  );

create policy "loads_delete_admin"
  on loads for delete
  using (public.current_profile_role() = 'admin');

-- load_vehicles / load_status_history: follow the parent load's visibility.
create policy "load_vehicles_select_scoped"
  on load_vehicles for select
  using (
    exists (
      select 1 from loads l
      where l.id = load_vehicles.load_id
        and (
          public.current_profile_role() in ('admin', 'dispatcher')
          or l.sales_owner_id = auth.uid()
        )
    )
  );

create policy "load_vehicles_write_staff"
  on load_vehicles for all
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'))
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "load_status_history_select_scoped"
  on load_status_history for select
  using (
    exists (
      select 1 from loads l
      where l.id = load_status_history.load_id
        and (
          public.current_profile_role() in ('admin', 'dispatcher')
          or l.sales_owner_id = auth.uid()
        )
    )
  );

create policy "load_status_history_insert_staff"
  on load_status_history for insert
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

-- documents / messages / invoices / payouts / reviews: Phase 2/3 tables.
-- Broad staff-read / admin-dispatcher-write policies for now — revisit
-- with finer scoping once those features are built.
create policy "documents_select_staff"
  on documents for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "documents_write_staff"
  on documents for all
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'))
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "messages_select_staff"
  on messages for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "messages_write_staff"
  on messages for all
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'))
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "invoices_select_staff"
  on invoices for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "invoices_write_admin"
  on invoices for all
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "payouts_select_staff"
  on payouts for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "payouts_write_admin"
  on payouts for all
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "reviews_select_staff"
  on reviews for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "reviews_write_staff"
  on reviews for all
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'))
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

-- ============================================================
-- Sales-safe loads view (excludes carrier_pay / margin).
-- security_invoker so it runs with the QUERYING user's RLS, not the
-- view owner's — required for the loads_select_scoped policy to apply.
-- ============================================================
create view loads_sales_safe
  with (security_invoker = on) as
select
  id, load_number, customer_id, carrier_id, status,
  pickup_address, pickup_city, pickup_state, pickup_zip,
  pickup_contact_name, pickup_contact_phone, pickup_ready_date,
  delivery_address, delivery_city, delivery_state, delivery_zip,
  delivery_contact_name, delivery_contact_phone, delivery_eta,
  transport_type, distance_miles, customer_rate, deposit_amount, balance_due,
  sales_owner_id, dispatcher_id, created_at, updated_at
from loads;
