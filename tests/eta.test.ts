import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ETA_CACHE_SECONDS,
  buildDirectionsBody,
  fetchRoadSummary,
  formatBusinessDateTime,
  getRoadEta,
  parseDirectionsSummary,
  roadEtaFromSummary,
} from "../src/lib/tracking/eta";

// The pure parts of the road-ETA helper. The network is a stubbed global fetch
// throughout — ORS is never called from a test — and the unstable_cache wrapper
// is exercised only for its contract (any failure, including "no Next request
// scope", must come back as null rather than a thrown error).

const KNOXVILLE = { lat: 35.9606, lng: -83.9207 };
const CHICAGO = { lat: 41.8781, lng: -87.6298 };

// ICU renders "3:40 PM" with a narrow no-break space before the dayPeriod on
// modern Node; normalize so the assertion is about content, not whitespace.
const plain = (s: string) => s.replace(/[  ]/g, " ");

const orsResponse = (summary: unknown) => ({
  features: [
    {
      properties: { summary },
      // Geometry rides along in the real response; the parser must drop it.
      geometry: { coordinates: [[-83.9, 35.9], [-87.6, 41.8]] },
    },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buildDirectionsBody — fix + fence → request shape", () => {
  it("emits [lon, lat] pairs, fix first, delivery second", () => {
    const body = buildDirectionsBody(KNOXVILLE, CHICAGO);
    expect(body.coordinates).toEqual([
      [-83.9207, 35.9606],
      [-87.6298, 41.8781],
    ]);
  });

  it("keeps the snap-anywhere radiuses the quote route uses", () => {
    // -1 = no snapping cap. A truck on a rural highway is routinely further
    // from a routable node than the ORS default allows.
    expect(buildDirectionsBody(KNOXVILLE, CHICAGO).radiuses).toEqual([-1, -1]);
  });
});

describe("parseDirectionsSummary — response → the two numbers, or null", () => {
  it("pulls meters and seconds out of a well-formed geojson response", () => {
    expect(parseDirectionsSummary(orsResponse({ distance: 869_000, duration: 30_600 }))).toEqual({
      meters: 869_000,
      seconds: 30_600,
    });
  });

  it("returns null on every malformed shape rather than throwing", () => {
    expect(parseDirectionsSummary(null)).toBeNull();
    expect(parseDirectionsSummary({})).toBeNull();
    expect(parseDirectionsSummary({ features: [] })).toBeNull();
    expect(parseDirectionsSummary(orsResponse(undefined))).toBeNull();
    expect(parseDirectionsSummary(orsResponse({ distance: "869000", duration: 30_600 }))).toBeNull();
    expect(parseDirectionsSummary(orsResponse({ distance: 869_000 }))).toBeNull();
    expect(parseDirectionsSummary(orsResponse({ distance: NaN, duration: 30_600 }))).toBeNull();
  });

  it("rejects negative distances and durations — ORS does not drive backwards", () => {
    expect(parseDirectionsSummary(orsResponse({ distance: -1, duration: 30_600 }))).toBeNull();
    expect(parseDirectionsSummary(orsResponse({ distance: 869_000, duration: -1 }))).toBeNull();
  });
});

describe("roadEtaFromSummary — summary → { roadMiles, etaAt }", () => {
  it("converts meters to rounded miles with the same factor route.ts uses", () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    // 160,934.4 m is exactly 100 miles.
    expect(roadEtaFromSummary({ meters: 160_934.4, seconds: 3600 }, now).roadMiles).toBe(100);
    // 1,609 m is 0.9998 mi — rounds to 1, not truncates to 0.
    expect(roadEtaFromSummary({ meters: 1609, seconds: 60 }, now).roadMiles).toBe(1);
  });

  it("anchors the ETA at the given departure instant plus the ORS duration", () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const eta = roadEtaFromSummary({ meters: 869_000, seconds: 8.5 * 3600 }, now);
    expect(eta.etaAt).toBe(new Date(now + 8.5 * 3600 * 1000).toISOString());
  });
});

describe("fetchRoadSummary — the one network call", () => {
  it("POSTs the fix→fence body to the driving-car directions endpoint with the key as Bearer", async () => {
    vi.stubEnv("ORS_KEY", "test-key");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => orsResponse({ distance: 869_000, duration: 30_600 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRoadSummary(KNOXVILLE, CHICAGO)).resolves.toEqual({
      meters: 869_000,
      seconds: 30_600,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Same profile as src/app/api/geo/route/route.ts — the two ORS callers
    // must not drift apart on what "the route" means.
    expect(url).toBe("https://api.openrouteservice.org/v2/directions/driving-car/geojson");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string)).toEqual({
      coordinates: [
        [-83.9207, 35.9606],
        [-87.6298, 41.8781],
      ],
      radiuses: [-1, -1],
    });
  });

  it("throws on a non-2xx answer — so a failure is never cached as an ETA", async () => {
    vi.stubEnv("ORS_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    await expect(fetchRoadSummary(KNOXVILLE, CHICAGO)).rejects.toThrow(/429/);
  });

  it("throws on a 200 with no summary in it", async () => {
    vi.stubEnv("ORS_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })));
    await expect(fetchRoadSummary(KNOXVILLE, CHICAGO)).rejects.toThrow(/summary/);
  });

  it("refuses to call ORS at all without a key", async () => {
    vi.stubEnv("ORS_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRoadSummary(KNOXVILLE, CHICAGO)).rejects.toThrow(/ORS_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getRoadEta — strictly best-effort", () => {
  it("returns null without touching the network when the key, fix, or fence is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("ORS_KEY", "");
    expect(
      await getRoadEta({ loadId: "L1", fix: { id: "f1", ...KNOXVILLE }, delivery: CHICAGO })
    ).toBeNull();

    vi.stubEnv("ORS_KEY", "test-key");
    expect(await getRoadEta({ loadId: "L1", fix: null, delivery: CHICAGO })).toBeNull();
    expect(
      await getRoadEta({ loadId: "L1", fix: { id: "f1", ...KNOXVILLE }, delivery: null })
    ).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null, never throws, when the call cannot be made", async () => {
    // Outside a Next request scope unstable_cache itself throws; inside one, a
    // network failure would. Both are the same contract: the page renders
    // without an ETA.
    vi.stubEnv("ORS_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      })
    );
    await expect(
      getRoadEta({ loadId: "L1", fix: { id: "f1", ...KNOXVILLE }, delivery: CHICAGO })
    ).resolves.toBeNull();
  });
});

describe("cache policy", () => {
  it("caches for ~30 minutes", () => {
    expect(ETA_CACHE_SECONDS).toBe(30 * 60);
  });
});

describe("formatBusinessDateTime — the customer-facing instant", () => {
  it("renders in the business timezone with the zone named", () => {
    // 19:40Z on a July day is 3:40 PM Eastern DAYLIGHT time.
    expect(plain(formatBusinessDateTime("2026-07-31T19:40:00.000Z", "America/New_York"))).toBe(
      "Jul 31, 3:40 PM EDT"
    );
    // 20:00Z in January is 3:00 PM Eastern STANDARD time — DST is handled.
    expect(plain(formatBusinessDateTime("2026-01-15T20:00:00.000Z", "America/New_York"))).toBe(
      "Jan 15, 3:00 PM EST"
    );
  });

  it("shows the app's em-dash placeholder for garbage input", () => {
    expect(formatBusinessDateTime("not-a-date", "America/New_York")).toBe("—");
  });
});

describe("no side effects from the read path", () => {
  // The brief is explicit: no eta_updated events written while rendering. If
  // ETAs ever belong on the spine, the ingest route records them — pinned as
  // file text the same way tracking-tokens.test.ts pins the route constants.
  it("neither the lib nor the pages that render an ETA touch recordEvent", () => {
    for (const rel of [
      "src/lib/tracking/eta.ts",
      "src/app/track/[token]/page.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src, rel).not.toMatch(/recordEvent/);
    }
  });

  it("only the summary survives parsing — route geometry never leaves the lib", () => {
    // The WORD appears in comments (and the endpoint is /geojson) — that is
    // fine. What must never appear is code READING it: a property access on
    // `geometry` (dot, optional-chain, or bracket) is the only way the route
    // line could travel from the ORS response to a caller, so that is what
    // gets pinned — in the lib and on the public page that renders its output.
    for (const rel of [
      "src/lib/tracking/eta.ts",
      "src/app/track/[token]/page.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src, rel).not.toMatch(/[.[]\s*["']?geometry/);
    }
    // And the parser reads the summary, nothing else, off the first feature.
    const lib = readFileSync(join(process.cwd(), "src/lib/tracking/eta.ts"), "utf8");
    expect(lib).toMatch(/properties\?\.summary/);
  });
});
