import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { Carrier } from "@/types/database";
import { CarrierForm } from "../carrier-form";
import { updateCarrier, deleteCarrier } from "../actions";
import { DeleteButton } from "@/components/delete-button";

export default async function EditCarrierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("carriers").select("*").eq("id", id).single();

  if (!data) notFound();
  const carrier = data as Carrier;
  const canManage = profile.role === "admin" || profile.role === "dispatcher";
  const boundUpdate = updateCarrier.bind(null, carrier.id);
  const boundDelete = deleteCarrier.bind(null, carrier.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{carrier.company_name}</h1>
        {profile.role === "admin" && (
          <DeleteButton
            onDelete={boundDelete}
            confirmMessage={`Delete carrier "${carrier.company_name}"? This cannot be undone.`}
          />
        )}
      </div>
      {canManage ? (
        <CarrierForm action={boundUpdate} carrier={carrier} />
      ) : (
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to edit carriers.
        </p>
      )}
    </div>
  );
}
