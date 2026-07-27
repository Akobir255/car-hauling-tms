-- A do-not-text list keyed by PHONE NUMBER, not by customer row.
--
-- customers.sms_opt_out was the only guard until now, and it has two holes
-- that the msgplane import made impossible to ignore:
--
--   1. The person who replied STOP may have no customer row at all. Fifty-three
--      of the STOP replies recovered from msgplane point at records msgplane
--      itself has since deleted — the obligation not to text them survived the
--      record that created it.
--   2. Lead generators re-sell the same phone number. The same human comes back
--      next month as a brand-new customer row with sms_opt_out = false, and the
--      flag that protected them is attached to a row nobody looks at anymore.
--
-- A number on this list is never texted, whatever record it arrives attached
-- to. The check lives in sendSms(), the single choke point every outbound text
-- passes through, so no future call site can route around it.

create table if not exists sms_suppressions (
  -- Last 10 digits, matching public.normalize_us_phone(). One row per human.
  phone_digits text primary key check (phone_digits ~ '^[0-9]{10}$'),
  reason text not null check (
    reason in ('stop_reply', 'wrong_number', 'complaint', 'manual', 'import')
  ),
  -- What they actually said. The flag is the rule; this is the evidence.
  source_text text,
  opted_out_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_suppressions_opted_out_at
  on sms_suppressions (opted_out_at desc);

alter table sms_suppressions enable row level security;

-- Everyone on staff needs to see it (and the send paths read it as the user).
create policy "sms_suppressions_select_staff"
  on sms_suppressions for select
  to authenticated
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

-- Anyone on staff can add a number — a rep told "stop calling me" on the phone
-- must be able to record it without waiting for an admin.
create policy "sms_suppressions_insert_staff"
  on sms_suppressions for insert
  to authenticated
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

-- Removing someone is the dangerous direction, so it is admin-only.
create policy "sms_suppressions_delete_admin"
  on sms_suppressions for delete
  to authenticated
  using (public.current_profile_role() = 'admin');

-- Is this number suppressed? SECURITY DEFINER so the send path can ask without
-- the caller needing read access to the whole list, and STABLE so a bulk send
-- can call it per recipient without re-planning each time.
create or replace function public.is_phone_suppressed(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from sms_suppressions
    where phone_digits = public.normalize_us_phone(p_phone)
  )
$$;

revoke all on function public.is_phone_suppressed(text) from public;
grant execute on function public.is_phone_suppressed(text) to authenticated, service_role;
