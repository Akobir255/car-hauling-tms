-- "Which of these have I not texted lately?"
--
-- The Age filter (0038-era work) answers a different question: how old is the
-- RECORD. That is not what stops a rep double-texting somebody. A quote raised
-- in 2022 may have been SMS'd yesterday, and at ~1,000 sends a day with reps
-- holding 30k follow-ups, the only safe question is when this SHIPPER was last
-- contacted -- not when their quote was created.
--
-- Kept on the customer as a stamp rather than computed from messages at read
-- time. The alternative is aggregating a table that grows by ~1,000 rows a day
-- on every list render, or resolving "not texted in 7 days" to an id list --
-- roughly 24,000 of 25,117 customers, which is not a filter that fits in a URL.

alter table customers
  add column if not exists last_sms_at timestamptz,
  add column if not exists last_email_at timestamptz;

comment on column customers.last_sms_at is
  'Most recent OUTBOUND sms to this shipper. Maintained by trigger on messages; null means never texted.';

create index if not exists customers_last_sms_at_idx on customers (last_sms_at);
create index if not exists customers_last_email_at_idx on customers (last_email_at);

-- Backfill from everything already sent.
update customers c
   set last_sms_at = m.last_at
  from (
    select customer_id, max(created_at) as last_at
      from messages
     where direction = 'outbound' and channel = 'sms' and customer_id is not null
     group by customer_id
  ) m
 where m.customer_id = c.id;

update customers c
   set last_email_at = m.last_at
  from (
    select customer_id, max(created_at) as last_at
      from messages
     where direction = 'outbound' and channel = 'email' and customer_id is not null
     group by customer_id
  ) m
 where m.customer_id = c.id;

-- Maintained in the database, not in the app: sends happen from bulk SMS, bulk
-- email, the single reply box and the contract mailer, and a stamp that only
-- some of those paths remember to write is worse than none at all.
create or replace function public.stamp_customer_last_contacted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction = 'outbound' and new.customer_id is not null then
    if new.channel = 'sms' then
      update customers
         set last_sms_at = greatest(coalesce(last_sms_at, new.created_at), new.created_at)
       where id = new.customer_id;
    elsif new.channel = 'email' then
      update customers
         set last_email_at = greatest(coalesce(last_email_at, new.created_at), new.created_at)
       where id = new.customer_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_stamp_last_contacted on messages;
create trigger messages_stamp_last_contacted
  after insert on messages
  for each row
  execute function public.stamp_customer_last_contacted();

-- The lists query loads, and this fact lives on the customer. Rather than
-- restate either view's column list -- which drifts, and 0029 is the story of
-- getting that wrong -- these wrap the existing views and add the one column.
-- security_invoker so the caller's own RLS still decides the rows.
drop view if exists loads_sales_safe_contact;
create view loads_sales_safe_contact
  with (security_invoker = on) as
select l.*, c.last_sms_at as customer_last_sms_at, c.last_email_at as customer_last_email_at
  from loads_sales_safe l
  left join customers c on c.id = l.customer_id;

revoke all on loads_sales_safe_contact from anon, authenticated;
grant select on loads_sales_safe_contact to authenticated;

drop view if exists loads_full_contact;
create view loads_full_contact
  with (security_barrier = true) as
select l.*, c.last_sms_at as customer_last_sms_at, c.last_email_at as customer_last_email_at
  from loads_full l
  left join customers c on c.id = l.customer_id;

revoke all on loads_full_contact from anon, authenticated;
grant select on loads_full_contact to authenticated;
