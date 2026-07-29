-- 32055751-US was the single record 0030 could not classify. Its import note
-- names the QUOTES tab, its msgplane_status says 'on-hold-order', and 0030's
-- backfill trusts the note, so it landed in Quotes > Hold.
--
-- The old system settles it: its own global search lists this record under
-- Orders & Leads with status "on-hold-order" and an order number of
-- "32055751-US cd". It is an order that was put on hold, and the note's tab
-- token is the thing that is wrong -- which is expected, since a record can be
-- reached from more than one list.
--
-- Stage only. Status stays 'hold', which is correct on both systems.

update loads
   set pipeline_stage = 'order'
 where load_number = '32055751-US'
   and msgplane_status = 'on-hold-order'
   and pipeline_stage = 'quote';

-- An UPDATE naming only pipeline_stage is honored verbatim: trg_loads_pipeline_stage
-- is `before insert or update OF status`, so it does not fire here.
