-- A way to read our own row policies back, without Docker.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
-- Auditing or rewriting a policy safely means reading the CURRENT definition
-- first. These policies have been redefined across dozens of migrations --
-- `customers_select_scoped` alone was written in 0013, widened in 0037 and
-- narrowed again in 0052 -- so the newest migration file that mentions a
-- policy is not reliably the one in force. Recreating one from the wrong
-- version is how you silently undo a fix: rebuild `customers_select_scoped`
-- from 0037 and the `hidden_at` check disappears, un-hiding the whole book as
-- a side effect of an unrelated edit.
--
-- The normal way to check is `supabase db dump`, which shells out to pg_dump
-- in a container and fails on any machine without Docker Desktop. The
-- dashboard shows policies one at a time, which does not diff.
--
-- `pg_policies` answers it exactly, but PostgREST only exposes `public`, so a
-- view in `public` is what makes the catalog reachable over the REST endpoint
-- the CLI already authenticates against.
--
-- ===========================================================================
-- WHO CAN READ IT
-- ===========================================================================
-- The service role, and nothing else. Explicitly revoked from anon and
-- authenticated, in that order, before any grant -- this is a map of every
-- lock in the building and it is not for the people the locks are for.
--
-- It exposes no data: `pg_policies` holds policy TEXT, not rows.

drop view if exists security_policy_snapshot;

create view security_policy_snapshot as
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles::text[] as roles,
  cmd,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public';

revoke all on security_policy_snapshot from anon, authenticated;

comment on view security_policy_snapshot is
  'Service-role-only mirror of pg_policies for the public schema, so row policies can be read back and diffed without Docker (supabase db dump needs a container). Policy text only -- no table data. Never grant this to anon or authenticated.';
