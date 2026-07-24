// ZIP -> { city, state } via OpenRouteService geocoding, keeping ORS_KEY on the
// server. Same provider as the marketing site's /api/citystate. Requires a
// signed-in staff session; degrades to 503 when ORS_KEY isn't set.

import type { NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORS_KEY = (process.env.ORS_KEY || "").trim();

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!ORS_KEY) return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });

  const zip = (req.nextUrl.searchParams.get("zip") || "").trim();
  if (!/^\d{5}$/.test(zip)) return Response.json({ error: "BAD_ZIP" }, { status: 400 });

  try {
    // Key goes in the header, not the URL — query strings end up in logs.
    const r = await fetch(
      `https://api.openrouteservice.org/geocode/search?text=${zip}&boundary.country=USA&size=1`,
      { headers: { Authorization: ORS_KEY }, signal: AbortSignal.timeout(5000) }
    );
    const d = await r.json();
    const p = d.features?.[0]?.properties;
    if (!p) return Response.json({ city: null, state: null });
    return Response.json({
      city: p.locality || p.county || "",
      state: p.region_a || p.region || "",
    });
  } catch (err) {
    console.error("[geo/citystate]", err);
    return Response.json({ city: null, state: null });
  }
}
