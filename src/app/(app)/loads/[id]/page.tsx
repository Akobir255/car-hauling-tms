import { notFound } from "next/navigation";
import Link from "next/link";
import { Car } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { DeleteButton } from "@/components/delete-button";
import { SectionBand, BandRow } from "@/components/section-band";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { ACTIONS_BY_STATUS, stageOf } from "@/lib/order-status";
import type { Customer, Load, LoadStatusHistoryEntry, LoadVehicle, Profile } from "@/types/database";
import { OrderActionBar } from "./order-action-bar";
import { deleteLoad, duplicateLoad } from "../actions";

const BACK_PATH = { lead: "/leads", quote: "/quotes", order: "/orders" } as const;

export default async function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const canManageCarrier = profile.role === "admin" || profile.role === "dispatcher";
  const supabase = await createClient();

  const { data: loadData } = await supabase
    .from(canManageCarrier ? "loads" : "loads_sales_safe")
    .select("*")
    .eq("id", id)
    .single();
  if (!loadData) notFound();
  const load = loadData as Load;

  const [{ data: customerData }, { data: vehiclesData }, { data: history }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", load.customer_id).single(),
    supabase.from("load_vehicles").select("*").eq("load_id", id).order("created_at"),
    supabase
      .from("load_status_history")
      .select("*")
      .eq("load_id", id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);
  const customer = customerData as Customer | null;
  const vehicles = (vehiclesData ?? []) as LoadVehicle[];
  const historyRows = (history ?? []) as LoadStatusHistoryEntry[];

  const profileIds = [
    ...new Set(
      [load.sales_owner_id, ...historyRows.map((h) => h.changed_by)].filter(Boolean) as string[]
    ),
  ];
  const { data: profs } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
    : { data: [] as Pick<Profile, "id" | "full_name" | "email">[] };
  const profById = new Map((profs ?? []).map((p) => [p.id, p]));
  const assignedTo = load.sales_owner_id ? profById.get(load.sales_owner_id) : null;

  const loadboard =
    load.posted_to_central_dispatch_at && load.posted_to_super_dispatch_at
      ? "All"
      : load.posted_to_central_dispatch_at
        ? "CD"
        : load.posted_to_super_dispatch_at
          ? "SD"
          : "—";

  const boundDelete = deleteLoad.bind(null, load.id);
  const boundDuplicate = duplicateLoad.bind(null, load.id);
  const backPath = BACK_PATH[stageOf(load.status)];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header bar: ID · Status · Campaign · Loadboard + actions */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-md border bg-card px-4 py-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">ID</p>
          <Link href={backPath} className="font-semibold tabular-nums text-blue-700 hover:underline dark:text-blue-400">
            {load.load_number}
          </Link>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</p>
          <StatusBadge status={load.status} />
        </div>
        <div className="hidden sm:block">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Campaign</p>
          <p className="text-sm">{load.campaign || "—"}</p>
        </div>
        <div className="hidden sm:block">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Loadboard</p>
          <p className="text-sm">{loadboard}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <OrderActionBar loadId={load.id} actions={ACTIONS_BY_STATUS[load.status] ?? []} />
          <Button
            size="sm"
            className="bg-green-600 uppercase tracking-wide text-white hover:bg-green-700"
            render={<Link href={`/loads/${load.id}/edit`} />}
          >
            Edit
          </Button>
        </div>
      </div>

      <SectionBand title="E-Sign">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Customer Contract</span>
          {load.date_signed ? (
            <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
              Signed {formatDate(load.date_signed)}
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Not signed</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            e-sign sending arrives with the contract integration
          </span>
        </div>
      </SectionBand>

      <SectionBand title="Order Information">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-1 text-sm">
            <p>
              <span className="font-semibold">Assigned To:</span>{" "}
              {assignedTo ? assignedTo.full_name || assignedTo.email : "—"}
            </p>
            <p className="font-semibold">Shipper:</p>
            {customer ? (
              <div className="space-y-0.5">
                <Link href={`/customers/${customer.id}`} className="text-blue-700 hover:underline dark:text-blue-400">
                  {customer.contact_name}
                </Link>
                {customer.phone && (
                  <p className="tabular-nums text-muted-foreground">
                    {customer.phone}{" "}
                    <span className="rounded bg-muted px-1 text-[10px] uppercase">sms</span>
                  </p>
                )}
                {customer.email && <p className="truncate text-muted-foreground">{customer.email}</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </div>

          <div className="space-y-1 text-sm">
            <p>
              <span className="font-semibold">Origin:</span> {load.pickup_city || "—"}
              {load.pickup_state ? `, ${load.pickup_state}` : ""} {load.pickup_zip || ""}
            </p>
            <p>
              <span className="font-semibold">Destination:</span> {load.delivery_city || "—"}
              {load.delivery_state ? `, ${load.delivery_state}` : ""} {load.delivery_zip || ""}
            </p>
            {load.distance_miles != null && (
              <p className="text-muted-foreground">{load.distance_miles.toLocaleString()} mi</p>
            )}
            <p className="text-muted-foreground">
              Transport: {load.transport_type}
              {load.transport_type === "enclosed" ? " (enclosed)" : ""}
            </p>
          </div>

          <div className="space-y-2 text-sm">
            {vehicles.length === 0 && <p className="text-muted-foreground">No vehicles.</p>}
            {vehicles.map((v) => (
              <div key={v.id} className="flex items-center gap-2">
                <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  <Car className="size-6" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-medium">
                    {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                    <span className="ml-1 text-muted-foreground">({v.vehicle_type})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {v.condition === "non_running" ? "Non-running" : "Running"}
                    {v.tariff != null ? ` · ${formatCurrency(v.tariff)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionBand>

      <SectionBand title="Payments & Dates">
        <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
          <div>
            <BandRow label="Tariff" value={formatCurrency(load.customer_rate)} />
            <BandRow label="Required Deposit" value={formatCurrency(load.deposit_amount)} />
            <BandRow label="Received" value={formatCurrency(load.received_amount)} />
            {canManageCarrier && (
              <>
                <BandRow label="Carrier Pay" value={formatCurrency(load.carrier_pay)} />
                <BandRow label="Carrier received" value={formatCurrency(load.carrier_received)} />
                <BandRow label="COD to Carrier" value={formatCurrency(load.cod_to_carrier)} />
              </>
            )}
          </div>
          <div>
            <BandRow label="1st Avail Pickup" value={formatDate(load.pickup_ready_date)} />
            <BandRow label="Date Signed" value={formatDate(load.date_signed)} />
            <BandRow label="Dispatched" value={formatDate(load.dispatched_at)} />
            <BandRow label="Delivery" value={formatDate(load.delivery_eta)} />
            <BandRow label="Picked-up" value={formatDate(load.picked_up_at)} />
            <BandRow label="Delivered" value={formatDate(load.delivered_at)} />
          </div>
        </div>
        {(load.cd_external_id || load.sd_external_id) && (
          <p className="mt-3 border-t pt-3 text-sm">
            <span className="font-semibold">Posted order ID: </span>
            {load.cd_external_id && <span>CD {load.cd_external_id}</span>}
            {load.cd_external_id && load.sd_external_id && " · "}
            {load.sd_external_id && <span>SD {load.sd_external_id}</span>}
          </p>
        )}
      </SectionBand>

      <SectionBand title="Shipping Information">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-semibold">Information for shipper</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {load.shipper_info || "—"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold">Notes from shipper</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{load.notes || "—"}</p>
          </div>
        </div>
      </SectionBand>

      <SectionBand title="History" bodyClassName="p-0">
        <div className="divide-y">
          {historyRows.map((h) => {
            const who = h.changed_by ? profById.get(h.changed_by) : null;
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <StatusBadge status={h.status} />
                <span className="text-muted-foreground">
                  {who?.full_name || who?.email || "System"}
                  {h.note ? ` — ${h.note}` : ""}
                </span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {formatDate(h.created_at)}
                </span>
              </div>
            );
          })}
          {historyRows.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No history yet.</p>
          )}
        </div>
      </SectionBand>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" render={<Link href={backPath} />}>
          ‹ Back to list
        </Button>
        <div className="flex items-center gap-2">
          <form action={boundDuplicate}>
            <Button type="submit" variant="ghost" size="sm">
              Duplicate
            </Button>
          </form>
          {profile.role === "admin" && (
            <DeleteButton
              onDelete={boundDelete}
              confirmMessage={`Delete ${load.load_number}? This cannot be undone.`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
