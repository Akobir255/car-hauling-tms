-- Evaluate the three whoami functions once per query instead of once per row.
--
-- ===========================================================================
-- WHAT THE ADVISOR IS COMPLAINING ABOUT
-- ===========================================================================
-- Supabase's "Auth RLS Initialization Plan" warning, on ~20 policies. A row
-- policy is a WHERE clause bolted onto every query, so `is_active_staff()` in
-- a policy runs once for every row Postgres considers. The functions are
-- STABLE, but stable only promises the answer will not change during the
-- statement -- it does not make Postgres remember it.
--
-- Wrapping the call in a scalar subquery does. `(select is_active_staff())`
-- has no reference to the row, so the planner hoists it into an InitPlan,
-- executes it once, and compares the constant against every row.
--
-- Nobody notices today: `hidden_at` leaves 18 loads visible out of 25,885.
-- On the restored book it is 25,885 executions of a function that does its own
-- `select ... from profiles` -- per query, on every page.
--
-- ===========================================================================
-- WHY THIS IS A REWRITE AND NOT A LIST
-- ===========================================================================
-- 80 policies across 32 tables, written over 65 migrations, several of them
-- redefined three or four times. Hand-copying them is exactly how a stale
-- version gets reinstated -- rebuild `customers_select_scoped` from its 0037
-- text and the `hidden_at` check vanishes, un-hiding the book as a side
-- effect of a performance change.
--
-- So this does not retype any policy. It reads each one back from the catalog
-- as Postgres currently holds it, substitutes ONLY the three call sites, and
-- writes it back. Whatever a policy says today, it says tomorrow, plus the
-- wrapper. A policy that needs no change is left alone entirely.
--
-- Wrapped (zero-argument, identical for every row in the query):
--     is_active_staff()        43 uses
--     current_profile_role()   47 uses
--     auth.uid()               17 uses
--
-- NOT wrapped:
--     user_can_access_load(load_id)   21 uses
-- It takes the row's own column. Hoisting it would evaluate it once against
-- one arbitrary row and apply that answer to every other row -- which is not
-- a slow policy, it is a broken one.
--
-- Verification: the whole migration is one transaction, and the policy text is
-- diffed against the pre-migration snapshot afterwards. The only permitted
-- difference is the wrapper.

do $$
declare
  r record;
  new_qual text;
  new_check text;
  stmt text;
  changed int := 0;
  skipped int := 0;
begin
  for r in
    select tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  loop
    new_qual := r.qual;
    new_check := r.with_check;

    -- Guard against double-wrapping: if a previous run already hoisted a
    -- call, leave it. `replace` on an already-wrapped body would nest.
    if new_qual is not null and new_qual !~* '\(\s*select\s+(public\.)?(is_active_staff|current_profile_role)' then
      new_qual := replace(new_qual, 'is_active_staff()', '(select is_active_staff())');
      new_qual := replace(new_qual, 'current_profile_role()', '(select current_profile_role())');
    end if;
    if new_qual is not null and new_qual !~* '\(\s*select\s+auth\.uid' then
      new_qual := replace(new_qual, 'auth.uid()', '(select auth.uid())');
    end if;

    if new_check is not null and new_check !~* '\(\s*select\s+(public\.)?(is_active_staff|current_profile_role)' then
      new_check := replace(new_check, 'is_active_staff()', '(select is_active_staff())');
      new_check := replace(new_check, 'current_profile_role()', '(select current_profile_role())');
    end if;
    if new_check is not null and new_check !~* '\(\s*select\s+auth\.uid' then
      new_check := replace(new_check, 'auth.uid()', '(select auth.uid())');
    end if;

    -- Nothing to do: do not churn a policy for the sake of it.
    if new_qual is not distinct from r.qual
       and new_check is not distinct from r.with_check then
      skipped := skipped + 1;
      continue;
    end if;

    stmt := format(
      'create policy %I on public.%I as %s for %s to %s',
      r.policyname,
      r.tablename,
      case when r.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      lower(r.cmd),
      (select string_agg(quote_ident(role_name), ', ') from unnest(r.roles) as role_name)
    );
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute stmt;
    changed := changed + 1;
  end loop;

  raise notice 'initplan: % policies rewritten, % already fine', changed, skipped;
end $$;

-- ---------------------------------------------------------------------------
-- While we are here: stop 0064/0065's audit views tripping the same linter
-- that flags loads_full.
--
-- They were created without `security_invoker`, which makes them run as their
-- owner -- so the advisor lists them as "Security Definer View: CRITICAL",
-- three new red rows on the dashboard for views that are only a convenience.
-- Unlike loads_full there is no reason for them to be owner-rights: they read
-- catalog views that any role may read, so invoker mode works and is strictly
-- safer. loads_full itself must stay as it is -- it is the only way a manager
-- reads carrier_pay after 0013 revokes the column.
--
-- Also fixes the grant column, which always came back empty:
-- information_schema.role_table_grants only shows grants for roles enabled in
-- the CURRENT session, and the caller is the service role, so anon's and
-- authenticated's grants were invisible. has_table_privilege asks directly.
-- ---------------------------------------------------------------------------
alter view security_policy_snapshot set (security_invoker = true);
alter view security_view_snapshot set (security_invoker = true);

drop view if exists security_table_rls;

create view security_table_rls with (security_invoker = true) as
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

revoke all on security_table_rls from anon, authenticated;

comment on view security_table_rls is
  'Service-role-only: every base table in public with its RLS flag, policy count, and whether anon/authenticated actually hold SELECT (asked via has_table_privilege -- information_schema hides grants for roles not enabled in the session). This is the view that would have caught the 0062 snapshot tables years earlier.';
