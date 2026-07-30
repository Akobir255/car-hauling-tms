import path from "node:path";
import type { NextConfig } from "next";

// Security headers. The Content-Security-Policy is NOT here — it needs a
// per-request nonce, so it is set in src/proxy.ts (middleware). Everything
// below is static and safe to send on every response.
const SECURITY_HEADERS = [
  // Belt-and-braces clickjacking protection alongside CSP frame-ancestors,
  // which older browsers ignore.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from MIME-sniffing a response into something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak internal paths (e.g. /sign/<token>) to third-party sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny the APIs this app has no use for. geolocation is the exception since
  // Phase 2: the driver page at /t/<token> IS a location tracker, and `()` is
  // an EMPTY allowlist that denies the feature to every origin INCLUDING self —
  // so navigator.geolocation would fail before the browser ever prompted, and
  // the driver would be told to "allow location in your browser settings" for a
  // denial that is a response header they cannot reach.
  //
  // (self) is the narrow form: our own origin may ASK, the user still has to
  // agree, and an embedded third party still gets nothing. Scoping it to /t
  // alone was the alternative, but two overlapping header entries for one key
  // is browser-dependent merging, and a silently re-broken driver page is worse
  // than one origin being allowed to prompt.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()",
  },
  // Two years, subdomains included — the app is HTTPS-only behind Vercel.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Silences a workspace-root warning caused by an unrelated package-lock.json
  // in the parent C:\Users\User directory.
  turbopack: {
    root: path.join(__dirname),
  },
  poweredByHeader: false, // don't advertise the framework/version
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
