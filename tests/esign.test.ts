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

  it("keeps a freshly signed contract viewable, and runs the window from the signature", () => {
    // Sent 20 days ago, signed yesterday: still inside the window because
    // signing is the later event.
    expect(isContractLinkExpired(daysAgo(20), daysAgo(1))).toBe(false);
  });

  it("expires a signed contract once its window closes", () => {
    // The old rule returned false here forever, leaving the shipper's name,
    // phone, both addresses and the price on a no-login page indefinitely.
    expect(isContractLinkExpired(daysAgo(365), daysAgo(300))).toBe(true);
  });

  it("treats a never-sent contract as dead, not eternal", () => {
    // voidSignature clears contract_sent_at and mints a new token, so the old
    // `!sentAt -> not expired` rule made revoking a signature produce a link
    // that never expired.
    expect(isContractLinkExpired(null, null)).toBe(true);
    expect(isContractLinkExpired(null, daysAgo(1))).toBe(false);
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
