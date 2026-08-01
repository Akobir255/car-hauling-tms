import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOW_CONFIDENCE } from "../src/lib/ai/intake-schema";
import {
  CONFIDENTLY_WRONG_THRESHOLD,
  clip,
  collapseFieldPath,
  confidentlyWrong,
  dailyCounts,
  estimatedSpendUsd,
  failureGroups,
  fieldCorrectionStats,
  isFailure,
  percentile,
  tokenTotals,
  versionRollup,
  type CorrectionRow,
  type ExtractionRow,
} from "../src/app/(app)/admin/ai/metrics";

const ext = (over: Partial<ExtractionRow> = {}): ExtractionRow => ({
  id: "e1",
  created_at: "2026-08-01T05:00:00Z",
  kind: "text",
  input_filename: null,
  input_sha256: null,
  model: "claude-opus-5",
  prompt_version: "intake-v1",
  error: null,
  stop_reason: null,
  input_tokens: 1000,
  output_tokens: 200,
  latency_ms: 1500,
  load_id: null,
  ...over,
});

const corr = (over: Partial<CorrectionRow> = {}): CorrectionRow => ({
  extraction_id: "e1",
  field_path: "contact.phone",
  model_value: "865",
  human_value: "(865) 328-7418",
  model_confidence: 0.9,
  created_at: "2026-08-01T05:10:00Z",
  prompt_version: "intake-v1",
  ...over,
});

describe("isFailure", () => {
  it("is exactly `error` set — the insert writes output XOR error", () => {
    expect(isFailure(ext())).toBe(false);
    expect(isFailure(ext({ error: "The model declined to read this document." }))).toBe(true);
  });
});

describe("percentile", () => {
  it("returns null on nothing — a dashboard with no calls has no p95", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("is nearest-rank on a known set", () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(values, 0.5)).toBe(500);
    expect(percentile(values, 0.95)).toBe(1000);
  });

  it("does not mutate its input and handles a single sample", () => {
    const values = [300, 100, 200];
    expect(percentile(values, 0.5)).toBe(200);
    expect(values).toEqual([300, 100, 200]);
    expect(percentile([42], 0.95)).toBe(42);
  });
});

describe("collapseFieldPath", () => {
  it("folds array indices so the per-field table ranks fields, not positions", () => {
    // "vehicles.0.vin" and "vehicles.3.vin" are the same lesson about the
    // same field.
    expect(collapseFieldPath("vehicles.0.vin")).toBe("vehicles.*.vin");
    expect(collapseFieldPath("vehicles.3.vin")).toBe("vehicles.*.vin");
    expect(collapseFieldPath("a.1.b.2.c")).toBe("a.*.b.*.c");
  });

  it("leaves index-free paths alone", () => {
    expect(collapseFieldPath("contact.phone")).toBe("contact.phone");
    expect(collapseFieldPath("quoted_price")).toBe("quoted_price");
  });
});

describe("dailyCounts", () => {
  const now = new Date("2026-08-01T12:00:00Z");

  it("zero-fills the whole window, split parsed/failed", () => {
    const out = dailyCounts(
      [
        ext({ created_at: "2026-08-01T05:00:00Z" }),
        ext({ created_at: "2026-07-31T23:00:00Z", error: "timed out" }),
      ],
      3,
      now
    );
    expect(out).toEqual([
      { date: "2026-07-30", ok: 0, failed: 0 },
      { date: "2026-07-31", ok: 0, failed: 1 },
      { date: "2026-08-01", ok: 1, failed: 0 },
    ]);
  });

  it("ignores rows outside the window rather than miscounting an edge day", () => {
    const out = dailyCounts([ext({ created_at: "2026-07-20T05:00:00Z" })], 3, now);
    expect(out.every((d) => d.ok === 0 && d.failed === 0)).toBe(true);
  });
});

describe("failureGroups", () => {
  it("prefers stop_reason, falls back to the stored error sentence", () => {
    const out = failureGroups([
      ext({ error: "cut short", stop_reason: "max_tokens" }),
      ext({ error: "cut short", stop_reason: "max_tokens" }),
      ext({ error: "The model declined to read this document.", stop_reason: null }),
      ext(), // success — not a failure group
    ]);
    expect(out).toEqual([
      { reason: "max_tokens", count: 2 },
      { reason: "The model declined to read this document.", count: 1 },
    ]);
  });
});

describe("token totals and the spend estimate", () => {
  it("treats null token counts as zero — a failed call may have neither", () => {
    expect(
      tokenTotals([ext(), ext({ input_tokens: null, output_tokens: null, error: "timed out" })])
    ).toEqual({ input: 1000, output: 200 });
  });

  it("prices at claude-opus-5 list rates: $5/M in, $25/M out", () => {
    expect(estimatedSpendUsd(1_000_000, 1_000_000)).toBe(30);
    expect(estimatedSpendUsd(0, 0)).toBe(0);
  });
});

describe("fieldCorrectionStats", () => {
  it("counts corrections AND distinct documents — three wrong VINs on one sheet is one bad document", () => {
    const out = fieldCorrectionStats([
      corr({ field_path: "vehicles.0.vin" }),
      corr({ field_path: "vehicles.1.vin" }),
      corr({ field_path: "vehicles.0.vin", extraction_id: "e2" }),
      corr({ field_path: "contact.phone" }),
    ]);
    expect(out[0]).toEqual({ field: "vehicles.*.vin", corrections: 3, documents: 2 });
    expect(out[1]).toEqual({ field: "contact.phone", corrections: 1, documents: 1 });
  });
});

describe("confidentlyWrong", () => {
  it("keeps the threshold welded to the review screen's — one constant, two consumers", () => {
    // If they drift, a field can be confidently-wrong here while the review
    // screen claims it flagged it — both statements about the same 0.85.
    expect(CONFIDENTLY_WRONG_THRESHOLD).toBe(LOW_CONFIDENCE);
  });

  it("includes the boundary, excludes below it and unknowns", () => {
    const out = confidentlyWrong([
      corr({ field_path: "a", model_confidence: 0.85 }),
      corr({ field_path: "b", model_confidence: 0.84 }),
      corr({ field_path: "c", model_confidence: null }),
    ]);
    expect(out.map((c) => c.field_path)).toEqual(["a"]);
  });

  it("sorts most-confident first — the worst prompt problems on top", () => {
    const out = confidentlyWrong([
      corr({ field_path: "a", model_confidence: 0.9 }),
      corr({ field_path: "b", model_confidence: 0.99 }),
    ]);
    expect(out.map((c) => c.field_path)).toEqual(["b", "a"]);
  });
});

describe("versionRollup", () => {
  it("slices calls, failures, confirms, corrections and latency per prompt_version", () => {
    const out = versionRollup(
      [
        ext({ id: "e1", latency_ms: 1000, load_id: "load-1" }),
        ext({ id: "e2", latency_ms: 5000, error: "timed out" }),
        ext({ id: "e3", prompt_version: "intake-v2", latency_ms: 700 }),
      ],
      [corr(), corr({ human_value: "other" }), corr({ prompt_version: "intake-v2" })]
    );
    expect(out).toEqual([
      {
        version: "intake-v1",
        calls: 2,
        failed: 1,
        confirmed: 1,
        corrections: 2,
        p50LatencyMs: 1000,
      },
      {
        version: "intake-v2",
        calls: 1,
        failed: 0,
        confirmed: 0,
        corrections: 1,
        p50LatencyMs: 700,
      },
    ]);
  });

  it("still lists a version seen only in corrections — an old call outside the window", () => {
    const out = versionRollup([], [corr({ prompt_version: "intake-v0" })]);
    expect(out).toEqual([
      { version: "intake-v0", calls: 0, failed: 0, confirmed: 0, corrections: 1, p50LatencyMs: null },
    ]);
  });
});

describe("clip", () => {
  it("renders empty as a dash and trims what it shows", () => {
    expect(clip(null)).toBe("—");
    expect(clip("   ")).toBe("—");
    expect(clip("  Dallas ")).toBe("Dallas");
  });

  it("caps long values with an ellipsis at the stated max", () => {
    const out = clip("x".repeat(60));
    expect(out.length).toBe(48);
    expect(out.endsWith("…")).toBe(true);
    expect(clip("x".repeat(48)).endsWith("…")).toBe(false);
  });
});

// Source pins, same style as the intake wiring block in ai-intake.test.ts:
// each is a decision a refactor could quietly undo.
describe("dashboard wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the page fetches metadata only — never the stored bodies", () => {
    // The extraction row's pasted email is a customer's message verbatim, and
    // the jsonb the model returned embeds the same contact details. Neither
    // may appear in this page's select.
    const src = read("src/app/(app)/admin/ai/page.tsx");
    expect(src).not.toContain("input_text");
    const cols = src.match(/const EXTRACTION_COLS =[\s\S]*?;/)?.[0] ?? "";
    expect(cols).toContain("input_sha256");
    expect(cols).not.toMatch(/[^_]output[^_]/); // output_tokens yes, the jsonb no
  });

  it("the page reads as the CALLER, so 0051's RLS decides, and gates admin/dispatcher", () => {
    const src = read("src/app/(app)/admin/ai/page.tsx");
    expect(src).toContain('from "@/lib/supabase/server"');
    expect(src).not.toContain("createAdminClient");
    expect(src).toMatch(/requireRole\("admin", "dispatcher"\)/);
  });

  it("the queries are bounded — the tables are append-only and grow forever", () => {
    const src = read("src/app/(app)/admin/ai/page.tsx");
    expect(src).toMatch(/\.gte\("created_at", since30\)/);
    expect(src).toMatch(/\.limit\(ROW_CAP\)/);
  });

  it("the topbar links it beside Users, admin-only like Users", () => {
    const src = read("src/components/app-topbar.tsx");
    const line = src.split("\n").find((l) => l.includes('"/admin/ai"')) ?? "";
    expect(line).toContain('label: "AI intake"');
    expect(line).toContain('roles: ["admin"]');
  });

  it("the intake screen's not-configured card points admins at the telemetry", () => {
    expect(read("src/app/(app)/loads/intake/page.tsx")).toContain('"/admin/ai"');
  });
});
