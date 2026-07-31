-- refresh_lane_price_stats() could not run: "DELETE requires a WHERE clause".
--
-- Supabase enables pg_safeupdate, which rejects an unqualified DELETE or UPDATE
-- to stop somebody wiping a table from the SQL editor by mistake. It applies
-- inside a SECURITY DEFINER function too — the guard is on the statement, not
-- on who is running it.
--
-- `where true` is the documented way to say "yes, all of them, on purpose".
-- TRUNCATE would also work and would be faster, but it takes an ACCESS
-- EXCLUSIVE lock, and this rebuild is meant to be runnable during the day
-- without blocking readers of a table the quote screen is querying.
--
-- Body otherwise identical to 0057.

create or replace function public.refresh_lane_price_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  delete from lane_price_stats where true;

  insert into lane_price_stats (
    origin_state, destination_state, vehicle_class, transport,
    n_quoted, p25, median, p75, n_won, n_lost
  )
  select
    upper(l.pickup_state), upper(l.delivery_state),
    coalesce(v.vehicle_type::text, 'any'),
    coalesce(l.transport_type::text, 'any'),
    count(*),
    percentile_cont(0.25) within group (order by l.customer_rate)::numeric(10,2),
    percentile_cont(0.50) within group (order by l.customer_rate)::numeric(10,2),
    percentile_cont(0.75) within group (order by l.customer_rate)::numeric(10,2),
    count(*) filter (where l.status in (
      'ready','posted_cd','posted_sd','booked','dispatched','picked_up',
      'in_transit','delivered','invoiced','paid'
    )),
    count(*) filter (where l.status in ('cancelled','lost'))
  from loads l
  left join lateral (
    select vehicle_type from load_vehicles lv where lv.load_id = l.id limit 1
  ) v on true
  where l.customer_rate is not null
    and l.customer_rate > 0
    and l.pickup_state is not null
    and l.delivery_state is not null
  group by 1, 2, 3, 4
  -- Ten loads minimum: the statistical floor, and what stops a published
  -- aggregate from describing one customer's price.
  having count(*) >= 10;

  get diagnostics written = row_count;
  return written;
end $$;

revoke all on function public.refresh_lane_price_stats() from public, anon, authenticated;
