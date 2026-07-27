import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { SectionBand } from "@/components/section-band";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { Carrier, Customer, Load, LoadVehicle } from "@/types/database";
import { LoadDetailsForm } from "../load-details-form";
import { StatusForm } from "../status-form";
import { FollowUpForm } from "../follow-up-form";
import { VehiclesEditor } from "../vehicles-editor";
import {
  updateLoad,
  updateLoadStatus,
  setFollowUp,
  clearFollowUp,
  addVehicle,
  removeVehicle,
  saveVehicleTariffs,
} from "../../actions";

export default async function EditLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const canManageCarrier = profile.role === "admin" || profile.role === "dispatcher";
  const supabase = await createClient();

  const { data: loadData } = await supabase
    .from(canManageCarrier ? MANAGER_LOADS_TABLE : "loads_sales_safe")
    .select("*")
    .eq("id", id)
    .single();
  if (!loadData) notFound();
  const load = loadData as Load;

  const [{ data: customerData }, { data: vehiclesData }, { data: carriers }, { data: campaignRows }] =
    await Promise.all([
      supabase.from("customers").select("*").eq("id", load.customer_id).single(),
      supabase.from("load_vehicles").select("*").eq("load_id", id).order("created_at"),
      canManageCarrier
        ? supabase.from("carriers").select("*").order("company_name")
        : Promise.resolve({ data: [] as Carrier[] }),
      // Campaign names already in use, so the header field suggests instead
      // of forcing free text every time.
      supabase.from("loads").select("campaign").not("campaign", "is", null).limit(500),
    ]);
  const customer = customerData as Customer | null;
  const vehicles = (vehiclesData ?? []) as LoadVehicle[];
  const campaigns = [
    ...new Set(((campaignRows ?? []) as { campaign: string | null }[]).map((r) => r.campaign).filter(Boolean) as string[]),
  ].sort();

  const boundUpdate = updateLoad.bind(null, load.id);
  const boundStatusUpdate = updateLoadStatus.bind(null, load.id);
  const boundSetFollowUp = setFollowUp.bind(null, load.id);
  const boundClearFollowUp = clearFollowUp.bind(null, load.id);
  const boundAddVehicle = addVehicle.bind(null, load.id);
  const boundRemoveVehicle = removeVehicle.bind(null, load.id);
  const boundSaveTariffs = saveVehicleTariffs.bind(null, load.id);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-4 py-3">
        <span className="font-semibold tabular-nums text-blue-700 dark:text-blue-400">
          {load.load_number}
        </span>
        <StatusBadge status={load.status} />
        {customer && (
          <span className="text-sm text-muted-foreground">{customer.contact_name}</span>
        )}
        <div className="ml-auto">
          <Button variant="outline" size="sm" render={<Link href={`/loads/${load.id}`} />}>
            ‹ Back to order
          </Button>
        </div>
      </div>

      {customer && (
        <SectionBand title="Shipper Information">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span>
              <span className="font-semibold">Name:</span> {customer.contact_name}
            </span>
            <span>
              <span className="font-semibold">Phone:</span>{" "}
              <span className="tabular-nums">{customer.phone || "—"}</span>
            </span>
            <span>
              <span className="font-semibold">Email:</span> {customer.email || "—"}
            </span>
            <Link
              href={`/customers/${customer.id}`}
              className="ml-auto text-blue-700 hover:underline dark:text-blue-400"
            >
              Edit shipper details →
            </Link>
          </div>
        </SectionBand>
      )}

      <SectionBand title="Contacts, Addresses, Rate & Notes" bodyClassName="p-5">
        <LoadDetailsForm
          action={boundUpdate}
          load={load}
          carriers={(carriers ?? []) as Carrier[]}
          canManageCarrier={canManageCarrier}
          campaigns={campaigns}
        />
      </SectionBand>

      <SectionBand title="Vehicles" bodyClassName="p-5">
        <VehiclesEditor
          vehicles={vehicles}
          addAction={boundAddVehicle}
          removeAction={boundRemoveVehicle}
          tariffsAction={boundSaveTariffs}
        />
      </SectionBand>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionBand title="Update Status" bodyClassName="p-5">
          <StatusForm currentStatus={load.status} action={boundStatusUpdate} />
        </SectionBand>
        <SectionBand title="Follow-up" bodyClassName="p-5">
          <FollowUpForm load={load} action={boundSetFollowUp} onClear={boundClearFollowUp} />
        </SectionBand>
      </div>
    </div>
  );
}
