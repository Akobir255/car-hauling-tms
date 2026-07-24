import { notFound } from "next/navigation";
import Link from "next/link";
import { Car, Clock, History, RefreshCw, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { DeleteButton } from "@/components/delete-button";
import { FormSection } from "@/components/form-section";
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
  saveVehicleTariffs,
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

  const [{ data: customerData }, { data: vehiclesData }, { data: history }, { data: carriers }] =
    await Promise.all([
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

  const customer = customerData as Customer | null;
  const vehicles = (vehiclesData ?? []) as LoadVehicle[];
  const totalTariff = vehicles.reduce((sum, v) => sum + (v.tariff ?? 0), 0);

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
  const boundSaveTariffs = saveVehicleTariffs.bind(null, load.id);

  return (
    <div className="mx-auto max-w-5xl">
      {/* Sticky summary: number, status, customer, money — visible while
          scrolling any part of the form. */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tabular-nums">{load.load_number}</h1>
          <StatusBadge status={load.status} />
          {customer && (
            <Link
              href={`/customers/${customer.id}`}
              className="max-w-48 truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              {customer.contact_name}
            </Link>
          )}
          <div className="ml-auto flex items-center gap-3">
            <p className="text-sm tabular-nums">
              <span className="text-muted-foreground">Tariff </span>
              <span className="font-semibold">{formatCurrency(totalTariff || load.customer_rate)}</span>
            </p>
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
      </div>

      <div className="space-y-8">
        <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2">
          <FormSection icon={RefreshCw} title="Update status">
            <StatusForm currentStatus={load.status} action={boundStatusUpdate} />
          </FormSection>
          <FormSection icon={Clock} title="Follow-up">
            <FollowUpForm load={load} action={boundSetFollowUp} onClear={boundClearFollowUp} />
          </FormSection>
        </div>

        {customer && (
          <FormSection
            icon={User}
            title="Shipper"
            aside={
              <Link href={`/customers/${customer.id}`} className="text-xs text-muted-foreground hover:underline">
                Open customer →
              </Link>
            }
          >
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm lg:grid-cols-4">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Name</dt>
                <dd className="font-medium">{customer.contact_name}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Company</dt>
                <dd>{customer.company_name || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Phone</dt>
                <dd className="tabular-nums">{customer.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email</dt>
                <dd className="truncate">{customer.email || "—"}</dd>
              </div>
            </dl>
          </FormSection>
        )}

        <LoadDetailsForm
          action={boundUpdate}
          load={load}
          carriers={(carriers ?? []) as Carrier[]}
          canManageCarrier={canManageCarrier}
        />

        <FormSection icon={Car} title="Vehicles">
          <VehiclesEditor
            vehicles={vehicles}
            addAction={boundAddVehicle}
            removeAction={boundRemoveVehicle}
            tariffsAction={boundSaveTariffs}
          />
        </FormSection>

        <FormSection icon={History} title="Status history">
          <div className="space-y-0">
            {historyRows.map((h) => {
              const who = h.changed_by ? profileById.get(h.changed_by) : null;
              return (
                <div
                  key={h.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2.5 text-sm last:border-b-0"
                >
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
              <p className="text-sm text-muted-foreground">No history yet.</p>
            )}
          </div>
        </FormSection>
      </div>
    </div>
  );
}
