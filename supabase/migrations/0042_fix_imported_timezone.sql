-- Every imported record is stored one hour early for half the year.
--
-- The importer converted msgplane's Eastern wall-clock times to UTC using a
-- FIXED -4 offset. -4 is Eastern DAYLIGHT time. For the five months a year that
-- Eastern is on STANDARD time (-5), every timestamp landed an hour early.
--
-- Proved two ways on the live database, 2026-07-29:
--
--  1. Six rows read off msgplane's own Quotes > Follow-up list (page 8000-8100)
--     against ours. All six differ by exactly one hour, all six in November:
--       31537732-US  msgplane 11/18/2024 07:01 AM   ours 06:01 AM
--       31537649-US  msgplane 11/18/2024 06:49 AM   ours 05:49 AM
--       31537525-US  msgplane 11/17/2024 07:37 PM   ours 06:37 PM
--       31537332-US  msgplane 11/17/2024 03:16 PM   ours 02:16 PM
--       31537014-US  msgplane 11/17/2024 07:50 AM   ours 06:50 AM
--       31536949-US  msgplane 11/17/2024 07:49 AM   ours 06:49 AM
--
--  2. 6,864 records share a round "noon" timestamp. Under a correct conversion
--     those would sit at 16:00Z in summer and 17:00Z in winter. Instead 4,375
--     summer AND 2,489 winter records all sit at 16:00Z, with only 13 rows at
--     17:00Z in the whole table. A single offset was used for every row.
--
-- So: rows whose Eastern offset is -5 need +1 hour; rows at -4 are already
-- right. 8,807 of 25,867 fall in EST.
--
-- Rows written by THIS system are excluded. A msgplane timestamp arrives with
-- whole seconds; an app insert carries microseconds (now()). Shifting those
-- would break the 45 records that are actually correct.
--
-- Not touched here: follow_up_at and the other imported timestamps almost
-- certainly carry the same skew, but created_at is the "Quoted" column the
-- lists sort and display, so it is corrected first and on its own, where the
-- before/after can be checked against msgplane row by row.

create table if not exists loads_created_at_pre_0042 as
  select id, created_at from public.loads;

-- trg_loads_updated_at fires on any update; without this the whole book would
-- read as modified by a correction nobody made. trg_loads_pipeline_stage is
-- `update OF status` and does not fire here.
alter table public.loads disable trigger trg_loads_updated_at;

do $$
declare n bigint;
begin
  update public.loads
     set created_at = created_at + interval '1 hour'
   where date_trunc('second', created_at) = created_at
     and (created_at at time zone 'America/New_York')
       - (created_at at time zone 'UTC') = interval '-5 hours';
  get diagnostics n = row_count;
  raise notice 'shifted % rows from EST-misread to the real Eastern time', n;
end $$;

alter table public.loads enable trigger trg_loads_updated_at;
