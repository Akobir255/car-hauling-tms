-- Outbound SMS should not vanish the moment you send it.
--
-- 0055 gave messages.hidden_at a `default now()` so live INBOUND traffic stops
-- putting real customers' names and numbers back on screen. That was right for
-- inbound and wrong for outbound: a text a dispatcher sends from the app is a
-- text they just typed, and watching it disappear from the thread reads as a
-- broken send. Somebody would have reported it as one.
--
-- A column default cannot look at another column, so this is a trigger:
-- inbound arrives hidden, outbound arrives visible.
--
-- IS THAT A HOLE? No, and the reason is worth writing down. You can only send
-- to a customer you can see, and every real customer is hidden — the customers
-- list, the order pages, the SMS panel and the blast recipient query all read
-- through RLS and return nothing but the eighteen samples. There is no visible
-- inbound thread to reply into either, because inbound is hidden. So the only
-- messages this makes visible are ones sent to a customer already on screen.
--
-- NOTHING IS BACKFILLED. The 7,790 existing messages stay hidden, outbound
-- included: those carry real customers' numbers in from_addr and their history
-- in body, which is exactly what was asked to disappear. This changes what
-- happens NEXT, like every other piece of this hide.

create or replace function public.messages_default_hidden()
returns trigger
language plpgsql
as $$
begin
  -- An explicit value always wins: a backfill or a restore says what it means.
  if new.hidden_at is not null then
    return new;
  end if;
  if new.direction = 'outbound' then
    new.hidden_at := null;      -- we sent it; show it
  else
    new.hidden_at := now();     -- it arrived; keep it dark
  end if;
  return new;
end $$;

-- The trigger replaces the blanket default. Leaving both would mean the default
-- fires first and the trigger then has no null left to interpret, so outbound
-- would stay hidden and this migration would look applied while doing nothing.
alter table messages alter column hidden_at drop default;

drop trigger if exists trg_messages_default_hidden on messages;
create trigger trg_messages_default_hidden
  before insert on messages
  for each row execute function public.messages_default_hidden();

comment on column messages.hidden_at is
  'Set = hidden from every logged-in user. trg_messages_default_hidden stamps INBOUND on arrival and leaves OUTBOUND visible, because you can only text a customer you can already see. Restoring means clearing the column and dropping the trigger.';

-- ---------------------------------------------------------------------------
-- FULL RESTORE, as the service role. The trigger joins the two remaining
-- defaults on the list of things to undo:
--
--   drop trigger if exists trg_messages_default_hidden on messages;
--   alter table webhook_events   alter column hidden_at drop default;
--   alter table sms_suppressions alter column hidden_at drop default;
--
--   update loads            set hidden_at = null;
--   update customers        set hidden_at = null;
--   update messages         set hidden_at = null;
--   update webhook_events   set hidden_at = null;
--   update sms_suppressions set hidden_at = null;
-- ---------------------------------------------------------------------------
