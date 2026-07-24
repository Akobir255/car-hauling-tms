import { notFound } from "next/navigation";
import Link from "next/link";
import { Car, Clock, DollarSign, FileSignature, History, RefreshCw, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { DeleteButton } from "@/components/delete-button";
import { FormSection } from "@/components/form-section";
import { formatCurrency, formatDate } from "@/lib/format";
import { ACTIONS_BY_STATUS } from "@/lib/order-status";
import type { Carrier, Customer, Load, LoadStatusHistoryEntry, LoadVehicle, Profile } from "@/types/database";
import { LoadDetailsForm } from "./load-details-form";
import { StatusForm } from "./status-form";
import { FollowUpForm } from "./follow-up-form";
import { VehiclesEditor } from "./vehicles-editor";
import { OrderActionBar } from "./order-action-bar";
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
      {/* Sticky summary bar: ID · Status · Campaign · Loadboard + the
          status-driven lifecycle actions (Post / Dispatch / Unpost / …). */}
      <div className="sticky top-14 z-20 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:top-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">ID</p>
            <p className="font-semibold tabular-nums text-blue-700 dark:text-blue-400">{load.load_number}</p>
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
            <p className="text-sm">
              {load.posted_to_central_dispatch_at && load.posted_to_super_dispatch_at
                ? "All"
                : load.posted_to_central_dispatch_at
                  ? "CD"
                  : load.posted_to_super_dispatch_at
                    ? "SD"
                    : "—"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <OrderActionBar loadId={load.id} actions={ACTIONS_BY_STATUS[load.status] ?? []} />
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

      <div className="space-y-8">
        {/* E-Sign — contract status. Sending for signature arrives with the
            e-sign integration; for now it reflects whether it's signed. */}
        <FormSection icon={FileSignature} title="E-Sign — Customer Contract">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {load.date_signed ? (
              <StatusBadge status="paid" />
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Not signed
              </span>
            )}
            <span className="text-muted-foreground">
              {load.date_signed ? `Signed ${formatDate(load.date_signed)}` : "Contract not sent yet"}
            </span>
            <Button size="sm" variant="outline" disabled className="ml-auto">
              Send for e-sign (coming soon)
            </Button>
          </div>
        </FormSection>

        {/* Payments & Dates — read summary; edit values in Load details below. */}
        <FormSection icon={DollarSign} title="Payments & Dates">
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Tariff</dt>
              <dd className="text-right font-medium tabular-nums">{formatCurrency(load.customer_rate)}</dd>
              <dt className="text-muted-foreground">Required deposit</dt>
              <dd className="text-right tabular-nums">{formatCurrency(load.deposit_amount)}</dd>
              <dt className="text-muted-foreground">Received</dt>
              <dd className="text-right tabular-nums">{formatCurrency(load.received_amount)}</dd>
              {canManageCarrier && (
                <>
                  <dt className="text-muted-foreground">Carrier pay</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(load.carrier_pay)}</dd>
                  <dt className="text-muted-foreground">COD to carrier</dt>
                  <dd className="text-right tabular-nums">{formatCurrency(load.cod_to_carrier)}</dd>
                </>
              )}
            </dl>
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">1st avail pickup</dt>
              <dd className="text-right tabular-nums">{formatDate(load.pickup_ready_date)}</dd>
              <dt className="text-muted-foreground">Date signed</dt>
              <dd className="text-right tabular-nums">{formatDate(load.date_signed)}</dd>
              <dt className="text-muted-foreground">Dispatched</dt>
              <dd className="text-right tabular-nums">{formatDate(load.dispatched_at)}</dd>
              <dt className="text-muted-foreground">Delivery ETA</dt>
              <dd className="text-right tabular-nums">{formatDate(load.delivery_eta)}</dd>
              <dt className="text-muted-foreground">Picked-up</dt>
              <dd className="text-right tabular-nums">{formatDate(load.picked_up_at)}</dd>
              <dt className="text-muted-foreground">Delivered</dt>
              <dd className="text-right tabular-nums">{formatDate(load.delivered_at)}</dd>
            </dl>
          </div>
          {(load.cd_external_id || load.sd_external_id) && (
            <p className="text-sm text-muted-foreground">
              Posted order ID:{" "}
              {load.cd_external_id && <span className="font-medium text-foreground">CD {load.cd_external_id}</span>}
              {load.cd_external_id && load.sd_external_id && " · "}
              {load.sd_external_id && <span className="font-medium text-foreground">SD {load.sd_external_id}</span>}
            </p>
          )}
        </FormSection>

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
