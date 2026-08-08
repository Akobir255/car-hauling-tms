// Register a lead generator that may POST to /api/webhooks/leads/<key>.
//
//   node scripts/add-lead-source.mjs <key> "<Display Name>"
//   node scripts/add-lead-source.mjs <key> --deactivate
//   node scripts/add-lead-source.mjs --list
//
// On create it prints the shared token ONCE. We store only its SHA-256 hash,
// so the token cannot be read back -- if it is lost, rotate by running create
// again, which mints a new token and overwrites the hash. Give the provider
// the key, the token, and the URL; the token goes in an `X-Lead-Token` header
// (or `Authorization: Bearer <token>`).
//
// Writes with the service role. Like set-flag.mjs, a human runs this and owns
// the result -- never wire it into CI or a deploy.

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(repoRoot, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://your-app").replace(/\/$/, "");

const [arg1, arg2] = process.argv.slice(2);

async function list() {
  const { data, error } = await db
    .from("lead_sources")
    .select("key, name, active, created_at")
    .order("created_at");
  if (error) throw error;
  if (!data.length) {
    console.log("No lead sources registered yet.");
    return;
  }
  console.log("\nLead sources:");
  for (const s of data) {
    console.log(`  ${s.active ? "●" : "○"} ${s.key.padEnd(20)} ${s.name}${s.active ? "" : "  (inactive)"}`);
  }
  console.log("\n● active   ○ inactive\n");
}

async function deactivate(key) {
  const { data, error } = await db
    .from("lead_sources")
    .update({ active: false })
    .eq("key", key)
    .select("key")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    console.error(`No source with key "${key}".`);
    process.exit(1);
  }
  console.log(`Deactivated "${key}". Its posts now get 404 until reactivated.`);
}

async function upsert(key, name) {
  // One token, shown once. 32 random bytes, hex -- long enough that the rate
  // limit never has to be the thing standing between a guesser and the door.
  const token = randomBytes(32).toString("hex");

  const { error } = await db.from("lead_sources").upsert(
    { key, name, secret_hash: sha256(token), active: true },
    { onConflict: "key" }
  );
  if (error) throw error;

  console.log(`\n  Lead source "${name}" is live.\n`);
  console.log("  Give the provider these three values:\n");
  console.log(`    URL     ${appUrl}/api/webhooks/leads/${key}`);
  console.log(`    Header  X-Lead-Token: ${token}`);
  console.log(`    Method  POST, application/json\n`);
  console.log("  The token is shown ONCE and is not stored in the clear.");
  console.log("  Lost it? Run this same command again to mint a new one.\n");
}

function validKey(k) {
  return /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(k);
}

try {
  if (arg1 === "--list") {
    await list();
  } else if (arg2 === "--deactivate") {
    await deactivate(arg1);
  } else if (arg1 && arg2) {
    if (!validKey(arg1)) {
      console.error(`Invalid key "${arg1}". Use lowercase letters, digits and hyphens (e.g. "montway", "ship-a-car").`);
      process.exit(1);
    }
    await upsert(arg1, arg2);
  } else {
    console.log("Usage:");
    console.log('  node scripts/add-lead-source.mjs <key> "<Display Name>"   register or rotate');
    console.log("  node scripts/add-lead-source.mjs <key> --deactivate       turn off");
    console.log("  node scripts/add-lead-source.mjs --list                   show all");
    process.exit(1);
  }
} catch (err) {
  console.error("Failed:", err.message || err);
  process.exit(1);
}
