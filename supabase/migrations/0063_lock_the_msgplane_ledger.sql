-- Take the old system's booking ledger away from staff too.
--
-- `msgplane_bookings` (0044) is reference data about the system this one
-- replaced: order number, booked-on date, and the rep who booked it. 400 rows.
-- 0044 gave every active staff member select on it, on the reasoning that it is
-- "reference data about the old system".
--
-- Two things have changed since:
--
--   * the 0052-0056 sweep hid the book from logged-in users, and this table was
--     missed -- it has no `hidden_at` and no policy that checks one, so it is
--     one of the few tables a rep can still read in bulk today;
--   * nothing in the application reads it. Confirmed: no reference to
--     `msgplane_bookings` anywhere under src/. It is queried by the service
--     role or not at all.
--
-- A per-rep production ranking of the old system is not customer data and this
-- is not urgent. But a table that no code reads should not be granted to
-- everyone who can log in, so it goes behind the service role with the rest of
-- the historical tables that 0062 locked.
--
-- To reverse:
--   grant select on public.msgplane_bookings to authenticated;
--   -- and recreate the 0044 policy if you want the row check back.

do $$
begin
  if to_regclass('public.msgplane_bookings') is null then
    raise notice 'msgplane_bookings not present, nothing to lock';
    return;
  end if;

  drop policy if exists "msgplane_bookings_select_staff" on public.msgplane_bookings;
  revoke all on public.msgplane_bookings from anon, authenticated;

  raise notice 'locked msgplane_bookings';
end $$;

comment on table public.msgplane_bookings is
  'Booking ledger imported from the msgplane system: order number, booked-on date, booking rep. Service role only as of 0063 -- no application code reads it, and the 0052-0056 hide sweep never covered it. Read it with the service role.';
