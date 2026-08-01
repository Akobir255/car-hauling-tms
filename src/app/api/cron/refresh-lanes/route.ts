import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily rebuild of lane_price_stats (vercel.json crons). Until this existed the
// refresh was a manual `select refresh_lane_price_stats();` nobody would
// remember to run, so the published medians would quietly age.
//
// Auth model: no user session. When CRON_SECRET is set in Vercel, its cron
// invocations carry `Authorization: Bearer <CRON_SECRET>`; anything else is
// turned away. The RPC itself is service-role-only (0057 revokes EXECUTE from
// authenticated), so the admin client here is the established pattern for this
// path, not a bypass — and the function's own >=10 HAVING floor is what keeps
// every published row a safe aggregate. Running while lane_pricing is dark is
// fine: the flag gates the readers, not the table.
//
// NOTE: this path must be listed in SELF_AUTHENTICATING_PREFIXES in
// src/lib/supabase/proxy.ts ("/api/cron") or the session middleware 307s the
// cron's cookie-less request to /login and the refresh silently never runs —
// the same trap /api/track documents there.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerMatches(header: string | null, secret: string): boolean {
  const provided = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // No secret configured means nothing can authenticate — fail closed, and say
  // so distinctly from a bad token so the deploy problem is diagnosable.
  if (!secret) {
    return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { data, error } = await createAdminClient().rpc("refresh_lane_price_stats");
  if (error) {
    console.error("lane stats refresh failed:", error.message);
    return Response.json({ error: "REFRESH_FAILED" }, { status: 500 });
  }

  // The function returns how many lane rows it published.
  return Response.json({ ok: true, lanes: data ?? 0 });
}
