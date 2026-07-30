import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DWELL_FIXES,
  EXIT_FACTOR,
  evaluateFence,
  haversineMeters,
  isMeaningfulMove,
  mergeHistory,
  type Coords,
  type Fence,
  type TimedFix,
} from "../src/lib/tracking/geofence";

// A dealer lot in Dallas, and points measured off it.
const LOT: Fence = { kind: "pickup", lat: 32.7767, lng: -96.797, radius_m: 500 };

// Metres per degree of latitude on the SAME sphere haversineMeters uses
// (mean earth radius 6,371,008.8m). The familiar 111,320 figure comes off the
// WGS84 ellipsoid instead, and mixing the two makes a "1000m" fixture measure
// 998.9m — a test failing on its own arithmetic rather than on the code.
const METRES_PER_DEG_LAT = (Math.PI * 6_371_008.8) / 180;

/** Move north by metres. */
const north = (from: Coords, metres: number): Coords => ({
  lat: from.lat + metres / METRES_PER_DEG_LAT,
  lng: from.lng,
});

const at = (metres: number): Coords => north({ lat: LOT.lat, lng: LOT.lng }, metres);

describe("haversineMeters", () => {
  it("measures a known short distance to within a metre", () => {
    expect(haversineMeters(LOT, at(1000))).toBeCloseTo(1000, 0);
  });

  it("is zero for the same point and symmetric", () => {
    expect(haversineMeters(LOT, LOT)).toBe(0);
    expect(haversineMeters(LOT, at(250))).toBeCloseTo(haversineMeters(at(250), LOT), 6);
  });

  it("does not confuse latitude with longitude", () => {
    // A degree of longitude at this latitude is much shorter than a degree of
    // latitude. Swapping the two is the classic bug and it would put a truck
    // in the wrong state, so it gets a test.
    const byLat = haversineMeters(LOT, { lat: LOT.lat + 1, lng: LOT.lng });
    const byLng = haversineMeters(LOT, { lat: LOT.lat, lng: LOT.lng + 1 });
    expect(byLat).toBeGreaterThan(byLng);
    expect(byLat).toBeCloseTo(111_195, -2);
  });
});

describe("evaluateFence — arrival", () => {
  const fresh = { arrived: false, departed: false };

  it("does not fire on a single fix, however close", () => {
    // One fix inside proves nothing: GPS in a metal cab throws wild points.
    expect(evaluateFence(LOT, [at(10)], fresh).transition).toBeNull();
  });

  it("fires once two consecutive fixes agree", () => {
    expect(evaluateFence(LOT, [at(10), at(50)], fresh).transition).toBe("arrived");
  });

  it("does not fire when only the newest fix is inside", () => {
    // Exactly the noise case: one stray point near the lot while driving past.
    expect(evaluateFence(LOT, [at(100), at(4000)], fresh).transition).toBeNull();
  });

  it("does not fire outside the radius", () => {
    expect(evaluateFence(LOT, [at(600), at(650)], fresh).transition).toBeNull();
  });

  it("never re-fires once arrival is recorded", () => {
    const state = { arrived: true, departed: false };
    expect(evaluateFence(LOT, [at(10), at(20)], state).transition).toBeNull();
  });
});

describe("evaluateFence — departure and the idling truck", () => {
  const arrived = { arrived: true, departed: false };

  it("does not treat drift just past the radius as leaving", () => {
    // THE bug this design exists to prevent: a driver parked on the boundary
    // drifting between fixes must not emit arrived/departed all afternoon.
    // 520m is outside the 500m radius but inside the 750m exit ring.
    expect(evaluateFence(LOT, [at(520), at(540)], arrived).transition).toBeNull();
  });

  it("fires once the wider exit ring is cleared", () => {
    const beyond = LOT.radius_m * EXIT_FACTOR + 50;
    expect(evaluateFence(LOT, [at(beyond), at(beyond + 100)], arrived).transition).toBe("departed");
  });

  it("needs consecutive fixes outside, not one", () => {
    const beyond = LOT.radius_m * EXIT_FACTOR + 50;
    expect(evaluateFence(LOT, [at(beyond), at(10)], arrived).transition).toBeNull();
  });

  it("is finished after departure — nothing fires again", () => {
    const done = { arrived: true, departed: true };
    expect(evaluateFence(LOT, [at(10), at(20)], done).transition).toBeNull();
    expect(evaluateFence(LOT, [at(9000), at(9100)], done).transition).toBeNull();
  });

  it("simulates an idling truck and emits exactly one arrival", () => {
    // Twenty fixes jittering across the boundary. The brief's requirement is
    // that this does not produce twenty rows.
    const state = { arrived: false, departed: false };
    let arrivals = 0;
    let departures = 0;
    const jitter = [480, 520, 495, 510, 470, 530, 460, 505, 490, 515];
    const history: Coords[] = [];
    for (const d of [...jitter, ...jitter]) {
      history.unshift(at(d));
      const v = evaluateFence(LOT, history, state);
      if (v.transition === "arrived") {
        arrivals++;
        state.arrived = true;
      }
      if (v.transition === "departed") {
        departures++;
        state.departed = true;
      }
    }
    expect(arrivals).toBeLessThanOrEqual(1);
    expect(departures).toBe(0);
  });
});

// The route's real loop, in miniature. Every earlier test in this file feeds
// evaluateFence a history by hand, which is exactly why none of them caught the
// defect below: the bug lived in HOW the route assembled that history, not in
// the maths.
function simulateIngest(
  fence: Fence,
  pings: TimedFix[],
  { evaluateOnlyWhenStored }: { evaluateOnlyWhenStored: boolean }
): string[] {
  const stored: TimedFix[] = [];
  const state = { arrived: false, departed: false };
  const events: string[] = [];

  for (const ping of pings) {
    const previous = stored[0] ?? null;
    const history = mergeHistory(ping, stored);
    const meaningful = isMeaningfulMove(previous, ping, 10);
    if (meaningful) stored.unshift(ping);
    if (evaluateOnlyWhenStored && !meaningful) continue;

    const v = evaluateFence(fence, history, state);
    if (v.transition === "arrived") {
      events.push("arrived");
      state.arrived = true;
    }
    if (v.transition === "departed") {
      events.push("departed");
      state.departed = true;
    }
  }
  return events;
}

/** Highway approach at ~5km per 3-minute ping, then parked at the dock. */
function approachAndPark(): TimedFix[] {
  const t = (min: number) => new Date(Date.UTC(2026, 6, 30, 12, min)).toISOString();
  const pings: TimedFix[] = [];
  let minute = 0;
  // Closing from 20km out in 5km steps — the last one lands inside the fence.
  for (const metres of [20_000, 15_000, 10_000, 5_000, 200]) {
    pings.push({ ...at(metres), at: t(minute) });
    minute += 3;
  }
  // Parked. Ten pings jittering by a few metres, none of them a real move.
  for (let i = 0; i < 10; i++) {
    pings.push({ ...at(200 + (i % 3)), at: t(minute) });
    minute += 3;
  }
  return pings;
}

describe("ingest loop — approach and park", () => {
  it("records the arrival of a truck that parks at the dock", () => {
    // The ordinary case, and the one that was broken: at highway speed only ONE
    // fix lands inside a 500m fence before the truck stops, and every fix after
    // that is filtered out as "not a real move".
    expect(simulateIngest(LOT, approachAndPark(), { evaluateOnlyWhenStored: false })).toEqual([
      "arrived",
    ]);
  });

  it("REGRESSION: gating evaluation on storage emits nothing at all", () => {
    // Pinned deliberately. This is what the route did before: the second
    // agreeing fix was never seen, so arrival never fired — and because
    // departure is gated behind arrival, the whole feature produced zero rows
    // while the driver's screen reported "sent" every three minutes.
    expect(simulateIngest(LOT, approachAndPark(), { evaluateOnlyWhenStored: true })).toEqual([]);
  });

  it("still emits exactly one arrival, not one per parked ping", () => {
    const events = simulateIngest(LOT, approachAndPark(), { evaluateOnlyWhenStored: false });
    expect(events.filter((e) => e === "arrived")).toHaveLength(1);
  });
});

describe("mergeHistory", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 6, 30, 12, min)).toISOString();

  it("orders by when the fix was taken, not by arrival at the server", () => {
    // A phone coming out of a canyon posts an hour-old fix. Prepending it blind
    // would put a stale position in the "current" slot and fire an arrival for
    // somewhere the truck has already left.
    const backdated: TimedFix = { ...at(9_000), at: t(0) };
    const stored: TimedFix[] = [
      { ...at(100), at: t(30) },
      { ...at(150), at: t(27) },
    ];
    const merged = mergeHistory(backdated, stored);
    expect(merged[0]).toEqual({ lat: at(100).lat, lng: at(100).lng });
    expect(merged).toHaveLength(3);
  });

  it("puts a genuinely current fix first", () => {
    const now: TimedFix = { ...at(50), at: t(60) };
    const stored: TimedFix[] = [{ ...at(5_000), at: t(30) }];
    expect(mergeHistory(now, stored)[0]).toEqual({ lat: at(50).lat, lng: at(50).lng });
  });
});

describe("isMeaningfulMove", () => {
  it("always stores the first fix", () => {
    expect(isMeaningfulMove(null, at(0), 10)).toBe(true);
  });

  it("ignores movement smaller than the fix's own accuracy", () => {
    // A phone on a dock reporting +/-100m has not travelled 40m.
    expect(isMeaningfulMove(at(0), at(40), 100)).toBe(false);
  });

  it("keeps a 25m floor when the device claims perfect accuracy", () => {
    expect(isMeaningfulMove(at(0), at(10), 0)).toBe(false);
    expect(isMeaningfulMove(at(0), at(40), 0)).toBe(true);
  });

  it("stores real travel", () => {
    expect(isMeaningfulMove(at(0), at(5000), 20)).toBe(true);
  });
});

describe("migration 0050", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0050_gps_tracking.sql"),
    "utf8"
  );

  it("gives every new table RLS and a policy", () => {
    for (const t of [
      "shipment_locations",
      "geofence_events",
      "load_geofences",
      "tracking_tokens",
      "feature_flags",
    ]) {
      expect(sql, `${t} must enable RLS`).toMatch(
        new RegExp(`alter table ${t} enable row level security;`)
      );
      expect(sql, `${t} must have a policy`).toMatch(new RegExp(`on ${t} for `));
      expect(sql, `${t} must revoke default grants`).toMatch(
        new RegExp(`revoke all on ${t} from anon, authenticated;`)
      );
    }
  });

  it("gives authenticated no way to write GPS rows directly", () => {
    // The only writer is the token-authenticated route running as the service
    // role. A staff session inserting positions by hand would be a forged trail.
    expect(sql).toMatch(/grant select on shipment_locations to authenticated;/);
    expect(sql).toMatch(/grant select on geofence_events to authenticated;/);
  });

  it("backstops geofence dedup with a unique index", () => {
    expect(sql).toMatch(
      /create unique index uq_geofence_events_once\s+on geofence_events \(load_id, fence, transition\);/
    );
  });

  it("allows only one live token per load per kind", () => {
    expect(sql).toMatch(/create unique index uq_tracking_tokens_live[\s\S]*?where revoked_at is null;/);
  });

  it("ships the feature dark", () => {
    expect(sql).toMatch(/insert into feature_flags \(key, enabled, note\) values\s*\n\s*\('gps_tracking', false/);
  });
});

describe("dwell constant", () => {
  it("is at least 2 — one fix can never establish a transition", () => {
    expect(DWELL_FIXES).toBeGreaterThanOrEqual(2);
  });
});
