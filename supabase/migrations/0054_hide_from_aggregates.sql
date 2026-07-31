-- The dashboard was still counting every hidden load.
--
-- Third instance of one root cause, and the pattern is now unmistakable:
-- ANYTHING that does not run the caller's RLS has to be told about hidden_at by
-- hand.
--
--   0053  non-invoker VIEWS      (loads_full, loads_full_contact)
--   0054  SECURITY DEFINER RPCs  (dashboard_stats, loads_status_counts)
--
-- With 25,867 loads hidden and the Recent Loads table correctly empty, the
-- dashboard still read:
--
--   New loads (7d)      171
--   Revenue (30d)       $569,690
--   Follow-ups due      18,227
--   Vehicle types       26,137 vehicles
--
-- All of it from `dashboard_stats`, which is `security definer` and queries
-- `loads` directly. Definer functions run as the function OWNER, so the row
-- policy never applies. The tab-strip counts on /loads have the same shape.
--
-- Both functions are reproduced verbatim below with one condition added per
-- subquery. The bodies are otherwise untouched on purpose: 0041 exists because
-- these numbers were wrong once already, and rewriting them while fixing
-- something else is how that happens twice.
--
-- Also here: webhook_events. The inbound-SMS diagnostics panel prints
-- `from_addr` — a real customer's mobile number — and `raw` carries the message
-- text with it. Admin-only, but "no one, including me" was the instruction.

-- ---------------------------------------------------------------------------
-- 1. Dashboard headline numbers
-- ---------------------------------------------------------------------------
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
    'new_last_7', (
      select count(*) from loads
       where hidden_at is null
         and (own is null or sales_owner_id = own)
         and created_at >= now() - interval '7 days' and created_at <= now()
    ),
    'new_prev_7', (
      select count(*) from loads
       where hidden_at is null
         and (own is null or sales_owner_id = own)
         and created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'
    ),
    'rev_last_30', (
      select coalesce(sum(customer_rate), 0) from loads
       where hidden_at is null
         and (own is null or sales_owner_id = own)
         and status <> 'cancelled'
         and created_at >= now() - interval '30 days' and created_at <= now()
    ),
    'rev_prev_30', (
      select coalesce(sum(customer_rate), 0) from loads
       where hidden_at is null
         and (own is null or sales_owner_id = own)
         and status <> 'cancelled'
         and created_at >= now() - interval '60 days' and created_at < now() - interval '30 days'
    ),
    'follow_ups_due', (
      select count(*) from loads
       where hidden_at is null
         and (own is null or sales_owner_id = own)
         and follow_up_at is not null
         and follow_up_at <= p_follow_up_cutoff
         and status in ('lead','quote','ready','booked','posted_cd','posted_sd',
                        'dispatched','picked_up','delivered','invoiced')
    ),
    'revenue_points', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'value', v) order by d), '[]'::jsonb)
        from (
          select d, coalesce((
            select sum(customer_rate) from loads
             where hidden_at is null
               and (own is null or sales_owner_id = own)
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
    'vehicle_types', (
      select coalesce(jsonb_object_agg(vehicle_type, c), '{}'::jsonb)
        from (
          select v.vehicle_type, count(*) as c
            from load_vehicles v
            join loads l on l.id = v.load_id
           where l.hidden_at is null
             and v.created_at >= now() - interval '90 days'
             and (own is null or l.sales_owner_id = own)
           group by v.vehicle_type
        ) t
    )
  );
end $$;

revoke all on function public.dashboard_stats(timestamptz) from public, anon;
grant execute on function public.dashboard_stats(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The /loads tab strip
-- ---------------------------------------------------------------------------
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
         where hidden_at is null
           and (own is null or sales_owner_id = own)
         group by status
      ) t
  );
end $$;

revoke all on function public.loads_status_counts(uuid) from public, anon;
grant execute on function public.loads_status_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The inbound-SMS diagnostics log
--
-- `from_addr` is a customer's mobile number and `raw` holds the message body.
-- Same marker, same restore. New receipts stay visible, which is the point of
-- the panel — it answers "is RingCentral delivering right now".
-- ---------------------------------------------------------------------------
alter table webhook_events add column if not exists hidden_at timestamptz;

comment on column webhook_events.hidden_at is
  'Set = hidden from the diagnostics panel. Holds a real customer number in from_addr and the message body in raw.';

create index if not exists idx_webhook_events_visible
  on webhook_events (hidden_at) where hidden_at is null;

update webhook_events set hidden_at = now() where hidden_at is null;

drop policy if exists "webhook_events_select_admin" on webhook_events;
create policy "webhook_events_select_admin"
  on webhook_events for select
  using (
    hidden_at is null
    and public.current_profile_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- RESTORE, all four migrations, as the service role:
--
--   update loads          set hidden_at = null;
--   update customers      set hidden_at = null;
--   update messages       set hidden_at = null;
--   update webhook_events set hidden_at = null;
--
-- The functions and views above need no change to restore: every condition
-- they carry is `hidden_at is null`, which is true for every row again.
-- ---------------------------------------------------------------------------
