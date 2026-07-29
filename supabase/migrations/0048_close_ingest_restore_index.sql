-- Close the ingest door, and put the booking index back under its real name.
--
-- Two loose ends from 0047, which was written to prepare a re-sweep that then
-- turned out not to be needed:
--
--   1. It re-created ingest_msgplane_bookings, an anon-callable insert
--      function. The re-sweep is not happening, so it has no reason to exist.
--   2. It truncated msgplane_bookings after copying the rows to
--      msgplane_bookings_truncated_0047, leaving the live table empty and the
--      whole 61,611-row index sitting under a name that reads like a discard.
--
-- On the truncation that started all this: the order-number suffix IS
-- meaningful -- trailing 0 means the carrier cancelled, 00 twice, no hyphen a
-- duplicate -- and the first sweep's /\d{8}-?US/ dropped the trailing digits.
-- That remains a real flaw in the index and is worth re-collecting one day.
--
-- What it did NOT do is affect date_signed. 0046 matched on the 8-digit core,
-- substring(load_number from '(\d{8})'), which ignores the suffix entirely, and
-- our 25,867 load numbers have 25,867 distinct cores, so the join was 1:1 with
-- or without it. Rolling the signed dates back was an over-correction on my
-- part; they have been restored from the preserved rows and stand at 766.
--
-- So the index is kept as it is, flagged as suffix-truncated in a comment
-- rather than thrown away, and a future re-sweep can replace it in place.

insert into public.msgplane_bookings (order_number, booked_on, rep_name, rep_login)
select order_number, booked_on, rep_name, rep_login
  from public.msgplane_bookings_truncated_0047
on conflict (order_number, booked_on) do nothing;

comment on table public.msgplane_bookings is
  'Every order msgplane booked, 2022-01-01 .. 2026-07-28, from Reports > Booked Orders. 61,611 rows. CAVEAT: collected with /\d{8}-?US/, so trailing suffixes are truncated -- a trailing 0 (carrier cancelled) or 00 (cancelled twice) is not visible here. The no-hyphen duplicate form survived. Re-collect with /\d{8}-?US\d*/ when the suffix matters; matching on the 8-digit core is unaffected.';

drop table if exists public.msgplane_bookings_truncated_0047;

-- The door closes. Nothing anon can write to this database again.
drop function if exists public.ingest_msgplane_bookings(text, jsonb);
