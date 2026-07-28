-- "Paperwork: sent, not signed" was returning nothing for 141 orders whose
-- contract demonstrably went out.
--
-- The filter tests contract_sent_at, which is a timestamp. The old system
-- records only THAT a contract was sent — its order page offers a "resend"
-- link, and nowhere on it is a send date. So for imported orders the fact is
-- knowable and the timestamp is not.
--
-- Writing a made-up timestamp into contract_sent_at would have made the filter
-- work and put a date in front of a rep that nothing supports. This column
-- carries the fact instead; contract_sent_at stays reserved for sends this
-- system actually performed and can therefore stamp honestly.

alter table loads
  add column if not exists contract_sent boolean not null default false;

comment on column loads.contract_sent is
  'A contract went out, but the send time is unknown — set by the msgplane import. Sends performed here stamp contract_sent_at instead.';

-- The paperwork filter reads "sent and not yet signed" off these two.
create index if not exists idx_loads_contract_sent_unsigned
  on loads (contract_sent)
  where contract_sent and date_signed is null;
