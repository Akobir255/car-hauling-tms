// Content-Security-Policy. Built per request because script-src carries a
// one-time nonce: Next.js reads the nonce out of the CSP on the REQUEST and
// stamps it onto its own inline hydration scripts, which is what lets us drop
// 'unsafe-inline' for scripts entirely.
//
// Only two external origins are ever contacted by the BROWSER — everything
// else (OpenRouteService, RingCentral, Resend, geocoding) is server-side and
// therefore not covered by CSP at all:
//   • tile.openstreetmap.org  — Leaflet map tiles on the quote form (img)
//   • vpic.nhtsa.dot.gov      — make/model autocomplete (fetch, client-side)
// Plus Supabase, which the browser client talks to directly.

const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

// Supabase Realtime uses wss:// on the same host. Not used today, but allowing
// it costs nothing and avoids a mystery breakage the day someone adds it.
const SUPABASE_WS = SUPABASE_ORIGIN.replace(/^https:/, "wss:");

export function buildCsp(nonce: string, isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets nonce-trusted scripts load their own chunks, which
    // is how Next's runtime works. Dev additionally needs eval for HMR.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Tailwind and Leaflet inject inline styles at runtime; nonces don't reach
    // them, so this one has to stay permissive. Style injection is a far
    // smaller risk than script injection.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://tile.openstreetmap.org"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      SUPABASE_ORIGIN,
      SUPABASE_WS,
      "https://vpic.nhtsa.dot.gov",
      ...(isDev ? ["ws:", "http://localhost:*"] : []),
    ].filter(Boolean),
    // Sucuri asked for these three explicitly.
    "object-src": ["'none'"], // no Flash/applets, ever
    "base-uri": ["'self'"], // block <base> injection redirecting relative URLs
    "frame-src": ["'none'"], // this app embeds no iframes
    // Clickjacking: modern equivalent of X-Frame-Options: DENY.
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"], // a form can never post to another origin
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  const csp = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");

  // Force any stray http:// subresource to https in production.
  return isDev ? csp : `${csp}; upgrade-insecure-requests`;
}
