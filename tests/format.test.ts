import { describe, expect, it } from "vitest";
import { formatPhone, formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { toE164 } from "@/lib/messaging/ringcentral";
import { optKeyword } from "@/lib/messaging/opt-keywords";

describe("formatPhone", () => {
  it("formats 10- and 11-digit US numbers", () => {
    expect(formatPhone("8657227114")).toBe("(865) 722-7114");
    expect(formatPhone("18657227114")).toBe("(865) 722-7114");
    expect(formatPhone("+1 865-722-7114")).toBe("(865) 722-7114");
    expect(formatPhone("(865) 722.7114")).toBe("(865) 722-7114");
  });

  it("returns an em dash for empty input", () => {
    expect(formatPhone("")).toBe("—");
    expect(formatPhone(null)).toBe("—");
    expect(formatPhone(undefined)).toBe("—");
  });

  it("passes through anything that isn't a US number rather than mangling it", () => {
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("12345")).toBe("12345");
  });
});

describe("toE164", () => {
  it("normalizes valid US numbers", () => {
    expect(toE164("8657227114")).toBe("+18657227114");
    expect(toE164("(865) 722-7114")).toBe("+18657227114");
    expect(toE164("1-865-722-7114")).toBe("+18657227114");
  });

  it("rejects anything that isn't 10 significant digits", () => {
    expect(toE164("865722711")).toBeNull(); // 9
    expect(toE164("28657227114")).toBeNull(); // 11 not starting with 1
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe("optKeyword — CTIA keywords are legally binding", () => {
  it("detects every opt-out keyword regardless of case or trailing punctuation", () => {
    for (const word of [
      "STOP",
      "stop",
      "Stop.",
      "STOP!",
      "  stop  ",
      "stopall",
      "unsubscribe",
      "cancel",
      "end",
      "quit",
      "revoke",
      "optout",
    ]) {
      expect(optKeyword(word), word).toBe("stop");
    }
  });

  it("detects opt-in keywords", () => {
    for (const word of ["START", "start", "unstop", "yes", "continue", "Yes!"]) {
      expect(optKeyword(word), word).toBe("start");
    }
  });

  it("does NOT trigger on keywords inside a sentence", () => {
    expect(optKeyword("please stop by the shop")).toBeNull();
    expect(optKeyword("yes I want to book")).toBeNull();
    expect(optKeyword("can you cancel my order")).toBeNull();
    expect(optKeyword("")).toBeNull();
    expect(optKeyword("   ")).toBeNull();
  });
});

describe("formatCurrency / formatDate", () => {
  it("formats money and treats null as an em dash", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
  });

  it("formats dates and rejects junk without throwing", () => {
    expect(formatDate("2026-07-24T12:00:00Z")).toMatch(/Jul 24, 2026/);
    expect(formatDate("not a date")).toBe("—");
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatDateTime("2026-07-24T12:00:00Z")).toMatch(/Jul 24, 2026/);
  });
});
