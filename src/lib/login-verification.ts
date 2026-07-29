import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/messaging/email";

// Email second factor. Server-only: this module reads and writes
// login_verifications with the service role, because RLS denies the user
// client every access to that table by design (see migration 0034).

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
// ONE guess per code. A wrong digit burns it and the user asks for another —
// which is why the cooldown below is waived once a code is spent, and why the
// number of codes a session may ever request is capped instead.
const MAX_ATTEMPTS = 1;
const MAX_SENDS_PER_SESSION = 10;

/** The Supabase auth session this request belongs to. */
export async function currentSessionId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  // session_id is a claim on the access token. getSession() does not verify
  // the signature, but every caller has already been through getUser(), which
  // validates the same token against the auth server — so by the time this
  // runs the token is known-good and the claim can be trusted as a key.
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    return typeof json?.session_id === "string" ? json.session_id : null;
  } catch {
    return null;
  }
}

function hashCode(sessionId: string, code: string): string {
  // The session id doubles as a salt, so the same code in two sessions does
  // not produce the same hash.
  return createHash("sha256").update(`${sessionId}:${code}`).digest("hex");
}

function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function isSessionVerified(sessionId: string, userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("login_verifications")
    .select("verified_at, user_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  // Fail CLOSED. An unreadable table means we cannot prove the second factor
  // was completed, and "cannot prove" has to mean "not verified" or the factor
  // is decorative.
  if (error) return false;
  if (!data?.verified_at) return false;
  // A session may only use the row that belongs to its own user.
  return data.user_id === userId;
}

export type IssueResult = { ok: true } | { ok: false; error: string; retryAfterSec?: number };

/**
 * Create (or refresh) the challenge for a session and email the code.
 * Called after the password check succeeds, and again by "resend".
 */
export async function issueChallenge(
  sessionId: string,
  userId: string,
  email: string
): Promise<IssueResult> {
  const db = createAdminClient();
  const { data: existing } = await db
    .from("login_verifications")
    .select("verified_at, last_sent_at, attempts, expires_at, sends")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existing?.verified_at) return { ok: true };

  const sends = existing?.sends ?? 0;
  if (sends >= MAX_SENDS_PER_SESSION) {
    return {
      ok: false,
      error: "Too many codes requested. Sign in again to start over.",
    };
  }

  // The cooldown exists to stop someone spraying a mailbox, not to punish a
  // typo. A code that has already been spent — one wrong guess, or expired —
  // is useless, so replacing it is allowed immediately.
  const spent =
    (existing?.attempts ?? 0) >= MAX_ATTEMPTS ||
    (existing?.expires_at ? new Date(existing.expires_at).getTime() < Date.now() : false);
  if (existing?.last_sent_at && !spent) {
    const since = Date.now() - new Date(existing.last_sent_at).getTime();
    if (since < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        error: "A code was just sent. Check your email.",
        retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000),
      };
    }
  }

  if (!isEmailConfigured()) {
    // Fail closed: without email there is no way to deliver the factor, and
    // letting the login through would silently disable it for everyone.
    return {
      ok: false,
      error: "Verification email is not configured. Contact your administrator.",
    };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error: upsertError } = await db.from("login_verifications").upsert(
    {
      session_id: sessionId,
      user_id: userId,
      code_hash: hashCode(sessionId, code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      attempts: 0,
      verified_at: null,
      last_sent_at: new Date().toISOString(),
      sends: sends + 1,
    },
    { onConflict: "session_id" }
  );
  if (upsertError) return { ok: false, error: "Could not start verification. Try again." };

  try {
    await sendEmail(
      email,
      `${code} is your US Star TMS sign-in code`,
      `Your sign-in code is ${code}\n\nIt expires in 5 minutes and you get one attempt — if you mistype it, ask for a new code.\n\nIf you did not just try to sign in, change your password immediately. Someone else has it.`
    );
  } catch {
    return { ok: false, error: "Could not send the verification email. Try again." };
  }
  return { ok: true };
}

// `reissue` says whether the code this session was holding is now spent, so
// the caller should send a fresh one. A malformed entry (not six digits) never
// spends the code — the person hasn't guessed yet.
export type VerifyResult = { ok: true } | { ok: false; error: string; reissue: boolean };

export async function verifyCode(
  sessionId: string,
  userId: string,
  submitted: string
): Promise<VerifyResult> {
  const code = submitted.replace(/\D/g, "");
  if (code.length !== 6) {
    return { ok: false, error: "Enter the 6-digit code from your email.", reissue: false };
  }

  const db = createAdminClient();
  const { data: row, error } = await db
    .from("login_verifications")
    .select("code_hash, expires_at, attempts, verified_at, user_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error || !row) return { ok: false, error: "That code has expired.", reissue: true };
  if (row.user_id !== userId) return { ok: false, error: "That code has expired.", reissue: true };
  if (row.verified_at) return { ok: true };

  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "That code was already used.", reissue: true };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "That code expired.", reissue: true };
  }

  if (!codesMatch(row.code_hash, hashCode(sessionId, code))) {
    // Count the attempt before returning, so guessing is bounded even if the
    // attacker abandons the page between tries.
    await db
      .from("login_verifications")
      .update({ attempts: row.attempts + 1 })
      .eq("session_id", sessionId);
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    return {
      ok: false,
      error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Incorrect code.",
      reissue: left <= 0,
    };
  }

  await db
    .from("login_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("session_id", sessionId);
  return { ok: true };
}
