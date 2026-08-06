-- Lock the four snapshot tables that 0049 warned about and did not fix.
--
-- ===========================================================================
-- WHY
-- ===========================================================================
-- Four migrations took a `create table as select *` snapshot before doing
-- something irreversible, and none of them locked the copy afterwards:
--
--   0013  messages_backup_pre_0013      every SMS and email body
--   0040  loads_unowned_pre_0040        ~25,900 loads
--   0040  customers_unowned_pre_0040    ~25,100 customers, with phone + email
--   0042  loads_created_at_pre_0042     load ids and timestamps
--   0047  loads_date_signed_pre_0047    load ids and signature dates
--
-- 0049 saw the problem, wrote it down, and fixed only its own table:
--
--   "The last snapshot table created this way (messages_backup_pre_0013) is
--    still sitting in the schema more than a year later, holding every SMS and
--    email body, protected only by an RLS flag that no migration ever set.
--    Once is enough."
--
-- It was not once. This migration applies 0049's own pattern to the other four,
-- and to the table 0049 was complaining about.
--
-- A `create table as` copy is dangerous in a way the original is not. It
-- inherits NONE of the protection the original carries:
--
--   * no RLS, so `hidden_at` does not apply -- the rows 0052/0053 hid from
--     every logged-in user are sitting in plain sight in the copy;
--   * no column grants, so the `carrier_pay` revoke from 0013 -- the first rule
--     in STATUS.md, the one that keeps margin away from sales -- is not
--     carried over. `select *` copied the column with default privileges;
--   * it is in `public`, so PostgREST publishes it. Anyone holding the
--     publishable key, which ships in the browser bundle by definition, can
--     read it straight off the REST endpoint without touching the app.
--
-- Supabase's own security advisor flags all five as CRITICAL "RLS Disabled in
-- Public". That is what pointed us at them.
--
-- ===========================================================================
-- WHAT THIS DOES
-- ===========================================================================
-- Revoke, then RLS on with zero policies. Nothing but the service role can
-- read them, which is exactly what a rollback copy should be -- the same shape
-- 0049 used for load_status_history_pre_0049.
--
-- Nothing is deleted and nothing is renamed, so every one of these is still a
-- working rollback path. Reversing this is one line per table:
--
--   alter table <t> disable row level security;
--   grant select on <t> to authenticated;
--
-- Guarded on to_regclass so a fresh install, where 0040 skips and the tables
-- may not exist, does not fail here.

do $$
declare
  t text;
  snapshots text[] := array[
    'messages_backup_pre_0013',
    'loads_unowned_pre_0040',
    'customers_unowned_pre_0040',
    'loads_created_at_pre_0042',
    'loads_date_signed_pre_0047',
    'load_status_history_pre_0049'
  ];
begin
  foreach t in array snapshots loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %: not present', t;
      continue;
    end if;

    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);

    raise notice 'locked %', t;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Say what each one is, so the next person knows whether it is safe to drop.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  notes text[][] := array[
    ['messages_backup_pre_0013',
     'Pre-0013 copy of `messages`, taken before the same-direction dedupe DELETE. Holds full SMS and email bodies. Service role only. Safe to drop once the dedupe is trusted -- it has been years.'],
    ['loads_unowned_pre_0040',
     'Pre-0040 copy of the loads that had no owner before the book was assigned. Contains carrier_pay: this copy never inherited 0013''s column revoke, so it must never be granted to `authenticated`. Service role only.'],
    ['customers_unowned_pre_0040',
     'Pre-0040 copy of the unowned customers, with phone and email. Predates the 0052 hide, so `hidden_at` does not apply to it. Service role only.'],
    ['loads_created_at_pre_0042',
     'Pre-0042 copy of load ids and created_at, taken before the imported-timezone fix. Service role only.'],
    ['loads_date_signed_pre_0047',
     'Pre-0047 copy of load ids and date_signed, taken before the suffix resweep. 0047 reads from it. Service role only.'],
    ['load_status_history_pre_0049',
     'Rollback copy of the pre-0049 status history; the same rows live in load_events where event_type = ''status_changed''. Service role only.']
  ];
begin
  for c in select notes[i][1] as t, notes[i][2] as note
           from generate_subscripts(notes, 1) as i loop
    if to_regclass('public.' || c.t) is not null then
      execute format('comment on table public.%I is %L', c.t, c.note);
    end if;
  end loop;
end $$;
