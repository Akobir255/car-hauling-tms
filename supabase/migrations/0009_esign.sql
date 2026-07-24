-- E-sign: a per-order signing token plus send/sign audit fields.
-- date_signed (from 0001) already records WHEN a contract was signed; these add
-- the shareable link and the send/IP trail behind it.

alter table loads
  add column if not exists contract_token uuid unique default gen_random_uuid(),
  add column if not exists contract_sent_at timestamptz,
  add column if not exists contract_signed_ip text;

-- Fill any rows created before the default existed.
update loads set contract_token = gen_random_uuid() where contract_token is null;

create index if not exists idx_loads_contract_token on loads (contract_token);
