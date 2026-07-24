-- Phase 2 (messaging) — reusable message templates + customer opt-outs.
-- The `messages` table itself was created in 0001 and already has the
-- channel/direction/status/provider_message_id columns the sender needs.

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel message_channel not null default 'sms',
  subject text,          -- email only
  body text not null,    -- supports {{first_name}}, {{route}}, {{quote_price}}, ...
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_message_templates_updated_at
  before update on message_templates
  for each row execute function public.set_updated_at();

alter table message_templates enable row level security;

create policy "message_templates_select_staff"
  on message_templates for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

create policy "message_templates_write_staff"
  on message_templates for all
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'))
  with check (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));

-- Opt-outs: excluded from every bulk send. sms_opt_out is the legally
-- required one (STOP replies); email_opt_out mirrors it for email blasts.
alter table customers
  add column sms_opt_out boolean not null default false,
  add column email_opt_out boolean not null default false;
