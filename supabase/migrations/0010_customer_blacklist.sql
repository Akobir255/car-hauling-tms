-- Blacklist flag on customers, for the order "⋯ More → Add to blacklist"
-- action (carriers already have their own `blacklisted` column from 0001).
alter table customers
  add column if not exists blacklisted boolean not null default false;
