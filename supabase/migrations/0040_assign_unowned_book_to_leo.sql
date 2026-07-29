-- Give the imported book an owner.
--
-- Measured on the live database 2026-07-29, before this migration:
--
--     loads      25,863 of 25,867 have sales_owner_id NULL
--     customers  25,113 of 25,117 have sales_owner_id NULL
--
-- Migration 0037 made ownership the EDIT boundary: a sales rep may change only
-- the records assigned to them, and an unowned record therefore belongs to
-- nobody and can be changed by no rep at all. With 99.98% of the book unowned
-- that rule had nothing to bite on — every record in the system opened
-- read-only for sales, saying "this record has no owner yet".
--
-- The honest fix would be to assign each record to the rep who actually worked
-- it. That evidence does not exist: `campaign` is null on all 25,867,
-- dispatcher_id is set on 1, load_status_history carries a local author on 35
-- of 32,503 rows, and note authorship — the only real signal — reaches 1,545
-- loads, of which just 969 name a single person. The other 24,894 have nothing.
-- The 25 names in those notes are also mostly people with no account here yet.
--
-- So the book goes to the owner of the business, on his instruction, as a
-- holding position: he is an admin, he could already edit all of it, and every
-- record now states who it belongs to instead of claiming it belongs to no one.
-- Reassignment to real reps happens from the Users screen and the list's bulk
-- Reassign action as those accounts are created, and 0041+ can carry the 969
-- note-attributable records once their reps exist.
--
-- ONLY rows that are currently unowned are touched. Charlie's 3 loads, Leo's
-- existing 1, and the 4 already-owned customers keep the owner they have.

-- ============================================================
-- 1. Record exactly which rows this migration claims, so it is reversible
--    to the row. Same pattern as 0013's messages_backup_pre_0013.
--    Drop these once the assignment is confirmed good:
--      drop table loads_unowned_pre_0040, customers_unowned_pre_0040;
-- ============================================================
create table if not exists loads_unowned_pre_0040 as
  select id from public.loads where sales_owner_id is null;

create table if not exists customers_unowned_pre_0040 as
  select id from public.customers where sales_owner_id is null;

-- ============================================================
-- 2. The assignment
-- ============================================================
-- updated_at is suppressed for the duration. trg_loads_updated_at fires on ANY
-- update, so without this every one of the 25,863 rows would read as modified
-- today — the whole book's "last touched" date rewritten by a bookkeeping
-- change nobody made. (trg_loads_pipeline_stage is `update OF status` and does
-- not fire here, which is what keeps 0031's and 0032's 6,604 hold/archived
-- corrections intact.)
alter table public.loads disable trigger trg_loads_updated_at;
alter table public.customers disable trigger trg_customers_updated_at;

do $$
declare
  leo uuid;
  n_loads bigint;
  n_customers bigint;
begin
  select id into leo from public.profiles where email = 'leo@usstrucking.org';
  if leo is null then
    -- Assigning to NULL is what this migration exists to undo. Fail instead.
    raise exception 'No profile for leo@usstrucking.org — refusing to assign the book to nobody';
  end if;

  update public.loads set sales_owner_id = leo where sales_owner_id is null;
  get diagnostics n_loads = row_count;

  update public.customers set sales_owner_id = leo where sales_owner_id is null;
  get diagnostics n_customers = row_count;

  raise notice 'assigned % loads and % customers to %', n_loads, n_customers, leo;
end $$;

alter table public.loads enable trigger trg_loads_updated_at;
alter table public.customers enable trigger trg_customers_updated_at;
