import { describe, expect, it } from "vitest";
import { extractionToNormalizedLead } from "@/lib/leads/from-extraction";
import type { IntakeExtraction } from "@/lib/ai/intake-schema";

// Build an extraction the way the model returns it: every field wrapped as
// { value, confidence }. Only value matters to the mapper.
const f = <T>(value: T | null) => ({ value, confidence: value === null ? 0 : 0.9 });

function extraction(over: Partial<Record<string, unknown>> = {}): IntakeExtraction {
  const base = {
    contact: { name: f("Maria Delgado"), company: f(null), phone: f("(865) 555-0118"), email: f("Maria@Example.com") },
    origin: { city: f("Indianapolis"), state: f("Indiana"), zip: f("46202"), address: f(null) },
    destination: { city: f("Hampton"), state: f("GA"), zip: f("30228-1234"), address: f(null) },
    vehicles: [
      { vin: f(null), year: f(2021), make: f("Toyota"), model: f("Camry"), condition: f("operable") },
    ],
    requested_pickup_date: f("8/7/26"),
    requested_delivery_date: f(null),
    quoted_price: f(null),
    transport_type: f("open"),
    notes: f("Customer prefers morning pickup."),
    ...over,
  };
  return base as unknown as IntakeExtraction;
}

describe("extractionToNormalizedLead", () => {
  it("maps a full extraction and cleans each field like the JSON path", () => {
    const lead = extractionToNormalizedLead(extraction());
    expect(lead).toMatchObject({
      contactName: "Maria Delgado",
      phone: "8655550118",
      email: "maria@example.com",
      originState: "IN",
      originZip: "46202",
      destState: "GA",
      destZip: "30228",
      vehicleYear: 2021,
      vehicleMake: "Toyota",
      operable: true,
      transportType: "open",
      readyDate: "2026-08-07",
      sourceRef: null,
    });
  });

  it("treats an inoperable vehicle as not operable", () => {
    const lead = extractionToNormalizedLead(
      extraction({
        vehicles: [{ vin: f(null), year: f(2019), make: f("Honda"), model: f("CR-V"), condition: f("inoperable") }],
      })
    );
    expect(lead.operable).toBe(false);
  });

  it("defaults transport to open when the model left it null", () => {
    const lead = extractionToNormalizedLead(extraction({ transport_type: f(null) }));
    expect(lead.transportType).toBe("open");
  });

  it("survives a missing vehicle array", () => {
    const lead = extractionToNormalizedLead(extraction({ vehicles: [] }));
    expect(lead.vehicleMake).toBeNull();
    expect(lead.vehicleYear).toBeNull();
    expect(lead.operable).toBe(true); // nothing said inoperable
  });

  it("rejects a junk state and a city-in-zip the same way the JSON path does", () => {
    const lead = extractionToNormalizedLead(
      extraction({
        origin: { city: f("Somewhere"), state: f("Nowhere"), zip: f("not-a-zip"), address: f(null) },
      })
    );
    expect(lead.originState).toBeNull();
    expect(lead.originZip).toBeNull();
    expect(lead.originCity).toBe("Somewhere");
  });
});
