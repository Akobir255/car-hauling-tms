import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { DeleteButton } from "@/components/delete-button";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Carrier, Customer, Load, LoadStatusHistoryEntry, LoadVehicle, Profile } from "@/types/database";
import { LoadDetailsForm } from "./load-details-form";
import { StatusForm } from "./status-form";
import { FollowUpForm } from "./follow-up-form";
import { VehiclesEditor } from "./vehicles-editor";
import { Button } from "@/components/ui/button";
import {
  updateLoad,
  updateLoadStatus,
  deleteLoad,
  duplicateLoad,
  setFollowUp,
  clearFollowUp,
  addVehicle,
  removeVehicle,
} from "../actions";

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const [{ data: customer }, { data: vehicles }, { data: history }, { data: carriers }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", load.customer_id).single(),
    supabase.from("load_vehicles").select("*").eq("load_id", id).order("created_at"),
    supabase
      .from("load_status_history")
      .select("*")
      .eq("load_id", id)
      .order("created_at", { ascending: false }),
    canManageCarrier
      ? supabase.from("carriers").select("*").order("company_name")
      : Promise.resolve({ data: [] as Carrier[] }),
  ]);

  const historyRows = (history ?? []) as LoadStatusHistoryEntry[];
  const changedByIds = [...new Set(historyRows.map((h) => h.changed_by).filter(Boolean) as string[])];
  const { data: changedByProfiles } = changedByIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", changedByIds)
    : { data: [] as Pick<Profile, "id" | "full_name" | "email">[] };
  const profileById = new Map((changedByProfiles ?? []).map((p) => [p.id, p]));

  const boundUpdate = updateLoad.bind(null, load.id);
  const boundStatusUpdate = updateLoadStatus.bind(null, load.id);
  const boundDelete = deleteLoad.bind(null, load.id);
  const boundDuplicate = duplicateLoad.bind(null, load.id);
  const boundSetFollowUp = setFollowUp.bind(null, load.id);
  const boundClearFollowUp = clearFollowUp.bind(null, load.id);
  const boundAddVehicle = addVehicle.bind(null, load.id);
  const boundRemoveVehicle = removeVehicle.bind(null, load.id);

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{load.load_number}</h1>
          <StatusBadge status={load.status} />
        </div>
        <div className="flex items-center gap-2">
          <form action={boundDuplicate}>
            <Button type="submit" variant="outline" size="sm">
              Duplicate
            </Button>
          </form>
          {profile.role === "admin" && (
            <DeleteButton
              onDelete={boundDelete}
              confirmMessage={`Delete load ${load.load_number}? This cannot be undone.`}
            />
          )}
        </div>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <p>
          <span className="text-muted-foreground">Customer: </span>
          {customer ? (
            <Link href={`/customers/${customer.id}`} className="font-medium hover:underline">
              {(customer as Customer).contact_name}
            </Link>
          ) : (
            "—"
          )}
        </p>
        <p className="mt-1">
          <span className="text-muted-foreground">Customer rate: </span>
          {formatCurrency(load.customer_rate)}
          {canManageCarrier && load.carrier_pay != null && load.customer_rate != null && (
            <span className="ml-3 text-muted-foreground">
              Margin: {formatCurrency(load.customer_rate - load.carrier_pay)}
            </span>
          )}
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Update status</h2>
        <StatusForm currentStatus={load.status} action={boundStatusUpdate} />
      </section>

      <section className="space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Follow-up</h2>
        <FollowUpForm load={load} action={boundSetFollowUp} onClear={boundClearFollowUp} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Vehicles</h2>
        <VehiclesEditor
          vehicles={(vehicles ?? []) as LoadVehicle[]}
          addAction={boundAddVehicle}
          removeAction={boundRemoveVehicle}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Load details</h2>
        <LoadDetailsForm
          action={boundUpdate}
          load={load}
          carriers={(carriers ?? []) as Carrier[]}
          canManageCarrier={canManageCarrier}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Status history</h2>
        <div className="space-y-2">
          {historyRows.map((h) => {
            const who = h.changed_by ? profileById.get(h.changed_by) : null;
            return (
              <div key={h.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <StatusBadge status={h.status} />
                  <span className="text-xs text-muted-foreground">{formatDate(h.created_at)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {who?.full_name || who?.email || "System"}
                  {h.note ? ` — ${h.note}` : ""}
                </p>
              </div>
            );
          })}
          {historyRows.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
        </div>
      </section>
    </div>
  );
}
