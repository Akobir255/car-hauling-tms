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

// Fixed color per vehicle-type entity (never by rank) — categorical slots
// validated for light and dark with the palette checker.
const VEHICLE_COLORS: Record<string, string> = {
  sedan: "text-blue-600 dark:text-blue-500",
  suv: "text-amber-600",
  pickup: "text-emerald-600",
  van: "text-violet-600 dark:text-violet-500",
  motorcycle: "text-pink-600 dark:text-pink-500",
  other: "text-muted-foreground",
};

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const canSeeMargin = profile.role === "admin" || profile.role === "dispatcher";
  const loadsTable = canSeeMargin ? "loads_full" : "loads_sales_safe";
  const supabase = await createClient();

  const since60 = daysAgo(60).toISOString();
  const since90 = daysAgo(90).toISOString();
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  // Same business-timezone boundary as the Follow-up Today tabs, so this
  // card's count always agrees with the queue.
  const endOfToday = endOfBusinessDay();

  const [
    { data: loads60Data },
    { data: recentLoadsData },
    { count: openQuotes },
    { data: dueFollowUpsData },
    { data: unassignedData },
    { data: expiringCarriersData },
    { data: vehicles90Data },
    { data: recentMessagesData },
  ] = await Promise.all([
    supabase
      .from(loadsTable)
      .select("id, created_at, status, customer_rate")
      .gte("created_at", since60),
    supabase.from(loadsTable).select("*").order("created_at", { ascending: false }).limit(6),
    supabase.from(loadsTable).select("id", { count: "exact", head: true }).eq("status", "quote"),
    supabase
      .from(loadsTable)
      .select("*")
      .not("follow_up_at", "is", null)
      .lte("follow_up_at", endOfToday.toISOString())
      .in("status", ACTIVE_STATUSES)
      .order("follow_up_at", { ascending: true })
      .limit(6),
    supabase
      .from(loadsTable)
      .select("*")
      .is("carrier_id", null)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: true })
      .limit(6),
    supabase
      .from("carriers")
      .select("*")
      .not("coi_expiry_date", "is", null)
      .lte("coi_expiry_date", in30Days.toISOString().slice(0, 10))
      .order("coi_expiry_date", { ascending: true })
      .limit(5),
    supabase.from("load_vehicles").select("vehicle_type, created_at").gte("created_at", since90),
    supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  const loads60 = (loads60Data ?? []) as Pick<Load, "id" | "created_at" | "status" | "customer_rate">[];
  const recentLoads = (recentLoadsData ?? []) as Load[];
  const followUps = (dueFollowUpsData ?? []) as Load[];
  const unassigned = (unassignedData ?? []) as Load[];
  const expiringCarriers = (expiringCarriersData ?? []) as Carrier[];
  const recentMessages = (recentMessagesData ?? []) as Message[];

  // ---- KPIs with honest 7/30-day deltas ----
  const d7 = daysAgo(7);
  const d14 = daysAgo(14);
  const d30 = daysAgo(30);
  const notCancelled = loads60.filter((l) => l.status !== "cancelled");

  const newLast7 = loads60.filter((l) => new Date(l.created_at) >= d7).length;
  const newPrev7 = loads60.filter((l) => {
    const c = new Date(l.created_at);
    return c >= d14 && c < d7;
  }).length;
  const newLoadsDelta = newPrev7 > 0 ? Math.round(((newLast7 - newPrev7) / newPrev7) * 100) : null;

  const revLast30 = notCancelled
    .filter((l) => new Date(l.created_at) >= d30)
    .reduce((s, l) => s + (l.customer_rate ?? 0), 0);
  const revPrev30 = notCancelled
    .filter((l) => new Date(l.created_at) < d30)
    .reduce((s, l) => s + (l.customer_rate ?? 0), 0);
  const revDelta = revPrev30 > 0 ? Math.round(((revLast30 - revPrev30) / revPrev30) * 100) : null;

  // ---- Cumulative revenue for the chart (last 30 days) ----
  const revenuePoints: RevenuePoint[] = [];
  let running = 0;
  for (let i = 29; i >= 0; i--) {
    const day = daysAgo(i).toISOString().slice(0, 10);
    running += notCancelled
      .filter((l) => l.created_at.slice(0, 10) === day)
      .reduce((s, l) => s + (l.customer_rate ?? 0), 0);
    revenuePoints.push({ date: day, value: Math.round(running) });
  }

  // ---- Vehicle types donut: top 4 + fold into Other ----
  const typeCounts = new Map<string, number>();
  for (const v of (vehicles90Data ?? []) as Pick<LoadVehicle, "vehicle_type">[]) {
    typeCounts.set(v.vehicle_type, (typeCounts.get(v.vehicle_type) ?? 0) + 1);
  }
  const ranked = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
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
          <h1 className="text-2xl font-semibold">Welcome back, {firstName}! 👋</h1>
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

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          title="New loads (7d)"
          value={String(newLast7)}
          icon={Package}
          iconClass="bg-blue-600/10 text-blue-600 dark:text-blue-400"
          delta={newLoadsDelta}
        />
        <StatCard
          title="Open quotes"
          value={String(openQuotes ?? 0)}
          icon={FileText}
          iconClass="bg-violet-600/10 text-violet-600 dark:text-violet-400"
        />
        <StatCard
          title="Revenue (30d)"
          value={formatCurrency(revLast30)}
          icon={CircleDollarSign}
          iconClass="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
          delta={revDelta}
          deltaLabel="vs prior 30 days"
        />
        <StatCard
          title="Follow-ups due"
          value={String(followUps.length)}
          icon={CalendarClock}
          iconClass="bg-amber-600/10 text-amber-700 dark:text-amber-400"
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
                      <Link href={`/loads/${l.id}`} className="font-medium tabular-nums hover:underline">
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
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <CalendarClock className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <CardTitle>Follow-ups due today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {followUps.map((l) => (
                <Link
                  key={l.id}
                  href={`/loads/${l.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  <span className="min-w-0">
                    <span className="font-medium tabular-nums">{l.load_number}</span>
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

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Truck className="size-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <CardTitle>Needs a carrier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {unassigned.map((l) => (
                <Link
                  key={l.id}
                  href={`/loads/${l.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  <span className="font-medium tabular-nums">{l.load_number}</span>
                  <StatusBadge status={l.status} />
                </Link>
              ))}
              {unassigned.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing waiting on a carrier.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <ShieldAlert className="size-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              <CardTitle>COI expiring soon</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {expiringCarriers.map((c) => (
                <Link
                  key={c.id}
                  href={`/carriers/${c.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  <span className="truncate font-medium">{c.company_name}</span>
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
              <MessageSquare className="size-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
              <CardTitle>Recent messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {recentMessages.map((m) => (
                <Link
                  key={m.id}
                  href={m.customer_id ? `/customers/${m.customer_id}` : "/messages"}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  {m.direction === "inbound" ? (
                    <ArrowDownLeft className="mt-0.5 size-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-label="Inbound" />
                  ) : (
                    <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Outbound" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="font-medium">
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
