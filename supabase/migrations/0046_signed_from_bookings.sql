-- Fill date_signed from msgplane's own Booked Orders report, and close the
-- ingest door behind the sweep.
--
-- The reported bug: Paperwork -> Signed returned nothing on Quotes, Hold and
-- Archived. It was not the filter. 0 of 25,109 quote-stage records carried a
-- date_signed; all 337 we held were order-stage, because the signed fact is not
-- a field on a msgplane record — it lives in a ticket attached to it, and the
-- Tickets module is access-denied for our login. The Booked Orders report
-- (Reports -> Booked Orders, one day per request) is the only bulk view of it,
-- and migration 0044 keeps the sweep of it in msgplane_bookings.
--
-- Matching is on the 8-digit core, not the whole string: both sides carry the
-- number in two shapes, "31543214-US" and "31542734US", and an exact join
-- silently drops every unhyphenated one.
--
-- A record booked more than once (signed, cancelled, re-signed) takes the most
-- recent booking. Records that already carry a date_signed are left alone —
-- those came from the order import and are more precise than a day.

alter table public.loads disable trigger trg_loads_updated_at;

do $$
declare n bigint;
begin
  update public.loads l
     set date_signed = b.last_booked
    from (
      select substring(order_number from '(\d{8})') as core,
             max(booked_on) as last_booked
        from public.msgplane_bookings
       where substring(order_number from '(\d{8})') is not null
       group by 1
    ) b
   where substring(l.load_number from '(\d{8})') = b.core
     and l.date_signed is null;
  get diagnostics n = row_count;
  raise notice 'date_signed set on % loads from msgplane bookings', n;
end $$;

alter table public.loads enable trigger trg_loads_updated_at;

-- The sweep is finished, so the write-only door from 0045 closes. It existed
-- to keep ~40,000 rows out of the tool transcript and had no other purpose;
-- leaving an anon-callable insert endpoint open afterwards would be sloppy.
drop function if exists public.ingest_msgplane_bookings(text, jsonb);
