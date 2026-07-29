-- Second factor on sign-in: a 6-digit code emailed after the password check.
--
-- Keyed by the Supabase auth SESSION id, not by user: signing out ends the
-- session, so the next sign-in is challenged again, while a token refresh
-- keeps the same session and stays verified. That is the behaviour people
-- expect from "verify this login" and it needs no extra cookie to carry.
--
-- Only the code's HASH is stored. A code is short-lived and rate-limited, but
-- a leaked backup should not hand anyone a working second factor.

create table if not exists login_verifications (
  session_id uuid primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_at timestamptz,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_login_verifications_user on login_verifications (user_id);

-- Sweeping old rows keeps this table from growing a row per login forever.
create index if not exists idx_login_verifications_expires on login_verifications (expires_at)
  where verified_at is null;

-- RLS on with NO policies: the user client must never read or write this.
-- Every access goes through the service role in src/lib/login-verification.ts.
-- Without this a signed-in rep could read their own code_hash, or worse, set
-- verified_at on their own row and skip the factor entirely.
alter table login_verifications enable row level security;
revoke all on login_verifications from anon, authenticated;

comment on table login_verifications is
  'Email second factor per auth session. Service-role only — RLS is enabled '
  'with no policies on purpose. Rows are disposable; deleting one just means '
  'that session must request a new code.';
