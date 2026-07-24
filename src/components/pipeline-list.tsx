import Link from "next/link";
import { CalendarCheck2, Inbox, Mail, MapPin, Phone, User } from "lucide-react";
import { VehicleThumb } from "@/components/vehicle-thumb";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";
import { endOfBusinessDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { SelectionProvider } from "@/components/pipeline/selection-context";
import { RowCheckbox, SelectAllCheckbox } from "@/components/pipeline/row-checkbox";
import { BulkActionBar } from "@/components/pipeline/bulk-action-bar";
import { EmptyState } from "@/components/empty-state";
import {
  LEAD_STATUSES,
  LEAD_TABS,
  ORDER_STATUSES,
  ORDER_TABS,
  QUOTE_STATUSES,
  QUOTE_TABS,
  type OrderTab,
  type PipelineStage,
} from "@/lib/order-status";
import { VEHICLE_TYPE_LABELS } from "@/types/database";
import type { Load, LoadStatus, LoadVehicle, Profile } from "@/types/database";

// Shared list for Leads / Quotes / Orders — one query path, msgplane column
// layout. Orders get sub-status tabs; Leads and Quotes get the working-queue
// pair (All | Follow-up Today).
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
  const tabs: OrderTab[] =
    stage === "order" ? ORDER_TABS : stage === "quote" ? QUOTE_TABS : LEAD_TABS;
  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0];

  // "Due" = follow-up scheduled for any time up to the end of today in the
  // business timezone (includes everything overdue). Shared with the
  // dashboard's due-today card so the two counts can never disagree.
  const endOfToday = endOfBusinessDay();
  const endOfTodayIso = endOfToday.toISOString();

  let query = supabase.from(table).select("*").limit(200);
  if (activeTab.notSigned) {
    query = query.in("status", ORDER_STATUSES).is("date_signed", null);
  } else {
    query = query.in("status", activeTab.statuses ?? stageStatuses);
  }
  if (activeTab.followUpDue) {
    // Oldest follow-up first — that's the order reps should work the queue in.
    query = query
      .not("follow_up_at", "is", null)
      .lte("follow_up_at", endOfTodayIso)
      .order("follow_up_at", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: false });
  }
  if (canSeeMargin && rep) query = query.eq("sales_owner_id", rep);

  // One slim query feeds every tab count for this stage.
  let countQuery = supabase
    .from(table)
    .select("status, date_signed, follow_up_at")
    .in("status", stageStatuses);
  if (canSeeMargin && rep) countQuery = countQuery.eq("sales_owner_id", rep);

  const [{ data, error }, { data: countRows }] = await Promise.all([query, countQuery]);
  const loads = (data ?? []) as Load[];

  type CountRow = { status: LoadStatus; date_signed: string | null; follow_up_at: string | null };
  const tabCount = (t: OrderTab) => {
    const rows = (countRows ?? []) as CountRow[];
    if (t.notSigned) return rows.filter((r) => r.date_signed == null).length;
    const inStatuses = rows.filter((r) => (t.statuses ?? stageStatuses).includes(r.status));
    if (t.followUpDue) {
      // Compare as Dates — string compare breaks if offset formats ever differ.
      return inStatuses.filter((r) => r.follow_up_at && new Date(r.follow_up_at) <= endOfToday)
        .length;
    }
    return inStatuses.length;
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
    if (tabKey !== tabs[0].key) params.set("tab", tabKey);
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

  const repsForBar = ((reps ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((r) => ({
    id: r.id,
    name: r.full_name || r.email,
  }));

  return (
    <SelectionProvider>
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
      {tabs.length > 1 && (
        <div className="overflow-x-auto border-b pb-1">
          <div className="flex items-center gap-1">
            {tabs.map((t) => {
              const active = activeTab.key === t.key;
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

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-sm font-bold uppercase tracking-wide text-foreground">
              <th className="w-8 px-2 py-3">
                <SelectAllCheckbox ids={loadIds} />
              </th>
              <th className="px-3 py-3">ID</th>
              <th className="px-3 py-3">Converted</th>
              <th className="px-3 py-3">Notes</th>
              <th className="px-3 py-3">Assigned to</th>
              <th className="px-3 py-3">Shipper</th>
              <th className="px-3 py-3">Vehicles</th>
              <th className="px-3 py-3">Orig/Dest</th>
              <th className="px-3 py-3">1st Avail</th>
              <th className="px-3 py-3">Quote</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((load) => {
              const customer = customerById.get(load.customer_id);
              const rp = load.sales_owner_id ? repById.get(load.sales_owner_id) : undefined;
              const loadVehicles = vehiclesByLoad.get(load.id) ?? [];
              const created = dateTime(load.created_at);
              return (
                <tr key={load.id} className="border-b align-top last:border-b-0 hover:bg-muted/40">
                  <td className="px-2 py-4">
                    <RowCheckbox id={load.id} label={`Select ${load.load_number}`} />
                  </td>
                  <td className="px-3 py-4">
                    <Link
                      href={`/loads/${load.id}`}
                      className="font-semibold tabular-nums text-primary hover:underline"
                    >
                      {load.load_number}
                    </Link>
                    <div className="mt-1.5">
                      <StatusBadge status={load.status} />
                    </div>
                    {load.follow_up_at && (
                      <span
                        title={load.follow_up_note ?? undefined}
                        className={cn(
                          "mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                          new Date(load.follow_up_at) < new Date()
                            ? "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-400/15 dark:text-red-300"
                            : "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-400/15 dark:text-amber-300"
                        )}
                      >
                        FU {formatDate(load.follow_up_at)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4">
                    <p className="tabular-nums text-foreground">{created.date}</p>
                    <p className="text-[13px] tabular-nums text-muted-foreground">{created.time}</p>
                  </td>
                  <td className="px-3 py-4">
                    <span className="inline-flex min-w-6 justify-center rounded border px-1.5 py-0.5 text-[13px] tabular-nums text-muted-foreground">
                      {load.notes || load.shipper_info ? 1 : 0}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <span className="flex items-center gap-1.5 text-foreground">
                      <User className="size-4 text-muted-foreground" aria-hidden="true" />
                      {rp ? rp.full_name || rp.email : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    {customer ? (
                      <div className="space-y-1">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="flex items-center gap-1.5 font-semibold text-primary hover:underline"
                        >
                          <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          {customer.contact_name}
                        </Link>
                        {customer.phone && (
                          <p className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                            <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                            {formatPhone(customer.phone)}
                          </p>
                        )}
                        {customer.email && (
                          <p className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="max-w-44 truncate">{customer.email}</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-4">
                    <div className="space-y-2">
                      {loadVehicles.length === 0 && <span className="text-muted-foreground">—</span>}
                      {loadVehicles.map((v) => (
                        <div key={v.id} className="flex items-center gap-2.5">
                          <VehicleThumb type={v.vehicle_type} />
                          <div className="leading-tight">
                            <p className="font-medium">
                              {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                            </p>
                            <p className="text-[13px] text-muted-foreground">
                              {VEHICLE_TYPE_LABELS[v.vehicle_type] ?? v.vehicle_type}
                              {load.transport_type === "enclosed" ? (
                                <span className="font-medium text-amber-600 dark:text-amber-400">
                                  {" "}
                                  · enclosed
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4">
                    <p className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-green-600 dark:text-green-500" aria-hidden="true" />
                      {load.pickup_city || "—"} {load.pickup_state || ""} {load.pickup_zip || ""}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-red-600 dark:text-red-500" aria-hidden="true" />
                      {load.delivery_city || "—"} {load.delivery_state || ""} {load.delivery_zip || ""}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 tabular-nums text-foreground">
                    {formatDate(load.pickup_ready_date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4">
                    <p>
                      <span className="text-muted-foreground">Tariff: </span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(load.customer_rate)}
                      </span>
                    </p>
                    <p className="text-[13px] tabular-nums text-muted-foreground">
                      Deposit: {formatCurrency(load.deposit_amount)}
                    </p>
                    {canSeeMargin && (
                      <p className="text-[13px] tabular-nums text-muted-foreground">
                        Carrier: {formatCurrency(load.carrier_pay)}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
            {loads.length === 0 && (
              <tr>
                <td colSpan={10}>
                  {activeTab.followUpDue ? (
                    <EmptyState
                      icon={CalendarCheck2}
                      title="Queue clear"
                      hint="No follow-ups due today. Anything you schedule lands here on its day."
                    />
                  ) : (
                    <EmptyState
                      icon={Inbox}
                      title="Nothing here yet"
                      hint={`New ${stage}s will show up in this list.`}
                      action={
                        <Button size="sm" render={<Link href="/loads/new" />}>
                          New {stage}
                        </Button>
                      }
                    />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BulkActionBar reps={repsForBar} canReassign={canSeeMargin} />
    </div>
    </SelectionProvider>
  );
}
