-- The other two halves of "read our own locks back": view bodies, and which
-- tables have RLS on at all.
--
-- 0064 exposed pg_policies. That answers "what does this policy say", but not:
--
--   * "is this view security_invoker, and if not, does its BODY carry the
--     condition instead" -- the question behind the advisor's two permanent
--     `loads_full` / `loads_full_contact` criticals, which are non-invoker on
--     purpose (0053) because that is the only way a manager reads carrier_pay
--     after 0013 revokes the column from `authenticated`;
--   * "which tables have row security enabled" -- the question that found the
--     five unprotected snapshot tables in 0062.
--
-- Both are catalog metadata, not data. Service role only, same as 0064.

drop view if exists security_view_snapshot;

create view security_view_snapshot as
select
  c.relname as view_name,
  pg_get_userbyid(c.relowner) as owner,
  -- reloptions carries security_invoker / security_barrier when they are set
  coalesce(array_to_string(c.reloptions, ', '), '') as options,
  coalesce(
    (select option_value = 'true'
       from pg_options_to_table(c.reloptions)
      where option_name = 'security_invoker'),
    false
  ) as is_security_invoker,
  pg_get_viewdef(c.oid, true) as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm');

revoke all on security_view_snapshot from anon, authenticated;

comment on view security_view_snapshot is
  'Service-role-only mirror of the public schema''s view definitions, owners and reloptions, so invoker mode can be checked against the view body. Metadata only. Never grant to anon or authenticated.';

drop view if exists security_table_rls;

create view security_table_rls as
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count,
  coalesce(
    (select string_agg(distinct g.grantee, ', ' order by g.grantee)
       from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.table_name = c.relname
        and g.privilege_type = 'SELECT'
        and g.grantee in ('anon', 'authenticated')),
    ''
  ) as select_granted_to
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

revoke all on security_table_rls from anon, authenticated;

comment on view security_table_rls is
  'Service-role-only: every base table in public with its RLS flag, policy count, and whether anon/authenticated hold SELECT. This is the view that would have caught the 0062 snapshot tables years earlier. Never grant to anon or authenticated.';
