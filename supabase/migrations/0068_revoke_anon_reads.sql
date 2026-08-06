-- Take SELECT away from `anon` on the 19 tables that still had it.
--
-- ===========================================================================
-- WHY
-- ===========================================================================
-- Supabase grants the publishable ("anon") role SELECT on new tables in
-- `public` by default. 0013 revoked it on `loads` and nowhere else, so 19
-- tables still hand it out -- among them `customers`, `messages`, `payouts`,
-- `invoices` and `profiles`.
--
-- Nothing leaks today. Every one of those tables has RLS on, and the policies
-- all route through is_active_staff(), which is false for an anonymous caller,
-- so the rows come back empty. Measured before this migration: an anonymous
-- request for `customers` returns HTTP 200 and zero rows.
--
-- The problem is what that arrangement costs when something else goes wrong.
-- The publishable key is in the browser bundle by definition, so `anon` is
-- effectively "the internet". With the grant in place, one policy written with
-- `using (true)` -- or one policy dropped during a migration, or a table
-- briefly re-created without its policy -- is a public data breach. Without
-- the grant, the same mistake is a staff-only overexposure, which is bad but
-- is not a headline. Two locks, not one.
--
-- ===========================================================================
-- WHY THIS IS SAFE
-- ===========================================================================
-- The pages that serve people with no account -- /sign/<token>,
-- /track/<token>, /t/<token> -- do not read these tables as `anon`. They read
-- with the SERVICE ROLE (createAdminClient) and authenticate by the
-- unguessable token instead of a session; that is the documented pattern in
-- src/lib/supabase/proxy.ts. The service role is unaffected by anything here.
--
-- The anon key's other job is authentication itself -- signing in, the emailed
-- code, setting a password. Those are GoTrue endpoints, not table reads, and
-- the tables behind them (pending_logins, login_verifications) are already
-- service-role only.
--
-- `authenticated` is untouched. This changes nothing for anyone who is logged
-- in, and every existing policy still applies to them exactly as before.
--
-- To reverse a single table:  grant select on public.<table> to anon;

do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
      and has_table_privilege('anon', c.oid, 'SELECT')
    order by c.relname
  loop
    execute format('revoke select on public.%I from anon', t);
    raise notice 'revoked anon select on %', t;
    n := n + 1;
  end loop;

  raise notice 'anon select revoked on % tables', n;
end $$;
