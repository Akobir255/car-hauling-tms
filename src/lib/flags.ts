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

export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle();
    // Unknown flag or a failed read means OFF. A feature flag that fails open
    // is not a feature flag.
    if (error || !data) return false;
    return Boolean(data.enabled);
  } catch {
    return false;
  }
}
