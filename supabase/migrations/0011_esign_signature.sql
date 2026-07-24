-- E-sign hardening: record WHO signed, not just that a click happened.
-- The typed full name + IP + timestamp together form the click-wrap record.
alter table loads
  add column if not exists contract_signed_name text;
