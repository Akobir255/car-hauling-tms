// Suggested-quote pricing, ported from the marketing site's calculateQuote.
// Mileage-tier base rate + adjustments for vehicle type / condition / transport.
// This is only a SUGGESTION shown to the agent — never auto-filled into the rate.

export type QuoteInput = {
  miles: number;
  vehicleType: string; // TMS enum: sedan | suv | pickup | van | motorcycle | other
  condition: string; // running | non_running
  transport: string; // open | enclosed | driveaway
};

export function calculateQuote({ miles, vehicleType, condition, transport }: QuoteInput): number {
  let rate: number;
  if (miles <= 300) rate = 1.3;
  else if (miles <= 700) rate = 1.1;
  else if (miles <= 1200) rate = 0.85;
  else if (miles <= 2400) rate = 0.7;
  else rate = 0.6;

  let price = miles * rate;
  if (price < 200) price = 200;

  const type = vehicleType.toLowerCase();
  if (type === "suv") price += 100;
  else if (type === "pickup") price += 150;
  else if (type === "van") price += 100;

  if (condition === "non_running") price += 100;
  if (transport === "enclosed") price *= 1.3;

  return Math.round(price);
}

// The house broker fee, as a share of what the customer pays.
//
// Loads are negotiated one at a time, so this is a starting point a rep types
// over — not a rule. What it must never be is ZERO BY OMISSION: carrier_pay is
// derived as customer_rate − deposit_amount, so a blank reservation fee records
// a load the brokerage earned nothing on. Measured 2026-07-29 on the live
// database: the ~2,500 loads created in May–July had a median recorded fee of
// exactly 0.0%, for precisely that reason.
export const BROKER_FEE_RATE = 0.2;

/** House reservation fee for a customer total, to the cent. */
export function defaultReservationFee(customerRate: number): number {
  return Math.round(customerRate * BROKER_FEE_RATE * 100) / 100;
}

/**
 * What the carrier is OFFERED — the customer's total less the fee we keep.
 * This is the figure posted to Central Dispatch and Super Dispatch, not a
 * settlement, which is why a load carrying exactly this number is treated as
 * unconfirmed (migration 0038). Defined once because three places have to
 * agree on it: creation, the edit form, and the backfill.
 */
export function offeredCarrierPay(customerRate: number, reservationFee: number | null): number {
  return Math.max(0, Math.round((customerRate - (reservationFee ?? 0)) * 100) / 100);
}

/**
 * Is a submitted carrier-pay figure a SETTLEMENT, or still the offer?
 *
 * `carrier_pay_confirmed` (0038) is the column every margin report has to filter
 * on, and it was being written by two places that disagreed. The edit form got
 * it right — a number equal to the offer arithmetic is still the offer. The
 * dispatch sheet wrote `true` unconditionally, and since that form PREFILLS the
 * field with the load's current carrier_pay, opening it to set a driver's phone
 * and pressing Save promoted an untouched estimate into a settlement. When 0038
 * landed only 195 of 25,848 priced loads were confirmed; that path would have
 * confirmed essentially every dispatched load, silently, and there is no way to
 * tell afterwards which figures a human actually typed.
 *
 * So the rule lives here, next to the arithmetic it depends on, and both writers
 * call it. Confirmed means: a number was submitted, and either the human said
 * outright that it is the settled figure, or it is NOT the number we would have
 * derived ourselves.
 *
 * The declared flag exists because equality is the arithmetic's only evidence:
 * a carrier who settles at exactly the posted offer — the ordinary happy case —
 * could otherwise never be recorded as confirmed at all.
 */
export function isConfirmedCarrierPay(args: {
  submitted: number | null | undefined;
  customerRate: number | null | undefined;
  reservationFee: number | null | undefined;
  /** The human ticked "this is the settled figure" — confirms even a figure
   *  equal to the derived offer, which the comparison below cannot. */
  declaredSettled?: boolean;
  /** A settlement, once recorded, stays one — never demoted, even when a later
   *  rate change makes the settled figure equal today's derived offer. */
  storedConfirmed?: boolean;
}): boolean {
  if (args.storedConfirmed) return true;
  if (args.submitted == null) return false;
  if (args.declaredSettled) return true;
  if (args.customerRate == null) return true;
  const offer = offeredCarrierPay(args.customerRate, args.reservationFee ?? null);
  return Math.abs(args.submitted - offer) > 0.005;
}
