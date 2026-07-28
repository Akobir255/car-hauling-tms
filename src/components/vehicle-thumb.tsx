import Image from "next/image";
import { cn } from "@/lib/utils";
import { VEHICLE_TYPE_LABELS, type VehicleType } from "@/types/database";

// The stock photo for a body type, served from our own /public.
//
// These are the cutout product shots the old system uses — a vehicle on a
// plain background, no street, no trees, no sky. That is the whole reason they
// live here as files rather than coming from a photo lookup: an encyclopedia
// photograph is a car parked somewhere, and a column of those reads as noise
// at 56px. It also removes the failure modes that came with the lookup — no
// external request, no missing article, no cache surprise, no broken image.
//
// Types with no supplied image fall back to the nearest road vehicle rather
// than to a blank box: a trailer or an RV still reads as "something on wheels"
// where an empty square reads as broken.
const IMAGE: Record<string, string> = {
  sedan: "/vehicles/sedan.png",
  suv: "/vehicles/suv.png",
  pickup: "/vehicles/pickup.png",
  motorcycle: "/vehicles/motorcycle.png",
  boat: "/vehicles/boat.png",
  atv: "/vehicles/atv.png",
  // Awaiting their own artwork; the closest shape stands in meanwhile.
  van: "/vehicles/suv.png",
  rv: "/vehicles/suv.png",
  trailer: "/vehicles/pickup.png",
  heavy_equipment: "/vehicles/pickup.png",
  other: "/vehicles/sedan.png",
};

export function vehicleImageFor(type: VehicleType | string | null | undefined): string {
  return IMAGE[String(type ?? "").toLowerCase()] ?? IMAGE.sedan;
}

export function VehicleThumb({
  type,
  className,
}: {
  type: VehicleType | string;
  className?: string;
}) {
  const label = VEHICLE_TYPE_LABELS[type as VehicleType] ?? "Vehicle";
  return (
    <span
      className={cn(
        // rounded-md, not bare `rounded` — the latter is Tailwind's fixed 4px
        // and would not follow --radius, which the spec pins at 3px.
        "flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md",
        className
      )}
    >
      <Image
        src={vehicleImageFor(type)}
        alt={`${label} (representative photo)`}
        width={112}
        height={72}
        // object-contain, not cover: these are cutouts, and cropping one to
        // fill the box would slice the nose off a pickup.
        className="size-full object-contain"
      />
    </span>
  );
}
