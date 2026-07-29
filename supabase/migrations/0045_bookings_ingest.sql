-- A temporary, write-only door for the msgplane Booked Orders sweep.
--
-- The sweep has to run inside the browser: msgplane serves the report only to a
-- real session, and the session is bound to cookies JavaScript cannot read, so
-- a server-side fetch gets the login page. The report answers one day at a
-- time, so the full history is ~1,670 requests and roughly 40,000 bookings.
--
-- Carrying 40,000 rows back out through the tool transcript would be absurd, so
-- the page posts them here directly instead. That means an endpoint the `anon`
-- role can call, which needs justifying:
--
--   * It is INSERT-ONLY into one reference table. It cannot read, update or
--     delete anything, and it returns a count, not data.
--   * It is guarded by a token that exists only for this run.
--   * It is dropped the moment the sweep finishes — migration 0046. If 0046 is
--     not in this repo, this function is still live and should not be.
--
-- The anon key it is called with is public by design; it ships in our own
-- browser bundle. RLS is what protects the database, and this function is the
-- only thing anon can do to msgplane_bookings.

create or replace function public.ingest_msgplane_bookings(p_token text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_token is distinct from 'sweep-2026-07-29-a41f' then
    raise exception 'bad token';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'batch too large';
  end if;

  insert into msgplane_bookings (order_number, booked_on, rep_name, rep_login)
  select
    r ->> 'o',
    (r ->> 'd')::date,
    nullif(r ->> 'n', ''),
    nullif(r ->> 'l', '')
  from jsonb_array_elements(p_rows) r
  where r ->> 'o' is not null and r ->> 'd' is not null
  on conflict (order_number, booked_on) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ingest_msgplane_bookings(text, jsonb) from public;
grant execute on function public.ingest_msgplane_bookings(text, jsonb) to anon, authenticated;
