-- The second factor has to come BEFORE a Supabase session exists, not after.
--
-- 0034 gated the app: requireProfile() sent an unverified session to /verify.
-- That protected the UI and nothing else. signInWithPassword already minted a
-- real access token at the password step, and the project URL and anon key are
-- public by design — so a stolen password was enough to lift the token out of
-- the cookie and query PostgREST, Storage and Realtime directly. RLS authorises
-- on role and uid; it had no idea a code was outstanding. The gate was in the
-- one place the attacker did not have to go through.
--
-- So the password check now happens on a client that persists nothing, and the
-- session is minted only after the emailed code is accepted. Until then all
-- that exists is a row here plus an httpOnly cookie holding this id — neither
-- of which authorises anything against the database.

create table if not exists pending_logins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sends int not null default 0,
  last_sent_at timestamptz not null default now(),
  next_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pending_logins_expires on pending_logins (expires_at);
create index if not exists idx_pending_logins_user on pending_logins (user_id);

-- Service role only. A pending login is pre-authentication by definition, so
-- there is no such thing as a legitimate `authenticated` read of this table.
alter table pending_logins enable row level security;
revoke all on pending_logins from anon, authenticated;

comment on table pending_logins is
  'Password accepted, emailed code outstanding. Holds no session and grants no '
  'access; exchanged for a real session only by src/lib/login-verification.ts '
  'once the code matches. Service-role only.';
