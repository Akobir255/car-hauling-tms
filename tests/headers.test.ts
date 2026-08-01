import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Both files are pinned as TEXT, the way geofence.test.ts pins migration SQL:
// what production serves is the literal string in the source, and importing
// next.config.ts would execute it rather than read it.

describe("Permissions-Policy (next.config.ts)", () => {
  const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
  const header =
    config.match(/key: "Permissions-Policy",\s*\n\s*value: "([^"]*)"/)?.[1] ?? "";

  it("still sets the header at all", () => {
    expect(header).not.toBe("");
  });

  it("keeps geolocation=(self) — the GPS driver page depends on it", () => {
    // `()` is an EMPTY allowlist: it denies geolocation to every origin
    // including our own, so navigator.geolocation on /t/<token> fails before
    // the browser ever prompts, and nothing in the app logs why. Reverting
    // this "tighter" value is exactly the well-meaning cleanup STATUS.md
    // warns about, hence a test that names the victim.
    expect(header).toContain("geolocation=(self)");
  });
});

describe("CSP allowlist (src/lib/security-headers.ts)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/security-headers.ts"), "utf8");

  it("keeps tile.openstreetmap.org in img-src — Leaflet tiles come from there", () => {
    // Without this origin every map renders as a grey grid of blocked tiles,
    // and only the browser console says why.
    expect(src).toMatch(/"img-src":\s*\[[^\]]*"https:\/\/tile\.openstreetmap\.org"/);
  });
});
