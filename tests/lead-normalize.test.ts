import { describe, expect, it } from "vitest";
import {
  flattenPayload,
  hasContact,
  normalizeDate,
  normalizeLead,
  normalizeOperable,
  normalizePhone,
  normalizeState,
  normalizeYear,
  normalizeZip,
} from "@/lib/leads/normalize";

describe("field normalizers", () => {
  it("reduces a phone to 10 digits and drops a US country code", () => {
    expect(normalizePhone("+1 (865) 555-0118")).toBe("8655550118");
    expect(normalizePhone("865.555.0118")).toBe("8655550118");
    expect(normalizePhone("18655550118")).toBe("8655550118");
    expect(normalizePhone("555-0118")).toBeNull(); // too short
    expect(normalizePhone("")).toBeNull();
  });

  it("maps a state name or code to two letters, and rejects junk", () => {
    expect(normalizeState("Indiana")).toBe("IN");
    expect(normalizeState("in")).toBe("IN");
    expect(normalizeState("GA")).toBe("GA");
    expect(normalizeState("New York")).toBe("NY");
    expect(normalizeState("Nowhere")).toBeNull();
    expect(normalizeState("XY")).toBeNull();
  });

  it("keeps 5 digits of a ZIP and ignores a city in the ZIP field", () => {
    expect(normalizeZip("46202")).toBe("46202");
    expect(normalizeZip("30228-1234")).toBe("30228");
    expect(normalizeZip("Atlanta")).toBeNull();
  });

  it("accepts only a plausible vehicle year", () => {
    expect(normalizeYear("2021")).toBe(2021);
    expect(normalizeYear("2021 Toyota")).toBe(2021);
    expect(normalizeYear("1899")).toBeNull();
    expect(normalizeYear("99")).toBeNull();
  });

  it("defaults to operable but honors any sign of inop", () => {
    expect(normalizeOperable(undefined)).toBe(true);
    expect(normalizeOperable("runs")).toBe(true);
    expect(normalizeOperable("yes")).toBe(true);
    expect(normalizeOperable("inop")).toBe(false);
    expect(normalizeOperable("does not run")).toBe(false);
    expect(normalizeOperable("non-running")).toBe(false);
  });

  it("parses ISO and US dates, and refuses free text", () => {
    expect(normalizeDate("2026-08-07")).toBe("2026-08-07");
    expect(normalizeDate("8/7/26")).toBe("2026-08-07");
    expect(normalizeDate("08/07/2026")).toBe("2026-08-07");
    expect(normalizeDate("ASAP")).toBeNull();
    expect(normalizeDate("next week")).toBeNull();
  });
});

describe("flattenPayload", () => {
  it("lifts one level of the usual wrappers", () => {
    const flat = flattenPayload({ lead: { phone: "8655550118" }, email: "a@b.com" });
    expect(flat.phone).toBe("8655550118");
    expect(flat.email).toBe("a@b.com");
  });

  it("lets an outer key win over a nested one", () => {
    const flat = flattenPayload({ phone: "1111111111", customer: { phone: "2222222222" } });
    expect(flat.phone).toBe("1111111111");
  });

  it("is safe on non-objects", () => {
    expect(flattenPayload(null)).toEqual({});
    expect(flattenPayload("nope")).toEqual({});
    expect(flattenPayload([1, 2])).toEqual({});
  });
});

describe("normalizeLead across provider dialects", () => {
  it("reads a flat snake_case provider", () => {
    const lead = normalizeLead({
      first_name: "Maria",
      last_name: "Delgado",
      phone_number: "(865) 555-0118",
      email_address: "M.Delgado@Example.com",
      origin_city: "Indianapolis",
      origin_state: "Indiana",
      origin_zip: "46202",
      destination_city: "Hampton",
      destination_state: "GA",
      destination_zip: "30228",
      vehicle_year: "2021",
      vehicle_make: "Toyota",
      vehicle_model: "Camry",
      running: "yes",
      ship_date: "8/7/26",
      lead_id: "ABC-123",
    });
    expect(lead).toMatchObject({
      contactName: "Maria Delgado",
      phone: "8655550118",
      email: "m.delgado@example.com",
      originState: "IN",
      originZip: "46202",
      destState: "GA",
      vehicleYear: 2021,
      vehicleMake: "Toyota",
      operable: true,
      transportType: "open",
      readyDate: "2026-08-07",
      sourceRef: "ABC-123",
    });
  });

  it("reads a nested camelCase provider that spells things differently", () => {
    const lead = normalizeLead({
      quote: {
        customer: { fullName: "John Buyer", telephone: "1-702-555-0146" },
        pickup: {},
      },
      // the handler flattens `customer` and `quote`; these live under them
      customer: { fullName: "John Buyer", telephone: "1-702-555-0146" },
      trailer_type: "Enclosed",
      inoperable: true,
      to_state: "texas",
      external_id: "Z-9",
    });
    expect(lead.contactName).toBe("John Buyer");
    expect(lead.phone).toBe("7025550146");
    expect(lead.transportType).toBe("enclosed");
    expect(lead.operable).toBe(false); // inoperable: true
    expect(lead.destState).toBe("TX");
    expect(lead.sourceRef).toBe("Z-9");
  });

  it("keeps a partial lead as long as it can be contacted", () => {
    const lead = normalizeLead({ email: "someone@example.com" });
    expect(hasContact(lead)).toBe(true);
    expect(lead.phone).toBeNull();
    expect(lead.contactName).toBeNull();
  });

  it("flags a lead with no way to reach anyone", () => {
    expect(hasContact(normalizeLead({ make: "Ford", model: "F-150" }))).toBe(false);
    expect(hasContact(normalizeLead({}))).toBe(false);
  });
});
