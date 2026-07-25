import { describe, expect, it } from "vitest";
import {
  EMAIL_BATCH_MAX,
  isEmailConfigured,
  isPlausibleEmail,
  sendEmailBatch,
} from "@/lib/messaging/email";

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

describe("sendEmailBatch", () => {
  it("reports unconfigured rather than throwing, so a blast degrades to queued", async () => {
    const r = await sendEmailBatch([{ to: "a@b.io", subject: "s", text: "t" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not configured/i);
  });

  it("treats an empty batch as a no-op success", async () => {
    const r = await sendEmailBatch([]);
    expect(r).toEqual({ ok: true, ids: [] });
  });

  it("refuses to exceed the provider's batch cap", async () => {
    const tooMany = Array.from({ length: EMAIL_BATCH_MAX + 1 }, (_, i) => ({
      to: `u${i}@example.com`,
      subject: "s",
      text: "t",
    }));
    const r = await sendEmailBatch(tooMany);
    expect(r.ok).toBe(false);
    // Must be the cap error, not a network attempt.
    if (!r.ok) expect(r.error).toMatch(/capped/i);
  });

  it("caps at 100, matching the compose screen's recipient limit", () => {
    expect(EMAIL_BATCH_MAX).toBe(100);
  });
});
