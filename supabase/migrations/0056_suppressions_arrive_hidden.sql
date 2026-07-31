-- sms_suppressions was half-fixed in 0055.
--
-- 0055 hid the 129 imported rows and gave `messages` and `webhook_events` a
-- `default now()` so live inbound traffic arrives dark. It did NOT give
-- sms_suppressions the same default — and suppressions are inbound traffic too.
-- The RingCentral webhook calls suppressPhone() whenever it sees a STOP, so a
-- real customer texting STOP writes a brand new row here.
--
-- Which is exactly what happened, within the hour:
--
--   5705333463  stop_reply  "Stop"   <- a real imported customer, hidden,
--                                       whose phone number was back on screen
--
-- Caught by a count that did not reconcile: four visible suppression rows
-- against three opted-out sample customers. The fourth was a real person.
--
-- The tradeoff, stated: a suppression a staff member creates by hand now also
-- arrives hidden, so it will not appear on the opt-out screen until the restore
-- runs. The block still applies — is_phone_suppressed() is SECURITY DEFINER and
-- never consulted RLS. Erring toward hidden is the right way round while the
-- instruction is "no customer information at all"; a suppression nobody can see
-- still protects the customer, whereas a visible one leaks their number.

alter table sms_suppressions alter column hidden_at set default now();

comment on column sms_suppressions.hidden_at is
  'Defaults to now(): rows arrive HIDDEN, including STOP replies written by the webhook. is_phone_suppressed() is SECURITY DEFINER and still enforces the block. Restoring means dropping this default too.';

-- The row that already slipped through, and anything that lands between this
-- statement and the default taking effect.
update sms_suppressions s
   set hidden_at = now()
 where s.hidden_at is null
   and not exists (
     select 1 from customers c
      where c.hidden_at is null
        and c.phone is not null
        and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = s.phone_digits
   );

-- ---------------------------------------------------------------------------
-- FULL RESTORE, as the service role — now THREE defaults to drop:
--
--   alter table messages          alter column hidden_at drop default;
--   alter table webhook_events    alter column hidden_at drop default;
--   alter table sms_suppressions  alter column hidden_at drop default;
--
--   update loads            set hidden_at = null;
--   update customers        set hidden_at = null;
--   update messages         set hidden_at = null;
--   update webhook_events   set hidden_at = null;
--   update sms_suppressions set hidden_at = null;
-- ---------------------------------------------------------------------------
