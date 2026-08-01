import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

// Feature flags (migration 0050).
//
// The brief asks for a flag per brokerage per phase; there are no brokerages
// here, so this is per install. The point stands either way: a phase deploys
// DARK and gets turned on deliberately, rather than going live for everyone the
// moment a commit lands.
//
// Read with the service role because the callers include routes with no session
// at all (the driver PWA posts from a phone with no login). A flag is not a
// secret — it is one boolean about whether a feature exists.

export type FeatureKey =
  | "gps_tracking"
  | "ai_intake"
  | "lane_pricing"
  | "exception_engine";

// One PostgREST round trip per request, however many flags a page awaits.
// React's cache() memoizes per argument for the CURRENT server request only —
// so a flip still lands on the very next request — and dedupes only identical
// calls, which is why this fetches the whole table (four rows) instead of one
// key: per-key fetches would still be one round trip per distinct flag.
// Outside a render (route handlers) cache() just calls through uncached, which
// is the old behaviour.
const loadFlags = cache(async (): Promise<Record<string, boolean>> => {
  try {
    const { data, error } = await createAdminClient()
      .from("feature_flags")
      .select("key, enabled");
    // An empty map reads as every flag OFF — the failure mode we want.
    if (error || !data) return {};
    return Object.fromEntries(data.map((row) => [row.key, Boolean(row.enabled)]));
  } catch {
    return {};
  }
});

export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  // Unknown flag or a failed read means OFF. A feature flag that fails open
  // is not a feature flag.
  const flags = await loadFlags();
  return flags[key] ?? false;
}
