"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { VehicleThumb } from "@/components/vehicle-thumb";
import type { VehicleType } from "@/types/database";

// Real photo of the vehicle model (via /api/vehicles/image), falling back to
// the type silhouette while the make/model is unknown or the lookup misses.
// unoptimized: the API route already serves resized, CDN-cached images —
// piping them through /_next/image again would just double-proxy.
export function VehiclePhoto({
  year,
  make,
  model,
  type,
  className,
}: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  type: VehicleType | string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !make?.trim() || !model?.trim()) {
    return <VehicleThumb type={type} className={className} />;
  }

  const src = `/api/vehicles/image?${new URLSearchParams({ make, model })}`;
  const alt = [year, make, model].filter(Boolean).join(" ");
  return (
    <span
      className={cn(
        "flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/60",
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
        className="size-full object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
