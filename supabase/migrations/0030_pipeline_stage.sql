-- Archived ORDERS were showing under Quotes > Archived. Measured before this
-- migration: that tab returned 483 rows, of which 365 came from msgplane's
-- ORDERS module and only 118 were archived quotes. Quotes > Hold: 57 of its
-- 6,501 were orders. Orders > Hold and Orders > Archived carried no stage
-- scoping at all, so 483 of their 484 archived rows were the SAME records,
-- listed under both modules at once.
--
-- Cause: src/components/pipeline-list.tsx derived the stage of a parked record
-- from its price -- "priced => was a quote". Orders are priced too, so every
-- archived order satisfied the quote test. The premise is written down as the
-- spec of the `stage` field in src/lib/order-status.ts; it is false.
--
-- The stage is not recoverable from the row. On the 6,993 parked records:
-- carrier_id is NULL on all of them, contract_token is set on all of them,
-- carrier_pay on 6,984, and posted_to_central_dispatch_at is an import
-- artifact -- equal to created_at on 6,974 of the 6,975 rows that carry it.
-- msgplane_status is close but inverts for future data: 0021 defines NULL as
-- "created in this system".
--
-- So the stage is stored. It is backfilled from load_status_history.note,
-- which names the msgplane source tab verbatim on every imported record
-- (6,993 of 6,993 parked rows resolve, zero unmatched), and kept correct by a
-- trigger so no write path has to remember it.

-- ============================================================
-- 1. Column. text + CHECK, not an enum: 0008's header note says a new enum
--    value must be committed before it can be used, and this repo already
--    models msgplane_status as text.
-- ============================================================
alter table public.loads
  add column if not exists pipeline_stage text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'loads_pipeline_stage_check'
       and conrelid = 'public.loads'::regclass
  ) then
    alter table public.loads
      add constraint loads_pipeline_stage_check
      check (pipeline_stage in ('lead', 'quote', 'order'));
  end if;
end $$;

comment on column public.loads.pipeline_stage is
  'Which list this record lives in: lead | quote | order. Maintained by trigger '
  'trg_loads_pipeline_stage and frozen when a record is parked, because a parked '
  'status (hold/archived/lost/cancelled) does not say which stage it was parked '
  'from. Never infer this from customer_rate -- orders are priced too.';

-- ============================================================
-- 2a. Live rows: the status IS the stage. No guessing needed.
-- ============================================================
update public.loads
   set pipeline_stage = case
         when status = 'lead'  then 'lead'
         when status = 'quote' then 'quote'
         else 'order'
       end
 where status not in ('hold', 'archived', 'lost', 'cancelled');

-- ============================================================
-- 2b. Parked rows: the only exact source is the import note, which names the
--     msgplane source TAB. Match the token BEFORE the comma, never the quoted
--     status word -- one note is polluted with page JavaScript the scraper
--     captured ("(orders_hold, was 'on-hold-order$('#tr_...').css(") and seven
--     more read "was '0on-hold-order'". A word-based parser mis-tags all
--     eight; the tab token parses all 6,993 cleanly.
--
--     distinct on ... order by created_at, id because a few live loads carry
--     more than one history row; every parked load carries exactly one.
-- ============================================================
with first_note as (
  select distinct on (load_id) load_id, note
    from public.load_status_history
   order by load_id, created_at asc, id asc
), tagged as (
  select load_id,
         (regexp_match(
            note,
            'Imported from (?:the previous system|msgplane) \(([a-z_0-9-]+)'
          ))[1] as tab
    from first_note
)
update public.loads l
   set pipeline_stage = case
         when t.tab in ('q_hold', 'q_archived', 'quotes', 'quotes_tab', 'quote')
           then 'quote'
         when t.tab in ('orders', 'orders_archived', 'orders_hold', 'orders_ready',
                        'orders_issues', 'issues', 'hold', 'archived',
                        'completed', 'lost', 'ready', 'incomplete',
                        'on-hold-order', 'dispatched', 'picked-up', 'posted-cd')
           then 'order'
       end
  from tagged t
 where l.id = t.load_id
   and l.status in ('hold', 'archived', 'lost', 'cancelled')
   and t.tab is not null;

-- ============================================================
-- 2c. Tier-2 fallback: msgplane's own word, for parked rows a future
--     re-import might add without a tagged note. Fires on zero rows today.
-- ============================================================
update public.loads
   set pipeline_stage = 'order'
 where status in ('hold', 'archived', 'lost', 'cancelled')
   and pipeline_stage is null
   and msgplane_status in ('completed', 'lost', 'on-hold-order', 'incomplete',
                           'ready', 'dispatched', 'picked-up', 'posted-cd');

-- ============================================================
-- 2d. Assert. Do NOT guess the remainder -- guessing is the bug being fixed.
-- ============================================================
do $$
declare n int;
begin
  select count(*) into n from public.loads where pipeline_stage is null;
  if n > 0 then
    raise exception
      'pipeline_stage: % rows unresolved. Inspect them before continuing: '
      'select l.load_number, l.status, l.msgplane_status, h.note from loads l '
      'left join load_status_history h on h.load_id = l.id '
      'where l.pipeline_stage is null;', n;
  end if;
end $$;

alter table public.loads alter column pipeline_stage set not null;

-- ============================================================
-- 3. Trigger. The read side stopped guessing; this is what stops the WRITE
--    side from destroying the answer. holdOrder / archiveOrder / markLost /
--    bulkCancel all collapse lead|quote|order into one parked word, and none
--    of them needs to change: parking carries the stage forward.
-- ============================================================
create or replace function public.loads_set_pipeline_stage()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'lead' then
    new.pipeline_stage := 'lead';
  elsif new.status = 'quote' then
    new.pipeline_stage := 'quote';
  elsif new.status in ('hold', 'archived', 'lost', 'cancelled') then
    if tg_op = 'UPDATE' then
      -- Parked. Read the stage off the status it is being parked FROM, so
      -- hold -> archived and hold -> lost keep the ORIGINAL stage rather than
      -- re-deriving "order" from a parked word.
      new.pipeline_stage := case
        when old.status = 'lead'  then 'lead'
        when old.status = 'quote' then 'quote'
        when old.status in ('hold', 'archived', 'lost', 'cancelled')
          then old.pipeline_stage
        else 'order'
      end;
    else
      -- INSERT straight into a parked status: importers and service-role
      -- writes only, with no prior status to read. An importer that knows the
      -- answer passes pipeline_stage explicitly. The price fallback below IS
      -- the discredited heuristic; it exists only so NOT NULL can hold, and no
      -- application path reaches it (createLoad inserts lead or quote).
      new.pipeline_stage := coalesce(
        new.pipeline_stage,
        case when new.customer_rate is null then 'lead' else 'quote' end
      );
    end if;
  else
    new.pipeline_stage := 'order';
  end if;
  return new;
end $$;

drop trigger if exists trg_loads_pipeline_stage on public.loads;
create trigger trg_loads_pipeline_stage
  before insert or update of status on public.loads
  for each row execute function public.loads_set_pipeline_stage();
-- `update OF status`: an UPDATE that does not touch status leaves the stored
-- stage alone. That is also the manual-correction escape hatch -- an UPDATE
-- naming only pipeline_stage is honored verbatim.

-- ============================================================
-- 4. Grants + BOTH views. 0013's closing note and 0029's post-mortem: a new
--    loads column needs column grants AND both views recreated, or the filter
--    fails SILENTLY -- the list renders `data ?? []`, so a rejected query and
--    an empty result look identical.
-- ============================================================
grant select (pipeline_stage), insert (pipeline_stage), update (pipeline_stage)
  on table public.loads to authenticated;
-- insert/update follow the 0013 convention even though the app never names
-- this column in a write: the trigger re-derives it on every status change, so
-- a client-supplied value cannot survive a real transition.

drop view if exists loads_sales_safe;
create view loads_sales_safe
  with (security_invoker = on) as
select
  id, load_number, customer_id, carrier_id, dispatcher_id, status, msgplane_status,
  pipeline_stage,
  pickup_address, pickup_city, pickup_state, pickup_zip,
  pickup_contact_name, pickup_contact_phone, pickup_company, pickup_contact_cell,
  pickup_ready_date, pickup_buyer_number,
  delivery_address, delivery_city, delivery_state, delivery_zip,
  delivery_contact_name, delivery_contact_phone, delivery_company, delivery_contact_cell,
  delivery_eta, delivery_buyer_number,
  transport_type, distance_miles,
  customer_rate, deposit_amount, balance_due, received_amount,
  date_signed, dispatched_at, picked_up_at, delivered_at,
  posted_to_central_dispatch_at, cd_external_id,
  posted_to_super_dispatch_at, sd_external_id,
  campaign, loadboard, shipper_info, notes, lost_reason,
  sales_owner_id, follow_up_at, follow_up_note,
  contract_token, contract_sent_at, contract_sent, contract_signed_name,
  contract_signed_email, contract_requires_card,
  balance_paid_by, cod_method, payment_terms, terms_begin,
  payment_method, invoice_payment_method,
  driver_first_name, driver_last_name, driver_phone,
  cd_note, dispatch_instructions,
  created_at, updated_at
from loads;

revoke all on loads_sales_safe from anon, authenticated;
grant select on loads_sales_safe to authenticated;

-- loads_full is `select *`, expanded and frozen at CREATE time -- it must be
-- recreated even though its body is unchanged, or the column is invisible on
-- the manager path and every filter on it fails there and only there.
drop view if exists loads_full;
create view loads_full
  with (security_barrier = true) as
select * from loads
where public.current_profile_role() in ('admin', 'dispatcher');

revoke all on loads_full from anon, authenticated;
grant select on loads_full to authenticated;

-- Every parked tab filters on both columns.
create index if not exists idx_loads_pipeline_stage_status
  on loads (pipeline_stage, status);
