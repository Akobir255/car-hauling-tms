import { describe, expect, it } from "vitest";
import {
  CONTRACT_LINK_EXPIRY_DAYS,
  TERMS_SECTIONS,
  isContractLinkExpired,
} from "@/lib/esign-terms";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("isContractLinkExpired", () => {
  it("treats a freshly sent link as live", () => {
    expect(isContractLinkExpired(daysAgo(0), null)).toBe(false);
    expect(isContractLinkExpired(daysAgo(CONTRACT_LINK_EXPIRY_DAYS - 1), null)).toBe(false);
  });

  it("expires a link past the window", () => {
    expect(isContractLinkExpired(daysAgo(CONTRACT_LINK_EXPIRY_DAYS + 1), null)).toBe(true);
    expect(isContractLinkExpired(daysAgo(365), null)).toBe(true);
  });

  it("never expires an already-signed contract — the record must stay viewable", () => {
    expect(isContractLinkExpired(daysAgo(365), daysAgo(300))).toBe(false);
  });

  it("reports not-expired when never sent (the unsent-token lock handles that case)", () => {
    expect(isContractLinkExpired(null, null)).toBe(false);
  });
});

describe("contract terms content", () => {
  it("carries both required sections", () => {
    expect(TERMS_SECTIONS.map((s) => s.heading)).toEqual([
      "Additional Information and Cancellation Fees",
      "Terms and Conditions",
    ]);
  });

  it("has the full A-L clause set and 21 numbered terms", () => {
    const [fees, terms] = TERMS_SECTIONS;
    expect(fees.clauses.map((c) => c.label)).toEqual(
      "ABCDEFGHIJKL".split("")
    );
    expect(terms.clauses).toHaveLength(21);
    expect(terms.clauses.map((c) => c.label)).toEqual(
      Array.from({ length: 21 }, (_, i) => String(i + 1))
    );
  });

  it("keeps the legally material specifics intact", () => {
    const all = TERMS_SECTIONS.flatMap((s) => s.clauses).map((c) => c.body).join(" ");
    expect(all).toContain("MC-206532"); // broker authority
    expect(all).toContain("State of Tennessee"); // governing law
    expect(all).toContain("$200"); // dry-run / cancellation fee
    expect(all).toContain("100 lbs"); // personal-items limit
    expect(all).toContain("$50,000"); // liability cap
  });

  it("flags clause F as important — it is the bill-of-lading warning", () => {
    const flagged = TERMS_SECTIONS.flatMap((s) => s.clauses).filter((c) => c.important);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].label).toBe("F");
    expect(flagged[0].body).toContain("bill of lading");
  });

  it("has no empty clause bodies", () => {
    for (const c of TERMS_SECTIONS.flatMap((s) => s.clauses)) {
      expect(c.body.trim().length).toBeGreaterThan(20);
    }
  });
});
