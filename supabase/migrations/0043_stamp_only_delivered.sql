-- last_sms_at must mean "we actually reached them", not "we tried".
--
-- 0039's trigger stamped on ANY outbound insert. The app deliberately writes
-- rows for sends that did not go out — 'queued' when the provider is
-- unconfigured, 'failed' when it rejects — so a failed blast would stamp every
-- recipient and then hide them from the filter built to find them. Worse, the
-- assignment is greatest(coalesce(last_sms_at, ...), new.created_at), so a false
-- stamp is monotonic: it can never be corrected downward, only aged out.
--
-- This stopped being theoretical the moment we looked at the real traffic.
-- Measured on RingCentral's message store 2026-07-29, over its 7-day window:
--
--     6,963 outbound SMS
--       5,162 Delivered
--         942 SendingFailed
--         859 DeliveryFailed      -> 26% never reached anybody
--
--     3,736 of the numbers texted are shippers we hold
--     2,657 of those were actually DELIVERED to
--     -------------------------------------------------
--     1,079 shippers whose only contact attempt failed
--
-- Import those 1,079 as "contacted" and a rep working the follow-up list never
-- sees them again. They are precisely the people who most need calling.
--
-- Delivery confirmations arrive from RingCentral as a NEW insert with status
-- 'delivered' (see api/webhooks/ringcentral), never as an update to the
-- original row, so AFTER INSERT remains the right hook — no AFTER UPDATE
-- counterpart is needed.

create or replace function public.stamp_customer_last_contacted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 'sent' counts: the provider accepted it and simply has not confirmed
  -- delivery yet. 'queued' and 'failed' do not.
  if new.direction = 'outbound'
     and new.customer_id is not null
     and new.status in ('sent', 'delivered') then
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
end $$;

-- Recompute rather than adjust: greatest() means a stamp set too high by the
-- old rule cannot be walked back, so both columns are cleared and re-derived
-- under the new predicate. Cheap today (1 and 2 rows carry a stamp) and
-- correct whenever this is replayed.
update customers set last_sms_at = null, last_email_at = null;

update customers c
   set last_sms_at = m.last_at
  from (
    select customer_id, max(created_at) as last_at
      from messages
     where direction = 'outbound' and channel = 'sms'
       and customer_id is not null
       and status in ('sent', 'delivered')
     group by customer_id
  ) m
 where m.customer_id = c.id;

update customers c
   set last_email_at = m.last_at
  from (
    select customer_id, max(created_at) as last_at
      from messages
     where direction = 'outbound' and channel = 'email'
       and customer_id is not null
       and status in ('sent', 'delivered')
     group by customer_id
  ) m
 where m.customer_id = c.id;
