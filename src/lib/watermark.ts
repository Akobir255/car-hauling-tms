// The per-user screen watermark: what the line says and how each piece is
// derived. The point is ATTRIBUTION, not prevention — nothing here stops a
// photograph, it just makes the photograph name the person who took it. So
// every field exists to narrow down "who was sitting in front of this screen,
// on what connection, when", and none of it is a secret worth hiding.

const SEPARATOR = " · ";

/**
 * The client's address out of an `x-forwarded-for` chain — the FIRST hop is
 * the browser; everything after it is Vercel's and Cloudflare's proxies. Same
 * read as the RingCentral webhook and the e-sign per-open audit, deliberately:
 * three places quoting one IP have to agree on which one it is.
 */
export function clientIpFromHeader(forwardedFor: string | null | undefined): string | null {
  const first = (forwardedFor ?? "").split(",")[0].trim();
  return first || null;
}

/**
 * A PREFIX of the auth session id — never the whole id, and never the access
 * token it is a claim on. Eight hex characters is enough to tie two photos to
 * the same login (and to find the row in `login_verifications`) while being
 * useless to anyone who reads it back off a screen.
 */
export function shortSessionId(sessionId: string | null | undefined): string | null {
  const compact = (sessionId ?? "").replace(/-/g, "").trim();
  return compact ? compact.slice(0, 8) : null;
}

/**
 * One line, repeated across the overlay. `day` is passed in rather than read
 * from the clock here so the builder stays pure and the caller keeps the
 * business-timezone decision (see `businessDay` in lib/dates).
 */
export function buildWatermarkLabel({
  name,
  email,
  sessionId,
  day,
  ip,
}: {
  name?: string | null;
  email?: string | null;
  sessionId?: string | null;
  day: string;
  ip?: string | null;
}): string {
  const who = (name ?? "").trim();
  const mail = (email ?? "").trim();

  const parts: string[] = [];
  // The name leads: it is the one field a person recognises at a glance in a
  // photo of a screen. A profile with no full_name falls back to the email
  // alone rather than starting the line with a gap, and a profile whose name
  // IS its email doesn't spend the width twice.
  if (who && who !== mail) parts.push(who);
  if (mail) parts.push(mail);
  if (parts.length === 0) parts.push("unknown user");

  parts.push(day);
  // "unknown" rather than dropping the field. A photograph has to be able to
  // distinguish "no address reached us" from "nobody put one in the
  // watermark" — a missing segment reads as the second and quietly weakens
  // every other line. The webhook uses the same word for the same reason.
  parts.push(`IP ${ip?.trim() || "unknown"}`);
  parts.push(`SID ${shortSessionId(sessionId) ?? "unknown"}`);

  return parts.join(SEPARATOR);
}
