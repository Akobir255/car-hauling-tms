import { describe, expect, it } from "vitest";
import { normalizeVehicleImageParams, wikiTitleCandidates } from "@/lib/vehicles/image";

describe("normalizeVehicleImageParams", () => {
  it("keeps real-world make/model punctuation", () => {
    expect(normalizeVehicleImageParams("Ford", "F-150")).toEqual({ make: "Ford", model: "F-150" });
    expect(normalizeVehicleImageParams("Mercedes-Benz", "C 300")).toEqual({
      make: "Mercedes-Benz",
      model: "C 300",
    });
  });

  it("strips characters that don't belong in a title query", () => {
    expect(normalizeVehicleImageParams("Toyota<script>", "RAV4?&piprop=x")).toEqual({
      make: "Toyotascript",
      model: "RAV4&pipropx",
    });
  });

  it("collapses whitespace and caps length", () => {
    const long = "A".repeat(60);
    const r = normalizeVehicleImageParams("  Toyota   ", long);
    expect(r?.make).toBe("Toyota");
    expect(r?.model).toHaveLength(40);
  });

  it("rejects missing or fully-stripped values", () => {
    expect(normalizeVehicleImageParams("", "Camry")).toBeNull();
    expect(normalizeVehicleImageParams("Toyota", null)).toBeNull();
    expect(normalizeVehicleImageParams("###", "$$$")).toBeNull();
  });
});

describe("wikiTitleCandidates", () => {
  it("title-cases the make and tries the automobile-disambiguated page too", () => {
    expect(wikiTitleCandidates({ make: "toyota", model: "RAV4" })).toEqual([
      "Toyota RAV4",
      "Toyota RAV4 (automobile)",
    ]);
  });

  it("adds an all-caps candidate for initialism models like NV and BRZ", () => {
    expect(wikiTitleCandidates({ make: "nissan", model: "Nv" })).toEqual([
      "Nissan Nv",
      "Nissan NV",
      "Nissan Nv (automobile)",
    ]);
  });
});
