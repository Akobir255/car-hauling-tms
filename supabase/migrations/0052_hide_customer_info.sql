-- Hide the imported customer records and the SMS history.
--
-- The ask: nothing copied from US Star should be visible on the platform, and
-- nobody should see it — not sales, not dispatch, not an admin. Nothing is
-- deleted. Every row stays exactly where it is, with every column intact.
--
-- MECHANISM: one nullable `hidden_at` column, and the SELECT policy requires it
-- to be null. Not app code. A `where` clause somebody forgets to add is how this
-- kind of hiding leaks — a page nobody remembered, an export, a search box, an
-- API route. A policy cannot be forgotten, because the database applies it to
-- every statement from every session, including one typed by an admin.
--
-- This is the same reasoning margin protection has run on since 0013: if it
-- matters that a human cannot see it, the database enforces it.
--
-- WHAT STAYS VISIBLE: carriers, their contacts, COI and authority — untouched,
-- as asked. Loads, vehicles, notes and documents are untouched too. Anything
-- created from here on is visible by default: `hidden_at` defaults to null, so
-- a customer added tomorrow, and an SMS that arrives tomorrow, both appear
-- normally. This hides the past, not the future.
--
-- TO BRING IT ALL BACK, as the service role (Supabase dashboard SQL editor):
--
--   update customers set hidden_at = null;
--   update messages   set hidden_at = null;
--
-- Nothing else is needed. That is the whole restore.

-- ---------------------------------------------------------------------------
-- 1. The marker
-- ---------------------------------------------------------------------------
alter table customers add column if not exists hidden_at timestamptz;
alter table messages  add column if not exists hidden_at timestamptz;

comment on column customers.hidden_at is
  'Set = hidden from every logged-in user by customers_select_scoped. Null = visible. Data is never deleted; clearing this column restores the row.';
comment on column messages.hidden_at is
  'Set = hidden from every logged-in user by messages_select_scoped. Null = visible.';

-- Partial indexes on the VISIBLE rows. Every list query now filters on
-- `hidden_at is null`, and after the backfill below that is the small set —
-- 25k hidden rows should never be walked to find the handful that are not.
create index if not exists idx_customers_visible on customers (hidden_at) where hidden_at is null;
create index if not exists idx_messages_visible  on messages  (hidden_at) where hidden_at is null;

-- ---------------------------------------------------------------------------
-- 2. Hide everything that exists right now
--
-- One timestamp for the whole batch, so "what was hidden on the day we did
-- this" is answerable later, and so a row hidden by some future action is
-- distinguishable from this one.
-- ---------------------------------------------------------------------------
update customers set hidden_at = now() where hidden_at is null;
update messages   set hidden_at = now() where hidden_at is null;

-- ---------------------------------------------------------------------------
-- 3. The policies
--
-- Both are REPLACED rather than added to. Permissive policies are ORed: a new
-- policy saying "and it must not be hidden" sitting beside the old one saying
-- "staff may read" would widen access back to everything, which is the exact
-- opposite of the intent and an easy mistake to make.
-- ---------------------------------------------------------------------------

-- Was: using (public.is_active_staff())  [0037]
drop policy if exists "customers_select_scoped" on customers;
create policy "customers_select_scoped"
  on customers for select
  using (
    hidden_at is null
    and public.is_active_staff()
  );

-- Was the 0013 shape: managers see all, a rep sees their own customers' threads.
-- That rule is preserved underneath; hidden_at is simply checked first.
drop policy if exists "messages_select_scoped" on messages;
create policy "messages_select_scoped"
  on messages for select
  using (
    hidden_at is null
    and (
      public.current_profile_role() in ('admin', 'dispatcher')
      or (
        public.is_active_staff()
        and customer_id is not null
        and exists (
          select 1 from customers c
          where c.id = messages.customer_id
            and c.sales_owner_id = auth.uid()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. What deliberately still works
--
-- The service role is not a person and does not go through these policies. That
-- is on purpose and it is what keeps the system running while the data is dark:
--
--   * the RingCentral webhook still matches an inbound text to its customer,
--     so nothing arrives orphaned and the history is intact when you unhide;
--   * find_customer_by_phone and the email/phone lookup in createLoad still
--     dedupe, so a returning customer does not become a second record;
--   * outbound SMS and email still resolve a recipient.
--
-- None of that renders anywhere. The screens read as the signed-in user, and
-- the signed-in user sees nothing.
--
-- NOT covered, because they are columns on `loads` rather than rows of their
-- own, and a policy cannot blank a column: pickup_contact_name,
-- pickup_contact_phone, delivery_contact_name, delivery_contact_phone and their
-- cell variants. Those are the site contacts printed on a dispatch sheet. Say
-- the word and they move to a shadow table in 0053.
-- ---------------------------------------------------------------------------
