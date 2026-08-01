import type { Metadata } from "next";
import { Activity, Gauge, ShieldAlert, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/flags";
import { isAiConfigured } from "@/lib/ai/extract-intake";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  CONFIDENTLY_WRONG_THRESHOLD,
  clip,
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
} from "./metrics";

// The first consumer of ai_extractions + ai_corrections (0051): volume, cost
// and — the part that matters — what humans had to fix. Deliberately rendered
// whether or not the ai_intake flag is on: this is telemetry ABOUT the
// feature, and "no calls yet" while the flag is off is a true statement, not
// a broken page.
//
// Every read goes through the CALLER's RLS client. 0051 scopes both tables to
// author-or-admin/dispatcher, and admin/dispatcher — the only roles past the
// gate below — read everything, so the numbers here are complete without this
// page needing the service role for anything.

export const metadata: Metadata = { title: "AI intake" };

// Metadata ONLY — never the stored bodies. The row's pasted email holds a
// customer's name, phone and address verbatim, and the jsonb the model
// returned embeds the same details, so neither column is ever fetched by this
// dashboard. sha / filename / kind is as close as it gets.
const EXTRACTION_COLS =
  "id, created_at, kind, input_filename, input_sha256, model, prompt_version, " +
  "error, stop_reason, input_tokens, output_tokens, latency_ms, load_id";

const WINDOW_DAYS = 30;
// The tables are append-only and grow forever; PostgREST also caps a response
// at 1,000 rows regardless of what .limit() asks for. So: a 30-day window, the
// newest 1,000 rows of it, and an exact count so the page can say out loud
// when the detail tables are working from a sample.
const ROW_CAP = 1000;

export default async function AdminAiPage() {
  // Wider than /admin/users' admin-only gate, on purpose: 0051's RLS already
  // grants dispatchers the same full read as admins — they run the intake
  // screen, and its telemetry is theirs to see. The topbar link stays
  // admin-only like the Users link; this only decides who may load the URL.
  await requireRole("admin", "dispatcher");
  const supabase = await createClient();

  const now = new Date();
  const since30 = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const since7Ms = now.getTime() - 7 * 86_400_000;

  const [flagOn, extractionsRes, correctionsRes] = await Promise.all([
    isFeatureEnabled("ai_intake"),
    supabase
      .from("ai_extractions")
      .select(EXTRACTION_COLS, { count: "exact" })
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP),
    // Corrections joined to the extraction that produced them — the join is
    // what carries prompt_version, the slicing key 0051 stored it for.
    supabase
      .from("ai_corrections")
      .select(
        "extraction_id, field_path, model_value, human_value, model_confidence, created_at, " +
          "extraction:ai_extractions(prompt_version)"
      )
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP),
  ]);

  const rows = (extractionsRes.data ?? []) as unknown as ExtractionRow[];
  const windowTotal = extractionsRes.count ?? rows.length;
  const truncated = windowTotal > rows.length;
  const queryError = extractionsRes.error?.message ?? correctionsRes.error?.message ?? null;

  type JoinedCorrection = Omit<CorrectionRow, "prompt_version"> & {
    extraction: { prompt_version: string } | null;
  };
  const corrections: CorrectionRow[] = (
    (correctionsRes.data ?? []) as unknown as JoinedCorrection[]
  ).map(({ extraction, ...c }) => ({
    ...c,
    prompt_version: extraction?.prompt_version ?? "unknown",
  }));

  // ---- Volume + health ----
  const days = dailyCounts(rows, WINDOW_DAYS, now);
  const maxDay = Math.max(...days.map((d) => d.ok + d.failed), 1);
  const failedCount = rows.filter(isFailure).length;
  const failures = failureGroups(rows);
  const latencies = rows.map((r) => r.latency_ms).filter((v): v is number => v != null);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);

  // ---- Cost ----
  const tokens30 = tokenTotals(rows);
  const tokens7 = tokenTotals(rows.filter((r) => Date.parse(r.created_at) >= since7Ms));

  // ---- Quality ----
  const parsedCount = rows.length - failedCount;
  // load_id stamped = a human confirmed and an order exists. Null on a parsed
  // row = abandoned, or still open on someone's screen — indistinguishable by
  // design, and the label below says so.
  const confirmedCount = rows.filter((r) => !isFailure(r) && r.load_id !== null).length;
  const fieldStats = fieldCorrectionStats(corrections);
  const wrong = confidentlyWrong(corrections);
  const versions = versionRollup(rows, corrections);

  const configured = isAiConfigured();

  const n = (v: number) => v.toLocaleString("en-US");
  const ms = (v: number | null) =>
    v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`;
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const WRONG_SHOWN = 15;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[15px]">AI intake</h1>
          <p className="text-sm text-muted-foreground">
            Every model call behind the intake screen — what it costs, how it fails, and what
            humans had to fix. Last {WINDOW_DAYS} days.
          </p>
        </div>
        {/* The two switches an operator will ask about first, stated rather
            than inferred from empty tables. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
            ai_intake flag {flagOn ? "on" : "off"}
          </span>
          <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
            {configured ? "ANTHROPIC_API_KEY set" : "ANTHROPIC_API_KEY missing"}
          </span>
        </div>
      </div>

      {queryError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
          Some telemetry could not be loaded, so the figures below may be incomplete. ({queryError})
        </p>
      )}

      {truncated && (
        <p className="rounded-lg border px-4 py-2.5 text-sm text-muted-foreground">
          The window holds {n(windowTotal)} calls; the tables below work from the newest{" "}
          {n(rows.length)}, so older days undercount. The headline call count is exact.
        </p>
      )}

      {windowTotal === 0 && !queryError && (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            No calls recorded yet.{" "}
            {!configured
              ? "ANTHROPIC_API_KEY is not set on this deployment, so the intake screen cannot reach the model — this page starts filling the moment the key lands and the first document is read."
              : !flagOn
                ? "The ai_intake flag is off, so nobody can reach the intake screen. The tables are applied and waiting — flip the flag and the first document read lands here."
                : "The intake screen is live — the first document somebody reads will appear here."}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          title={`Calls (${WINDOW_DAYS}d)`}
          value={n(windowTotal)}
          icon={Activity}
          iconClass="bg-chart-1/10 text-chart-1"
        />
        <StatCard
          title={`Failed calls (${WINDOW_DAYS}d)`}
          value={
            rows.length > 0
              ? `${n(failedCount)} (${Math.round((failedCount / rows.length) * 100)}%)`
              : "0"
          }
          icon={ShieldAlert}
          iconClass="bg-destructive/10 text-destructive"
        />
        <StatCard
          title="p50 latency"
          value={ms(p50)}
          icon={Timer}
          iconClass="bg-chart-2/10 text-chart-2"
        />
        <StatCard
          title="p95 latency"
          value={ms(p95)}
          icon={Gauge}
          iconClass="bg-chart-4/10 text-chart-4"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Calls by day</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                Calls will chart here as documents are read.
              </p>
            ) : (
              <div>
                <div className="flex h-32 items-end gap-[3px]">
                  {days.map((d) => {
                    const total = d.ok + d.failed;
                    return (
                      <div
                        key={d.date}
                        className="flex h-full flex-1 flex-col justify-end gap-px"
                        title={`${dayLabel(d.date)}: ${d.ok} parsed, ${d.failed} failed`}
                      >
                        {d.failed > 0 && (
                          <div
                            className="min-h-[2px] w-full rounded-sm bg-destructive"
                            style={{ height: `${(d.failed / maxDay) * 100}%` }}
                          />
                        )}
                        {d.ok > 0 && (
                          <div
                            className="min-h-[2px] w-full rounded-sm bg-chart-1"
                            style={{ height: `${(d.ok / maxDay) * 100}%` }}
                          />
                        )}
                        {total === 0 && <div className="w-full border-b border-border" />}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-chart-1" aria-hidden="true" /> parsed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-destructive" aria-hidden="true" />{" "}
                    failed
                  </span>
                  <span className="ml-auto tabular-nums">
                    {dayLabel(days[0].date)} – {dayLabel(days[days.length - 1].date)}
                  </span>
                </div>
                {/* The bars carry no text a reader can reach — same convention
                    as the revenue chart. */}
                <table className="sr-only">
                  <caption>AI intake calls by day, parsed and failed</caption>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.date}>
                        <th scope="row">{d.date}</th>
                        <td>{d.ok} parsed</td>
                        <td>{d.failed} failed</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estimated spend</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Window</TableHead>
                  <TableHead className="text-right">In tokens</TableHead>
                  <TableHead className="text-right">Out tokens</TableHead>
                  <TableHead className="text-right">Est. spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { label: "Last 7 days", t: tokens7 },
                  { label: `Last ${WINDOW_DAYS} days`, t: tokens30 },
                ].map(({ label, t }) => (
                  <TableRow key={label}>
                    <TableCell>{label}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(t.input)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(t.output)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(estimatedSpendUsd(t.input, t.output))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              An estimate, not a bill: claude-opus-5 list rates ($5 / $25 per million tokens in /
              out), no caching discounts, no billing-side rounding.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Confidently wrong</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Fields corrected by a human where the model claimed ≥ {CONFIDENTLY_WRONG_THRESHOLD}{" "}
              confidence — so the review screen never steered anyone to look. Each row is a prompt
              problem, not the review screen working. This is the exact query 0051 stored
              model_confidence to answer.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Model said</TableHead>
                  <TableHead>Human fixed</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wrong.slice(0, WRONG_SHOWN).map((c) => (
                  <TableRow key={`${c.extraction_id}:${c.field_path}:${c.human_value}`}>
                    {/* The raw path, uncollapsed — WHICH vehicle was wrong
                        matters here. */}
                    <TableCell className="font-mono text-xs">{c.field_path}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {clip(c.model_value)}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{clip(c.human_value)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.model_confidence?.toFixed(2) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatDateTime(c.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
                {wrong.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      None — which is the goal, not a gap.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {wrong.length > WRONG_SHOWN && (
              <p className="mt-2 text-xs text-muted-foreground">
                …and {n(wrong.length - WRONG_SHOWN)} more in the window.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Outcomes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {[
                { label: "Parsed", value: parsedCount },
                { label: "Confirmed into an order", value: confirmedCount },
                { label: "Abandoned or still open", value: parsedCount - confirmedCount },
                { label: "Failed", value: failedCount },
                { label: "Corrections recorded", value: corrections.length },
              ].map((row) => (
                <p key={row.label} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="tabular-nums">{n(row.value)}</span>
                </p>
              ))}
              <p className="pt-1.5 text-xs text-muted-foreground">
                Confirmed = a load exists for the extraction. A parsed row with no load was
                abandoned — or is still open on someone&apos;s screen.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Failures by reason</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {failures.map((f) => (
                <p key={f.reason} className="flex items-center justify-between gap-2">
                  <span className="truncate text-muted-foreground">{f.reason}</span>
                  <span className="tabular-nums">{n(f.count)}</span>
                </p>
              ))}
              {failures.length === 0 && (
                <p className="text-sm text-muted-foreground">No failures in the window.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Corrections by field</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Vehicle positions are collapsed — three wrong VINs on one sheet is one bad document,
              counted once under vehicles.*.vin.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead className="text-right">Corrections</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fieldStats.map((f) => (
                  <TableRow key={f.field}>
                    <TableCell className="font-mono text-xs">{f.field}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(f.corrections)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(f.documents)}</TableCell>
                  </TableRow>
                ))}
                {fieldStats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No corrections yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By prompt version</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Only intake-v1 exists today; the column exists for exactly this table.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Confirmed</TableHead>
                  <TableHead className="text-right">Corrections</TableHead>
                  <TableHead className="text-right">p50 latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.version}>
                    <TableCell className="font-mono text-xs">{v.version}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(v.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(v.failed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(v.confirmed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(v.corrections)}</TableCell>
                    <TableCell className="text-right tabular-nums">{ms(v.p50LatencyMs)}</TableCell>
                  </TableRow>
                ))}
                {versions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No calls yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
