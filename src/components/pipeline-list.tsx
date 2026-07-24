import Link from "next/link";
import { Car, MapPin, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  LEAD_STATUSES,
  ORDER_STATUSES,
  ORDER_TABS,
  QUOTE_STATUSES,
  type PipelineStage,
} from "@/lib/order-status";
import type { Load, LoadStatus, LoadVehicle, Profile } from "@/types/database";

// Shared list for Leads / Quotes / Orders — one query path, msgplane column
// layout. Orders get the sub-status tab bar; leads and quotes don't.
export async function PipelineList({
  stage,
  title,
  description,
  tab,
  rep,
}: {
  stage: PipelineStage;
  title: string;
  description: string;
  tab?: string;
  rep?: string;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const canSeeMargin = profile.role === "admin" || profile.role === "dispatcher";
  const table = canSeeMargin ? "loads" : "loads_sales_safe";

  const stageStatuses: LoadStatus[] =
    stage === "lead" ? LEAD_STATUSES : stage === "quote" ? QUOTE_STATUSES : ORDER_STATUSES;

  const activeTab = stage === "order" ? ORDER_TABS.find((t) => t.key === tab) ?? ORDER_TABS[0] : null;

  let query = supabase.from(table).select("*").order("created_at", { ascending: false }).limit(200);
  if (activeTab) {
    if (activeTab.notSigned) query = query.in("status", ORDER_STATUSES).is("date_signed", null);
    else query = query.in("status", activeTab.statuses ?? stageStatuses);
  } else {
    query = query.in("status", stageStatuses);
  }
  if (canSeeMargin && rep) query = query.eq("sales_owner_id", rep);

  let countQuery = supabase.from(table).select("status, date_signed").in("status", ORDER_STATUSES);
  if (canSeeMargin && rep) countQuery = countQuery.eq("sales_owner_id", rep);

  const [{ data, error }, { data: countRows }] = await Promise.all([
    query,
    stage === "order"
      ? countQuery
      : Promise.resolve({ data: [] as { status: LoadStatus; date_signed: string | null }[] }),
  ]);
  const loads = (data ?? []) as Load[];

  const tabCount = (t: (typeof ORDER_TABS)[number]) => {
    const rows = (countRows ?? []) as { status: LoadStatus; date_signed: string | null }[];
    if (t.notSigned) return rows.filter((r) => r.date_signed == null).length;
    return rows.filter((r) => (t.statuses ?? []).includes(r.status)).length;
  };

  const loadIds = loads.map((l) => l.id);
  const customerIds = [...new Set(loads.map((l) => l.customer_id).filter(Boolean))];

  const [{ data: customers }, { data: reps }, { data: vehicles }] = await Promise.all([
    customerIds.length
      ? supabase.from("customers").select("id, contact_name, phone, email").in("id", customerIds)
      : Promise.resolve({
          data: [] as { id: string; contact_name: string; phone: string | null; email: string | null }[],
        }),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
    loadIds.length
      ? supabase.from("load_vehicles").select("*").in("load_id", loadIds)
      : Promise.resolve({ data: [] as LoadVehicle[] }),
  ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const repById = new Map(
    ((reps ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((r) => [r.id, r])
  );
  const vehiclesByLoad = new Map<string, LoadVehicle[]>();
  for (const v of (vehicles ?? []) as LoadVehicle[]) {
    const list = vehiclesByLoad.get(v.load_id) ?? [];
    list.push(v);
    vehiclesByLoad.set(v.load_id, list);
  }

  const basePath = stage === "lead" ? "/leads" : stage === "quote" ? "/quotes" : "/orders";
  const tabHref = (tabKey: string) => {
    const params = new URLSearchParams();
    if (tabKey !== ORDER_TABS[0].key) params.set("tab", tabKey);
    if (rep) params.set("rep", rep);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const dateTime = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
      time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {loads.length} {loads.length === 1 ? "record" : "records"} · {description}
          </p>
        </div>
        <Button render={<Link href="/loads/new" />}>New {stage}</Button>
      </div>

      {/* msgplane-style tab bar: coral active pill, per-status counts. */}
      {stage === "order" && (
        <div className="overflow-x-auto border-b pb-1">
          <div className="flex items-center gap-1">
            {ORDER_TABS.map((t) => {
              const active = (activeTab?.key ?? ORDER_TABS[0].key) === t.key;
              return (
                <Link
                  key={t.key}
                  href={tabHref(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-red-400 font-medium text-white"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums",
                      active ? "bg-white/25 text-white" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {tabCount(t)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-8 px-2 py-2"></th>
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Converted</th>
              <th className="px-3 py-2 font-medium">Notes</th>
              <th className="px-3 py-2 font-medium">Assigned to</th>
              <th className="px-3 py-2 font-medium">Shipper</th>
              <th className="px-3 py-2 font-medium">Vehicles</th>
              <th className="px-3 py-2 font-medium">Orig/Dest</th>
              <th className="px-3 py-2 font-medium">1st Avail</th>
              <th className="px-3 py-2 font-medium">Quote</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((load) => {
              const customer = customerById.get(load.customer_id);
              const rp = load.sales_owner_id ? repById.get(load.sales_owner_id) : undefined;
              const loadVehicles = vehiclesByLoad.get(load.id) ?? [];
              const created = dateTime(load.created_at);
              return (
                <tr key={load.id} className="border-b align-top last:border-b-0 hover:bg-muted/30">
                  <td className="px-2 py-3">
                    <input type="checkbox" aria-label={`Select ${load.load_number}`} className="mt-0.5" />
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/loads/${load.id}`}
                      className="font-medium tabular-nums text-blue-700 hover:underline dark:text-blue-400"
                    >
                      {load.load_number}
                    </Link>
                    <div className="mt-1">
                      <StatusBadge status={load.status} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                    <p className="tabular-nums">{created.date}</p>
                    <p className="text-xs tabular-nums">{created.time}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex min-w-6 justify-center rounded border px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {load.notes || load.shipper_info ? 1 : 0}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <User className="size-3.5" aria-hidden="true" />
                      {rp ? rp.full_name || rp.email : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium">{customer?.contact_name ?? "—"}</p>
                    {customer?.phone && <p className="tabular-nums text-muted-foreground">{customer.phone}</p>}
                    {customer?.email && (
                      <p className="max-w-44 truncate text-muted-foreground">{customer.email}</p>
                    )}
                    {customer && (
                      <Link
                        href={`/customers/${customer.id}`}
                        className="text-xs text-blue-700 hover:underline dark:text-blue-400"
                      >
                        quick view
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="space-y-1.5">
                      {loadVehicles.length === 0 && <span className="text-muted-foreground">—</span>}
                      {loadVehicles.map((v) => (
                        <div key={v.id} className="flex items-center gap-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                            <Car className="size-4" aria-hidden="true" />
                          </span>
                          <div className="leading-tight">
                            <p>{[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}</p>
                            <p className="text-xs text-muted-foreground">
                              {v.vehicle_type}
                              {load.transport_type === "enclosed" ? (
                                <span className="text-amber-600 dark:text-amber-400"> · enclosed</span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <p className="flex items-center gap-1">
                      <MapPin className="size-3 text-green-600 dark:text-green-500" aria-hidden="true" />
                      {load.pickup_city || "—"} {load.pickup_state || ""} {load.pickup_zip || ""}
                    </p>
                    <p className="flex items-center gap-1">
                      <MapPin className="size-3 text-red-600 dark:text-red-500" aria-hidden="true" />
                      {load.delivery_city || "—"} {load.delivery_state || ""} {load.delivery_zip || ""}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">
                    {formatDate(load.pickup_ready_date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs">
                    <p>Tariff: {formatCurrency(load.customer_rate)}</p>
                    <p className="text-muted-foreground">Deposit: {formatCurrency(load.deposit_amount)}</p>
                    {canSeeMargin && (
                      <p className="text-muted-foreground">Carrier: {formatCurrency(load.carrier_pay)}</p>
                    )}
                  </td>
                </tr>
              );
            })}
            {loads.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
