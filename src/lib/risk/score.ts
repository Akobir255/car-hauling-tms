// Phase 7a — which active orders are in trouble, from what we already know.
//
// Pure functions over a load-shaped object. No database, no clock of its own —
// `now` is always passed in, because a scorer that reads the wall clock cannot
// be tested against "the day before the pickup date" and every interesting case
// here is a date boundary.
//
// The brief's version of this compares live GPS against a routing ETA. That
// needs Phase 2 switched on and a routing key, so what is scored here is the
// paperwork-and-promises half: dates that have passed, an order with nobody
// hauling it, an agreement nobody signed. In this book those are the failures
// that actually happen, and none of them need a satellite.

/** Statuses where an order is committed but not yet delivered. */
export const ACTIVE_STATUSES = [
  "ready",
  "posted_cd",
  "posted_sd",
  "booked",
  "dispatched",
  "picked_up",
  "in_transit",
] as const;

/** Committed, but nothing has physically moved yet. */
const NOT_YET_MOVING = ["ready", "posted_cd", "posted_sd", "booked"];
/** On a truck. */
const MOVING = ["dispatched", "picked_up", "in_transit"];

export type RiskInput = {
  id: string;
  load_number: string | null;
  status: string;
  carrier_id: string | null;
  pickup_ready_date: string | null;
  delivery_eta: string | null;
  date_signed: string | null;
  contract_sent_at: string | null;
  contract_sent: boolean | null;
  follow_up_at: string | null;
  updated_at: string | null;
};

export type RiskFactor = {
  key: string;
  weight: number;
  /** Written to be read aloud in a stand-up, not parsed. */
  detail: string;
};

export type RiskAssessment = {
  id: string;
  loadNumber: string | null;
  score: number;
  band: "low" | "watch" | "high";
  factors: RiskFactor[];
};

const DAY = 86_400_000;

/**
 * Whole days from now to `iso`; negative means the date has passed.
 *
 * A DATE column and a timestamp are compared differently and must be, or the
 * answer is wrong by a day for most of the working day. `pickup_ready_date` and
 * `delivery_eta` are DATEs: "due today" has to read as 0 whether it is looked at
 * at 9am or 5pm, so both sides are anchored to noon and the difference is a
 * whole number by construction. Anchoring only the date — the obvious version —
 * makes today read as -1 from lunchtime onward, which would have put every
 * active order in the queue as overdue.
 *
 * A real timestamp (updated_at) keeps instant-to-instant arithmetic, where
 * flooring is right: 9.5 days untouched is 9 days untouched, not 10.
 */
export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const dateOnly = iso.length <= 10;
  const t = Date.parse(dateOnly ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(t)) return null;
  if (!dateOnly) return Math.floor((t - now.getTime()) / DAY);
  const base = Date.parse(`${now.toISOString().slice(0, 10)}T12:00:00Z`);
  return Math.round((t - base) / DAY);
}

/**
 * Score one active order.
 *
 * Weights are ordered by what costs the most when it goes wrong, not by how
 * often it fires. A truck that never arrived outranks an unsigned contract even
 * though the second is far more common.
 */
export function assess(load: RiskInput, now: Date, acknowledged: Set<string> = new Set()): RiskAssessment {
  const f: RiskFactor[] = [];
  const add = (key: string, weight: number, detail: string) => {
    if (!acknowledged.has(key)) f.push({ key, weight, detail });
  };

  const toPickup = daysUntil(load.pickup_ready_date, now);
  const toDelivery = daysUntil(load.delivery_eta, now);
  const moving = MOVING.includes(load.status);
  const waiting = NOT_YET_MOVING.includes(load.status);

  // Promised a delivery date that has gone by. The customer knows before we do.
  if (toDelivery != null && toDelivery < 0 && load.status !== "delivered") {
    add("delivery_overdue", Math.min(50, 25 + Math.abs(toDelivery) * 5),
      `Delivery was due ${Math.abs(toDelivery)} day${Math.abs(toDelivery) === 1 ? "" : "s"} ago`);
  }

  // Past its pickup date and still sitting.
  if (toPickup != null && toPickup < 0 && waiting) {
    add("pickup_overdue", Math.min(40, 20 + Math.abs(toPickup) * 5),
      `Pickup was ready ${Math.abs(toPickup)} day${Math.abs(toPickup) === 1 ? "" : "s"} ago and it has not moved`);
  }

  // Committed to a customer with nobody booked to haul it.
  if (waiting && !load.carrier_id) {
    const soon = toPickup != null && toPickup <= 2;
    add("no_carrier", soon ? 35 : 15,
      soon
        ? `No carrier assigned and pickup is ${toPickup! < 0 ? "already past" : `in ${toPickup} day${toPickup === 1 ? "" : "s"}`}`
        : "No carrier assigned yet");
  }

  // On a truck, and nobody ever signed.
  if ((moving || waiting) && !load.date_signed) {
    const sent = Boolean(load.contract_sent_at || load.contract_sent);
    add("unsigned", moving ? 20 : 10,
      sent
        ? "Agreement went out but has not been signed"
        : "No signed agreement, and none has been sent");
  }

  // A follow-up somebody set and then did not do.
  const toFollowUp = daysUntil(load.follow_up_at, now);
  if (toFollowUp != null && toFollowUp < 0) {
    add("followup_overdue", Math.min(15, 5 + Math.abs(toFollowUp) * 2),
      `Follow-up was due ${Math.abs(toFollowUp)} day${Math.abs(toFollowUp) === 1 ? "" : "s"} ago`);
  }

  // Moving, but nothing has been recorded against it for a week.
  const sinceTouch = load.updated_at ? -1 * (daysUntil(load.updated_at, now) ?? 0) : null;
  if (moving && sinceTouch != null && sinceTouch >= 7) {
    add("stale", 12, `Nothing recorded on this order for ${sinceTouch} days`);
  }

  const score = Math.min(100, f.reduce((a, x) => a + x.weight, 0));
  const worst = f.reduce((m, x) => Math.max(m, x.weight), 0);

  return {
    id: load.id,
    loadNumber: load.load_number,
    score,
    // Two ways to be urgent, because a pure sum gets this wrong. On the real
    // sample set a delivery two days late scored 42 and landed in "watch",
    // while an order with three moderate problems scored 77 and shouted — but
    // the late delivery is the one where a customer is standing in a driveway.
    // So: several moderate things (sum >= 45) OR one serious thing (>= 30).
    //
    // 'watch' rather than 'medium': the middle band is a list somebody skims,
    // not a severity. Naming it after the action keeps it honest.
    band: score >= 45 || worst >= 30 ? "high" : score >= 20 ? "watch" : "low",
    factors: f.sort((a, b) => b.weight - a.weight),
  };
}

/** Everything worth showing, worst first. Orders with no factors drop out. */
export function atRiskQueue(
  loads: RiskInput[],
  now: Date,
  acknowledged: Map<string, Set<string>> = new Map()
): RiskAssessment[] {
  return loads
    .filter((l) => (ACTIVE_STATUSES as readonly string[]).includes(l.status))
    .map((l) => assess(l, now, acknowledged.get(l.id) ?? new Set()))
    .filter((a) => a.factors.length > 0)
    .sort((a, b) => b.score - a.score);
}
