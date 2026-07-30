import { createAdminClient } from "@/lib/supabase/admin";
import { addressText, geocodeUS } from "@/lib/geo/geocode";

// Geofence centres are resolved LAZILY — when a load first gets a tracking
// link, not for the whole book. There are ~26,000 loads and only the handful
// currently on a truck can produce a geofence event, so backfilling every one
// would be tens of thousands of ORS calls to answer a question nobody asked.
//
// Called from the staff action that issues a driver link, deliberately NOT from
// the ingest route: geocoding is a network round trip to a third party, and the
// thing on the other end of that route is a phone in a moving truck.

export async function ensureLoadGeofences(
  loadId: string
): Promise<{ created: number; missing: ("pickup" | "delivery")[] }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("load_geofences")
    .select("kind")
    .eq("load_id", loadId);
  const have = new Set((existing ?? []).map((r) => r.kind as string));
  if (have.has("pickup") && have.has("delivery")) return { created: 0, missing: [] };

  const { data: load } = await admin
    .from("loads")
    .select(
      "id, pickup_address, pickup_city, pickup_state, pickup_zip, delivery_address, delivery_city, delivery_state, delivery_zip"
    )
    .eq("id", loadId)
    .maybeSingle();
  if (!load) return { created: 0, missing: ["pickup", "delivery"] };

  const targets: { kind: "pickup" | "delivery"; text: string }[] = [];
  if (!have.has("pickup")) {
    targets.push({
      kind: "pickup",
      text: addressText({
        address: load.pickup_address,
        city: load.pickup_city,
        state: load.pickup_state,
        zip: load.pickup_zip,
      }),
    });
  }
  if (!have.has("delivery")) {
    targets.push({
      kind: "delivery",
      text: addressText({
        address: load.delivery_address,
        city: load.delivery_city,
        state: load.delivery_state,
        zip: load.delivery_zip,
      }),
    });
  }

  const rows: Record<string, unknown>[] = [];
  const missing: ("pickup" | "delivery")[] = [];
  for (const t of targets) {
    const point = t.text ? await geocodeUS(t.text) : null;
    if (!point) {
      // A load whose address is "— 9225" (the import left a few like that)
      // simply gets no fence. Tracking still works; arrival just is not
      // detected, and the dispatcher sees the position on the map regardless.
      missing.push(t.kind);
      continue;
    }
    rows.push({
      load_id: loadId,
      kind: t.kind,
      lat: point.lat,
      lng: point.lng,
      geocoded_from: t.text,
    });
  }

  if (rows.length) {
    // Racing two link issues for the same load is possible; the unique index on
    // (load_id, kind) is what settles it, so a conflict is not an error here.
    await admin.from("load_geofences").upsert(rows, { onConflict: "load_id,kind", ignoreDuplicates: true });
  }
  return { created: rows.length, missing };
}
