import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { CoiBadge } from "@/components/coi-badge";
import { formatCurrency } from "@/lib/format";
import type { Carrier, Load } from "@/types/database";

const ACTIVE_STATUSES = ["quote", "booked", "dispatched", "picked_up", "in_transit"];

export default async function DashboardPage() {
  const profile = await requireProfile();
  const canSeeMargin = profile.role === "admin" || profile.role === "dispatcher";
  const supabase = await createClient();

  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const loadsTable = canSeeMargin ? "loads" : "loads_sales_safe";
  const [{ data: unassignedLoads }, { data: expiringCarriers }, { data: dueFollowUps }] =
    await Promise.all([
      supabase
        .from(loadsTable)
        .select("*")
        .is("carrier_id", null)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: true })
        .limit(25),
      supabase
        .from("carriers")
        .select("*")
        .not("coi_expiry_date", "is", null)
        .lte("coi_expiry_date", in30Days.toISOString().slice(0, 10))
        .order("coi_expiry_date", { ascending: true })
        .limit(25),
      supabase
        .from(loadsTable)
        .select("*")
        .not("follow_up_at", "is", null)
        .lte("follow_up_at", endOfToday.toISOString())
        .in("status", ACTIVE_STATUSES)
        .order("follow_up_at", { ascending: true })
        .limit(25),
    ]);

  const loads = (unassignedLoads ?? []) as Load[];
  const carriers = (expiringCarriers ?? []) as Carrier[];
  const followUps = (dueFollowUps ?? []) as Load[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {followUps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Follow-ups due ({followUps.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {followUps.map((load) => (
              <Link
                key={load.id}
                href={`/loads/${load.id}`}
                className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
              >
                <div>
                  <p className="font-medium">{load.load_number}</p>
                  <p className="text-muted-foreground">
                    {load.pickup_city || "—"}, {load.pickup_state || "—"} &rarr;{" "}
                    {load.delivery_city || "—"}, {load.delivery_state || "—"}
                    {load.follow_up_note ? ` — ${load.follow_up_note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {load.follow_up_at
                      ? new Date(load.follow_up_at).toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : ""}
                  </span>
                  <StatusBadge status={load.status} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Loads needing a carrier ({loads.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loads.map((load) => (
              <Link
                key={load.id}
                href={`/loads/${load.id}`}
                className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
              >
                <div>
                  <p className="font-medium">{load.load_number}</p>
                  <p className="text-muted-foreground">
                    {load.pickup_city || "—"}, {load.pickup_state || "—"} &rarr;{" "}
                    {load.delivery_city || "—"}, {load.delivery_state || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {canSeeMargin && <span>{formatCurrency(load.customer_rate)}</span>}
                  <StatusBadge status={load.status} />
                </div>
              </Link>
            ))}
            {loads.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing waiting on a carrier.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>COI expiring within 30 days ({carriers.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {carriers.map((carrier) => (
              <Link
                key={carrier.id}
                href={`/carriers/${carrier.id}`}
                className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
              >
                <p className="font-medium">{carrier.company_name}</p>
                <CoiBadge expiryDate={carrier.coi_expiry_date} />
              </Link>
            ))}
            {carriers.length === 0 && (
              <p className="text-sm text-muted-foreground">No COIs expiring soon.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
