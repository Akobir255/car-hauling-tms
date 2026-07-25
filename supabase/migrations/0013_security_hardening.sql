-- Security hardening (v2 — redesigned after adversarial review of v1).
--
--  1. handle_new_user no longer trusts raw_user_meta_data.role — every new
--     auth user starts as 'sales'; real roles are set by trusted admin code.
--  2. current_profile_role() returns NULL for deactivated profiles, which
--     turns off every role-gated policy for offboarded staff at once.
--  3. Margin protection moves from "app convention" into the database via
--     COLUMN-LEVEL grants: the five carrier-money columns (carrier_pay,
--     carrier_received, cod_to_carrier, carrier_id, dispatcher_id) are not
--     readable or writable through the user client at all. Row policies keep
--     sales scoped to their own loads — and sales KEEP base-table row
--     visibility, because Postgres applies SELECT policies to UPDATE...WHERE
--     (v1 removed it and silently broke every sales write).
--  4. Admin/dispatcher reads that need margin columns go through the new
--     loads_full view (owner-rights, role-gated, security_barrier).
--     loads_sales_safe stays security_invoker (so base RLS + grants apply
--     through it) and gains the e-sign columns; both views are stripped of
--     the DML grants Supabase's default privileges would otherwise attach.
--  5. load_vehicles / load_status_history writes are scoped through the
--     parent load instead of "any staff can write anything".
--  6. Owner-branch policies (customers, messages) gain an active-profile
--     gate; payouts (carrier money) become admin/dispatcher-only reads.
--  7. SMS dedupe: same-direction duplicates cleaned up, then enforced by a
--     unique index on (direction, provider_message_id).
--
-- NOTE for future migrations: INSERT/UPDATE/SELECT on loads are now
-- column-scoped. If a later migration adds a loads column the USER client
-- must touch, grant it explicitly:
--   grant select (new_col), insert (new_col), update (new_col)
--     on public.loads to authenticated;
-- and add it to loads_sales_safe / loads_full as appropriate.

-- ============================================================
-- 1. Trigger: never trust client-supplied role
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
    'sales'  -- invited roles are applied by trusted admin code afterwards
  );
  return new;
end;
$$;

-- ============================================================
-- 2. Role helpers require an ACTIVE profile
-- ============================================================
create or replace function public.current_profile_role()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

-- Parent-load access check for child tables (SECURITY DEFINER so child
-- policies don't depend on the caller's loads policies).
create or replace function public.user_can_access_load(l_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.loads l
    join public.profiles p on p.id = auth.uid() and p.active
    where l.id = l_id
      and (p.role in ('admin', 'dispatcher') or l.sales_owner_id = p.id)
  );
$$;

-- ============================================================
-- 3. loads row policies (sales keep row visibility on their own loads —
--    column grants below are what hide the margin columns)
-- ============================================================
drop policy if exists "loads_select_scoped" on loads;
drop policy if exists "loads_insert_staff" on loads;
drop policy if exists "loads_update_scoped" on loads;
drop policy if exists "loads_delete_admin" on loads;

create policy "loads_select_scoped"
  on loads for select
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (public.current_profile_role() = 'sales' and sales_owner_id = auth.uid())
  );

create policy "loads_insert_scoped"
  on loads for insert
  with check (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (public.current_profile_role() = 'sales' and sales_owner_id = auth.uid())
  );

create policy "loads_update_scoped"
  on loads for update
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (public.current_profile_role() = 'sales' and sales_owner_id = auth.uid())
  )
  with check (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (public.current_profile_role() = 'sales' and sales_owner_id = auth.uid())
  );

create policy "loads_delete_admin"
  on loads for delete
  using (public.current_profile_role() = 'admin');

-- ============================================================
-- 4. Column-scoped grants: the five margin columns vanish for the
--    user client (select, insert, and update alike)
-- ============================================================
-- SELECT hides only the MONEY columns — sales legitimately see which carrier
-- hauls their load (dashboard/list filters use carrier_id), just never what
-- it pays. Writes are blocked on all five so assignment can't be tampered
-- with either; managers write them through the service role.
do $$
declare sel_cols text; write_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into sel_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'loads'
    and column_name not in ('carrier_pay', 'carrier_received', 'cod_to_carrier');

  select string_agg(quote_ident(column_name), ', ')
    into write_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'loads'
    and column_name not in
      ('carrier_pay', 'carrier_received', 'cod_to_carrier', 'carrier_id', 'dispatcher_id');

  execute 'revoke select, insert, update on table public.loads from anon, authenticated';
  execute format(
    'grant select (%s), insert (%s), update (%s) on table public.loads to authenticated',
    sel_cols, write_cols, write_cols
  );
end $$;

-- ============================================================
-- 5. Views. loads_sales_safe: security_invoker (base RLS + column grants
--    apply through it), now including the e-sign columns the app reads.
--    loads_full: owner-rights, admin/dispatcher only, ALL columns — the
--    read path for screens that show margin. Both: SELECT-only grants.
-- ============================================================
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

-- ============================================================
-- 6. Child tables scoped through the parent load
-- ============================================================
drop policy if exists "load_vehicles_select_scoped" on load_vehicles;
drop policy if exists "load_vehicles_write_staff" on load_vehicles;
drop policy if exists "load_status_history_select_scoped" on load_status_history;
drop policy if exists "load_status_history_insert_staff" on load_status_history;

create policy "load_vehicles_select_scoped"
  on load_vehicles for select
  using (public.user_can_access_load(load_id));

create policy "load_vehicles_write_scoped"
  on load_vehicles for all
  using (public.user_can_access_load(load_id))
  with check (public.user_can_access_load(load_id));

create policy "load_status_history_select_scoped"
  on load_status_history for select
  using (public.user_can_access_load(load_id));

create policy "load_status_history_insert_scoped"
  on load_status_history for insert
  with check (public.user_can_access_load(load_id));

-- ============================================================
-- 7. Active-profile gate on owner-branch policies; payouts locked down
-- ============================================================
drop policy if exists "customers_select_scoped" on customers;
drop policy if exists "customers_insert_staff" on customers;
drop policy if exists "customers_update_scoped" on customers;

create policy "customers_select_scoped"
  on customers for select
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (public.is_active_staff() and sales_owner_id = auth.uid())
  );

create policy "customers_insert_staff"
  on customers for insert
  with check (public.is_active_staff());

create policy "customers_update_scoped"
  on customers for update
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (public.is_active_staff() and sales_owner_id = auth.uid())
  );

drop policy if exists "messages_select_scoped" on messages;
drop policy if exists "messages_insert_scoped" on messages;
drop policy if exists "messages_update_scoped" on messages;

create policy "messages_select_scoped"
  on messages for select
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (
      public.is_active_staff()
      and customer_id is not null
      and exists (
        select 1 from customers c
        where c.id = messages.customer_id and c.sales_owner_id = auth.uid()
      )
    )
  );

create policy "messages_insert_scoped"
  on messages for insert
  with check (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (
      public.current_profile_role() = 'sales'
      and customer_id is not null
      and exists (
        select 1 from customers c
        where c.id = messages.customer_id and c.sales_owner_id = auth.uid()
      )
    )
  );

create policy "messages_update_scoped"
  on messages for update
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (
      public.is_active_staff()
      and customer_id is not null
      and exists (
        select 1 from customers c
        where c.id = messages.customer_id and c.sales_owner_id = auth.uid()
      )
    )
  );

-- payouts carry per-load carrier money — same boundary as carrier_pay.
drop policy if exists "payouts_select_staff" on payouts;
create policy "payouts_select_admin_dispatcher"
  on payouts for select
  using (public.current_profile_role() in ('admin', 'dispatcher'));

-- ============================================================
-- 8. SMS dedupe: clean same-direction duplicates, then enforce
-- ============================================================
-- Snapshot first: this project has no automatic backups, and the DELETE below
-- is irreversible. Drop this table once the dedupe is confirmed good:
--   drop table messages_backup_pre_0013;
create table if not exists messages_backup_pre_0013 as select * from messages;

delete from messages m
using messages k
where m.provider_message_id = k.provider_message_id
  and m.direction = k.direction
  and m.provider_message_id is not null
  and (k.created_at < m.created_at
       or (k.created_at = m.created_at and k.id < m.id));

create unique index if not exists idx_messages_provider_direction_unique
  on messages (direction, provider_message_id)
  where provider_message_id is not null;
