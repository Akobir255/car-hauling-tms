import { LOW_CONFIDENCE } from "@/lib/ai/intake-schema";

// Pure computation for the AI-intake telemetry dashboard. No I/O here: the
// page feeds it rows it read through the CALLER's RLS client, and the tests
// feed it fixtures — the same split the risk scorer uses (src/lib/risk).
//
// The shapes mirror the columns the page actually selects, which is
// deliberately NOT the whole row: `input_text` is a customer's email verbatim
// and `output` embeds the same contact details, so neither is ever fetched by
// the dashboard. Metadata only — sha, filename, kind, tokens, latency.

export type ExtractionRow = {
  id: string;
  created_at: string;
  kind: string;
  input_filename: string | null;
  input_sha256: string | null;
  model: string;
  prompt_version: string;
  error: string | null;
  stop_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  load_id: string | null;
};

export type CorrectionRow = {
  extraction_id: string;
  field_path: string;
  model_value: string | null;
  human_value: string;
  model_confidence: number | null;
  created_at: string;
  /** Flattened from the joined extraction — the slicing key 0051 stored it for. */
  prompt_version: string;
};

/**
 * A row is a failure iff `error` is set. The insert in loads/intake/actions.ts
 * writes output XOR error, never both — so this needs no look at the jsonb.
 */
export function isFailure(row: Pick<ExtractionRow, "error">): boolean {
  return row.error !== null;
}

/** Nearest-rank percentile. p in 0..1; null when there is nothing to rank. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * "vehicles.0.vin" and "vehicles.3.vin" are the same lesson about the same
 * field — collapse array indices so the per-field table ranks fields, not
 * positions. The raw path stays intact on the confidently-wrong list, where
 * WHICH vehicle was wrong matters.
 */
export function collapseFieldPath(path: string): string {
  return path.replace(/(^|\.)\d+(?=\.|$)/g, "$1*");
}

export type DayCount = { date: string; ok: number; failed: number };

/**
 * Zero-filled calls-per-day for the trailing window, split parsed/failed.
 * Days are UTC (ISO date of created_at) — consistent with the timestamps the
 * table stores, and a day boundary a few hours off does not change what this
 * chart is for.
 */
export function dailyCounts(
  rows: Pick<ExtractionRow, "created_at" | "error">[],
  days: number,
  now: Date = new Date()
): DayCount[] {
  const byDate = new Map<string, DayCount>();
  const out: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const entry: DayCount = { date: key, ok: 0, failed: 0 };
    byDate.set(key, entry);
    out.push(entry);
  }
  for (const row of rows) {
    const entry = byDate.get(new Date(row.created_at).toISOString().slice(0, 10));
    if (!entry) continue; // outside the window
    if (isFailure(row)) entry.failed += 1;
    else entry.ok += 1;
  }
  return out;
}

/**
 * Failures grouped by why. stop_reason first ("refusal", "max_tokens"); the
 * stored error sentence otherwise — extract-intake.ts writes fixed phrasing,
 * never a verbatim SDK message, so grouping on it is stable and safe to show.
 */
export function failureGroups(
  rows: Pick<ExtractionRow, "error" | "stop_reason">[]
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isFailure(row)) continue;
    const reason = row.stop_reason || row.error || "unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function tokenTotals(
  rows: Pick<ExtractionRow, "input_tokens" | "output_tokens">[]
): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const row of rows) {
    input += row.input_tokens ?? 0;
    output += row.output_tokens ?? 0;
  }
  return { input, output };
}

// claude-opus-5 list rates, per million tokens. An ESTIMATE by construction:
// list price only — no caching discounts, no billing-side rounding. The page
// labels it as such wherever it prints.
export const OPUS_INPUT_PER_MTOK = 5;
export const OPUS_OUTPUT_PER_MTOK = 25;

export function estimatedSpendUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1e6) * OPUS_INPUT_PER_MTOK + (outputTokens / 1e6) * OPUS_OUTPUT_PER_MTOK;
}

export type FieldStat = {
  field: string;
  corrections: number;
  /** DISTINCT extractions — a sheet with three wrong VINs is one bad document. */
  documents: number;
};

export function fieldCorrectionStats(
  corrections: Pick<CorrectionRow, "extraction_id" | "field_path">[]
): FieldStat[] {
  const map = new Map<string, { corrections: number; docs: Set<string> }>();
  for (const c of corrections) {
    const field = collapseFieldPath(c.field_path);
    const entry = map.get(field) ?? { corrections: 0, docs: new Set<string>() };
    entry.corrections += 1;
    entry.docs.add(c.extraction_id);
    map.set(field, entry);
  }
  return [...map.entries()]
    .map(([field, e]) => ({ field, corrections: e.corrections, documents: e.docs.size }))
    .sort((a, b) => b.corrections - a.corrections || a.field.localeCompare(b.field));
}

// The same 0.85 the review screen highlights below — deliberately ONE
// constant. At or above it the model claimed certainty and the reviewer was
// not steered to look, so a correction there is a prompt problem, not the
// review screen working. This is the exact query 0051 stored
// model_confidence to make answerable.
export const CONFIDENTLY_WRONG_THRESHOLD = LOW_CONFIDENCE;

export function confidentlyWrong(corrections: CorrectionRow[]): CorrectionRow[] {
  return corrections
    .filter(
      (c) => c.model_confidence != null && c.model_confidence >= CONFIDENTLY_WRONG_THRESHOLD
    )
    .sort(
      (a, b) =>
        (b.model_confidence ?? 0) - (a.model_confidence ?? 0) ||
        b.created_at.localeCompare(a.created_at)
    );
}

export type VersionStat = {
  version: string;
  calls: number;
  failed: number;
  confirmed: number;
  corrections: number;
  p50LatencyMs: number | null;
};

/** Per-prompt-version rollup. Only intake-v1 exists today; the column exists for exactly this. */
export function versionRollup(
  rows: ExtractionRow[],
  corrections: Pick<CorrectionRow, "prompt_version">[]
): VersionStat[] {
  const map = new Map<string, { rows: ExtractionRow[]; corrections: number }>();
  for (const row of rows) {
    const entry = map.get(row.prompt_version) ?? { rows: [], corrections: 0 };
    entry.rows.push(row);
    map.set(row.prompt_version, entry);
  }
  for (const c of corrections) {
    const entry = map.get(c.prompt_version) ?? { rows: [], corrections: 0 };
    entry.corrections += 1;
    map.set(c.prompt_version, entry);
  }
  return [...map.entries()]
    .map(([version, e]) => ({
      version,
      calls: e.rows.length,
      failed: e.rows.filter(isFailure).length,
      confirmed: e.rows.filter((r) => r.load_id !== null).length,
      corrections: e.corrections,
      p50LatencyMs: percentile(
        e.rows.map((r) => r.latency_ms).filter((v): v is number => v != null),
        0.5
      ),
    }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

/** Display clamp for correction values — long, and occasionally sensitive, text. */
export function clip(value: string | null | undefined, max = 48): string {
  const s = (value ?? "").trim();
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
