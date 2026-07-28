"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { VehicleThumb } from "@/components/vehicle-thumb";
import { VEHICLE_TYPE_LABELS, type VehicleType } from "@/types/database";

// Real photo of the vehicle model, via /api/vehicles/image.
//
// Every row gets a photograph, the way the system this replaces does it. When
// the record carries no make/model the API serves a representative model for
// the body type instead — dimmed and desaturated here, with a tooltip saying
// so, because it is a photo of that KIND of vehicle and not this one. The
// drawn silhouette is now only for a genuine lookup failure.
// unoptimized: the API route already serves resized, CDN-cached images —
// piping them through /_next/image again would just double-proxy.
export function VehiclePhoto({
  year,
  make,
  model,
  type,
  className,
  vehicleId,
  hasOverride = false,
}: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  type: VehicleType | string;
  className?: string;
  /** When this vehicle carries an uploaded photo, it wins over the lookup. */
  vehicleId?: string;
  hasOverride?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  // The drawing is now the LAST resort, not the second one. The old system
  // shows a photograph on every row, so a blank make no longer drops straight
  // to a silhouette — the API serves a representative model for the body type
  // and only a genuine lookup failure lands here.
  if (failed) {
    return <VehicleThumb type={type} className={className} />;
  }

  const query = new URLSearchParams();
  if (hasOverride && vehicleId) query.set("vehicleId", vehicleId);
  if (make?.trim()) query.set("make", make);
  if (model?.trim()) query.set("model", model);
  if (type) query.set("type", String(type));
  const src = `/api/vehicles/image?${query}`;
  // A stand-in is a photo of that KIND of vehicle, not this one. Saying so in
  // the alt text and the tooltip is what keeps a dispatcher from describing a
  // car nobody has seen.
  const isStandIn = !hasOverride && (!make?.trim() || !model?.trim());
  const described = [year, make, model].filter(Boolean).join(" ");
  const alt = isStandIn ? `${VEHICLE_TYPE_LABELS[type as VehicleType] ?? "Vehicle"} (representative photo)` : described;
  return (
    <span
      className={cn(
        // rounded-md, not bare `rounded` — the latter is Tailwind's fixed 4px
        // and would not follow --radius, which the spec pins at 3px.
        "flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/60",
        className
      )}
    >
      <Image
        src={src}
        alt={alt}
        width={112}
        height={72}
        unoptimized
        loading="lazy"
        className={cn("size-full object-cover", isStandIn && "opacity-70 saturate-50")}
        title={isStandIn ? "Representative photo — this order does not record the make/model." : undefined}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
