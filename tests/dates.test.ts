import { describe, expect, it } from "vitest";
import { endOfBusinessDay } from "@/lib/dates";

// This function decides what "due today" means for the Follow-up Today queue
// AND the dashboard card. A regression here silently hides reps' follow-ups,
// which is exactly the bug it was written to fix (it used to be UTC-based).
describe("endOfBusinessDay", () => {
  it("returns the end of the business day, not the server's day", () => {
    // 2026-07-24 03:00 UTC = 2026-07-23 23:00 America/New_York, so the
    // business day that is 'ending' is the 23rd, not the 24th.
    const end = endOfBusinessDay(new Date("2026-07-24T03:00:00Z"));
    const inNy = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(end);
    expect(inNy).toBe("2026-07-23");
  });

  it("lands on 23:59:59.999 local time", () => {
    const end = endOfBusinessDay(new Date("2026-07-24T15:00:00Z"));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(end);
    expect(parts).toBe("23:59:59");
    expect(end.getMilliseconds()).toBe(999);
  });

  it("is always in the future relative to a mid-day 'now'", () => {
    const now = new Date("2026-07-24T15:00:00Z"); // 11:00 ET
    expect(endOfBusinessDay(now).getTime()).toBeGreaterThan(now.getTime());
  });

  it("includes an evening follow-up that UTC end-of-day would have dropped", () => {
    // A follow-up set for 8pm ET on the 24th is 2026-07-25T00:00Z — past UTC
    // midnight. It must still count as due on the 24th.
    const now = new Date("2026-07-24T18:00:00Z"); // 2pm ET on the 24th
    const followUp = new Date("2026-07-25T00:00:00Z"); // 8pm ET on the 24th
    expect(followUp.getTime()).toBeLessThanOrEqual(endOfBusinessDay(now).getTime());
  });

  it("handles both sides of a DST transition", () => {
    // US DST ends 2026-11-01. Check the day before and after resolve cleanly.
    for (const iso of ["2026-10-31T18:00:00Z", "2026-11-02T18:00:00Z"]) {
      const end = endOfBusinessDay(new Date(iso));
      const hhmmss = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(end);
      expect(hhmmss).toBe("23:59:59");
    }
  });
});
