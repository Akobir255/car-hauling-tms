-- refresh_lane_price_stats() now folds quote_outcomes into the win/loss counts.
--
-- 0057 built quote_outcomes as THE asset — the reason a quote died, at what
-- price, against whose — and then computed n_won/n_lost from load status alone,
-- so a recorded outcome never moved a published number. Every row a rep types
-- into that form from now on was going to be ignored by the very statistics it
-- exists to improve. This closes that loop:
--
--   won:  the load reached a won status, OR someone recorded a 'won' outcome
--   lost: cancelled/lost status, OR a 'lost' or 'expired' outcome
--
-- A load is counted ONCE, and won wins the argument: reaching a won status is a
-- fact about the freight, an outcome row is a human's account of it, and a load
-- that moved is not "lost" however its paperwork reads. The lost count is
-- therefore gated on NOT being won, so no load can sit in both columns and
-- n_won + n_lost can never exceed n_quoted.
--
-- bool_or over an empty lateral returns NULL, not false, and a NULL inside
-- `not (...)` makes the whole lost filter NULL — which FILTER treats as false,
-- silently dropping every plain cancelled load with no outcome rows. Hence the
-- coalesce on both flags; the counts are wrong without it.
--
-- Everything 0058 established stays: SECURITY DEFINER to reach the hidden book,
-- service-role-only execution, `delete ... where true` for pg_safeupdate, and
-- the >= 10 floor that keeps a published row an aggregate no one can turn back
-- into a customer's price. Body otherwise identical to 0058.

create or replace function public.refresh_lane_price_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  -- pg_safeupdate rejects a bare DELETE even inside SECURITY DEFINER; `where
  -- true` is the documented "yes, all of them, on purpose" (see 0058).
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
    -- Won by status or by recorded outcome.
    count(*) filter (where
      l.status in (
        'ready','posted_cd','posted_sd','booked','dispatched','picked_up',
        'in_transit','delivered','invoiced','paid'
      )
      or coalesce(o.any_won, false)
    ),
    -- Lost by status or by recorded outcome — but never a load already counted
    -- as won. The `not (...)` mirrors the won filter above verbatim; if one
    -- changes, both must.
    count(*) filter (where
      not (
        l.status in (
          'ready','posted_cd','posted_sd','booked','dispatched','picked_up',
          'in_transit','delivered','invoiced','paid'
        )
        or coalesce(o.any_won, false)
      )
      and (l.status in ('cancelled','lost') or coalesce(o.any_lost, false))
    )
  from loads l
  left join lateral (
    select vehicle_type from load_vehicles lv where lv.load_id = l.id limit 1
  ) v on true
  -- A load can carry several outcome rows (an expiry, then a correction);
  -- collapse them to two booleans so each load is still one input row.
  left join lateral (
    select
      bool_or(q.outcome = 'won')                as any_won,
      bool_or(q.outcome in ('lost', 'expired')) as any_lost
    from quote_outcomes q
    where q.load_id = l.id
  ) o on true
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

comment on function public.refresh_lane_price_stats() is
  'Rebuilds lane_price_stats from the whole book, hidden rows included, folding quote_outcomes into the win/loss counts (won by status or won outcome; lost by cancelled status or lost/expired outcome; never both). Service role only. Publishes a lane only at >=10 loads, which is both the statistical floor and what stops an aggregate describing one customer.';
