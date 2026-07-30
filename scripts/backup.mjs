// Nightly off-site backup of the DATA.
//
// Supabase reports pitr_enabled:false and an empty backups list for this
// project, which means there is nothing to restore from if the database is
// lost or somebody runs a bad delete. The schema is safe — it is the
// migrations in this repo — so what has to be captured is the rows.
//
// Writes one gzipped JSON file per table into a dated folder, plus a
// manifest.json with row counts so a restore can be checked rather than
// assumed. Reads with the service role, so RLS does not silently truncate the
// backup to what one user can see.
//
//   node scripts/backup.mjs [--out DIR] [--keep N]
//
// Restore = apply the migrations to an empty project, then insert the rows
// back in the order below (parents before children).

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Reads .env.local itself so a scheduler can call this directly, with no
// wrapper and no secrets on the command line.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(repoRoot, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Parent tables first: this is also the order a restore must insert in.
const TABLES = [
  "profiles",
  "customers",
  "carriers",
  "loads",
  "load_vehicles",
  "load_notes",
  "load_requests",
  // 0049: the event spine, and the base TABLE — not the load_status_history
  // view that now sits over it. Backing up the view would capture only status
  // events, drop event_type/source/payload, and restore through an INSTEAD OF
  // trigger that renumbers every id. This file is the only disaster-recovery
  // copy this project has.
  "load_events",
  "documents",
  "messages",
  "message_templates",
  "contract_versions",
  "contract_events",
  "contract_cards",
  "invoices",
  "payouts",
  "reviews",
  "tickets",
  "ticket_comments",
  "sms_suppressions",
  "webhook_events",
];

const args = process.argv.slice(2);
const outRoot = args.includes("--out") ? args[args.indexOf("--out") + 1] : "C:/Users/User/tms-backups";
const keep = args.includes("--keep") ? Number(args[args.indexOf("--keep") + 1]) : 14;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(outRoot, stamp);
mkdirSync(dir, { recursive: true });

const manifest = { startedAt: new Date().toISOString(), tables: {}, errors: [] };

for (const table of TABLES) {
  const rows = [];
  let failed = null;
  // PostgREST caps a response at 1000 rows, so a backup that does not page is
  // a backup that quietly keeps the first thousand.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").range(from, from + 999);
    if (error) {
      failed = error.message;
      break;
    }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  if (failed) {
    manifest.errors.push(`${table}: ${failed}`);
    console.log(`  ${table.padEnd(22)} FAILED — ${failed}`);
    continue;
  }
  writeFileSync(join(dir, `${table}.json.gz`), gzipSync(JSON.stringify(rows)));
  manifest.tables[table] = rows.length;
  console.log(`  ${table.padEnd(22)} ${String(rows.length).padStart(7)} rows`);
}

manifest.finishedAt = new Date().toISOString();
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));

// A backup that fails silently is worse than none, so say so loudly and exit
// non-zero — a scheduler can then alarm on it.
if (manifest.errors.length) {
  console.error(`\nBACKUP INCOMPLETE — ${manifest.errors.length} table(s) failed. See manifest.json`);
}
console.log(`\n${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows -> ${dir}`);

// Retention: keep the last N dated folders.
if (existsSync(outRoot)) {
  const folders = readdirSync(outRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d.name))
    .map((d) => d.name)
    .sort();
  for (const old of folders.slice(0, Math.max(0, folders.length - keep))) {
    rmSync(join(outRoot, old), { recursive: true, force: true });
    console.log(`pruned ${old}`);
  }
}

process.exit(manifest.errors.length ? 1 : 0);
