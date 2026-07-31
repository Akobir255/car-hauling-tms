// What have we historically quoted on this lane?
//
// Server-side only, like every other data route here: the caller sends two
// state codes, and gets back a median and a band. It never returns a load, a
// customer, a load number or a date — migration 0057 publishes a lane only at
// ten or more loads, so the smallest thing this endpoint can describe is an
// aggregate over ten.
//
// That matters more than usual right now: the history behind these numbers is
// the 25,867 HIDDEN loads. The floor is what makes reading them safe.

import type { NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/flags";
import { pickLane, toSuggestion, type LaneStat } from "@/lib/pricing/lanes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE = /^[A-Za-z]{2}$/;

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!(await isFeatureEnabled("lane_pricing"))) {
    return Response.json({ error: "NOT_ENABLED" }, { status: 503 });
  }

  const q = req.nextUrl.searchParams;
  const from = (q.get("from") || "").trim();
  const to = (q.get("to") || "").trim();
  if (!STATE.test(from) || !STATE.test(to)) {
    return Response.json({ error: "BAD_STATE" }, { status: 400 });
  }

  // Read as the CALLER, not the service role. lane_price_stats carries no
  // customer data, but routing an aggregate through the admin client is how a
  // "harmless" endpoint becomes the next leak.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lane_price_stats")
    .select("origin_state,destination_state,vehicle_class,transport,n_quoted,p25,median,p75,n_won,n_lost")
    .eq("origin_state", from.toUpperCase())
    .eq("destination_state", to.toUpperCase());

  if (error) {
    console.error("lane pricing lookup failed:", error.message);
    return Response.json({ error: "LOOKUP_FAILED" }, { status: 500 });
  }

  const asked = {
    vehicleClass: q.get("vehicle") || undefined,
    transport: q.get("transport") || undefined,
  };
  const suggestion = toSuggestion(
    pickLane((data ?? []) as LaneStat[], { originState: from, destState: to, ...asked }),
    asked
  );

  // 200 with a null body, not 404: "we have no history on this lane" is an
  // answer, and the caller renders it differently from a failure.
  return Response.json({ suggestion });
}
