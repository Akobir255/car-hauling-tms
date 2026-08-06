import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWatermarkLabel, clientIpFromHeader, shortSessionId } from "../src/lib/watermark";
import { businessDay } from "../src/lib/dates";

describe("clientIpFromHeader", () => {
  it("takes the FIRST hop — the client, not our proxies", () => {
    // Vercel appends its own address, and Cloudflare sits in front of that.
    // Reading the last entry (or the whole header) attributes every screenshot
    // in the company to one datacentre IP, which is silently useless.
    expect(clientIpFromHeader("203.0.113.7, 198.51.100.4, 172.16.0.9")).toBe("203.0.113.7");
  });

  it("tolerates the spacing browsers and proxies actually send", () => {
    expect(clientIpFromHeader("  203.0.113.7  ")).toBe("203.0.113.7");
    expect(clientIpFromHeader("203.0.113.7,198.51.100.4")).toBe("203.0.113.7");
  });

  it("returns null when there is no header at all", () => {
    // Local dev has no proxy in front of it. Null, not "", so the label
    // builder is the only place that decides what an absent IP reads as.
    expect(clientIpFromHeader(null)).toBeNull();
    expect(clientIpFromHeader(undefined)).toBeNull();
    expect(clientIpFromHeader("")).toBeNull();
    expect(clientIpFromHeader("   ")).toBeNull();
  });
});

describe("shortSessionId", () => {
  const SESSION = "9f3c2a1b-4d5e-4f60-8a71-2b3c4d5e6f70";

  it("is a prefix, never the whole id", () => {
    expect(shortSessionId(SESSION)).toBe("9f3c2a1b");
  });

  it("never leaks more than eight characters, whatever it is given", () => {
    // The id is printed in a font a camera can read. It is a session
    // IDENTIFIER rather than the access token, so it is not a credential —
    // but there is no reason to publish all of it either.
    expect(shortSessionId(SESSION)!.length).toBe(8);
    expect(shortSessionId("a".repeat(200))!.length).toBe(8);
    expect(SESSION.startsWith(shortSessionId(SESSION)!)).toBe(true);
  });

  it("returns null rather than an empty string when there is no session", () => {
    expect(shortSessionId(null)).toBeNull();
    expect(shortSessionId("")).toBeNull();
  });
});

describe("buildWatermarkLabel", () => {
  const base = {
    name: "Leo Toshev",
    email: "leo@usstrucking.org",
    sessionId: "9f3c2a1b-4d5e-4f60-8a71-2b3c4d5e6f70",
    day: "2026-08-06",
    ip: "203.0.113.7",
  };

  it("carries all five facts the overlay exists to record", () => {
    const label = buildWatermarkLabel(base);
    expect(label).toBe(
      "Leo Toshev · leo@usstrucking.org · 2026-08-06 · IP 203.0.113.7 · SID 9f3c2a1b"
    );
  });

  it("leads with the name — it is what a person recognises in a photo", () => {
    expect(buildWatermarkLabel(base).startsWith("Leo Toshev")).toBe(true);
  });

  it("falls back to the email when the profile has no full_name", () => {
    // profiles.full_name is nullable, and the app already renders
    // `full_name || email` in the top bar. A blank lead-in would make the
    // busiest watermark field the emptiest.
    const label = buildWatermarkLabel({ ...base, name: null });
    expect(label.startsWith("leo@usstrucking.org · 2026-08-06")).toBe(true);
  });

  it("does not print the same value twice when the name IS the email", () => {
    const label = buildWatermarkLabel({ ...base, name: "leo@usstrucking.org" });
    expect(label.match(/leo@usstrucking\.org/g)).toHaveLength(1);
  });

  it("says 'unknown' instead of dropping a missing IP or session", () => {
    // A dropped segment reads as "nobody bothered", which quietly undermines
    // the fields that ARE there. An explicit "unknown" is a finding.
    const label = buildWatermarkLabel({ ...base, ip: null, sessionId: null });
    expect(label).toContain("IP unknown");
    expect(label).toContain("SID unknown");
  });

  it("still identifies the day when a profile is empty end to end", () => {
    const label = buildWatermarkLabel({ name: null, email: null, sessionId: null, day: "2026-08-06", ip: null });
    expect(label).toBe("unknown user · 2026-08-06 · IP unknown · SID unknown");
  });
});

describe("businessDay", () => {
  it("is the business timezone's calendar day, not the server's", () => {
    // Vercel runs UTC. 2026-08-07T02:30Z is still the 6th in New York, and a
    // watermark that disagrees with the Follow-up Today queue about what day
    // it is makes every screenshot argue with the screen it came from.
    expect(businessDay(new Date("2026-08-07T02:30:00Z"))).toBe("2026-08-06");
  });

  it("produces the sortable YYYY-MM-DD shape the label assumes", () => {
    expect(businessDay(new Date("2026-08-06T16:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// The overlay's guarantees are CSS and JSX, not functions, so they are pinned
// as text the way headers.test.ts pins the CSP and next.config.ts. Each of
// these is a one-word edit away from being lost with nothing else complaining.
describe("the overlay itself", () => {
  const component = readFileSync(
    join(process.cwd(), "src/components/session-watermark.tsx"),
    "utf8"
  );
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const shell = readFileSync(join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");
  const dispatchSheet = readFileSync(
    join(process.cwd(), "src/app/(app)/loads/[id]/dispatch/print/page.tsx"),
    "utf8"
  );

  it("never swallows a click and never reaches a screen reader", () => {
    expect(component).toContain("pointer-events-none");
    expect(component).toContain('aria-hidden="true"');
  });

  it("stays out of the layout — fixed, and clipping its own overspill", () => {
    // position: fixed is also what repeats it on every printed page.
    expect(component).toContain("fixed inset-0");
    expect(component).toContain("overflow-hidden");
  });

  // The rotated layer has to be big enough to still contain the viewport once
  // it is turned, and how big depends on the ASPECT RATIO. The first version
  // used a flat inset-[-25%] (150% of each side) and was measurably short on
  // every landscape screen — 1440x900 left the top-left corner 75px clear of
  // the nearest line, which is a crop that carries no attribution at all. So
  // the sizing is read back out of the component and checked as geometry.
  describe("covers the viewport it is rotated over", () => {
    const angle = Number(component.match(/rotate-\[(-?[\d.]+)deg\]/)![1]);
    const w = component.match(/w-\[calc\((\d+)vw_\+_(\d+)vh\)\]/)!;
    const h = component.match(/h-\[calc\((\d+)vw_\+_(\d+)vh\)\]/)!;
    const layer = (vw: number, vh: number) => ({
      width: (Number(w[1]) / 100) * vw + (Number(w[2]) / 100) * vh,
      height: (Number(h[1]) / 100) * vw + (Number(h[2]) / 100) * vh,
    });
    const needed = (vw: number, vh: number) => {
      const c = Math.abs(Math.cos((angle * Math.PI) / 180));
      const s = Math.abs(Math.sin((angle * Math.PI) / 180));
      return { width: vw * c + vh * s, height: vw * s + vh * c };
    };

    // A laptop, the two common desktops, an ultrawide, a 4K panel, a phone and
    // a tablet — portrait as well as landscape, because the flat-percentage
    // version happened to pass in portrait and that is why it looked fine.
    const screens: [number, number][] = [
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
      [3440, 1440],
      [3840, 2160],
      [375, 812],
      [768, 1024],
    ];

    it.each(screens)("%ix%i", (vw, vh) => {
      const have = layer(vw, vh);
      const want = needed(vw, vh);
      expect(have.width).toBeGreaterThanOrEqual(want.width);
      expect(have.height).toBeGreaterThanOrEqual(want.height);
    });

    it("repeats the SHORTEST possible label far enough to span the widest", () => {
      // Measured in a browser at 12px Lato with tracking-wide, against the real
      // compiled stylesheet: ~432px per copy for a typical line, ~363px for a
      // real short one ("Ann Lee · ann@usst.com · …"), ~310px for the floor
      // below. The floor is what the count has to be sized against, because the
      // copy count is global and the label is PER USER: sized on a typical name
      // instead, the emptiest profiles get bare ends on every row — the same
      // uncovered-corner bug as the flat inset-[-25%], just at the far end of
      // the line rather than the top of it. At the original 12 copies the floor
      // fell 724px short at 3840x2160 and a real short label 88px short.
      const FLOOR_COPY_PX = 310;
      const floorLabel = buildWatermarkLabel({
        name: null,
        email: null,
        sessionId: null,
        day: "2026-08-06",
        ip: null,
      });
      // If the builder's floor ever changes shape, the width above is stale and
      // the arithmetic below is measuring a string that no longer exists.
      expect(floorLabel).toHaveLength(52);

      const repeats = Number(component.match(/REPEATS_PER_ROW = (\d+)/)![1]);
      const widest = Math.max(...screens.map(([vw, vh]) => layer(vw, vh).width));
      expect(repeats * FLOOR_COPY_PX).toBeGreaterThanOrEqual(widest);
    });
  });

  it("takes its ink from a token, so dark theme is not a separate colour", () => {
    expect(css).toMatch(/^\s*--watermark-ink:/m);
    // [^}] rather than [\s\S]: the greedy version is satisfied by the
    // `color: var(--watermark-ink)` rule further down the file, so it would
    // still pass with the dark override deleted — which is the one thing this
    // assertion exists to catch.
    expect(css).toMatch(/\.dark\s*\{[^}]*--watermark-ink:/);
    expect(css).toMatch(/\[data-session-watermark\]\s*\{\s*color:\s*var\(--watermark-ink\)/);
  });

  it("keeps the two themes at the SAME alpha, so neither is a ghost", () => {
    // Measured: 14% lands on #e0e0e0 over the light page (which is --border,
    // the "as present as a hairline rule" calibration) and 1.32:1, against
    // 1.40:1 for the same alpha in dark. Tuning one theme and forgetting the
    // other is the failure this catches — the app is unusable to nobody if
    // the watermark is invisible, so nothing else would ever complain.
    const alphas = [...css.matchAll(/--watermark-ink:\s*rgb\([^)]*\/\s*([\d.]+)\)/g)].map((m) =>
      Number(m[1])
    );
    expect(alphas).toHaveLength(2);
    expect(alphas[0]).toBe(alphas[1]);
  });

  it("keeps the @media print rule that makes it survive Ctrl+P", () => {
    const printBlock = css.match(/@media print \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(printBlock).toContain("[data-session-watermark]");
    expect(printBlock).toContain("var(--watermark-ink-paper)");
    expect(printBlock).toContain("print-color-adjust: exact");
  });

  it("is mounted in the app shell, which is what puts it on every screen", () => {
    expect(shell).toContain("<SessionWatermark");
    expect(shell).toContain("x-forwarded-for");
  });

  it("keeps the dispatch sheet's paper marker and the rule that reads it", () => {
    // The sheet renders INSIDE (app)/layout.tsx, so it needs no watermark of
    // its own — only this marker, or a dark-theme session prints and
    // screenshots that sheet with light ink on white.
    expect(dispatchSheet).toContain("data-paper-sheet");
    expect(css).toContain("body:has([data-paper-sheet]) [data-session-watermark]");
  });
});
