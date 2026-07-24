-- Sequential load numbers starting at 10000000 (msgplane convention).
-- New loads get `<n>-US`; duplicated loads get `<n>US` (no hyphen), matching
-- how msgplane marks duplicates. The sequence guarantees uniqueness without
-- retries.

create sequence public.load_number_seq start with 10000000;

create or replace function public.next_load_number()
returns bigint
language sql
security definer
set search_path = public
as $$
  select nextval('public.load_number_seq');
$$;

revoke execute on function public.next_load_number() from public, anon;
grant execute on function public.next_load_number() to authenticated;
