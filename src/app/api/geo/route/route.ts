// Geocode origin/destination and return the drivable route (miles, hours,
// polyline) via OpenRouteService — replacing the browser's direct calls to
// Nominatim/OSRM, whose public servers throttle or block anonymous browser
// traffic (the "Couldn't locate the origin" failures). Same auth + key
// handling as the other /api/geo routes.

import type { NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORS_KEY = (process.env.ORS_KEY || "").trim();

// Returns [lon, lat] (ORS order) for a free-text US location.
async function geocodeText(text: string): Promise<[number, number] | null> {
  const r = await fetch(
    `https://api.openrouteservice.org/geocode/search?text=${encodeURIComponent(text)}&boundary.country=USA&size=1`,
    { headers: { Authorization: ORS_KEY }, signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  const c = d.features?.[0]?.geometry?.coordinates;
  return Array.isArray(c) ? [c[0], c[1]] : null;
}

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!ORS_KEY) return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  if (from.length < 2 || to.length < 2) {
    return Response.json({ error: "BAD_INPUT" }, { status: 400 });
  }

  try {
    const [origin, dest] = await Promise.all([geocodeText(from), geocodeText(to)]);
    if (!origin) return Response.json({ error: "ORIGIN_NOT_FOUND" }, { status: 422 });
    if (!dest) return Response.json({ error: "DEST_NOT_FOUND" }, { status: 422 });

    const r = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ORS_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [origin, dest], radiuses: [-1, -1] }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) return Response.json({ error: "NO_ROUTE" }, { status: 422 });
    const gj = await r.json();
    const feature = gj.features?.[0];
    const summary = feature?.properties?.summary;
    const lineCoords = feature?.geometry?.coordinates as [number, number][] | undefined;
    if (!summary || !lineCoords) return Response.json({ error: "NO_ROUTE" }, { status: 422 });

    return Response.json({
      miles: Math.round(summary.distance * 0.000621371),
      hours: summary.duration / 3600,
      // [lat, lon] pairs, ready for Leaflet.
      coords: lineCoords.map(([lon, lat]) => [lat, lon]),
    });
  } catch (err) {
    console.error("[geo/route]", err);
    return Response.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
