import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/messaging/email";

// The pre-session half of the email second factor.
//
// Everything here happens BEFORE a Supabase session exists. That ordering is
// the whole point: a password alone must not produce an access token, because
// an access token is usable against PostgREST/Storage/Realtime directly and
// none of those consult this application's code.

const COOKIE = "pending_login";
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS = 10;

function hashCode(pendingId: string, code: string): string {
  return createHash("sha256").update(`${pendingId}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function setCookie(id: string) {
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.ceil(CODE_TTL_MS / 1000) * (MAX_SENDS + 2),
  });
}

export async function clearPendingCookie() {
  (await cookies()).delete(COOKIE);
}

export async function pendingId(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

/**
 * Check the password WITHOUT creating a session, then start a challenge.
 * Returns an error string, or null on success (caller redirects to /verify).
 */
export async function startPendingLogin(
  email: string,
  password: string,
  nextPath: string
): Promise<string | null> {
  // A throwaway client: persistSession false and no cookie adapter, so a
  // correct password mints tokens that live and die inside this function.
  const probe = createPlainClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.user) return "Invalid email or password.";
  // Kill the tokens this check just produced. They were never written anywhere,
  // but revoking is cheap and leaves nothing usable if that ever changes.
  await probe.auth.signOut().catch(() => {});

  const db = createAdminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("id, email, active")
    .eq("id", data.user.id)
    .single();
  // Same answer as a bad password: whether an account exists or is disabled is
  // not something an unauthenticated caller gets to learn.
  if (!profile || !profile.active) return "Invalid email or password.";

  if (!isEmailConfigured()) {
    return "Verification email is not configured. Contact your administrator.";
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { data: row, error: insErr } = await db
    .from("pending_logins")
    .insert({
      user_id: profile.id,
      email: profile.email,
      code_hash: "pending",
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      sends: 1,
      next_path: nextPath || null,
    })
    .select("id")
    .single();
  if (insErr || !row) return "Could not start sign-in. Try again.";

  await db
    .from("pending_logins")
    .update({ code_hash: hashCode(row.id, code) })
    .eq("id", row.id);

  try {
    await sendEmail(
      profile.email,
      `${code} is your US Star TMS sign-in code`,
      `Your sign-in code is ${code}\n\nIt expires in 5 minutes and you get one attempt — if you mistype it we will send another.\n\nIf you did not just try to sign in, change your password immediately. Someone else has it.`
    );
  } catch {
    await db.from("pending_logins").delete().eq("id", row.id);
    return "Could not send the verification email. Try again.";
  }

  await setCookie(row.id);
  return null;
}

export type PendingView = { email: string; nextPath: string } | null;

export async function describePending(): Promise<PendingView> {
  const id = await pendingId();
  if (!id) return null;
  const { data } = await createAdminClient()
    .from("pending_logins")
    .select("email, next_path, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return { email: data.email, nextPath: data.next_path ?? "" };
}

export async function resendPendingCode(): Promise<string | null> {
  const id = await pendingId();
  if (!id) return "Your sign-in expired. Start again.";
  const db = createAdminClient();
  const { data: row } = await db
    .from("pending_logins")
    .select("id, email, sends, last_sent_at, attempts, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return "Your sign-in expired. Start again.";
  if (row.sends >= MAX_SENDS) return "Too many codes requested. Start again.";

  // The cooldown guards a mailbox, not a typo: a code already spent by a wrong
  // guess or by expiry can be replaced immediately.
  const spent =
    row.attempts >= 1 || new Date(row.expires_at).getTime() < Date.now();
  if (!spent) {
    const since = Date.now() - new Date(row.last_sent_at).getTime();
    if (since < RESEND_COOLDOWN_MS) return "A code was just sent. Check your email.";
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db
    .from("pending_logins")
    .update({
      code_hash: hashCode(row.id, code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      attempts: 0,
      sends: row.sends + 1,
      last_sent_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  try {
    await sendEmail(
      row.email,
      `${code} is your US Star TMS sign-in code`,
      `Your sign-in code is ${code}\n\nIt expires in 5 minutes and you get one attempt.\n\nIf you did not just try to sign in, change your password immediately.`
    );
  } catch {
    return "Could not send the verification email. Try again.";
  }
  return null;
}

export type CompleteResult = { ok: true; nextPath: string } | { ok: false; error: string };

/**
 * Check the code and, only if it matches, mint the real session.
 */
export async function completePendingLogin(submitted: string): Promise<CompleteResult> {
  const code = submitted.replace(/\D/g, "");
  const id = await pendingId();
  if (!id) return { ok: false, error: "Your sign-in expired. Start again." };
  if (code.length !== 6) {
    return { ok: false, error: "Enter the 6-digit code from your email." };
  }

  const db = createAdminClient();
  const { data: row } = await db
    .from("pending_logins")
    .select("id, user_id, email, code_hash, expires_at, attempts, next_path")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Your sign-in expired. Start again." };

  // Consume the single attempt ATOMICALLY. Two concurrent submissions both
  // read attempts=0, so a plain read-then-write would let every request in a
  // burst count as the same guess; matching on attempts=0 in the WHERE clause
  // means exactly one of them wins and the rest are already spent.
  const { data: claimed } = await db
    .from("pending_logins")
    .update({ attempts: 1 })
    .eq("id", row.id)
    .eq("attempts", 0)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: "That code was already used." };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "That code expired." };
  }
  if (!sameHash(row.code_hash, hashCode(row.id, code))) {
    return { ok: false, error: "Incorrect code." };
  }

  // Correct. Mint a session without ever holding the password: an admin-issued
  // one-time link, redeemed server-side, which is what writes the auth cookies.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: row.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return { ok: false, error: "Could not complete sign-in. Try again." };
  }
  const supabase = await createClient();
  const { error: otpErr } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });
  if (otpErr) return { ok: false, error: "Could not complete sign-in. Try again." };

  await db.from("pending_logins").delete().eq("id", row.id);
  await clearPendingCookie();

  // Belt and braces: mark the session that was just created as verified, so
  // requireProfile's gate passes for it and keeps failing for anything older.
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (token) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
      );
      if (typeof payload?.session_id === "string") {
        await db.from("login_verifications").upsert(
          {
            session_id: payload.session_id,
            user_id: row.user_id,
            code_hash: "consumed",
            expires_at: new Date().toISOString(),
            attempts: 0,
            verified_at: new Date().toISOString(),
            last_sent_at: new Date().toISOString(),
            sends: 0,
          },
          { onConflict: "session_id" }
        );
      }
    } catch {
      /* the gate simply stays shut if this fails */
    }
  }

  const next = row.next_path ?? "";
  return { ok: true, nextPath: next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard" };
}
