// Phase 6a — what we have historically quoted on a state lane.
//
// The number this produces is the median of our OWN past quotes, not a market
// rate and not a prediction. Every name in here says "quoted" for that reason:
// the moment it gets called a "predicted price" on screen, someone will trust
// it like one.
//
// Why state pairs and not cities: measured on the real book, 24,483 distinct
// city pairs produced 42 lanes with five or more samples. State pairs produced
// 553 with ten or more, covering 80.9% of history. City-level pricing is not a
// modelling choice here, it is an absent dataset.

/** Below this a lane is not published at all — see 0057's HAVING clause. */
export const MIN_SAMPLES = 10;

export type LaneStat = {
  origin_state: string;
  destination_state: string;
  vehicle_class: string;
  transport: string;
  n_quoted: number;
  p25: number;
  median: number;
  p75: number;
  n_won: number;
  n_lost: number;
};

export type LaneSuggestion = {
  median: number;
  low: number;
  high: number;
  samples: number;
  /** Null when too few outcomes are recorded to state one honestly. */
  winRate: number | null;
  /** True when the match fell back to a broader row than was asked for. */
  broadened: boolean;
  matchedOn: string;
};

const two = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().slice(0, 2);

/**
 * Pick the best row for a lane from a candidate set.
 *
 * Preference order is most-specific-first: exact vehicle class and transport,
 * then class with any transport, then transport with any class, then the bare
 * lane. A tie on specificity goes to the larger sample — between "SUV, 11
 * loads" and "any vehicle, 300 loads", the second is the better number even
 * though it is less specific, so specificity only decides among rows that
 * clear the floor.
 */
export function pickLane(
  rows: LaneStat[],
  want: { originState: string; destState: string; vehicleClass?: string; transport?: string }
): LaneStat | null {
  const o = two(want.originState);
  const d = two(want.destState);
  if (!o || !d) return null;

  const vc = (want.vehicleClass ?? "").trim().toLowerCase();
  const tr = (want.transport ?? "").trim().toLowerCase();

  const onLane = rows.filter(
    (r) => two(r.origin_state) === o && two(r.destination_state) === d && r.n_quoted >= MIN_SAMPLES
  );
  if (onLane.length === 0) return null;

  const tiers: ((r: LaneStat) => boolean)[] = [
    (r) => r.vehicle_class === vc && r.transport === tr,
    (r) => r.vehicle_class === vc && r.transport === "any",
    (r) => r.vehicle_class === "any" && r.transport === tr,
    (r) => r.vehicle_class === "any" && r.transport === "any",
  ];

  for (const tier of tiers) {
    const hit = onLane.filter(tier).sort((a, b) => b.n_quoted - a.n_quoted);
    if (hit.length) return hit[0];
  }
  // Nothing matched the requested shape — fall back to whatever this lane has
  // most evidence for rather than returning nothing.
  return onLane.slice().sort((a, b) => b.n_quoted - a.n_quoted)[0];
}

/**
 * Turn a row into what the screen shows.
 *
 * winRate stays null unless at least ten outcomes are recorded. This book has a
 * 10.7% observed win rate across 796 wins and 6,612 cancellations, which is one
 * or two wins on a typical lane — a "33% win rate" computed from three loads is
 * a number that will be repeated in a meeting, so it is better not to produce
 * it at all.
 */
export function toSuggestion(row: LaneStat | null, asked: { vehicleClass?: string; transport?: string }): LaneSuggestion | null {
  if (!row) return null;
  const decided = row.n_won + row.n_lost;
  const vc = (asked.vehicleClass ?? "").trim().toLowerCase();
  const tr = (asked.transport ?? "").trim().toLowerCase();

  return {
    median: Number(row.median),
    low: Number(row.p25),
    high: Number(row.p75),
    samples: row.n_quoted,
    winRate: decided >= MIN_SAMPLES ? row.n_won / decided : null,
    broadened:
      (vc !== "" && row.vehicle_class !== vc) || (tr !== "" && row.transport !== tr),
    matchedOn: `${row.origin_state}→${row.destination_state}, ${row.vehicle_class === "any" ? "all vehicles" : row.vehicle_class}, ${row.transport === "any" ? "all transport" : row.transport}`,
  };
}

/** How far off the middle a typed price is, as a fraction. Null if unknowable. */
export function deviationFromMedian(entered: number | null, median: number | null): number | null {
  if (entered == null || median == null || !Number.isFinite(entered) || !median) return null;
  return (entered - median) / median;
}

/**
 * Is a typed price far enough outside the band to be worth a second look?
 *
 * Outside p25–p75 is NOT the bar — half of all normal quotes fall outside a
 * middle-50% band by definition, and a warning that fires half the time is
 * furniture. This asks for 25% off the median.
 */
export function isOutlier(entered: number | null, s: LaneSuggestion | null): boolean {
  const dev = deviationFromMedian(entered, s?.median ?? null);
  return dev != null && Math.abs(dev) >= 0.25;
}
