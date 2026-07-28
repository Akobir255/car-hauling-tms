import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { Carrier } from "@/types/database";
import { CarrierForm } from "../carrier-form";
import { updateCarrier, deleteCarrier } from "../actions";
import { DeleteButton } from "@/components/delete-button";
import { SectionBand } from "@/components/section-band";
import { CarrierDocs, type CarrierDoc } from "../carrier-docs";

export default async function EditCarrierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data }, { data: docRows }] = await Promise.all([
    supabase.from("carriers").select("*").eq("id", id).single(),
    supabase
      .from("documents")
      .select("id, doc_type, file_name, expires_at, created_at")
      .eq("entity_type", "carrier")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!data) notFound();
  const carrier = data as Carrier;
  const canManage = profile.role === "admin" || profile.role === "dispatcher";
  const boundUpdate = updateCarrier.bind(null, carrier.id);
  const boundDelete = deleteCarrier.bind(null, carrier.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px]">{carrier.company_name}</h1>
        {profile.role === "admin" && (
          <DeleteButton
            onDelete={boundDelete}
            confirmMessage={`Delete carrier "${carrier.company_name}"? This cannot be undone.`}
          />
        )}
      </div>
      <SectionBand title="Documents — COI, W-9, authority">
        <CarrierDocs
          carrierId={carrier.id}
          docs={(docRows ?? []) as CarrierDoc[]}
          canManage={canManage}
        />
      </SectionBand>

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
