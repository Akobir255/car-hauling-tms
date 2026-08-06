import { describe, expect, it } from "vitest";
import {
  SESSION_MAX_AGE_SECONDS,
  clampSessionCookie,
} from "@/lib/supabase/cookie-lifetime";

// The library's own default, which is what we are clamping. If @supabase/ssr
// ever lowers it below ours this test still passes -- it only asserts that
// whatever arrives is capped, never raised.
const SSR_DEFAULT_MAX_AGE = 400 * 24 * 60 * 60;

describe("clampSessionCookie", () => {
  it("caps the library's 400-day default at one working day", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(28_800);
    expect(clampSessionCookie({ maxAge: SSR_DEFAULT_MAX_AGE }).maxAge).toBe(
      SESSION_MAX_AGE_SECONDS
    );
  });

  it("leaves a shorter life alone — it only ever lowers", () => {
    expect(clampSessionCookie({ maxAge: 600 }).maxAge).toBe(600);
  });

  it("keeps a deletion a deletion", () => {
    // Sign-out and cookie rotation come through as maxAge 0. Raising that to
    // eight hours would resurrect the cookie being removed.
    expect(clampSessionCookie({ maxAge: 0 }).maxAge).toBe(0);
  });

  it("preserves every other cookie attribute", () => {
    const out = clampSessionCookie({
      maxAge: SSR_DEFAULT_MAX_AGE,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: true,
    });
    // Dropping path or sameSite here would break auth outright, which is the
    // failure mode this test exists to catch.
    expect(out).toMatchObject({
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: true,
    });
  });

  it("supplies a life when the caller gave none", () => {
    const withoutMaxAge: { maxAge?: number; path: string; sameSite: string } = {
      path: "/",
      sameSite: "lax",
    };
    expect(clampSessionCookie(withoutMaxAge)).toMatchObject({
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
  });
});
