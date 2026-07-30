// Geofence evaluation — pure, so it can be tested without a truck.
//
// The requirement is "a truck idling near a geofence does not emit twenty
// rows", and one mechanism is not enough for that. Three stack here:
//
//   1. HYSTERESIS. Entering takes crossing the radius; leaving takes crossing a
//      LARGER one. A driver parked exactly on the line drifts a few metres
//      between fixes, and with a single boundary that is an arrival and a
//      departure every couple of minutes, forever.
//   2. DWELL. One fix inside proves nothing — GPS in a metal cab routinely
//      throws a point hundreds of metres off. Consecutive fixes agreeing is
//      what makes it real.
//   3. A UNIQUE INDEX in migration 0050, as the backstop that holds even if
//      everything above is wrong.

export type Coords = { lat: number; lng: number };

/** Entering the fence is entering `radius_m`. */
export const ENTER_FACTOR = 1;
/** Leaving takes 1.5x the radius, so the boundary cannot flap. */
export const EXIT_FACTOR = 1.5;
/** Consecutive fixes that must agree before a transition is believed. */
export const DWELL_FIXES = 2;

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in metres. Haversine rather than a projection: the
 * distances here are a few hundred metres to a few kilometres, where the error
 * is centimetres, and it has no dependencies or datum surprises.
 */
export function haversineMeters(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Fence = { kind: "pickup" | "delivery"; lat: number; lng: number; radius_m: number };

export type FenceVerdict = {
  transition: "arrived" | "departed" | null;
  /** Distance of the newest fix, for the event payload and for debugging. */
  distance_m: number;
};

/**
 * Decide whether the newest fixes mean the truck just arrived or just left.
 *
 * `fixes` is newest-first and should hold at least DWELL_FIXES entries; fewer
 * than that returns no transition, which is deliberate — a first ping cannot
 * establish anything, and the next one two minutes later will.
 *
 * `arrived` / `departed` are whether those events were ALREADY recorded for
 * this fence. Each fires once (migration 0050 enforces it), so once departed is
 * true this fence is finished and nothing more is emitted.
 */
export function evaluateFence(
  fence: Fence,
  fixes: Coords[],
  state: { arrived: boolean; departed: boolean }
): FenceVerdict {
  const newest = fixes[0];
  const distance_m = newest ? haversineMeters(newest, fence) : Number.NaN;

  if (fixes.length < DWELL_FIXES || state.departed) {
    return { transition: null, distance_m };
  }

  const recent = fixes.slice(0, DWELL_FIXES);
  const distances = recent.map((f) => haversineMeters(f, fence));

  if (!state.arrived) {
    const allInside = distances.every((d) => d <= fence.radius_m * ENTER_FACTOR);
    return { transition: allInside ? "arrived" : null, distance_m };
  }

  // Arrived already: the only thing left to detect is leaving, and leaving
  // means clearing the wider ring.
  const allOutside = distances.every((d) => d > fence.radius_m * EXIT_FACTOR);
  return { transition: allOutside ? "departed" : null, distance_m };
}

/**
 * A position is worth storing only if it says something new. A phone left on a
 * dock posts the same spot every three minutes; those rows cost storage, make
 * the trail unreadable, and tell a dispatcher nothing.
 */
export function isMeaningfulMove(
  previous: Coords | null,
  next: Coords,
  accuracy_m: number | null
): boolean {
  if (!previous) return true;
  const moved = haversineMeters(previous, next);
  // Below the fix's own accuracy the "movement" is noise, not travel. The 25m
  // floor keeps a wildly optimistic accuracy reading from letting jitter
  // through.
  const threshold = Math.max(25, accuracy_m ?? 0);
  return moved > threshold;
}
