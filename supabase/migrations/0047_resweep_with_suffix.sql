-- Re-do the booking sweep, keeping the order number msgplane actually prints.
--
-- The suffix is not noise. Per the operator:
--
--     trailing 0    the order was cancelled by the carrier
--     trailing 00   cancelled twice
--     no hyphen     a duplicated order
--
-- The first sweep matched with /\d{8}-?US/, which stops at "US". The
-- no-hyphen form survived, because the hyphen was already optional, but every
-- trailing digit was silently dropped: msgplane's own Booked Orders report
-- carries 31520672-US0 and 31514609-US0 on 2024-10-24, and 30541256-US0 on
-- 2026-03-19, and all three were written to msgplane_bookings as plain -US.
-- On three sampled days 3 of 83 orders carried a suffix, so on the order of
-- 2,000 of the 61,611 rows are wrong.
--
-- It reached past the table, too: 0046 matched loads on the 8-digit core, so a
-- booking that was really -US0 stamped date_signed onto the plain -US record.
--
-- This migration does the reversible half. The sweep itself has to be re-run
-- from the browser with /\d{8}-?US\d*/, after which a later migration
-- recomputes date_signed from the corrected rows.

-- ============================================================
-- 1. Snapshot, so the recompute can be undone
-- ============================================================
-- 0046 filled date_signed in place and kept no record of which rows it touched,
-- which is the reason this cannot simply be reversed. Fixed here, before
-- anything else is written.
create table if not exists loads_date_signed_pre_0047 as
  select id, load_number, date_signed from public.loads;

create table if not exists msgplane_bookings_truncated_0047 as
  select * from public.msgplane_bookings;

-- ============================================================
-- 2. Clear the truncated sweep
-- ============================================================
-- Not a delete-where-suffix-missing: the truncation is indistinguishable from a
-- genuine -US booking once written, so every row is suspect and the whole set
-- is re-collected. The copy above keeps the old rows for comparison.
truncate table public.msgplane_bookings;

-- ============================================================
-- 3. Re-open the ingest door for the re-run
-- ============================================================
-- 0046 dropped this, correctly, because the sweep was finished. It is needed
-- once more. A new token, so the old one cannot be replayed, and a longer
-- order_number column check is not required — the column is already text.
create or replace function public.ingest_msgplane_bookings(p_token text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if p_token is distinct from 'resweep-2026-07-29-b73c' then
    raise exception 'bad token';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'batch too large';
  end if;

  insert into msgplane_bookings (order_number, booked_on, rep_name, rep_login)
  select r ->> 'o', (r ->> 'd')::date, nullif(r ->> 'n', ''), nullif(r ->> 'l', '')
    from jsonb_array_elements(p_rows) r
   where r ->> 'o' is not null and r ->> 'd' is not null
  on conflict (order_number, booked_on) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ingest_msgplane_bookings(text, jsonb) from public;
grant execute on function public.ingest_msgplane_bookings(text, jsonb) to anon, authenticated;

-- ============================================================
-- 4. Roll date_signed back to what it was before 0046
-- ============================================================
-- The recompute runs against the corrected sweep, so the values 0046 derived
-- from truncated numbers are removed rather than left to be overwritten --
-- some of them will not be re-derived, and a wrong date that survives because
-- nothing replaced it is worse than a blank.
alter table public.loads disable trigger trg_loads_updated_at;

update public.loads l
   set date_signed = s.date_signed
  from loads_date_signed_pre_0047 s
 where s.id = l.id
   and l.date_signed is distinct from s.date_signed;

-- Everything 0046 added, undone: back to the 337 that came from the order
-- import with a real timestamp.
update public.loads l
   set date_signed = null
  from msgplane_bookings_truncated_0047 b
 where substring(l.load_number from '(\d{8})') = substring(b.order_number from '(\d{8})')
   and l.date_signed is not null
   and l.date_signed = b.booked_on;

alter table public.loads enable trigger trg_loads_updated_at;
