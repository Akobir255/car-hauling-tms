// Suggested quote for a lane: geocode both ZIPs, route for driving miles, then
// apply calculateQuote. Lower-48 ground only (the ocean/AK/HI logic on the
// marketing site is customer-facing; agents price those manually). Returns a
// SUGGESTION — the UI shows it but never fills the rate field.

import type { NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { calculateQuote } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORS_KEY = (process.env.ORS_KEY || "").trim();

type Geo = { coords: [number, number]; city: string; state: string };

async function geocode(zip: string): Promise<Geo | null> {
  const r = await fetch(
    `https://api.openrouteservice.org/geocode/search?api_key=${ORS_KEY}&text=${zip}&boundary.country=USA&size=1`
  );
  const d = await r.json();
  const f = d.features?.[0];
  if (!f) return null;
  return {
    coords: f.geometry.coordinates,
    city: f.properties.locality || f.properties.county || "",
    state: f.properties.region_a || f.properties.region || "",
  };
}

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!ORS_KEY) return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();
  const vehicleType = (sp.get("type") || "sedan").trim();
  const condition = (sp.get("condition") || "running").trim();
  const transport = (sp.get("transport") || "open").trim();

  if (!/^\d{5}$/.test(from) || !/^\d{5}$/.test(to)) {
    return Response.json({ error: "BAD_ZIP" }, { status: 400 });
  }

  try {
    const [origin, dest] = await Promise.all([geocode(from), geocode(to)]);
    if (!origin || !dest) return Response.json({ error: "GEOCODE_FAILED" }, { status: 422 });

    const routeRes = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ORS_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [origin.coords, dest.coords], radiuses: [-1, -1] }),
      }
    );
    const rd = await routeRes.json();
    const summary = rd.routes?.[0]?.summary;
    if (!summary) return Response.json({ error: "NO_ROUTE" }, { status: 422 });

    const miles = Math.round(summary.distance * 0.000621371);
    const price = calculateQuote({ miles, vehicleType, condition, transport });

    return Response.json({
      miles,
      price,
      originCity: origin.city,
      originState: origin.state,
      destCity: dest.city,
      destState: dest.state,
    });
  } catch (err) {
    console.error("[geo/quote]", err);
    return Response.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
