-- Stop computing headline numbers from a truncated page of rows.
--
-- PostgREST caps a response at 1,000 rows (max_rows). Several screens fetched a
-- set and reduced it in JavaScript, so every one of them was reducing an
-- arbitrary 1,000-row slice and presenting the answer as fact:
--
--   dashboard   the 60-day window is 1,756 rows. Revenue (30d) rendered about
--               $370,000 against a true $624,740, and the growth arrow read
--               +220% against a true +28%. The vehicle donut was drawn from
--               1,000 of 26,137 rows, and the "follow-ups due" KPI printed the
--               length of a .limit(6) query -- it could never exceed 6, against
--               18,278 actually due.
--   /loads      status tab counts tallied from 1,000 of 25,867, so the "All"
--               tab always read exactly 1000.
--
-- Aggregates are exempt from the row cap because they return one row, so the
-- fix is to do the arithmetic in Postgres. Both functions are SECURITY DEFINER
-- (they read `loads` directly, past RLS) and therefore re-apply the scoping
-- rules themselves:
--
--   * a NULL role -- deactivated staff, or nobody -- gets NULL, not numbers.
--   * 'sales' is pinned to its own rows, whatever the caller passes. Migration
--     0037 made ownership an edit boundary rather than a visibility one, but a
--     rep's OWN dashboard is still their own book, and a definer function must
--     not become the hole that hands one rep another rep's totals.
--   * only customer_rate is summed. carrier_pay and its two siblings are never
--     read here, so the margin boundary from 0013 is untouched.

-- ============================================================
-- 1. Dashboard headline numbers
-- ============================================================
-- The follow-up cutoff is a parameter rather than now(): "due" means the end of
-- the day in the BUSINESS timezone, which lives in one place in the app
-- (endOfBusinessDay). Passing it keeps this function from having a second,
-- silently different opinion about when today ends.
create or replace function public.dashboard_stats(p_follow_up_cutoff timestamptz)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  r public.user_role := public.current_profile_role();
  own uuid;
begin
  if r is null then
    return null;
  end if;
  own := case when r = 'sales' then auth.uid() else null end;

  return jsonb_build_object(
    -- Both bounds. These had a lower bound only, so the 79 loads carrying a
    -- created_at in the future counted as "new this week" every week, forever.
    'new_last_7', (
      select count(*) from loads
       where (own is null or sales_owner_id = own)
         and created_at >= now() - interval '7 days' and created_at <= now()
    ),
    'new_prev_7', (
      select count(*) from loads
       where (own is null or sales_owner_id = own)
         and created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'
    ),
    'rev_last_30', (
      select coalesce(sum(customer_rate), 0) from loads
       where (own is null or sales_owner_id = own)
         and status <> 'cancelled'
         and created_at >= now() - interval '30 days' and created_at <= now()
    ),
    'rev_prev_30', (
      select coalesce(sum(customer_rate), 0) from loads
       where (own is null or sales_owner_id = own)
         and status <> 'cancelled'
         and created_at >= now() - interval '60 days' and created_at < now() - interval '30 days'
    ),
    'follow_ups_due', (
      select count(*) from loads
       where (own is null or sales_owner_id = own)
         and follow_up_at is not null
         and follow_up_at <= p_follow_up_cutoff
         and status in ('lead','quote','ready','booked','posted_cd','posted_sd',
                        'dispatched','picked_up','delivered','invoiced')
    ),
    -- One row per day for the last 30, zero-filled: a day with no loads has to
    -- appear as a flat step in the chart, not as a missing point.
    'revenue_points', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'value', v) order by d), '[]'::jsonb)
        from (
          select d, coalesce((
            select sum(customer_rate) from loads
             where (own is null or sales_owner_id = own)
               and status <> 'cancelled'
               and created_at >= d and created_at < d + interval '1 day'
          ), 0) as v
          from generate_series(
            date_trunc('day', now()) - interval '29 days',
            date_trunc('day', now()),
            interval '1 day'
          ) d
        ) t
    ),
    -- Scoped through the parent load. The app's version read load_vehicles
    -- unscoped, so after 0037 a sales rep's donut showed the whole company's
    -- vehicle mix beside four KPIs that were all their own.
    'vehicle_types', (
      select coalesce(jsonb_object_agg(vehicle_type, c), '{}'::jsonb)
        from (
          select v.vehicle_type, count(*) as c
            from load_vehicles v
            join loads l on l.id = v.load_id
           where v.created_at >= now() - interval '90 days'
             and (own is null or l.sales_owner_id = own)
           group by v.vehicle_type
        ) t
    )
  );
end $$;

revoke all on function public.dashboard_stats(timestamptz) from public, anon;
grant execute on function public.dashboard_stats(timestamptz) to authenticated;

-- ============================================================
-- 2. Per-status counts for the /loads tab strip
-- ============================================================
-- p_rep is the manager-only rep filter. A sales caller is pinned to their own
-- rows regardless of what is passed.
create or replace function public.loads_status_counts(p_rep uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  r public.user_role := public.current_profile_role();
  own uuid;
begin
  if r is null then
    return null;
  end if;
  own := case when r = 'sales' then auth.uid() else p_rep end;

  return (
    select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
      from (
        select status, count(*) as c
          from loads
         where (own is null or sales_owner_id = own)
         group by status
      ) t
  );
end $$;

revoke all on function public.loads_status_counts(uuid) from public, anon;
grant execute on function public.loads_status_counts(uuid) to authenticated;
