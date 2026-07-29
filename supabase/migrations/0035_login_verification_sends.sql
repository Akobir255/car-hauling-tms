-- One attempt per code (0034 shipped with six) means a mistyped digit burns
-- the code and the user asks for another. That is the intended strictness, but
-- it moves the brute-force question from "how many guesses per code" to "how
-- many codes can a session ask for" -- so the sends are counted and capped.
--
-- Not reset by a new code: the count is per SESSION for its whole life. Ten
-- codes is far more than a person needs and far less than a guessing budget
-- (each send is one 1-in-a-million guess AND an email landing in the real
-- owner's inbox, which is the alarm).

alter table login_verifications
  add column if not exists sends int not null default 0;

comment on column login_verifications.sends is
  'Codes issued to this session, ever. Capped in src/lib/login-verification.ts; '
  'hitting the cap forces a fresh sign-in rather than another code.';
