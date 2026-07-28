"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { VehicleThumb } from "@/components/vehicle-thumb";
import { VEHICLE_TYPE_LABELS, type VehicleType } from "@/types/database";

// Real photo of the vehicle model, via /api/vehicles/image.
//
// Two modes, matching how the system this replaces behaves:
//   LIST   — the body type's stock photo. Every Car row carries the same
//            silver sedan, every Pickup the same truck. A rep scanning a
//            hundred rows is reading the shape, not the model, and this
//            collapses a hundred lookups into one cached image per type.
//   DETAIL — the actual model, resolved from make/model, falling back to the
//            body type and finally to a drawing if even that misses.
//
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
  generic = false,
}: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  type: VehicleType | string;
  className?: string;
  /** When this vehicle carries an uploaded photo, it wins over the lookup. */
  vehicleId?: string;
  hasOverride?: boolean;
  /** Show the body type's stock photo instead of resolving this model. */
  generic?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  // The drawing is now the LAST resort, not the second one. The old system
  // shows a photograph on every row, so a blank make no longer drops straight
  // to a silhouette — the API serves a representative model for the body type
  // and only a genuine lookup failure lands here.
  if (failed) {
    return <VehicleThumb type={type} className={className} />;
  }

  // An uploaded photo is of THIS vehicle, so it wins even in a list — that is
  // a real picture of the car, not a stand-in for its shape.
  const useModel = !generic || (hasOverride && Boolean(vehicleId));

  const query = new URLSearchParams();
  if (hasOverride && vehicleId) query.set("vehicleId", vehicleId);
  if (useModel && make?.trim()) query.set("make", make);
  if (useModel && model?.trim()) query.set("model", model);
  if (type) query.set("type", String(type));
  const src = `/api/vehicles/image?${query}`;
  // A stand-in is a photo of that KIND of vehicle, not this one — true on
  // every list row by design, and on a detail page only when the model could
  // not be resolved. The alt text says so either way, so a screen reader is
  // never told the customer's car is something nobody has seen.
  const isStandIn = !hasOverride && (generic || !make?.trim() || !model?.trim());
  const described = [year, make, model].filter(Boolean).join(" ");
  const typeLabel = VEHICLE_TYPE_LABELS[type as VehicleType] ?? "Vehicle";
  const alt = isStandIn ? `${typeLabel} (representative photo)` : described;
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
        // In a list the stock photo IS the intended look, so it renders at
        // full strength. Dimming is reserved for a DETAIL page falling back,
        // where it signals that the model could not be resolved.
        className={cn(
          "size-full object-cover",
          isStandIn && !generic && "opacity-70 saturate-50"
        )}
        title={
          isStandIn && !generic
            ? "Representative photo — this order does not record the make/model."
            : undefined
        }
        onError={() => setFailed(true)}
      />
    </span>
  );
}
