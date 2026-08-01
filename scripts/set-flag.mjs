// Manual feature-flag switch. Phases deploy DARK and get turned on by a human,
// deliberately — so this script must NEVER be wired into a scheduler, a deploy
// hook, or CI. An operator runs it, reads the output, and owns the flip.
//
//   node scripts/set-flag.mjs <key> on|off
//
// Writes feature_flags with the service role (the table has no authenticated
// write policy — deliberate) and prints previous -> new state, so a no-op flip
// and a real one look different.

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Reads .env.local itself, same as backup.mjs — no wrapper and no secrets on
// the command line.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(repoRoot, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// The four flags that exist (FeatureKey in src/lib/flags.ts). An unknown key
// is refused rather than upserted: a typo that silently creates a fifth row
// looks exactly like a flip that took.
const KNOWN_FLAGS = ["gps_tracking", "ai_intake", "lane_pricing", "exception_engine"];

const [key, state] = process.argv.slice(2);
if (!KNOWN_FLAGS.includes(key) || !["on", "off"].includes(state)) {
  console.error("Usage: node scripts/set-flag.mjs <key> on|off");
  console.error(`Keys: ${KNOWN_FLAGS.join(", ")}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: before, error: readError } = await db
  .from("feature_flags")
  .select("enabled, updated_at")
  .eq("key", key)
  .maybeSingle();
if (readError) {
  console.error(`Read failed: ${readError.message}`);
  process.exit(1);
}
if (!before) {
  // Known to the app but missing from the table: the migration that seeds the
  // row has not been applied. Refuse rather than insert — seeding is the
  // migration's job, and isFeatureEnabled treats a missing row as OFF anyway.
  console.error(`"${key}" is not in feature_flags — has its migration been applied?`);
  process.exit(1);
}

const { data: after, error: writeError } = await db
  .from("feature_flags")
  .update({ enabled: state === "on", updated_at: new Date().toISOString() })
  .eq("key", key)
  .select("enabled, updated_at")
  .single();
if (writeError) {
  console.error(`Update failed: ${writeError.message}`);
  process.exit(1);
}

const word = (enabled) => (enabled ? "ON" : "OFF");
console.log(
  `${key}: ${word(before.enabled)} (since ${before.updated_at}) -> ${word(after.enabled)}`
);
