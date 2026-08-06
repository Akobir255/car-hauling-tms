import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/flags";
import { resolveTrackingToken } from "@/lib/tracking/tokens";
import { formatDateTime } from "@/lib/format";
import { formatBusinessDateTime, getRoadEta } from "@/lib/tracking/eta";
import { TrackingMap, type TrackFix } from "@/components/tracking/tracking-map";
import { AutoRefresh } from "@/components/tracking/auto-refresh";

// The customer's tracking page (Phase 2). Read-only, no login.
//
// WHAT THIS PAGE MUST NOT CONTAIN, per the brief and per common sense: carrier
// names, rates, margin, or anyone's contact details. A shipper who can see the
// carrier can call them directly next time, and the tariff is nobody's business
// but the party who agreed it. Nothing below selects those columns at all —
// redaction by not fetching, rather than by remembering not to render.

export const dynamic = "force-dynamic";

// Reached from a text message, never from a search. If one of these URLs is
// pasted somewhere a crawler can see it, the token stops being unguessable.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

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

  const [{ data: trailRows }, { data: fences }, { data: stops }] = await Promise.all([
    admin
      .from("shipment_locations")
      .select("id, lat, lng, recorded_at")
      .eq("load_id", loadId)
      .order("recorded_at", { ascending: false })
      .limit(200),
    admin.from("load_geofences").select("kind, lat, lng").eq("load_id", loadId),
    admin
      .from("geofence_events")
      .select("fence, transition, occurred_at")
      .eq("load_id", loadId)
      .order("occurred_at", { ascending: true }),
  ]);

  // Oldest→newest for the trail; the newest fix is the position of record.
  const trail = ((trailRows ?? []) as TrackFix[]).slice().reverse();
  const position = trail[trail.length - 1] ?? null;

  // The miles figure is straight-line and rounded — a "how far away" answer,
  // not an ETA — and it is labeled as such below. It is the FALLBACK now: when
  // ORS answers, the road figure and an arrival estimate stand in for it.
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
  // ANY delivery-fence event means the truck reached the destination — the
  // departure event (which auto-revokes the driver link) is gated behind
  // arrival in the ingest route, but checking both costs nothing and a page
  // that says "in transit" after the car is off the truck is the failure mode.
  const deliveryStops = (stops ?? []).filter((s) => s.fence === "delivery");
  const atDelivery = deliveryStops.length > 0;
  const deliveredAt =
    deliveryStops.find((s) => s.transition === "arrived")?.occurred_at ??
    deliveryStops[0]?.occurred_at ??
    null;

  // Road distance + ETA, strictly best-effort (null on any failure, cached per
  // fix for ~30 min in the lib). Never asked for once the truck has reached the
  // delivery fence — an ETA on a delivered car is noise, and skipping the call
  // entirely is cheaper than suppressing the render. Only miles and a time ever
  // reach this page: the lib drops the route geometry at parse time, so there
  // is nothing here to leak beyond what the straight-line figure already said.
  const eta =
    !atDelivery && position && delivery
      ? await getRoadEta({ loadId, fix: position, delivery })
      : null;

  return (
    <div className="mx-auto max-w-lg space-y-6 p-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Order</p>
        <h1 className="text-2xl font-bold tabular-nums">{resolved.load.load_number}</h1>
      </header>

      <section className="rounded-md border p-5">
        <p className="text-sm text-muted-foreground">Status</p>
        <p className="text-xl font-bold">
          {atDelivery
            ? "Delivered"
            : (STATUS_WORDS[resolved.load.status] ?? "In progress")}
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Picked up</dt>
            <dd>{arrivedPickup ? "Yes" : "Not yet"}</dd>
          </div>
          {/* The truck has arrived: say when, and imply no further movement —
              no distance, no ETA. The arrival stamp is fence data, not an
              address, so nothing redacted above becomes visible here. */}
          {atDelivery && deliveredAt && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Arrived</dt>
              <dd className="tabular-nums">{formatBusinessDateTime(deliveredAt)}</dd>
            </div>
          )}
          {eta && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Distance by road</dt>
                <dd className="tabular-nums">~{eta.roadMiles.toLocaleString()} mi</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Estimated arrival</dt>
                <dd className="tabular-nums">{formatBusinessDateTime(eta.etaAt)}</dd>
              </div>
            </>
          )}
          {/* Straight-line stays as the fallback when ORS had no answer. */}
          {!eta && remainingMiles != null && !atDelivery && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Straight-line distance</dt>
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

      {/* Trail + last position only. NO fence circles here on purpose: this
          page names the stops as city/state, and a 500m circle centred on the
          pickup is the pickup ADDRESS with one extra step — drawing it would
          undo the redaction the queries above maintain. Leaflet over
          tile.openstreetmap.org, both already allowed by the CSP. */}
      {trail.length > 0 && <TrackingMap fixes={trail} />}

      {/* No realtime channel for an anonymous visitor — a periodic server
          re-render keeps the page current through the same redacted queries. */}
      <AutoRefresh intervalMs={60_000} />

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
