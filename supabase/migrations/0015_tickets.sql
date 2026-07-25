-- Tickets: the internal issue tracker msgplane has ("Tickets 2094 open").
-- A ticket is a piece of work with a status, optionally attached to a load
-- and/or a customer, assigned to a rep, with a comment thread.

create type ticket_status as enum ('open', 'pending', 'resolved', 'closed');
create type ticket_priority as enum ('low', 'normal', 'high', 'urgent');

-- Its own sequence: sharing load_number_seq would consume load numbers.
create sequence public.ticket_number_seq start with 1000;

create table tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint not null unique default nextval('public.ticket_number_seq'),
  subject text not null,
  body text,
  status ticket_status not null default 'open',
  priority ticket_priority not null default 'normal',
  load_id uuid references loads (id) on delete set null,
  customer_id uuid references customers (id) on delete set null,
  assigned_to uuid references profiles (id) on delete set null,
  created_by uuid references profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tickets_updated_at
  before update on tickets
  for each row execute function public.set_updated_at();

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  body text not null,
  author_id uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index idx_tickets_status_created on tickets (status, created_at desc);
create index idx_tickets_assigned on tickets (assigned_to, status);
create index idx_tickets_load on tickets (load_id);
create index idx_ticket_comments_ticket on ticket_comments (ticket_id, created_at);

alter table tickets enable row level security;
alter table ticket_comments enable row level security;

-- Tickets are an internal coordination tool: every active staff member can see
-- and comment on them (unlike loads, they carry no margin data). Only
-- admin/dispatcher may delete.
create policy "tickets_select_staff"
  on tickets for select
  using (public.is_active_staff());

create policy "tickets_insert_staff"
  on tickets for insert
  with check (public.is_active_staff() and created_by = auth.uid());

create policy "tickets_update_staff"
  on tickets for update
  using (public.is_active_staff())
  with check (public.is_active_staff());

create policy "tickets_delete_admin_dispatcher"
  on tickets for delete
  using (public.current_profile_role() in ('admin', 'dispatcher'));

create policy "ticket_comments_select_staff"
  on ticket_comments for select
  using (public.is_active_staff());

create policy "ticket_comments_insert_staff"
  on ticket_comments for insert
  with check (public.is_active_staff() and author_id = auth.uid());

create policy "ticket_comments_delete_admin"
  on ticket_comments for delete
  using (public.current_profile_role() = 'admin');
