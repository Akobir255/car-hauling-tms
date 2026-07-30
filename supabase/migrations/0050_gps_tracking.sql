-- Phase 2: GPS ingestion.
--
-- Four tables and a feature flag. Nothing here touches `loads`: adding a column
-- there means 0013's checklist (grant it explicitly, then recreate loads_full,
-- loads_sales_safe AND both _contact views, because `select *` is expanded and
-- frozen at creation). Geofence centres live in their own table instead, which
-- also models the thing better -- a radius belongs to a stop, not to a load.
--
-- Every table below gets brokerage_id on the same terms as 0049: nullable, no
-- foreign key, no index, referenced by no policy. This app is single-tenant.
--
-- READ rule throughout is is_active_staff(), matching 0037 and 0049. WRITES are
-- service-role only for the GPS path, because the writer is a phone in a truck
-- with no session at all -- it authenticates with a token, server-side, and the
-- route handler does the insert. `authenticated` gets no insert grant on
-- shipment_locations or geofence_events for exactly that reason.

-- ---------------------------------------------------------------------------
-- 1. Where the truck is.
-- ---------------------------------------------------------------------------
create table shipment_locations (
  id           uuid primary key default gen_random_uuid(),
  load_id      uuid not null references loads (id) on delete cascade,
  brokerage_id uuid,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  -- When the DEVICE fixed the position. A phone coming back into signal posts a
  -- backlog, so this is routinely older than created_at and is what everything
  -- orders by.
  recorded_at  timestamptz not null default now(),
  source       text not null default 'driver_pwa'
                 check (source in ('driver_pwa', 'eld', 'manual')),
  accuracy_m   double precision check (accuracy_m >= 0),
  created_at   timestamptz not null default now()
);

create index idx_shipment_locations_load_recorded
  on shipment_locations (load_id, recorded_at desc);

alter table shipment_locations enable row level security;

create policy "shipment_locations_select_scoped"
  on shipment_locations for select
  using (public.is_active_staff());

-- No insert/update/delete policy: the only writer is the token-authenticated
-- route handler running as the service role.

revoke all on shipment_locations from anon, authenticated;
grant select on shipment_locations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Arrivals and departures.
--
-- Deduplicated by a UNIQUE INDEX, not by hope: one arrival and one departure
-- per fence per load. A truck idling on the boundary cannot emit twenty rows
-- because the twenty-first insert has nowhere to go -- the ingest path uses
-- ON CONFLICT DO NOTHING. The app layer adds hysteresis and a dwell threshold
-- on top (see src/lib/tracking/geofence.ts); this index is the backstop that
-- holds even if that logic is wrong.
--
-- The tradeoff, stated plainly: a load that genuinely re-enters a fence after
-- leaving it records only the first visit. For auto transport that is the right
-- trade -- you arrive at a pickup once -- and a second visit is still visible
-- in shipment_locations.
-- ---------------------------------------------------------------------------
create table geofence_events (
  id           uuid primary key default gen_random_uuid(),
  load_id      uuid not null references loads (id) on delete cascade,
  brokerage_id uuid,
  fence        text not null check (fence in ('pickup', 'delivery')),
  transition   text not null check (transition in ('arrived', 'departed')),
  location_id  uuid references shipment_locations (id) on delete set null,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create unique index uq_geofence_events_once
  on geofence_events (load_id, fence, transition);

create index idx_geofence_events_load_occurred
  on geofence_events (load_id, occurred_at desc);

alter table geofence_events enable row level security;

create policy "geofence_events_select_scoped"
  on geofence_events for select
  using (public.is_active_staff());

revoke all on geofence_events from anon, authenticated;
grant select on geofence_events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The fences themselves, geocoded lazily when tracking starts on a load.
-- ---------------------------------------------------------------------------
create table load_geofences (
  id           uuid primary key default gen_random_uuid(),
  load_id      uuid not null references loads (id) on delete cascade,
  brokerage_id uuid,
  kind         text not null check (kind in ('pickup', 'delivery')),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  -- 500m holds a truck stop or a dealer lot without swallowing the next block.
  radius_m     integer not null default 500 check (radius_m between 50 and 20000),
  -- What was geocoded, so a wrong fence can be traced to the address that
  -- produced it rather than guessed at.
  geocoded_from text,
  created_at   timestamptz not null default now()
);

create unique index uq_load_geofences_load_kind on load_geofences (load_id, kind);

alter table load_geofences enable row level security;

create policy "load_geofences_select_scoped"
  on load_geofences for select
  using (public.is_active_staff());

revoke all on load_geofences from anon, authenticated;
grant select on load_geofences to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tokens for the two no-login pages.
--
-- Same shape as the contract link that already works this way: an unguessable
-- string, checked server-side, never a session. Two kinds with different powers
-- and they must not be confused -- `driver` may WRITE positions for its one
-- load, `customer` may only read a redacted view of it.
--
-- The token column is the secret. It is never exposed to a client bundle, and
-- both pages resolve it through the service role after validating.
-- ---------------------------------------------------------------------------
create table tracking_tokens (
  id           uuid primary key default gen_random_uuid(),
  load_id      uuid not null references loads (id) on delete cascade,
  brokerage_id uuid,
  kind         text not null check (kind in ('driver', 'customer')),
  token        text not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_by   uuid references profiles (id),
  created_at   timestamptz not null default now()
);

-- One live token per load per kind. Reissuing revokes the old one in app code;
-- this index stops two live drivers posting to the same load by accident.
create unique index uq_tracking_tokens_live
  on tracking_tokens (load_id, kind)
  where revoked_at is null;

create index idx_tracking_tokens_token on tracking_tokens (token);

alter table tracking_tokens enable row level security;

create policy "tracking_tokens_select_scoped"
  on tracking_tokens for select
  using (public.is_active_staff());

-- Issuing a token is a write on the load, so it follows the load's write rule.
create policy "tracking_tokens_insert_scoped"
  on tracking_tokens for insert
  with check (public.is_active_staff() and public.user_can_access_load(load_id));

create policy "tracking_tokens_update_scoped"
  on tracking_tokens for update
  using (public.is_active_staff() and public.user_can_access_load(load_id))
  with check (public.is_active_staff() and public.user_can_access_load(load_id));

revoke all on tracking_tokens from anon, authenticated;
grant select, insert, update on tracking_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Feature flags.
--
-- The brief asks for a flag per brokerage per phase. There are no brokerages,
-- so this is per install: one row per feature, admin-togglable, read by anyone
-- on staff. It exists so Phase 2 can be dark on production the moment it
-- deploys and be turned on for one load at a time.
-- ---------------------------------------------------------------------------
create table feature_flags (
  key          text primary key,
  enabled      boolean not null default false,
  brokerage_id uuid,
  note         text,
  updated_by   uuid references profiles (id),
  updated_at   timestamptz not null default now()
);

alter table feature_flags enable row level security;

create policy "feature_flags_select_staff"
  on feature_flags for select
  using (public.is_active_staff());

create policy "feature_flags_write_admin"
  on feature_flags for all
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

revoke all on feature_flags from anon, authenticated;
grant select, insert, update on feature_flags to authenticated;

insert into feature_flags (key, enabled, note) values
  ('gps_tracking', false, 'Phase 2: driver PWA, position ingest, geofencing, customer tracking page.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Realtime.
--
-- The dashboard map subscribes instead of polling. Realtime applies RLS to
-- postgres_changes, so a subscriber still only receives rows the
-- shipment_locations select policy would have handed them.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table shipment_locations;
