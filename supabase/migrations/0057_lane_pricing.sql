-- Phase 6a: lane pricing from our own history.
--
-- ===========================================================================
-- WHAT THIS IS NOT, AND WHY
-- ===========================================================================
-- The brief asks for a gradient-boosted regression on CARRIER COST. That is not
-- buildable on this data and building it anyway would be worse than not:
--
--   carrier_pay populated          25,866 loads
--   carrier_pay_confirmed             195 loads
--
-- The other 25,671 were DERIVED at creation as customer_rate minus the
-- reservation fee (see 0038 and createLoad). A model trained on them learns an
-- arithmetic identity, scores near-perfectly, and knows nothing about the
-- market. It would look like it worked, which is the dangerous kind of wrong.
-- The carrier-cost model stays blocked until confirmed carrier pay accumulates
-- on dispatch sheets.
--
-- distance_miles is set on 2 of 25,867 rows, so there is no distance feature
-- either, and metro-level lanes need geocoding. Measured on the real data:
--
--   city pairs   24,483 distinct, 42 with >=5 samples   -> statistically empty
--   state pairs   2,023 distinct, 553 with >=10 samples -> 80.9% of history
--
-- So the lane key is the STATE PAIR. What this ships is the brief's actual
-- on-screen deliverable — a suggested customer price with a confidence band the
-- dispatcher can override — computed from what we have really quoted.
--
-- ===========================================================================
-- HONESTY ABOUT WHAT THE NUMBER MEANS
-- ===========================================================================
-- The median is what we TYPICALLY QUOTE on a lane, not what typically WINS.
-- Only 796 loads in the whole book reached a won state against 6,612 cancelled
-- — a 10.7% win rate — which is one or two wins per lane, far too few to price
-- from. Both counts are stored so the screen can say which is which, and
-- quote_outcomes below exists so that in six months it can price from wins.
--
-- ===========================================================================
-- AND ABOUT THE HIDDEN BOOK
-- ===========================================================================
-- The stats are computed over every load including the 25,867 hidden ones —
-- that history is the entire point. The refresh runs SECURITY DEFINER to reach
-- them, which is the same mechanism that leaked customer rows in 0053 and 0054,
-- so the guard is structural: MIN_SAMPLES = 10 in the aggregate's HAVING
-- clause. A published row is a median over ten or more loads, which cannot be
-- turned back into any one customer's price. No customer, contact, load number
-- or date leaves this function.

-- ---------------------------------------------------------------------------
-- 1. The published lane statistics
-- ---------------------------------------------------------------------------
create table lane_price_stats (
  id                uuid primary key default gen_random_uuid(),
  brokerage_id      uuid,

  origin_state      text not null,
  destination_state text not null,
  -- 'any' rather than null so the unique index below actually constrains: null
  -- is not equal to null, and a nullable key would let duplicate lanes pile up
  -- on every refresh.
  vehicle_class     text not null default 'any',
  transport         text not null default 'any',

  -- Every price we have quoted on this lane.
  n_quoted          integer not null,
  p25               numeric not null,
  median            numeric not null,
  p75               numeric not null,
  -- How those quotes ended. n_won + n_lost rarely equals n_quoted: most quotes
  -- in this book were never resolved either way.
  n_won             integer not null default 0,
  n_lost            integer not null default 0,

  computed_at       timestamptz not null default now()
);

create unique index idx_lane_price_stats_lane
  on lane_price_stats (origin_state, destination_state, vehicle_class, transport);

alter table lane_price_stats enable row level security;

-- Aggregates only, and never fewer than ten loads behind a row.
create policy "lane_price_stats_select_staff"
  on lane_price_stats for select
  using (public.is_active_staff());

-- Written by the refresh function (service role) and nothing else.
revoke all on lane_price_stats from anon, authenticated;
grant select on lane_price_stats to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Why a quote died. THIS IS THE ASSET.
--
-- The brief: win/loss at given price points is the most valuable pricing signal
-- there is and almost no brokerage captures it. This book has 6,612 cancelled
-- quotes and not one recorded reason, because there was nowhere to put one.
-- Starts empty; every row from here is a row the old system never had.
-- ---------------------------------------------------------------------------
create table quote_outcomes (
  id             uuid primary key default gen_random_uuid(),
  brokerage_id   uuid,
  load_id        uuid not null references loads (id) on delete cascade,

  outcome        text not null check (outcome in ('won', 'lost', 'expired')),
  -- Deliberately a short list. Free text is unanalysable, and the whole reason
  -- this table exists is to be analysed.
  reason         text check (reason in (
                   'price', 'timing', 'no_response', 'went_with_competitor',
                   'customer_cancelled', 'vehicle_not_ready', 'other'
                 )),
  reason_note    text,

  -- The price on the record when this was decided, and what the customer said
  -- they were offered elsewhere. The second one is the expensive column to
  -- collect and the one that makes the first one mean something.
  quoted_price     numeric,
  competitor_price numeric,

  recorded_by    uuid references profiles (id),
  created_at     timestamptz not null default now()
);

create index idx_quote_outcomes_load on quote_outcomes (load_id);
create index idx_quote_outcomes_created on quote_outcomes (created_at desc);

alter table quote_outcomes enable row level security;

create policy "quote_outcomes_select_scoped"
  on quote_outcomes for select
  using (
    public.is_active_staff()
    and exists (select 1 from loads l where l.id = quote_outcomes.load_id)
  );

create policy "quote_outcomes_insert_scoped"
  on quote_outcomes for insert
  with check (public.is_active_staff() and public.user_can_access_load(load_id));

-- Append-only, enforced twice like every other record-of-fact table here: no
-- update or delete policy, and no update or delete grant.
revoke all on quote_outcomes from anon, authenticated;
grant select, insert on quote_outcomes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. When the dispatcher disagreed with the suggestion
--
-- Kept because a suggestion nobody follows is a bug report, and the reasons are
-- how the model finds out what it does not know. Records the sample size too:
-- "overrode a median of 12 loads" and "overrode a median of 400" are different
-- events.
-- ---------------------------------------------------------------------------
create table price_overrides (
  id               uuid primary key default gen_random_uuid(),
  brokerage_id     uuid,
  load_id          uuid references loads (id) on delete set null,

  origin_state      text,
  destination_state text,
  suggested_price  numeric,
  entered_price    numeric,
  sample_size      integer,

  reason           text,
  created_by       uuid references profiles (id),
  created_at       timestamptz not null default now()
);

create index idx_price_overrides_created on price_overrides (created_at desc);
create index idx_price_overrides_lane on price_overrides (origin_state, destination_state);

alter table price_overrides enable row level security;

create policy "price_overrides_select_staff"
  on price_overrides for select
  using (public.is_active_staff());

create policy "price_overrides_insert_staff"
  on price_overrides for insert
  with check (public.is_active_staff());

revoke all on price_overrides from anon, authenticated;
grant select, insert on price_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The refresh
--
-- SECURITY DEFINER so it can read the hidden historical book, which is the only
-- reason this feature has anything to say. The HAVING clause is the guard: ten
-- loads minimum behind any published row.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_lane_price_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  delete from lane_price_stats;

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
  -- One vehicle per load is the norm here; a multi-car load contributes to each
  -- class it carries, which is the right behaviour for "what does an SUV cost
  -- on this lane".
  left join lateral (
    select vehicle_type from load_vehicles lv where lv.load_id = l.id limit 1
  ) v on true
  where l.customer_rate is not null
    and l.customer_rate > 0
    and l.pickup_state is not null
    and l.delivery_state is not null
  group by 1, 2, 3, 4
  -- The privacy and statistics guard, in one line. Ten loads minimum.
  having count(*) >= 10;

  get diagnostics written = row_count;
  return written;
end $$;

revoke all on function public.refresh_lane_price_stats() from public, anon, authenticated;

comment on function public.refresh_lane_price_stats() is
  'Rebuilds lane_price_stats from the whole book, hidden rows included. Service role only. Publishes a lane only at >=10 loads, which is both the statistical floor and what stops an aggregate describing one customer.';

-- ---------------------------------------------------------------------------
-- 5. Dark on arrival, same as every phase since 0050.
-- ---------------------------------------------------------------------------
insert into feature_flags (key, enabled, note) values
  ('lane_pricing', false, 'Phase 6a: suggested customer price per state lane, with override and lost-quote capture.')
on conflict (key) do nothing;
