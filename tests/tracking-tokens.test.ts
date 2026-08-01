import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CUSTOMER_TOKEN_DEAD_STATUSES,
  DEFAULT_TOKEN_TTL_DAYS,
  DRIVER_TOKEN_DEAD_STATUSES,
  isTokenDeadForStatus,
  isTokenExpired,
} from "../src/lib/tracking/tokens";
import { EVENT_TYPES } from "../src/lib/events/types";
import type { LoadStatus } from "../src/types/database";

const routeSrc = readFileSync(
  join(process.cwd(), "src/app/api/track/[token]/route.ts"),
  "utf8"
);
const trackerSrc = readFileSync(
  join(process.cwd(), "src/app/t/[token]/driver-tracker.tsx"),
  "utf8"
);

// Every status the enum knows. Kept in the test rather than imported as a
// value so a NEW status added to the union fails here and forces a decision
// about both token kinds, instead of silently keeping links alive.
const ALL_STATUSES: LoadStatus[] = [
  "lead",
  "quote",
  "ready",
  "posted_cd",
  "posted_sd",
  "booked",
  "dispatched",
  "picked_up",
  "in_transit",
  "delivered",
  "hold",
  "archived",
  "lost",
  "invoiced",
  "paid",
  "cancelled",
];

describe("token lifecycle — driver", () => {
  it("dies the moment the load is delivered or otherwise finished", () => {
    for (const s of ["delivered", "invoiced", "paid", "archived", "lost", "cancelled"] as const) {
      expect(isTokenDeadForStatus("driver", s), s).toBe(true);
    }
  });

  it("stays alive through every working status", () => {
    const dead = new Set<LoadStatus>(DRIVER_TOKEN_DEAD_STATUSES);
    for (const s of ALL_STATUSES.filter((s) => !dead.has(s))) {
      expect(isTokenDeadForStatus("driver", s), s).toBe(false);
    }
    // The ones a truck is actually moving under must be in that set.
    for (const s of ["dispatched", "picked_up", "in_transit"] as const) {
      expect(isTokenDeadForStatus("driver", s), s).toBe(false);
    }
  });
});

describe("token lifecycle — customer", () => {
  it("outlives delivery on purpose — the shipper checks right after the car lands", () => {
    for (const s of ["delivered", "invoiced", "paid"] as const) {
      expect(isTokenDeadForStatus("customer", s), s).toBe(false);
    }
  });

  it("dies when the record is parked or the order never happened", () => {
    for (const s of ["archived", "lost", "cancelled"] as const) {
      expect(isTokenDeadForStatus("customer", s), s).toBe(true);
    }
  });

  it("everything that kills a customer link also kills a driver link", () => {
    for (const s of CUSTOMER_TOKEN_DEAD_STATUSES) {
      expect(DRIVER_TOKEN_DEAD_STATUSES, s).toContain(s);
    }
  });
});

describe("token TTL backstop", () => {
  it("is 45 days — generous because status, not the clock, is the real expiry", () => {
    expect(DEFAULT_TOKEN_TTL_DAYS).toBe(45);
    // A coast-to-coast car on a slow carrier is three weeks; a link that dies
    // mid-haul is a support call.
    expect(DEFAULT_TOKEN_TTL_DAYS).toBeGreaterThanOrEqual(21);
  });

  it("treats the exact expiry instant as expired", () => {
    const at = "2026-07-31T12:00:00.000Z";
    const ms = new Date(at).getTime();
    expect(isTokenExpired(at, ms)).toBe(true);
    expect(isTokenExpired(at, ms - 1)).toBe(false);
    expect(isTokenExpired(at, ms + 1)).toBe(true);
  });
});

describe("ingest route constants", () => {
  // Pinned as file text, the same style geofence.test.ts uses for migration
  // 0050: the numbers are a cross-file contract, and only one side of each
  // pair is importable in a unit test (the route pulls in the service client).
  it("rate-limits to one accepted ping per 25s — under the client's 3-minute cycle", () => {
    expect(routeSrc).toMatch(/const MIN_PING_INTERVAL_MS = 25_000;/);
    expect(trackerSrc).toMatch(/const PING_INTERVAL_MS = 3 \* 60_000;/);
  });

  it("accepts a backdated fix up to 24h old, and near-zero clock skew forward", () => {
    expect(routeSrc).toMatch(/const MAX_BACKDATE_MS = 24 \* 60 \* 60_000;/);
    expect(routeSrc).toMatch(/const MAX_FUTURE_MS = 2 \* 60_000;/);
  });
});

describe("offline queue in the driver page", () => {
  it("buffers failed posts instead of discarding them", () => {
    // The file's header once CLAIMED nothing was thrown away while the catch
    // block dropped the fix. Now the failed path writes the queue.
    expect(trackerSrc).toMatch(/writeQueue\(token, queue\)/);
    expect(trackerSrc).toMatch(/localStorage\.setItem\(queueKey\(token\)/);
  });

  it("caps the queue and refuses fixes the server would clamp to now", () => {
    expect(trackerSrc).toMatch(/const QUEUE_MAX = 50;/);
    // Must equal the route's MAX_BACKDATE_MS: anything older arrives clamped
    // to the current time, which paints a stale position as live.
    expect(trackerSrc).toMatch(/const QUEUE_MAX_AGE_MS = 24 \* 60 \* 60_000;/);
  });

  it("paces the drain slower than the server's rate limit", () => {
    // 30s between the fresh fix and a drained one, against a 25s server floor.
    expect(trackerSrc).toMatch(/const DRAIN_DELAY_MS = 30_000;/);
  });

  it("takes a screen wake lock, feature-detected, and re-acquires on visibility", () => {
    expect(trackerSrc).toMatch(/"wakeLock" in navigator/);
    expect(trackerSrc).toMatch(/navigator\.wakeLock\.request\("screen"\)/);
    expect(trackerSrc).toMatch(/addEventListener\("visibilitychange"/);
  });
});

describe("auto-revoke on delivery", () => {
  it("revokes the driver token when the truck departs the delivery fence", () => {
    expect(routeSrc).toMatch(/f\.kind === "delivery" && verdict\.transition === "departed"/);
    // Same revoke shape as the mint path: stamp revoked_at on the live row.
    const revoke = routeSrc.match(
      /from\("tracking_tokens"\)\s*\.update\(\{ revoked_at:[\s\S]*?\.is\("revoked_at", null\);/
    );
    expect(revoke, "route must stamp revoked_at on the live driver token").toBeTruthy();
    expect(revoke![0]).toMatch(/\.eq\("kind", "driver"\)/);
  });

  it("records the revocation on the timeline with a margin-free payload", () => {
    expect(EVENT_TYPES).toContain("tracking_link_revoked");
    const event = routeSrc.match(/type: "tracking_link_revoked",\s*payload: \{([^}]*)\}/);
    expect(event, "route must record a tracking_link_revoked event").toBeTruthy();
    // payload is readable by ALL staff (0049): kind and reason, nothing else.
    expect(event![1]).toMatch(/kind: "driver"/);
    expect(event![1]).not.toMatch(/pay|rate|cod|margin|carrier_id/i);
  });

  it("leaves the customer token alone — it is supposed to outlive delivery", () => {
    const revokeBlock = routeSrc.match(
      /from\("tracking_tokens"\)[\s\S]*?\.is\("revoked_at", null\);/
    );
    expect(revokeBlock![0]).not.toMatch(/"customer"/);
  });
});
