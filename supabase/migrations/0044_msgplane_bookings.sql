-- Which orders were BOOKED, on what day, by which rep — straight from
-- msgplane's own "Booked Orders" report.
--
-- Why this table exists rather than a one-off script that writes loads.
-- date_signed and walks away:
--
--   * The signed fact is not a field on a msgplane record. It lives in a ticket
--     attached to it ("The order has been signed"), and the Tickets module is
--     access-denied for our login, so there is no list to sweep. The Booked
--     Orders report is the only bulk view of it.
--   * The report answers one day at a time — a date range throws a PHP error —
--     and msgplane serialises requests from a single session, so the sweep runs
--     about a second per day and roughly half an hour for the whole history.
--     That is not something to repeat because a later question needs it.
--   * It carries more than the signed date. Every booking names the rep who
--     made it, which is the only per-record ownership evidence that exists
--     anywhere: campaign is null on all 25,867 loads, dispatcher_id is set on
--     one, and note authorship reaches 1,545. Migration 0040 put the whole book
--     on Leo as a holding position precisely because this did not exist yet.
--
-- So the sweep is kept, not consumed. Later migrations read from here.
--
-- Deliberately keyed (order_number, booked_on): a record can legitimately be
-- booked more than once — signed, cancelled, re-signed — and each is a real
-- event. The load's date_signed takes the most recent.

create table if not exists msgplane_bookings (
  order_number text not null,
  booked_on date not null,
  rep_name text,
  rep_login text,
  -- The report is grouped by rep, so a row with no orders is a rep who booked
  -- nothing that day; those are not stored.
  imported_at timestamptz not null default now(),
  primary key (order_number, booked_on)
);

create index if not exists msgplane_bookings_order_idx on msgplane_bookings (order_number);
create index if not exists msgplane_bookings_date_idx on msgplane_bookings (booked_on);
create index if not exists msgplane_bookings_rep_idx on msgplane_bookings (rep_login);

alter table msgplane_bookings enable row level security;

-- Reference data about the old system: any active member of staff may read it,
-- nobody writes it through the user client. The sweep runs as the service role.
create policy "msgplane_bookings_select_staff"
  on msgplane_bookings for select
  to authenticated
  using (public.is_active_staff());
