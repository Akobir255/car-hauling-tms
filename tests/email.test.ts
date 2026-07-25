import { describe, expect, it } from "vitest";
import { isEmailConfigured, isPlausibleEmail } from "@/lib/messaging/email";

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const e of [
      "leo@usstrucking.org",
      "first.last+tag@sub.domain.co",
      "a@b.io",
      "  spaced@example.com  ", // trimmed before checking
    ]) {
      expect(isPlausibleEmail(e), e).toBe(true);
    }
  });

  it("rejects malformed addresses so a blast can't burn quota on them", () => {
    for (const e of [
      "",
      null,
      undefined,
      "no-at-sign",
      "@nolocal.com",
      "trailing@",
      "two@@at.com",
      "spaces in@example.com",
      "no@tld",
      `${"a".repeat(250)}@example.com`, // over the 254-char limit
    ]) {
      expect(isPlausibleEmail(e as string | null | undefined), String(e)).toBe(false);
    }
  });
});

describe("isEmailConfigured", () => {
  it("is false without RESEND_API_KEY/EMAIL_FROM, so blasts stay queued not lost", () => {
    // The test env has no email credentials; this asserts the graceful-
    // degradation contract the compose UI relies on.
    expect(isEmailConfigured()).toBe(false);
  });
});
