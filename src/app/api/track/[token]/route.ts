import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/flags";
import { resolveTrackingToken } from "@/lib/tracking/tokens";
import {
  evaluateFence,
  isMeaningfulMove,
  mergeHistory,
  type Coords,
  type Fence,
} from "@/lib/tracking/geofence";
import { recordEvent } from "@/lib/events/record-event";

// Position ingest for the driver PWA (Phase 2).
//
// This route is in SELF_AUTHENTICATING_PREFIXES: the middleware does not send it
// to /login, because the caller is a phone in a truck with no session. That
// bypass is prefix-based, so EVERY check is this handler's job — the token, its
// kind, its expiry, the load's state, and the rate limit.
//
// It writes with the service role. There is no anon-writable table anywhere in
// this schema and this does not add one: the browser never touches Postgres,
// it posts here and this decides.

const pingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
  // The device's own clock for the fix. Trusted only within a window (below):
  // a wrong phone clock must not be able to backdate a trail.
  recorded_at: z.string().datetime().optional(),
});

/** A driver posts every 2-5 minutes. Anything under this is a bug or a bot. */
const MIN_PING_INTERVAL_MS = 25_000;
/**
 * A fix may be BACKDATED — that is the normal case for a phone that lost signal
 * in a canyon and posts what it buffered. A day is the outside of plausible.
 * (An earlier version clamped anything over 15 minutes old to now, which would
 * have flattened exactly the backlog the recorded_at column exists to preserve.)
 */
const MAX_BACKDATE_MS = 24 * 60 * 60_000;
/** Forward is different: a fix cannot have happened yet. Allow only clock jitter. */
const MAX_FUTURE_MS = 2 * 60_000;

const small = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Dark until switched on, and a disabled feature looks like it does not exist
  // rather than like something to probe.
  if (!(await isFeatureEnabled("gps_tracking"))) return small(404, { error: "not_found" });

  const { token } = await params;
  const resolved = await resolveTrackingToken(token, "driver");
  if (!resolved.ok) {
    // A driver needs to know the difference between "wrong link" and "this job
    // is over" — they act on it. Anyone else learns nothing useful. The body
    // carries the resolver's reason so the page can tell the GOOD ending apart:
    // "revoked_after_delivery" (the auto-revoke below fired) and "load_closed"
    // mean the job is finished, not that the driver needs a new link.
    const gone =
      resolved.reason === "expired" ||
      resolved.reason === "revoked" ||
      resolved.reason === "revoked_after_delivery" ||
      resolved.reason === "load_closed";
    return small(gone ? 410 : 404, { error: resolved.reason });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return small(400, { error: "bad_json" });
  }
  const parsed = pingSchema.safeParse(body);
  if (!parsed.success) return small(400, { error: "bad_ping" });

  const admin = createAdminClient();
  const now = Date.now();

  // Rate limit off the token row itself, not an in-memory map: this runs on
  // Vercel, where every lambda instance keeps its own memory and a cold start
  // resets it. The database is the only shared state there is.
  if (resolved.row.last_used_at) {
    const since = now - new Date(resolved.row.last_used_at).getTime();
    if (since < MIN_PING_INTERVAL_MS) {
      return small(429, { error: "too_fast", retry_after_ms: MIN_PING_INTERVAL_MS - since });
    }
  }

  const claimed = parsed.data.recorded_at ? new Date(parsed.data.recorded_at).getTime() : now;
  const implausible = now - claimed > MAX_BACKDATE_MS || claimed - now > MAX_FUTURE_MS;
  const recordedAt = new Date(implausible ? now : claimed).toISOString();

  const loadId = resolved.load.id;
  const next: Coords = { lat: parsed.data.lat, lng: parsed.data.lng };

  // Newest first. DWELL_FIXES of history is what the geofence needs; a few
  // extra rows cost nothing and make the "did it actually move" check possible.
  const { data: recent } = await admin
    .from("shipment_locations")
    .select("id, lat, lng, recorded_at")
    .eq("load_id", loadId)
    .order("recorded_at", { ascending: false })
    .limit(5);
  const previous = recent?.[0] ? { lat: recent[0].lat, lng: recent[0].lng } : null;

  await admin
    .from("tracking_tokens")
    .update({ last_used_at: new Date(now).toISOString() })
    .eq("id", resolved.row.id);

  const history = mergeHistory(
    { lat: next.lat, lng: next.lng, at: recordedAt },
    (recent ?? []).map((r) => ({ lat: r.lat, lng: r.lng, at: r.recorded_at }))
  );

  // A phone sitting on a dock posts the same spot every three minutes. Those
  // rows make the trail unreadable and tell a dispatcher nothing, so they are
  // not stored — but they are still EVALUATED, and that distinction is the
  // whole feature.
  //
  // Arriving means the last two fixes agree that we are inside the fence. A
  // truck at highway speed covers ~5km in a 3-minute gap, so at most ONE stored
  // fix ever lands inside a 500m radius before it parks; every fix after that
  // is a non-move. Returning here would mean the second agreeing fix is never
  // seen, no arrival ever fires, and — since departure is gated behind arrival
  // — the geofence feature emits nothing at all, ever, while the driver's
  // screen cheerfully reports "sent".
  if (!isMeaningfulMove(previous, next, parsed.data.accuracy_m ?? null)) {
    await evaluateGeofences(loadId, history, recent?.[0]?.id ?? null, recordedAt);
    return small(200, { ok: true, stored: false });
  }

  const { data: inserted, error } = await admin
    .from("shipment_locations")
    .insert({
      load_id: loadId,
      lat: next.lat,
      lng: next.lng,
      recorded_at: recordedAt,
      accuracy_m: parsed.data.accuracy_m ?? null,
      source: "driver_pwa",
    })
    .select("id")
    .single();
  if (error) return small(500, { error: "store_failed" });

  // Same merged history as the not-stored path — mergeHistory already ordered
  // it by recorded_at, so a backdated fix cannot masquerade as the current one.
  await evaluateGeofences(loadId, history, inserted.id, recordedAt);

  return small(200, { ok: true, stored: true });
}

/**
 * Emit arrival/departure if the last few fixes agree. Bounded work: two fence
 * rows, two existing-event rows, and arithmetic — no third-party calls, which
 * is why geocoding happens when the link is issued instead of here.
 */
async function evaluateGeofences(
  loadId: string,
  fixes: Coords[],
  /** Null when the triggering fix was not stored — a parked truck's ping. */
  locationId: string | null,
  occurredAt: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: fences } = await admin
    .from("load_geofences")
    .select("kind, lat, lng, radius_m")
    .eq("load_id", loadId);
  // No fence means an address that would not geocode (ensureLoadGeofences runs
  // when the link is issued). Positions still record; only arrival detection is
  // lost, and the dispatcher can see the truck on the map regardless.
  if (!fences?.length) return;

  const { data: existing } = await admin
    .from("geofence_events")
    .select("fence, transition")
    .eq("load_id", loadId);

  for (const f of fences as Fence[]) {
    const state = {
      arrived: (existing ?? []).some((e) => e.fence === f.kind && e.transition === "arrived"),
      departed: (existing ?? []).some((e) => e.fence === f.kind && e.transition === "departed"),
    };
    const verdict = evaluateFence(f, fixes, state);
    if (!verdict.transition) continue;

    // The unique index in 0050 is the real dedup; ignoreDuplicates makes a
    // double-fire a no-op instead of a 409.
    const { error } = await admin
      .from("geofence_events")
      .upsert(
        {
          load_id: loadId,
          fence: f.kind,
          transition: verdict.transition,
          location_id: locationId,
          occurred_at: occurredAt,
        },
        { onConflict: "load_id,fence,transition", ignoreDuplicates: true }
      );
    if (error) continue;

    await recordEvent({
      loadId,
      type: verdict.transition === "arrived" ? "geofence_entered" : "geofence_exited",
      payload: { fence: f.kind, recorded_at: occurredAt },
      source: "gps",
    });

    // The truck has left the DELIVERY fence: the freight is off, and location
    // sharing has no further purpose. The driver link dies now instead of
    // resting on the 45-day TTL — statuses sit at Dispatched until the CD/SD
    // integration lands, so status alone would never kill it. Same revoke
    // shape as the mint path (revoked_at on the live row); the CUSTOMER link
    // deliberately survives — the most common time a shipper opens it is
    // right after the car lands.
    if (f.kind === "delivery" && verdict.transition === "departed") {
      await admin
        .from("tracking_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("load_id", loadId)
        .eq("kind", "driver")
        .is("revoked_at", null);
      // Margin-free payload, like every load_events row: kind and reason only.
      await recordEvent({
        loadId,
        type: "tracking_link_revoked",
        payload: { kind: "driver", reason: "delivery_departed" },
        source: "gps",
        occurredAt,
      });
    }
  }
}
