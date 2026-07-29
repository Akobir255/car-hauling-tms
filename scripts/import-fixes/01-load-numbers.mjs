// Defect 4: corrupted load_numbers + duplicate loads.
// DRY RUN unless --apply.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("C:/Users/User/car-hauling-tms/package.json");
const { createClient } = require("@supabase/supabase-js");
for (const line of readFileSync("C:/Users/User/car-hauling-tms/.env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const page = async (t, cols, apply = (q) => q) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await apply(db.from(t).select(cols)).range(f, f + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

const CORRUPT = /^(\d{8}-?US)(\d+)$/i;
const core = (n) => (String(n).match(/^(\d{8})/) || [])[1];

// Authoritative clean numbers where msgplane rendered them on a detail page.
const sweepNum = new Map();
for (const f of ["msgplane-orders-sweep.json", "msgplane-detail-sweep.json"]) {
  let j; try { j = JSON.parse(readFileSync("C:/Users/User/Downloads/" + f, "utf8")); } catch { continue; }
  const rows = Array.isArray(j) ? j : j.rows || j.records || j.data || [];
  for (const r of rows) {
    const n = r.order || r.load_number || r.id;
    const c = core(n);
    if (c && !CORRUPT.test(String(n)) && !sweepNum.has(c)) sweepNum.set(c, String(n).trim());
  }
}

const loads = await page("loads", "id, load_number, status, msgplane_status, created_at");
const notes = await page("load_notes", "id, load_id");
const vehicles = await page("load_vehicles", "id, load_id, year, make, model, vehicle_type, condition");
const hist = await page("load_status_history", "id, load_id");

const count = (rows) => { const m = new Map(); rows.forEach((r) => m.set(r.load_id, (m.get(r.load_id) || 0) + 1)); return m; };
const nBy = count(notes), hBy = count(hist);
const vBy = new Map();
vehicles.forEach((v) => { if (!vBy.has(v.load_id)) vBy.set(v.load_id, []); vBy.get(v.load_id).push(v); });

const byCore = new Map();
for (const l of loads) { const c = core(l.load_number); if (!c) continue; if (!byCore.has(c)) byCore.set(c, []); byCore.get(c).push(l); }

const renames = [];
const merges = [];
for (const [c, rows] of byCore) {
  const corrupt = rows.filter((r) => CORRUPT.test(r.load_number));
  if (!corrupt.length) continue;
  // Correct number: the sweep's if we have it, else the corrupt string minus
  // the welded digits — which preserves whether msgplane used a dash.
  const target = sweepNum.get(c) || corrupt[0].load_number.match(CORRUPT)[1];
  if (rows.length === 1) {
    renames.push({ id: corrupt[0].id, from: corrupt[0].load_number, to: target, status: corrupt[0].status });
    continue;
  }
  // Duplicate: keep whichever row actually holds the record's history.
  const score = (r) => (nBy.get(r.id) || 0) * 100 + (r.msgplane_status ? 10 : 0) + (hBy.get(r.id) || 0);
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  const keep = sorted[0], drop = sorted.slice(1);
  const sig = (v) => `${v.year}|${(v.make || "").toLowerCase()}|${(v.model || "").toLowerCase()}`;
  const keepSig = new Set((vBy.get(keep.id) || []).map(sig));
  const dropDetail = drop.map((d) => {
    const dv = vBy.get(d.id) || [];
    const uniqueVeh = dv.filter((v) => !keepSig.has(sig(v)));
    return { id: d.id, load_number: d.load_number, notes: nBy.get(d.id) || 0, veh: dv.length, uniqueVeh: uniqueVeh.length, vehList: dv.map(sig) };
  });
  merges.push({
    core: c, target,
    keep: { id: keep.id, load_number: keep.load_number, notes: nBy.get(keep.id) || 0, veh: (vBy.get(keep.id) || []).length, vehList: (vBy.get(keep.id) || []).map(sig) },
    drop: dropDetail,
  });
}

console.log(`renames (no twin): ${renames.length}`);
console.log(`merges (duplicate pairs): ${merges.length}\n`);
for (const m of merges) {
  console.log(`  ${m.core} -> ${m.target}`);
  console.log(`     KEEP  ${m.keep.load_number} notes=${m.keep.notes} veh=${m.keep.veh} [${m.keep.vehList.join(", ")}]`);
  for (const d of m.drop) {
    console.log(`     DROP  ${d.load_number} notes=${d.notes} veh=${d.veh} uniqueVeh=${d.uniqueVeh} [${d.vehList.join(", ")}]`);
  }
}
const risky = merges.filter((m) => m.drop.some((d) => d.notes > 0 || d.uniqueVeh > 0));
console.log(`\nmerges where the dropped row holds data the keeper lacks: ${risky.length}`);
if (risky.length) risky.forEach((m) => console.log("   !!", m.core, JSON.stringify(m.drop)));

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }
if (risky.length) { console.log("\nREFUSING to apply: a dropped row holds unique data. Resolve by hand."); process.exit(1); }

let renamed = 0, dropped = 0;
for (const m of merges) {
  for (const d of m.drop) {
    const { error } = await db.from("loads").delete().eq("id", d.id);
    if (error) { console.log("  delete FAIL", d.load_number, error.message); continue; }
    dropped++;
  }
  const { error } = await db.from("loads").update({ load_number: m.target }).eq("id", m.keep.id);
  if (error) console.log("  rename FAIL", m.keep.load_number, error.message); else renamed++;
}
for (const r of renames) {
  const { error } = await db.from("loads").update({ load_number: r.to }).eq("id", r.id);
  if (error) console.log("  rename FAIL", r.from, error.message); else renamed++;
}
console.log(`\nrenamed ${renamed}, deleted ${dropped} duplicate rows`);
