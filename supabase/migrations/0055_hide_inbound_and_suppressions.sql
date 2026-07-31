-- Two gaps in the hide, both found by counting rather than by reading code.
--
-- ===========================================================================
-- 1. sms_suppressions was never covered
-- ===========================================================================
-- 129 rows, primary-keyed on `phone_digits` — the last ten digits of a real
-- customer's mobile number, with the verbatim text they sent in `source_text`.
-- Readable by every staff member. It is customer information from US Star by
-- any reading, and the hide missed it because the table has no customer_id and
-- no load_id, so it did not look like a child of anything.
--
-- Suppression keeps WORKING while hidden: the send guard is
-- public.is_phone_suppressed(), which is SECURITY DEFINER precisely so the send
-- path can ask without read access to the list. Nobody gets texted who asked
-- not to be. The list simply stops being browsable.
--
-- ===========================================================================
-- 2. "Hides the past, not the future" was the wrong rule for INBOUND
-- ===========================================================================
-- 0052 made hidden_at nullable with no default, so anything arriving later was
-- visible. That is right for a load or a customer created deliberately in the
-- app — the ten sample orders depend on it. It is wrong for inbound SMS, which
-- nobody creates on purpose: real customers are still texting the RingCentral
-- number, and within an hour of the hide, 3 messages and 18 webhook receipts
-- had appeared on screen carrying names, numbers and message bodies.
--
-- So these two tables get `default now()`: dark on arrival, until told
-- otherwise. Everything still lands in the database and the webhook still
-- matches each text to its customer — the record is intact, it is only unread.
--
-- NOTE FOR RESTORE: these defaults must be dropped as well as the column
-- cleared, or new traffic keeps hiding itself. The full sequence is at the
-- bottom of this file.

-- ---------------------------------------------------------------------------
-- 1. The suppression list
-- ---------------------------------------------------------------------------
alter table sms_suppressions add column if not exists hidden_at timestamptz;

comment on column sms_suppressions.hidden_at is
  'Set = hidden from the opt-out review screen. Holds a real customer number and the verbatim text they sent. is_phone_suppressed() is SECURITY DEFINER and still enforces the block.';

create index if not exists idx_sms_suppressions_visible
  on sms_suppressions (hidden_at) where hidden_at is null;

-- Hide every suppression EXCEPT those belonging to a customer who is still
-- visible. That keeps the opt-out screen working for the sample records while
-- the imported list goes dark, and it stays correct if more customers are
-- unhidden later.
update sms_suppressions s
   set hidden_at = now()
 where s.hidden_at is null
   and not exists (
     select 1 from customers c
      where c.hidden_at is null
        and c.phone is not null
        and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = s.phone_digits
   );

drop policy if exists "sms_suppressions_select_staff" on sms_suppressions;
create policy "sms_suppressions_select_staff"
  on sms_suppressions for select
  to authenticated
  using (
    hidden_at is null
    and public.current_profile_role() in ('admin', 'dispatcher', 'sales')
  );

-- ---------------------------------------------------------------------------
-- 2. Inbound traffic arrives hidden
-- ---------------------------------------------------------------------------
alter table messages       alter column hidden_at set default now();
alter table webhook_events alter column hidden_at set default now();

comment on column messages.hidden_at is
  'Defaults to now(): inbound and outbound SMS arrive HIDDEN and stay unread until someone clears this column. Restoring means dropping the default too.';

-- Anything that landed between 0052/0054 and this migration.
update messages       set hidden_at = now() where hidden_at is null;
update webhook_events set hidden_at = now() where hidden_at is null;

-- ---------------------------------------------------------------------------
-- FULL RESTORE, as the service role. The two ALTERs matter: without them the
-- next inbound text hides itself again and it looks like the restore failed.
--
--   alter table messages       alter column hidden_at drop default;
--   alter table webhook_events alter column hidden_at drop default;
--
--   update loads             set hidden_at = null;
--   update customers         set hidden_at = null;
--   update messages          set hidden_at = null;
--   update webhook_events    set hidden_at = null;
--   update sms_suppressions  set hidden_at = null;
-- ---------------------------------------------------------------------------
