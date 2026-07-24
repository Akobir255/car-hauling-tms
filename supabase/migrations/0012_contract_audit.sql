-- E-sign audit trail: every open of the signing link is logged (IP + user
-- agent), and the signature now also captures the signer's email.

alter table loads
  add column if not exists contract_signed_email text;

create table if not exists contract_events (
  id bigserial primary key,
  load_id uuid not null references loads (id) on delete cascade,
  event text not null check (event in ('viewed', 'signed')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_events_load
  on contract_events (load_id, created_at desc);

alter table contract_events enable row level security;

-- Staff read the audit; inserts come only from the public sign page via the
-- service role (which bypasses RLS), so no insert policy is needed.
create policy "contract_events_select_staff"
  on contract_events for select
  using (public.current_profile_role() in ('admin', 'dispatcher', 'sales'));
