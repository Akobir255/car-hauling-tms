import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/flags";
import { resolveTrackingToken } from "@/lib/tracking/tokens";
import { formatDateTime } from "@/lib/format";

// The customer's tracking page (Phase 2). Read-only, no login.
//
// WHAT THIS PAGE MUST NOT CONTAIN, per the brief and per common sense: carrier
// names, rates, margin, or anyone's contact details. A shipper who can see the
// carrier can call them directly next time, and the tariff is nobody's business
// but the party who agreed it. Nothing below selects those columns at all —
// redaction by not fetching, rather than by remembering not to render.

export const dynamic = "force-dynamic";

const STATUS_WORDS: Record<string, string> = {
  ready: "Booked",
  posted_cd: "Finding a carrier",
  posted_sd: "Finding a carrier",
  booked: "Carrier assigned",
  dispatched: "Carrier assigned",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
};

export default async function CustomerTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!(await isFeatureEnabled("gps_tracking"))) notFound();

  const { token } = await params;
  const resolved = await resolveTrackingToken(token, "customer");
  if (!resolved.ok) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-5">
        <h1 className="text-2xl font-bold">This tracking link isn&apos;t active</h1>
        <p className="text-muted-foreground">
          It may have expired. Contact your booking agent for an update.
        </p>
      </div>
    );
  }

  const admin = createAdminClient();
  const loadId = resolved.load.id;

  const [{ data: position }, { data: fences }, { data: stops }] = await Promise.all([
    admin
      .from("shipment_locations")
      .select("lat, lng, recorded_at")
      .eq("load_id", loadId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("load_geofences").select("kind, lat, lng").eq("load_id", loadId),
    admin
      .from("geofence_events")
      .select("fence, transition, occurred_at")
      .eq("load_id", loadId)
      .order("occurred_at", { ascending: true }),
  ]);

  // Deliberately coarse. A shipper needs to know the car is moving and roughly
  // where — not the driver's doorstep-level position, which is a person's
  // location, not a package's.
  const delivery = (fences ?? []).find((f) => f.kind === "delivery");
  const remainingMiles =
    position && delivery
      ? Math.round(
          (haversine(position.lat, position.lng, delivery.lat, delivery.lng) / 1609.344) * 1
        )
      : null;

  const arrivedPickup = (stops ?? []).some(
    (s) => s.fence === "pickup" && s.transition === "arrived"
  );
  const arrivedDelivery = (stops ?? []).some(
    (s) => s.fence === "delivery" && s.transition === "arrived"
  );

  return (
    <div className="mx-auto max-w-lg space-y-6 p-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Order</p>
        <h1 className="text-2xl font-bold tabular-nums">{resolved.load.load_number}</h1>
      </header>

      <section className="rounded-md border p-5">
        <p className="text-sm text-muted-foreground">Status</p>
        <p className="text-xl font-bold">
          {arrivedDelivery
            ? "Delivered"
            : (STATUS_WORDS[resolved.load.status] ?? "In progress")}
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Picked up</dt>
            <dd>{arrivedPickup ? "Yes" : "Not yet"}</dd>
          </div>
          {remainingMiles != null && !arrivedDelivery && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Distance remaining</dt>
              <dd className="tabular-nums">~{remainingMiles.toLocaleString()} mi</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Last update</dt>
            <dd className="tabular-nums">
              {position ? formatDateTime(position.recorded_at) : "Awaiting first update"}
            </dd>
          </div>
        </dl>
      </section>

      {/* The map goes here. It is NOT built: Mapbox GL needs a public token this
          project does not have, and it also needs api.mapbox.com and
          events.mapbox.com added to connect-src plus worker-src blob: in
          src/lib/security-headers.ts — without which it fails silently under
          the CSP. Everything above works today without it. */}

      <p className="text-xs text-muted-foreground">
        Positions are reported by the driver&apos;s device and can lag by a few minutes or pause
        where there is no signal.
      </p>
    </div>
  );
}

// Local copy rather than importing the tracking helper: this page is public and
// has no business pulling in the geofence module's other exports.
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(lat1)) * Math.cos(toRad(lat2));
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
