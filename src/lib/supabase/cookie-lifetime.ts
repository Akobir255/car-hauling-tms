// How long a signed-in session survives in the browser.
//
// @supabase/ssr's own default is 400 days (utils/constants.js), which is the
// longest life a browser will honour. A laptop handed back on a Friday would
// still be signed in the following spring.
//
// Passing `cookieOptions: { maxAge }` to createServerClient does NOT change it.
// The library spreads your options and then puts the default back on top:
//
//   const setCookieOptions = {
//     ...DEFAULT_COOKIE_OPTIONS,
//     ...cookieOptions,
//     maxAge: DEFAULT_COOKIE_OPTIONS.maxAge,   // <- last word
//   };
//
// So the only place left to set it is our own `setAll`, which receives the
// finished options and hands them to the cookie store. Both clients that write
// session cookies -- src/lib/supabase/server.ts and the middleware in
// src/lib/supabase/proxy.ts -- run every write through the clamp below.
//
// What this does and does not buy:
//   * the browser stops presenting the session after 8 hours, so a shared or
//     returned machine needs a fresh login the next day;
//   * it does NOT revoke anything server-side. A refresh token copied out of
//     the cookie jar still works until Supabase expires it. Deactivating the
//     profile is the control that kills a copied token instantly, because the
//     row policies check that flag inside Postgres. Offboarding = deactivate.

// One working day. Long enough that nobody is logged out mid-shift, short
// enough that a laptop left on Friday is dead by Monday.
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Cap a session cookie's lifetime at {@link SESSION_MAX_AGE_SECONDS}.
 *
 * Only ever lowers the number. Deletions arrive as `maxAge: 0` and must stay
 * 0 — raising one would resurrect the cookie being removed. Every other
 * attribute is passed straight through: dropping `path` or `sameSite` here
 * would break authentication outright.
 */
export function clampSessionCookie<T extends { maxAge?: number }>(options: T): T {
  const maxAge =
    typeof options?.maxAge === "number"
      ? Math.min(options.maxAge, SESSION_MAX_AGE_SECONDS)
      : SESSION_MAX_AGE_SECONDS;
  return { ...options, maxAge } as T;
}
