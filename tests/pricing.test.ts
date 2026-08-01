import { describe, expect, it } from "vitest";
import { calculateQuote, isConfirmedCarrierPay, offeredCarrierPay } from "@/lib/pricing";

// The suggested-price engine. These lock in the mileage tiers and surcharges
// so a future edit can't silently change what agents get quoted.
describe("calculateQuote", () => {
  const base = { vehicleType: "sedan", condition: "running", transport: "open" };

  it("applies the short-haul tier ($1.30/mi)", () => {
    expect(calculateQuote({ ...base, miles: 300 })).toBe(390);
  });

  it("applies each mileage tier at its boundary", () => {
    expect(calculateQuote({ ...base, miles: 700 })).toBe(770); // 1.10
    expect(calculateQuote({ ...base, miles: 1200 })).toBe(1020); // 0.85
    expect(calculateQuote({ ...base, miles: 2400 })).toBe(1680); // 0.70
    expect(calculateQuote({ ...base, miles: 3000 })).toBe(1800); // 0.60
  });

  it("never quotes below the $200 floor", () => {
    expect(calculateQuote({ ...base, miles: 1 })).toBe(200);
    expect(calculateQuote({ ...base, miles: 0 })).toBe(200);
  });

  it("adds the vehicle-type surcharges", () => {
    const miles = 500; // 550 base
    expect(calculateQuote({ ...base, miles })).toBe(550);
    expect(calculateQuote({ ...base, miles, vehicleType: "suv" })).toBe(650);
    expect(calculateQuote({ ...base, miles, vehicleType: "pickup" })).toBe(700);
    expect(calculateQuote({ ...base, miles, vehicleType: "van" })).toBe(650);
    // Types without a surcharge must not add one.
    expect(calculateQuote({ ...base, miles, vehicleType: "motorcycle" })).toBe(550);
  });

  it("adds $100 for a non-running vehicle", () => {
    expect(calculateQuote({ ...base, miles: 500, condition: "non_running" })).toBe(650);
  });

  it("multiplies enclosed transport by 1.3, applied after surcharges", () => {
    expect(calculateQuote({ ...base, miles: 500, transport: "enclosed" })).toBe(715);
    // (550 + 100 SUV) * 1.3 = 845 — surcharge is inside the multiplier.
    expect(
      calculateQuote({ ...base, miles: 500, vehicleType: "suv", transport: "enclosed" })
    ).toBe(845);
  });

  it("is case-insensitive on vehicle type", () => {
    expect(calculateQuote({ ...base, miles: 500, vehicleType: "SUV" })).toBe(650);
  });

  it("ignores unknown type/condition/transport instead of throwing", () => {
    expect(
      calculateQuote({ miles: 500, vehicleType: "spaceship", condition: "??", transport: "??" })
    ).toBe(550);
  });

  it("always returns a whole dollar amount", () => {
    for (const miles of [37, 199, 451, 999, 1731, 2899]) {
      const price = calculateQuote({ ...base, miles, transport: "enclosed" });
      expect(Number.isInteger(price)).toBe(true);
    }
  });
});

// The offer-vs-settlement rule. carrier_pay_confirmed (0038) is the column
// every margin report has to filter on, and it was being written by two server
// actions that disagreed: the edit form compared against the derived offer, the
// dispatch sheet wrote `true` unconditionally. Because that sheet PREFILLS the
// field, opening it to type a driver's phone and pressing Save promoted an
// untouched estimate into a settlement. Both now call this, so they cannot
// drift apart again.
describe("isConfirmedCarrierPay", () => {
  const rate = 1000;
  const deposit = 200;
  const offer = offeredCarrierPay(rate, deposit); // 800

  it("does NOT confirm a figure that is exactly the derived offer", () => {
    // The prefilled dispatch sheet, saved untouched. This is the whole bug.
    expect(
      isConfirmedCarrierPay({ submitted: offer, customerRate: rate, reservationFee: deposit })
    ).toBe(false);
  });

  it("confirms a figure a human actually moved", () => {
    expect(
      isConfirmedCarrierPay({ submitted: 750, customerRate: rate, reservationFee: deposit })
    ).toBe(true);
    expect(
      isConfirmedCarrierPay({ submitted: 825, customerRate: rate, reservationFee: deposit })
    ).toBe(true);
  });

  it("treats a sub-cent difference as the offer, not a settlement", () => {
    expect(
      isConfirmedCarrierPay({
        submitted: offer + 0.004,
        customerRate: rate,
        reservationFee: deposit,
      })
    ).toBe(false);
  });

  it("keeps the stored verdict when nothing was submitted — never demotes silently", () => {
    expect(
      isConfirmedCarrierPay({
        submitted: null,
        customerRate: rate,
        reservationFee: deposit,
        storedConfirmed: true,
      })
    ).toBe(true);
    expect(
      isConfirmedCarrierPay({ submitted: undefined, customerRate: rate, reservationFee: deposit })
    ).toBe(false);
  });

  it("confirms anything typed on an unpriced load — there is no offer to compare to", () => {
    expect(
      isConfirmedCarrierPay({ submitted: 700, customerRate: null, reservationFee: null })
    ).toBe(true);
  });

  it("handles a missing reservation fee the same way offeredCarrierPay does", () => {
    expect(
      isConfirmedCarrierPay({ submitted: rate, customerRate: rate, reservationFee: null })
    ).toBe(false);
  });

  it("confirms a figure EQUAL to the offer when the human declares it settled", () => {
    // The dispatch sheet's checkbox. A carrier settling at exactly the posted
    // offer is the ordinary happy case, and equality is the only evidence the
    // arithmetic has — so without the declaration it could never be recorded.
    expect(
      isConfirmedCarrierPay({
        submitted: offer,
        customerRate: rate,
        reservationFee: deposit,
        declaredSettled: true,
      })
    ).toBe(true);
  });

  it("a declared settlement with no figure submitted confirms nothing", () => {
    expect(
      isConfirmedCarrierPay({
        submitted: null,
        customerRate: rate,
        reservationFee: deposit,
        declaredSettled: true,
      })
    ).toBe(false);
  });

  it("an unticked checkbox changes nothing — the arithmetic rule still applies", () => {
    expect(
      isConfirmedCarrierPay({
        submitted: offer,
        customerRate: rate,
        reservationFee: deposit,
        declaredSettled: false,
      })
    ).toBe(false);
    expect(
      isConfirmedCarrierPay({
        submitted: 750,
        customerRate: rate,
        reservationFee: deposit,
        declaredSettled: false,
      })
    ).toBe(true);
  });

  it("never demotes a stored settlement, even when it equals today's offer", () => {
    // Rates can drift until a settled figure coincides with the derived offer;
    // re-saving the prefilled sheet must not flip a settlement back into an
    // estimate.
    expect(
      isConfirmedCarrierPay({
        submitted: offer,
        customerRate: rate,
        reservationFee: deposit,
        storedConfirmed: true,
      })
    ).toBe(true);
  });
});
