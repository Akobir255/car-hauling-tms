-- An opt-out flag with no proof behind it is worth very little the day
-- someone files a TCPA complaint: the question is never "was the box
-- ticked", it is "when did they ask, and what did they say". These columns
-- carry that answer alongside the flag it justifies.
--
-- Filled in by the msgplane STOP import (Jul-Aug 2023 replies) and, from
-- here on, by the RingCentral inbound-SMS webhook when it sees a STOP.

alter table customers
  add column if not exists sms_opt_out_at timestamptz,
  add column if not exists sms_opt_out_source text,
  add column if not exists email_opt_out_at timestamptz,
  add column if not exists email_opt_out_source text;

comment on column customers.sms_opt_out_source is
  'Verbatim message (or system reason) that triggered the SMS opt-out.';
comment on column customers.email_opt_out_source is
  'Verbatim message (or system reason) that triggered the email opt-out.';

-- The bulk-send guards filter on the flag, so the flag stays the source of
-- truth; this index just makes the "who opted out, and why" review screen
-- cheap to render.
create index if not exists idx_customers_opted_out
  on customers (sms_opt_out_at desc)
  where sms_opt_out or email_opt_out;
