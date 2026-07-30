import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LoadStatus } from "@/types/database";

// Server-only. Never import from a Client Component: resolving a token uses the
// service role, and the token itself is the secret that stands in for a login.
//
// This mirrors the contract link that already works this way (/sign/[token]) —
// an unguessable string checked server-side, never a session — because that
// pattern is proven here and a second scheme would be a second thing to get
// wrong.

/** 32 bytes of CSPRNG, base64url. Guessing is not a threat model at this size. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The driver's link dies when the freight is off the truck. The brief says
 * "expires on delivery", and STATUS on the load is the truth of that — the
 * timestamp below is only a backstop for a load that never reaches a terminal
 * state (abandoned, stuck in dispatched forever).
 */
export const DRIVER_TOKEN_DEAD_STATUSES: LoadStatus[] = [
  "delivered",
  "invoiced",
  "paid",
  "archived",
  "lost",
  "cancelled",
];

/**
 * The customer's link outlives delivery on purpose: the most common time a
 * shipper opens it is right after the car lands, to see that it did. It dies
 * when the record is parked or the order never happened.
 */
export const CUSTOMER_TOKEN_DEAD_STATUSES: LoadStatus[] = ["archived", "lost", "cancelled"];

/**
 * Backstop TTL. Not the real expiry — the status check above is — so this is
 * deliberately generous: a car moving coast to coast on a slow carrier is three
 * weeks, and a link that dies mid-haul is a support call.
 */
export const DEFAULT_TOKEN_TTL_DAYS = 45;

export type TrackingTokenKind = "driver" | "customer";

export type TrackingTokenRow = {
  id: string;
  load_id: string;
  kind: TrackingTokenKind;
  token: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

export type ResolvedToken =
  | { ok: true; row: TrackingTokenRow; load: { id: string; load_number: string; status: LoadStatus } }
  | { ok: false; reason: "not_found" | "wrong_kind" | "revoked" | "expired" | "load_closed" };

/**
 * Validate a token from a public URL. Uses the service role because the caller
 * has no session at all — that is the point of the page — so every check that
 * would normally be RLS's job is made explicitly here.
 */
export async function resolveTrackingToken(
  token: string,
  kind: TrackingTokenKind
): Promise<ResolvedToken> {
  // A token is a fixed-shape secret; anything else is not worth a round trip.
  if (!token || token.length < 20 || token.length > 200) return { ok: false, reason: "not_found" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("tracking_tokens")
    .select("id, load_id, kind, token, expires_at, revoked_at, last_used_at")
    .eq("token", token)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  const t = row as TrackingTokenRow;
  // Kind is checked, not assumed: a customer's read-only link must never be
  // accepted by the ingest endpoint just because it is a valid token.
  if (t.kind !== kind) return { ok: false, reason: "wrong_kind" };
  if (t.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(t.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const { data: load } = await admin
    .from("loads")
    .select("id, load_number, status")
    .eq("id", t.load_id)
    .maybeSingle();
  if (!load) return { ok: false, reason: "not_found" };

  const dead = kind === "driver" ? DRIVER_TOKEN_DEAD_STATUSES : CUSTOMER_TOKEN_DEAD_STATUSES;
  if (dead.includes(load.status as LoadStatus)) return { ok: false, reason: "load_closed" };

  return { ok: true, row: t, load: load as { id: string; load_number: string; status: LoadStatus } };
}

/**
 * Issue a link for a load, replacing any live one of the same kind. Runs as the
 * CALLER, so the insert policy in 0050 still decides whether this staff member
 * may write to this load — issuing a driver link is a write on the order.
 */
export async function mintTrackingToken(
  loadId: string,
  kind: TrackingTokenKind,
  createdBy: string,
  ttlDays: number = DEFAULT_TOKEN_TTL_DAYS
): Promise<{ token: string | null; error: string | null }> {
  const supabase = await createClient();

  // Revoke first: the unique index in 0050 allows one live token per load per
  // kind, so reissuing without this fails on conflict rather than rotating.
  const { error: revokeError } = await supabase
    .from("tracking_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("load_id", loadId)
    .eq("kind", kind)
    .is("revoked_at", null);
  if (revokeError) return { token: null, error: revokeError.message };

  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const { error } = await supabase.from("tracking_tokens").insert({
    load_id: loadId,
    kind,
    token,
    expires_at: expiresAt,
    created_by: createdBy,
  });
  if (error) return { token: null, error: error.message };
  return { token, error: null };
}
