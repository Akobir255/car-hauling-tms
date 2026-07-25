import { describe, expect, it } from "vitest";
import { calculateQuote } from "@/lib/pricing";

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
