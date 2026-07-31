import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_SAMPLES,
  deviationFromMedian,
  isOutlier,
  pickLane,
  toSuggestion,
  type LaneStat,
} from "../src/lib/pricing/lanes";

const lane = (over: Partial<LaneStat> = {}): LaneStat => ({
  origin_state: "CA",
  destination_state: "TX",
  vehicle_class: "sedan",
  transport: "open",
  n_quoted: 298,
  p25: 650,
  median: 750,
  p75: 850,
  n_won: 3,
  n_lost: 74,
  ...over,
});

describe("pickLane", () => {
  const rows = [
    lane(),
    lane({ vehicle_class: "suv", n_quoted: 120, median: 900 }),
    lane({ vehicle_class: "any", transport: "any", n_quoted: 480, median: 800 }),
    lane({ origin_state: "NY", destination_state: "FL", n_quoted: 197, median: 630 }),
  ];

  it("prefers the exact vehicle and transport match", () => {
    const hit = pickLane(rows, { originState: "CA", destState: "TX", vehicleClass: "suv", transport: "open" });
    expect(hit?.vehicle_class).toBe("suv");
    expect(Number(hit?.median)).toBe(900);
  });

  it("falls back to the broader lane when the exact shape has no history", () => {
    const hit = pickLane(rows, { originState: "CA", destState: "TX", vehicleClass: "motorcycle", transport: "open" });
    expect(hit?.vehicle_class).toBe("any");
  });

  it("is case- and whitespace-insensitive about state codes", () => {
    expect(pickLane(rows, { originState: " ca ", destState: "tx" })).not.toBeNull();
  });

  it("returns null for a lane with no history at all", () => {
    expect(pickLane(rows, { originState: "MT", destState: "ME" })).toBeNull();
  });

  it("never returns a lane under the sample floor", () => {
    // The floor is enforced in SQL too (0057's HAVING). Belt and braces: this
    // is the last thing between a thin aggregate and a dispatcher's screen.
    const thin = [lane({ n_quoted: MIN_SAMPLES - 1 })];
    expect(pickLane(thin, { originState: "CA", destState: "TX" })).toBeNull();
  });

  it("ignores the other direction — a lane is not symmetric", () => {
    // CA->TX and TX->CA price differently; the real book has $800 against $600.
    expect(pickLane(rows, { originState: "TX", destState: "CA" })).toBeNull();
  });
});

describe("toSuggestion", () => {
  it("reports the band and the sample size", () => {
    const s = toSuggestion(lane(), { vehicleClass: "sedan", transport: "open" });
    expect(s).toMatchObject({ median: 750, low: 650, high: 850, samples: 298 });
  });

  it("withholds a win rate when too few quotes were ever decided", () => {
    // 3 won + 74 lost clears the floor; 3 + 2 does not. A "60% win rate" from
    // five loads is a number that gets repeated in a meeting.
    expect(toSuggestion(lane({ n_won: 3, n_lost: 2 }), {})?.winRate).toBeNull();
    expect(toSuggestion(lane(), {})?.winRate).toBeCloseTo(3 / 77, 5);
  });

  it("flags when it answered with a broader lane than was asked for", () => {
    const s = toSuggestion(lane({ vehicle_class: "any" }), { vehicleClass: "suv", transport: "open" });
    expect(s?.broadened).toBe(true);
  });

  it("does not claim to be broadened when nothing specific was asked", () => {
    expect(toSuggestion(lane({ vehicle_class: "any", transport: "any" }), {})?.broadened).toBe(false);
  });

  it("returns null for no row rather than a zero-priced suggestion", () => {
    expect(toSuggestion(null, {})).toBeNull();
  });
});

describe("isOutlier", () => {
  const s = toSuggestion(lane(), {})!; // median 750, band 650-850

  it("does not fire merely for sitting outside the middle band", () => {
    // Half of all normal quotes fall outside p25-p75 by definition. A warning
    // that fires half the time is furniture.
    expect(isOutlier(900, s)).toBe(false);
    expect(isOutlier(600, s)).toBe(false);
  });

  it("fires at 25% off the median, either way", () => {
    expect(isOutlier(940, s)).toBe(true);
    expect(isOutlier(560, s)).toBe(true);
  });

  it("stays quiet with nothing typed and with no suggestion", () => {
    expect(isOutlier(null, s)).toBe(false);
    expect(isOutlier(750, null)).toBe(false);
  });

  it("survives a median of zero without dividing by it", () => {
    expect(deviationFromMedian(500, 0)).toBeNull();
    expect(isOutlier(500, { ...s, median: 0 })).toBe(false);
  });
});

describe("migration 0057/0058", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0057_lane_pricing.sql"), "utf8");
  const fix = readFileSync(join(process.cwd(), "supabase/migrations/0058_lane_refresh_safeupdate.sql"), "utf8");

  it("gives all three tables brokerage_id and an RLS policy", () => {
    for (const t of ["lane_price_stats", "quote_outcomes", "price_overrides"]) {
      expect(sql).toMatch(new RegExp(`create table ${t}[\\s\\S]*?brokerage_id`));
      expect(sql).toMatch(new RegExp(`alter table ${t} enable row level security;`));
      expect(sql).toMatch(new RegExp(`on ${t} for select`));
      expect(sql).toMatch(new RegExp(`revoke all on ${t} from anon, authenticated;`));
    }
  });

  it("keeps quote_outcomes append-only — it is the pricing asset", () => {
    expect(sql).toMatch(/grant select, insert on quote_outcomes to authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*update[^;]*on quote_outcomes/i);
    expect(sql).not.toMatch(/on quote_outcomes for (update|delete|all)/i);
  });

  it("enforces the ten-load floor in SQL, not just in the client", () => {
    // This is the privacy guard as much as the statistical one: the stats are
    // computed over the 25,867 HIDDEN loads, and a published row must never be
    // reducible to one customer's price.
    expect(sql).toMatch(/having count\(\*\) >= 10;/);
    expect(fix).toMatch(/having count\(\*\) >= 10;/);
  });

  it("does not let authenticated run the refresh", () => {
    expect(sql).toMatch(/revoke all on function public\.refresh_lane_price_stats\(\) from public, anon, authenticated;/);
    expect(fix).toMatch(/revoke all on function public\.refresh_lane_price_stats\(\) from public, anon, authenticated;/);
  });

  it("qualifies the delete, because pg_safeupdate rejects a bare one", () => {
    // The 0057 body failed at runtime with "DELETE requires a WHERE clause".
    expect(fix).toMatch(/delete from lane_price_stats where true;/);
  });

  it("ships the phase dark", () => {
    expect(sql).toMatch(/\('lane_pricing', false/);
  });

  it("counts a won lane by status, and treats cancelled and lost as lost", () => {
    expect(fix).toMatch(/filter \(where l\.status in \('cancelled','lost'\)\)/);
    expect(fix).toMatch(/'booked','dispatched','picked_up'/);
  });
});
