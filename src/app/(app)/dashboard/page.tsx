import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  FileText,
  MessageSquare,
  Package,
  ShieldAlert,
  Truck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/flags";
import { recordEvent } from "@/lib/events/record-event";
import {
  ACTIVE_STATUSES as RISK_STATUSES,
  atRiskQueue,
  type RiskAssessment,
  type RiskInput,
} from "@/lib/risk/score";
import { RiskCard } from "./risk-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { CoiBadge } from "@/components/coi-badge";
import { StatCard } from "@/components/stat-card";
import { RevenueChart, type RevenuePoint } from "@/components/charts/revenue-chart";
import { DonutChart, type DonutSegment } from "@/components/charts/donut-chart";
import { formatCurrency, titleCase } from "@/lib/format";
import { endOfBusinessDay } from "@/lib/dates";
import type { Carrier, Load, LoadVehicle, Message } from "@/types/database";

const ACTIVE_STATUSES = [
  "lead",
  "quote",
  "ready",
  "posted_cd",
  "posted_sd",
  "booked",
  "dispatched",
  "picked_up",
  "in_transit",
];

// Fixed color per vehicle-type entity (never by rank). The five slots are the
// theme's chart tokens, which now carry msgplane's accent family, so the donut
// tracks the palette instead of Tailwind's ramp.
const VEHICLE_COLORS: Record<string, string> = {
  sedan: "text-chart-1",
  suv: "text-chart-2",
  pickup: "text-chart-3",
  van: "text-chart-4",
  motorcycle: "text-chart-5",
  other: "text-muted-foreground",
};

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireProfile();
  const canSeeMargin = profile.role === "admin" || profile.role === "dispatcher";
  const loadsTable = canSeeMargin ? "loads_full" : "loads_sales_safe";
  const supabase = await createClient();

  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  // Same business-timezone boundary as the Follow-up Today tabs, so this
  // card's count always agrees with the queue.
  const endOfToday = endOfBusinessDay();

  // The dashboard is a PERSONAL dashboard: a rep's numbers are their own
  // numbers. Migration 0037 made every record readable so that search can find
  // another rep's order, which means these queries have to name the owner
  // themselves — the row policy no longer narrows them.
  const isSales = profile.role === "sales";
  let recentQuery = supabase
    .from(loadsTable)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6);
  let openQuotesQuery = supabase
    .from(loadsTable)
    .select("id", { count: "exact", head: true })
    .eq("status", "quote");
  let dueFollowUpsQuery = supabase
    .from(loadsTable)
    .select("*")
    .not("follow_up_at", "is", null)
    .lte("follow_up_at", endOfToday.toISOString())
    .in("status", ACTIVE_STATUSES)
    // Same direction as the Follow-up tab this card links to. When the two
    // disagreed, the six shown here were the six the list put LAST.
    .order("follow_up_at", { ascending: false })
    .limit(6);
  if (isSales) {
    recentQuery = recentQuery.eq("sales_owner_id", profile.id);
    openQuotesQuery = openQuotesQuery.eq("sales_owner_id", profile.id);
    dueFollowUpsQuery = dueFollowUpsQuery.eq("sales_owner_id", profile.id);
  }

  const [
    { data: statsData, error: statsError },
    { data: recentLoadsData },
    { count: openQuotes },
    { data: dueFollowUpsData },
    { data: unassignedData },
    { data: expiringCarriersData },
    { data: recentMessagesData },
  ] = await Promise.all([
    // Every headline number in one aggregate call (migration 0041). These used
    // to be reduced in JS from a .select() of the 60-day window — 1,756 rows
    // against PostgREST's 1,000-row cap, so revenue read ~$370k against a true
    // $624,740 and the growth arrow said +220% against a true +28%. An
    // aggregate returns one row and is not capped.
    supabase.rpc("dashboard_stats", { p_follow_up_cutoff: endOfToday.toISOString() }),
    recentQuery,
    openQuotesQuery,
    dueFollowUpsQuery,
    // carrier_id is revoked from `authenticated` by migration 0013 and is not
    // in loads_sales_safe, so this filter is only valid for managers reading
    // loads_full. For sales it would return 42703, and the ignored error would
    // silently render an empty "Needs a carrier" card forever.
    canSeeMargin
      ? supabase
          .from(loadsTable)
          .select("*")
          .is("carrier_id", null)
          .in("status", ACTIVE_STATUSES)
          .order("created_at", { ascending: true })
          .limit(6)
      : Promise.resolve({ data: [] as Load[] }),
    supabase
      .from("carriers")
      .select("*")
      .not("coi_expiry_date", "is", null)
      .lte("coi_expiry_date", in30Days.toISOString().slice(0, 10))
      .order("coi_expiry_date", { ascending: true })
      .limit(5),
    supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  // A failed aggregate must not render as a dashboard full of zeroes — that is
  // indistinguishable from a quiet month, which is how the old truncation hid
  // for so long.
  type Stats = {
    new_last_7: number;
    new_prev_7: number;
    rev_last_30: number;
    rev_prev_30: number;
    follow_ups_due: number;
    revenue_points: { date: string; value: number }[];
    vehicle_types: Record<string, number>;
  };
  const stats = (statsData ?? null) as Stats | null;

  const recentLoads = (recentLoadsData ?? []) as Load[];
  const followUps = (dueFollowUpsData ?? []) as Load[];
  const unassigned = (unassignedData ?? []) as Load[];
  const expiringCarriers = (expiringCarriersData ?? []) as Carrier[];
  const recentMessages = (recentMessagesData ?? []) as Message[];

  // ---- Phase 7a: what is going wrong right now ----
  //
  // One extra query, and it reads through `loadsTable` like everything else on
  // this page — so a sales rep is scoped to their own rows by RLS, margin
  // columns stay revoked, and hidden loads stay hidden, with none of that
  // restated here. The scoring itself is pure and lives in src/lib/risk.
  // One clock for the whole panel. Reading it twice would let a snooze expire
  // between the two reads, and Date.now() during render is a lint error under
  // React 19's purity rule besides.
  const asOf = new Date();
  const [exceptionsEnabled, gpsEnabled] = await Promise.all([
    isFeatureEnabled("exception_engine"),
    isFeatureEnabled("gps_tracking"),
  ]);
  let atRisk: RiskAssessment[] = [];
  if (exceptionsEnabled) {
    let riskQuery = supabase
      .from(loadsTable)
      .select(
        "id, load_number, status, carrier_id, pickup_ready_date, delivery_eta, date_signed, contract_sent_at, contract_sent, follow_up_at, updated_at"
      )
      .in("status", RISK_STATUSES)
      // The 500-row cap has to degrade toward the rows most likely to be in
      // trouble, and deterministically: earliest promised delivery first (an
      // overdue one sorts before everything), then earliest pickup, then id so
      // two renders never disagree about which rows made the cut.
      .order("delivery_eta", { ascending: true, nullsFirst: false })
      .order("pickup_ready_date", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(500);
    if (isSales) riskQuery = riskQuery.eq("sales_owner_id", profile.id);
    const { data: riskRows, error: riskError } = await riskQuery;
    if (riskError) {
      // A failed risk query must not take the dashboard down with it — this is
      // an advisory panel, not the page.
      console.error("at-risk queue failed:", riskError.message);
    } else {
      const acked = new Map<string, Set<string>>();
      let rows = (riskRows ?? []) as RiskInput[];
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const { data: acks } = await supabase
          .from("risk_acknowledgements")
          .select("load_id, factor, snoozed_until")
          .in("load_id", ids);
        for (const a of acks ?? []) {
          // A snooze that has run out is not an acknowledgement any more.
          if (a.snoozed_until && Date.parse(a.snoozed_until) < asOf.getTime()) continue;
          const set = acked.get(a.load_id) ?? new Set<string>();
          set.add(a.factor ?? "*");
          acked.set(a.load_id, set);
        }
      }

      // With GPS on, hand the scorer what the satellites know: latest fix per
      // load, whether a driver link is live, and pickup-fence arrivals. All
      // best-effort — a failed read scores like GPS-dark, never a broken page.
      // Reads go through the caller's client like everything else here; all
      // three tables are staff-readable under 0050 (tracking_tokens included).
      if (gpsEnabled && ids.length) {
        const [locsRes, tokensRes, fencesRes] = await Promise.all([
          // Newest-first plus first-seen-per-load below = latest fix per load.
          // Capped at PostgREST's 1,000 rows: with more recent fixes than that
          // across candidates, a quiet truck's older fix drops out and it
          // scores as unfixed — the alarming direction, not the silent one.
          supabase
            .from("shipment_locations")
            .select("load_id, recorded_at")
            .in("load_id", ids)
            .order("recorded_at", { ascending: false })
            .limit(1000),
          supabase
            .from("tracking_tokens")
            .select("load_id")
            .in("load_id", ids)
            .eq("kind", "driver")
            .is("revoked_at", null)
            .gt("expires_at", asOf.toISOString()),
          supabase
            .from("geofence_events")
            .select("load_id, transition, occurred_at")
            .in("load_id", ids)
            .eq("fence", "pickup"),
        ]);
        for (const r of [locsRes, tokensRes, fencesRes]) {
          if (r.error) console.error("risk GPS signal read failed:", r.error.message);
        }
        const lastFix = new Map<string, string>();
        for (const l of locsRes.data ?? []) {
          if (!lastFix.has(l.load_id)) lastFix.set(l.load_id, l.recorded_at);
        }
        const liveDriver = new Set((tokensRes.data ?? []).map((t) => t.load_id));
        const arrived = new Map<string, string>();
        const departed = new Map<string, string>();
        for (const g of fencesRes.data ?? []) {
          if (g.transition === "arrived") arrived.set(g.load_id, g.occurred_at);
          else if (g.transition === "departed") departed.set(g.load_id, g.occurred_at);
        }
        rows = rows.map((r) => ({
          ...r,
          lastFixAt: lastFix.get(r.id) ?? null,
          trackingActive: liveDriver.has(r.id),
          arrivedPickupAt: arrived.get(r.id) ?? null,
          departedPickupAt: departed.get(r.id) ?? null,
        }));
      }

      atRisk = atRiskQueue(rows, asOf, acked);

      // First time a load reaches the high band, put it on the timeline.
      // Check-then-insert against an append-only table: a rare race duplicate
      // is acceptable, a flood is not — so a failed dedupe read emits nothing.
      // Best-effort throughout, and the payload is margin-free by construction
      // ({score, reason}); load_events.payload is readable by all staff.
      const flagged = atRisk.filter((a) => a.band === "high");
      if (flagged.length) {
        const { data: already, error: dedupeError } = await supabase
          .from("load_events")
          .select("load_id")
          .eq("event_type", "risk_flagged")
          .in("load_id", flagged.map((a) => a.id));
        if (dedupeError) {
          console.error("risk_flagged dedupe read failed:", dedupeError.message);
        } else {
          const seen = new Set((already ?? []).map((e) => e.load_id));
          // recordEvent never throws; failures log inside it.
          await Promise.all(
            flagged
              .filter((a) => !seen.has(a.id))
              .map((a) =>
                recordEvent({
                  loadId: a.id,
                  type: "risk_flagged",
                  payload: { score: a.score, reason: a.factors[0]?.detail ?? "at risk" },
                  source: "integration",
                })
              )
          );
        }
      }
    }
  }

  // ---- KPIs with honest 7/30-day deltas ----
  const newLast7 = stats?.new_last_7 ?? 0;
  const newPrev7 = stats?.new_prev_7 ?? 0;
  const newLoadsDelta = newPrev7 > 0 ? Math.round(((newLast7 - newPrev7) / newPrev7) * 100) : null;

  const revLast30 = Number(stats?.rev_last_30 ?? 0);
  const revPrev30 = Number(stats?.rev_prev_30 ?? 0);
  const revDelta = revPrev30 > 0 ? Math.round(((revLast30 - revPrev30) / revPrev30) * 100) : null;

  // ---- Cumulative revenue for the chart (last 30 days) ----
  // The function returns one row per day, zero-filled; the running total is the
  // only part that stays here.
  const revenuePoints: RevenuePoint[] = [];
  for (const p of stats?.revenue_points ?? []) {
    const previous = revenuePoints[revenuePoints.length - 1]?.value ?? 0;
    revenuePoints.push({ date: p.date, value: Math.round(previous + Number(p.value ?? 0)) });
  }

  // ---- Vehicle types donut: top 4 + fold into Other ----
  const ranked = Object.entries(stats?.vehicle_types ?? {}).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 4);
  const foldCount = ranked.slice(4).reduce((s, [, n]) => s + n, 0);
  const donutSegments: DonutSegment[] = top.map(([type, n]) => ({
    label: titleCase(type),
    value: n,
    colorClass: VEHICLE_COLORS[type] ?? VEHICLE_COLORS.other,
  }));
  if (foldCount > 0) {
    donutSegments.push({ label: "Other", value: foldCount, colorClass: VEHICLE_COLORS.other });
  }

  // ---- Names for recent loads + message activity ----
  const customerIds = [
    ...new Set(
      [...recentLoads.map((l) => l.customer_id), ...recentMessages.map((m) => m.customer_id)].filter(
        Boolean
      ) as string[]
    ),
  ];
  const { data: customersData } = customerIds.length
    ? await supabase.from("customers").select("id, contact_name").in("id", customerIds)
    : { data: [] as { id: string; contact_name: string }[] };
  const customerName = new Map((customersData ?? []).map((c) => [c.id, c.contact_name]));

  const recentLoadIds = recentLoads.map((l) => l.id);
  const { data: recentVehiclesData } = recentLoadIds.length
    ? await supabase
        .from("load_vehicles")
        .select("load_id, year, make, model")
        .in("load_id", recentLoadIds)
    : { data: [] as Pick<LoadVehicle, "load_id" | "year" | "make" | "model">[] };
  const firstVehicle = new Map<string, string>();
  for (const v of (recentVehiclesData ?? []) as Pick<LoadVehicle, "load_id" | "year" | "make" | "model">[]) {
    if (!firstVehicle.has(v.load_id)) {
      firstVehicle.set(v.load_id, [v.year, v.make, v.model].filter(Boolean).join(" ") || "—");
    }
  }

  const firstName = (profile.full_name || profile.email).split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* Weight 400: the spec reserves 700 for "Notes from Shipper". */}
          <h1 className="text-[15px]">Welcome back, {firstName}! 👋</h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening with your loads today.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href="/messages/new" />}>
            New blast
          </Button>
          <Button render={<Link href="/loads/new" />}>New load</Button>
        </div>
      </div>

      {/* Say so rather than drawing zeroes. A silently-empty dashboard reads as
          a quiet month, which is exactly how the 1,000-row truncation went
          unnoticed for as long as it did. */}
      {(statsError || !stats) && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
          The headline figures could not be loaded, so the cards and the chart
          below are blank rather than wrong.
          {statsError?.message ? ` (${statsError.message})` : ""}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          title="New loads (7d)"
          value={String(newLast7)}
          icon={Package}
          iconClass="bg-chart-1/10 text-chart-1"
          delta={newLoadsDelta}
        />
        <StatCard
          title="Open quotes"
          value={String(openQuotes ?? 0)}
          icon={FileText}
          iconClass="bg-chart-4/10 text-chart-4"
        />
        <StatCard
          title="Revenue (30d)"
          value={formatCurrency(revLast30)}
          icon={CircleDollarSign}
          iconClass="bg-chart-3/10 text-chart-3"
          delta={revDelta}
          deltaLabel="vs prior 30 days"
        />
        {/* The real count, not the length of the six-row list below it — which
            is what this printed, so it could never read above 6 against 18,278
            actually due. */}
        <StatCard
          title="Follow-ups due"
          value={String(stats?.follow_ups_due ?? 0)}
          icon={CalendarClock}
          iconClass="bg-chart-2/10 text-chart-2"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Revenue — cumulative, last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueChart points={revenuePoints} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vehicle types — last 90 days</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart segments={donutSegments} totalLabel="vehicles" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent loads</CardTitle>
            <Link href="/loads" className="text-xs text-muted-foreground hover:underline">
              View all →
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Load</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLoads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link href={`/loads/${l.id}`} className="tabular-nums text-msg-link hover:underline">
                        {l.load_number}
                      </Link>
                    </TableCell>
                    <TableCell>{customerName.get(l.customer_id) ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {firstVehicle.get(l.id) ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {l.pickup_city || "—"}, {l.pickup_state || "—"} → {l.delivery_city || "—"},{" "}
                      {l.delivery_state || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(l.customer_rate)}
                    </TableCell>
                  </TableRow>
                ))}
                {recentLoads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No loads yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Phase 7a. Above follow-ups deliberately: a follow-up is a task
              somebody chose, this is work going wrong whether or not anyone
              chose to look. Scored in TypeScript from the same role view the
              rest of this page reads, so it inherits RLS and the margin column
              grants rather than needing its own opinion about either. The card
              itself is a client component for the Handled/Snooze buttons, with
              its own error boundary — it may vanish, never take the page. */}
          {exceptionsEnabled && atRisk.length > 0 && (
            <RiskCard
              items={atRisk.slice(0, 6).map((a) => ({
                id: a.id,
                loadNumber: a.loadNumber,
                band: a.band,
                detail: a.factors[0]?.detail ?? null,
                worstFactor: a.factors[0]?.key ?? null,
                extraCount: Math.max(0, a.factors.length - 1),
              }))}
              total={atRisk.length}
            />
          )}

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              {/* Card icons take the spec's row-icon family. */}
              <CalendarClock className="size-4 text-chart-2" aria-hidden="true" />
              <CardTitle>Follow-ups due today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {followUps.map((l) => (
                <Link
                  key={l.id}
                  href={`/loads/${l.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-msg-hover"
                >
                  <span className="min-w-0">
                    <span className="tabular-nums text-msg-link">{l.load_number}</span>
                    {l.follow_up_note && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {l.follow_up_note}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {l.follow_up_at
                      ? new Date(l.follow_up_at).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </Link>
              ))}
              {followUps.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing due — clear runway.</p>
              )}
            </CardContent>
          </Card>

          {canSeeMargin && (
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <Truck className="size-4 text-msg-shipper" aria-hidden="true" />
                <CardTitle>Needs a carrier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {unassigned.map((l) => (
                  <Link
                    key={l.id}
                    href={`/loads/${l.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-msg-hover"
                  >
                    <span className="tabular-nums text-msg-link">{l.load_number}</span>
                    <StatusBadge status={l.status} />
                  </Link>
                ))}
                {unassigned.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing waiting on a carrier.</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
              <CardTitle>COI expiring soon</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {expiringCarriers.map((c) => (
                <Link
                  key={c.id}
                  href={`/carriers/${c.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-msg-hover"
                >
                  <span className="truncate text-msg-link">{c.company_name}</span>
                  <CoiBadge expiryDate={c.coi_expiry_date} />
                </Link>
              ))}
              {expiringCarriers.length === 0 && (
                <p className="text-sm text-muted-foreground">No COIs expiring soon.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <MessageSquare className="size-4 text-chart-3" aria-hidden="true" />
              <CardTitle>Recent messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {recentMessages.map((m) => (
                <Link
                  key={m.id}
                  href={m.customer_id ? `/customers/${m.customer_id}` : "/messages"}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-msg-hover"
                >
                  {m.direction === "inbound" ? (
                    <ArrowDownLeft className="mt-0.5 size-3.5 shrink-0 text-msg-shipper" aria-label="Inbound" />
                  ) : (
                    <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Outbound" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="text-msg-link">
                        {m.customer_id ? customerName.get(m.customer_id) ?? "Unknown" : "Unmatched"}
                      </span>{" "}
                      <span className="text-muted-foreground">{m.body}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </span>
                  </span>
                </Link>
              ))}
              {recentMessages.length === 0 && (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
