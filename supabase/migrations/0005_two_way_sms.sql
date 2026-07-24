-- Two-way SMS — inbound replies land in `messages` via the RingCentral
-- webhook (service role), so no new tables. This adds:
--   1. read_at on messages, for the unread-inbound badge and Mark-all-read.
--   2. A phone normalizer + expression index so an inbound from-number can
--      be matched to a customer without scanning formats ("(555) 123-4567"
--      vs "+15551234567").
--
-- find_customer_by_phone runs with INVOKER rights on purpose: the webhook
-- calls it with the service role (bypasses RLS), while any anon/authenticated
-- caller is still filtered by the customers RLS policies — so it cannot be
-- used to probe which phone numbers are customers.

alter table messages
  add column read_at timestamptz;

-- Partial index: the unread counter only ever asks "inbound and not read".
create index idx_messages_unread_inbound
  on messages (created_at)
  where direction = 'inbound' and read_at is null;

-- Per-customer conversation threads.
create index idx_messages_customer_created
  on messages (customer_id, created_at);

-- Last 10 digits of a US number; '' when there aren't 10 digits to compare.
create or replace function public.normalize_us_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 10
      then right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
    else ''
  end
$$;

create index idx_customers_phone_normalized
  on customers (public.normalize_us_phone(phone));

create or replace function public.find_customer_by_phone(p_phone text)
returns uuid
language sql
stable
set search_path = public
as $$
  select id from customers
  where normalize_us_phone(p_phone) <> ''
    and normalize_us_phone(phone) = normalize_us_phone(p_phone)
  order by updated_at desc
  limit 1
$$;

-- ------------------------------------------------------------
-- Tighten messages RLS. 0001 left messages on broad staff-wide
-- policies ("revisit with finer scoping once those features are built") —
-- that was fine while the table held only staff-authored outbound blasts,
-- but two-way SMS puts customer-authored conversations in here, and those
-- must follow the same scoping as customers: sales reps see only their own
-- customers' threads. Unmatched inbound (no customer_id) is
-- admin/dispatcher-only. The webhook inserts via service role, which
-- bypasses RLS and is unaffected.
-- ------------------------------------------------------------
drop policy "messages_select_staff" on messages;
drop policy "messages_write_staff" on messages;

create policy "messages_select_scoped"
  on messages for select
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (
      customer_id is not null
      and exists (
        select 1 from customers c
        where c.id = messages.customer_id
          and c.sales_owner_id = auth.uid()
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
        where c.id = messages.customer_id
          and c.sales_owner_id = auth.uid()
      )
    )
  );

-- Update covers read_at flips (Mark all read); same visibility scoping.
create policy "messages_update_scoped"
  on messages for update
  using (
    public.current_profile_role() in ('admin', 'dispatcher')
    or (
      customer_id is not null
      and exists (
        select 1 from customers c
        where c.id = messages.customer_id
          and c.sales_owner_id = auth.uid()
      )
    )
  );

create policy "messages_delete_admin"
  on messages for delete
  using (public.current_profile_role() = 'admin');
