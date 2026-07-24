-- Webhook receipt log — so an admin can SEE whether RingCentral is actually
-- delivering inbound SMS and, if so, why a message was or wasn't stored.
-- The webhook writes here via the service role (bypasses RLS); only admins
-- can read it. Kept small: the raw payload is truncated before insert.

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'ringcentral',
  received_at timestamptz not null default now(),
  token_ok boolean,
  event_type text,       -- e.g. 'SMS', or 'validation', 'unknown'
  direction text,        -- 'Inbound' / 'Outbound' when present
  from_addr text,
  outcome text not null, -- stored | duplicate | ignored_* | no_customer | error_* | unauthorized | validation
  detail text,           -- human-readable note (error message, ignore reason)
  raw jsonb              -- truncated raw body for inspection
);

create index idx_webhook_events_received_at on webhook_events (received_at desc);

alter table webhook_events enable row level security;

-- Admins only. Inserts come from the service-role client, which bypasses RLS.
create policy "webhook_events_select_admin"
  on webhook_events for select
  using (public.current_profile_role() = 'admin');
