import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Everything the lead webhooks share: the rate limiter, the receipt log, and
// the source-authentication check. It lives here rather than in each route so
// the security boundary is written ONCE — two copies of a constant-time token
// check is how one of them quietly drifts and opens a hole.
//
// Every path under /api/webhooks bypasses the middleware (src/proxy.ts), so
// these functions ARE the boundary. They run for both the JSON webhook and the
// email webhook.

// Per-IP, in-process. Modest on purpose: a provider sending more than this a
// minute is malfunctioning, and the cap is what keeps a guessed URL from being
// hammered while the secret holds it shut anyway. Shared across both routes.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const rateWindow = new Map<string, { count: number; startedAt: number }>();

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateWindow.get(ip);
  if (!entry || now - entry.startedAt > RATE_WINDOW_MS) {
    rateWindow.set(ip, { count: 1, startedAt: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Compare the HASHES, both fixed-length hex, so the length check leaks nothing
// and a wrong-length token cannot be distinguished by timing.
function hashMatches(provided: string, expectedHash: string): boolean {
  const a = Buffer.from(sha256(provided));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string; outcome: string; tokenOk: boolean };

/**
 * Confirm a lead source exists, is active, and presented the right token.
 * Fail-closed: an unknown source and an inactive one get the same 404 as each
 * other on purpose, so this endpoint cannot be used to enumerate which keys
 * exist. A lookup error is a 503, never an "authorized".
 */
export async function authorizeSource(
  supabase: SupabaseClient,
  source: string,
  providedToken: string
): Promise<AuthResult> {
  const { data: src, error } = await supabase
    .from("lead_sources")
    .select("secret_hash, active")
    .eq("key", source)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 503, error: "Temporarily unavailable", outcome: "error_source_lookup", tokenOk: false };
  }
  if (!src || !src.active) {
    return { ok: false, status: 404, error: "Unknown source", outcome: "unauthorized_unknown_source", tokenOk: false };
  }
  if (!providedToken || !hashMatches(providedToken, src.secret_hash as string)) {
    return { ok: false, status: 401, error: "Invalid token", outcome: "unauthorized_bad_token", tokenOk: false };
  }
  return { ok: true };
}

/** Pull the token from either the custom header or an Authorization bearer. */
export function tokenFromHeaders(headers: Headers): string {
  return (
    headers.get("x-lead-token") ||
    (headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    ""
  );
}

export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

// Best-effort receipt log into the table 0007 created for RingCentral. Never
// throws: a diagnostics failure must not cost us the lead. `channel` is 'json'
// or 'email', so the two inbound paths are distinguishable in the log while
// sharing the source's provenance.
export async function logDelivery(
  supabase: SupabaseClient,
  source: string,
  channel: "json" | "email",
  row: { token_ok?: boolean | null; outcome: string; detail?: string | null; from_addr?: string | null; raw?: unknown }
): Promise<void> {
  try {
    const rawStr = row.raw != null ? JSON.stringify(row.raw).slice(0, 4000) : null;
    await supabase.from("webhook_events").insert({
      source: `lead:${source}`.slice(0, 100),
      token_ok: row.token_ok ?? null,
      event_type: channel === "email" ? "lead_email" : "lead",
      direction: "Inbound",
      from_addr: row.from_addr ?? null,
      outcome: row.outcome,
      detail: row.detail ?? null,
      raw: rawStr ? JSON.parse(rawStr) : null,
    });
  } catch (err) {
    console.error("lead webhook_events log failed:", err);
  }
}
