"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { VehiclePhoto } from "@/components/vehicle-photo";
import type { VehicleType } from "@/types/database";
import { uploadVehiclePhoto, clearVehiclePhoto, type PhotoState } from "./photo-actions";

const initial: PhotoState = { error: null };

// The order's vehicle picture with an override control: the make/model
// lookup gets it right most of the time, but a dispatcher who has the real
// photo can drop it in and it wins from then on.
export function VehiclePhotoEditor({
  loadId,
  vehicleId,
  year,
  make,
  model,
  type,
  hasOverride,
}: {
  loadId: string;
  vehicleId: string;
  year: number | null;
  make: string | null;
  model: string | null;
  type: VehicleType | string;
  hasOverride: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    uploadVehiclePhoto.bind(null, loadId, vehicleId),
    initial
  );
  const [busy, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success("Photo updated.");
  }, [state]);

  return (
    <div className="space-y-1">
      <VehiclePhoto
        year={year}
        make={make}
        model={model}
        type={type}
        vehicleId={vehicleId}
        hasOverride={hasOverride}
        className="h-20 w-32 rounded-md"
      />
      <form ref={formRef} action={formAction} className="flex items-center gap-2 text-xs max-md:gap-4">
        <label className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground hover:underline max-md:min-h-12">
          <Camera className="size-3" aria-hidden="true" />
          {pending ? "uploading…" : hasOverride ? "replace photo" : "use real photo"}
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={() => formRef.current?.requestSubmit()}
          />
        </label>
        {hasOverride && (
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive hover:underline max-md:min-h-12"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await clearVehiclePhoto(loadId, vehicleId);
                if (!r.ok) toast.error(r.error ?? "Couldn't remove it.");
                else toast.success("Reverted to the model photo.");
              })
            }
          >
            reset
          </button>
        )}
      </form>
    </div>
  );
}
