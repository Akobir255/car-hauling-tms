import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SectionBand } from "@/components/section-band";
import type { Load, LoadRequest, LoadVehicle } from "@/types/database";
import { DispatchSheetForm } from "./dispatch-sheet-form";

// msgplane's "Edit Dispatch Sheet" screen (their DISPATCH button target):
// dates, carrier, driver, instructions, and the payment terms in one place.
// SAVE keeps the sheet; SAVE AND DISPATCH also assigns the carrier — which
// is the only thing that flips a posted order to Dispatched.
export default async function DispatchSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "dispatcher") redirect(`/loads/${id}`);

  const supabase = await createClient();
  const { data: loadData } = await supabase
    .from(MANAGER_LOADS_TABLE)
    .select("*")
    .eq("id", id)
    .single();
  if (!loadData) notFound();
  const load = loadData as Load;

  const [{ data: vehiclesData }, { data: requestRows }, { data: carrierRow }] = await Promise.all([
    supabase.from("load_vehicles").select("*").eq("load_id", id).order("created_at"),
    supabase
      .from("load_requests")
      .select("*")
      .eq("load_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    load.carrier_id
      ? supabase.from("carriers").select("id, company_name, phone").eq("id", load.carrier_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const vehicles = (vehiclesData ?? []) as LoadVehicle[];
  const requests = (requestRows ?? []) as LoadRequest[];
  const canDispatch = ["posted_cd", "posted_sd", "booked"].includes(load.status);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">
          Edit Dispatch Sheet for order #{load.load_number}
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" render={<Link href={`/loads/${load.id}/dispatch/print`} />}>
            Print sheet
          </Button>
          <Button variant="secondary" size="sm" render={<Link href={`/loads/${load.id}`} />}>
            Back to order
          </Button>
        </div>
      </div>

      <SectionBand title="Dispatch Sheet">
        <DispatchSheetForm
          load={load}
          vehicles={vehicles}
          requests={requests}
          currentCarrier={(carrierRow as { id: string; company_name: string; phone: string | null } | null) ?? null}
          canDispatch={canDispatch}
        />
      </SectionBand>
    </div>
  );
}
