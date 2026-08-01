import { unstable_cache } from "next/cache";

// Road distance + ETA from the latest stored fix to the delivery fence centre.
//
// Server-only. Never import from a Client Component: the ORS key lives here,
// and the CSP allowlist is closed on purpose — the browser never talks to
// openrouteservice.org. Same profile (driving-car) and endpoint family as
// src/app/api/geo/route/route.ts, so the two ORS callers cannot drift apart on
// what "the route" means.
//
// STRICTLY BEST-EFFORT, by contract: a missing key, a missing fence, a missing
// fix, a timeout, a 4xx — all of them return null and the caller renders the
// page without an ETA (the customer page falls back to its straight-line
// figure). Nothing here throws to a page, and nothing here writes anywhere —
// an eta_updated spine event from a READ path would be a side effect in
// render; if the timeline ever wants ETAs, the ingest route is where they
// get recorded.
//
// CACHED per (loadId, latest fix identity) for ~30 minutes via unstable_cache —
// the caching API the Next 16 docs prescribe for a project NOT running Cache
// Components ("Caching (Previous Model)" guide; `use cache` needs
// `cacheComponents: true` in next.config.ts, which this app deliberately does
// not enable). Repeated renders and multiple viewers of the same fix share one
// ORS call; a NEW stored fix is a new key, so the figure follows the truck.
// Failures are never cached: the inner fetch throws, unstable_cache only
// stores successful results, and the wrapper turns the throw into null.

/** ~30 minutes — long enough to absorb refresh loops, short enough to matter. */
export const ETA_CACHE_SECONDS = 30 * 60;

/** One directions call, bounded: no geocoding (both ends are already coordinates). */
const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

/** Same conversion route.ts uses. */
const MILES_PER_METER = 0.000621371;

export type EtaPoint = { lat: number; lng: number };

export type RoadEta = {
  /** Drivable miles from the fix to the delivery centre, rounded. */
  roadMiles: number;
  /** ISO instant: ORS duration on top of a departure of now. */
  etaAt: string;
};

/**
 * The ORS request body for fix → delivery. ORS wants [lon, lat] — backwards
 * from everything else in this codebase, which is why it is written down once
 * here (the same reason geocode.ts documents its coordinate flip).
 * radiuses: -1 = snap to the nearest routable road however far, same as the
 * quote map's route call — a truck on a rural highway is often >350m (the ORS
 * default) from the nearest node ORS will admit to.
 */
export function buildDirectionsBody(
  from: EtaPoint,
  to: EtaPoint
): { coordinates: [number, number][]; radiuses: number[] } {
  return {
    coordinates: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    radiuses: [-1, -1],
  };
}

/**
 * Pull { meters, seconds } out of an ORS geojson directions response, or null
 * when the shape is not there. ONLY the summary leaves this module — the route
 * geometry is deliberately dropped so nothing downstream (least of all the
 * public customer page) can leak it.
 */
export function parseDirectionsSummary(
  json: unknown
): { meters: number; seconds: number } | null {
  const summary = (
    json as {
      features?: { properties?: { summary?: { distance?: unknown; duration?: unknown } } }[];
    }
  )?.features?.[0]?.properties?.summary;
  const meters = summary?.distance;
  const seconds = summary?.duration;
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) return null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  return { meters, seconds };
}

/** Summary → the shape callers render. Departure is `nowMs`, not fetch time. */
export function roadEtaFromSummary(
  summary: { meters: number; seconds: number },
  nowMs: number
): RoadEta {
  return {
    roadMiles: Math.round(summary.meters * MILES_PER_METER),
    etaAt: new Date(nowMs + summary.seconds * 1000).toISOString(),
  };
}

/**
 * The one network call. Throws on ANY failure — deliberately, because
 * unstable_cache only stores results, so a transient ORS outage is retried on
 * the next render instead of being cached as "no ETA" for 30 minutes.
 * Exported for the unit tests, which stub global fetch.
 */
export async function fetchRoadSummary(
  from: EtaPoint,
  to: EtaPoint
): Promise<{ meters: number; seconds: number }> {
  const key = (process.env.ORS_KEY || "").trim();
  if (!key) throw new Error("ORS_KEY not configured");
  const r = await fetch(ORS_DIRECTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildDirectionsBody(from, to)),
    // Same bound as route.ts's directions call. A page render is waiting.
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`ORS directions ${r.status}`);
  const parsed = parseDirectionsSummary(await r.json());
  if (!parsed) throw new Error("ORS directions response had no summary");
  return parsed;
}

// loadId and fixId do nothing in the body — they exist to be ARGUMENTS,
// because unstable_cache keys an invocation on its arguments: one entry per
// (load, latest fix), shared by the staff page and every customer viewer.
const cachedRoadSummary = unstable_cache(
  async (
    _loadId: string,
    _fixId: string,
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number
  ) => fetchRoadSummary({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }),
  ["tracking-road-eta"],
  { revalidate: ETA_CACHE_SECONDS }
);

/**
 * Road miles + ETA for a load, or null. The ONLY entry point pages use, and it
 * makes at most one ORS call per render — usually zero, when the fix hasn't
 * changed since someone last looked within the cache window.
 */
export async function getRoadEta(input: {
  loadId: string;
  /** The latest stored fix (id is the cache identity). */
  fix: { id: string; lat: number; lng: number } | null | undefined;
  /** The delivery fence centre. */
  delivery: EtaPoint | null | undefined;
}): Promise<RoadEta | null> {
  const { loadId, fix, delivery } = input;
  if (!(process.env.ORS_KEY || "").trim()) return null;
  if (!fix || !delivery) return null;
  try {
    const summary = await cachedRoadSummary(
      loadId,
      fix.id,
      fix.lat,
      fix.lng,
      delivery.lat,
      delivery.lng
    );
    // ETA is anchored to NOW at read time, on the cached duration: for a truck
    // parked long enough to stop producing stored fixes, "if it left now" is
    // the honest estimate, and a moving truck refreshes the key anyway.
    return roadEtaFromSummary(summary, Date.now());
  } catch {
    // Best-effort by contract — includes the unstable_cache invariant outside
    // a Next request scope, so this module never breaks a test or a script.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Display formatting — BUSINESS_TIMEZONE-aware, same env contract as
// src/lib/dates.ts. format.ts's formatDateTime deliberately isn't reused for
// the ETA: it renders in the SERVER's zone (UTC on Vercel), which for "arrives
// around 3:40 PM" would be off by the team's whole working day.

const BUSINESS_TZ = (process.env.BUSINESS_TIMEZONE || "America/New_York").trim();

/**
 * "Aug 1, 3:40 PM EDT" — a friendly instant in the business timezone, zone
 * named so a customer in another one isn't misled. Also used for the delivery
 * arrival stamp on the customer page. `tz` is a parameter only so tests are
 * deterministic; callers take the default.
 */
export function formatBusinessDateTime(iso: string, tz: string = BUSINESS_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}
