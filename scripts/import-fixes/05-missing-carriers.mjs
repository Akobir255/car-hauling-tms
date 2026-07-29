// The 18 dispatched/delivered orders whose hauler was swept from msgplane but
// had no row in the carrier directory, so carrier_id stayed NULL and the order
// showed "—" where msgplane shows a company and a phone.
//
// These are carriers US Star demonstrably gave loads to — the name and number
// come from msgplane's own Dispatched / Issues / Picked-Up lists — so the
// directory rows are created from that, marked with source 'msgplane-import'
// so nobody mistakes them for vetted entries with MC and DOT numbers on file.
//
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
const page = async (t, cols) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from(t).select(cols).range(f, f + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};
const core = (n) => (String(n).match(/^(\d{8})/) || [])[1];
const digits = (p) => (p || "").replace(/\D/g, "").slice(-10);
const norm = (s) =>
  (s || "").toLowerCase().replace(/[.,'"()&]/g, " ")
    .replace(/\b(llc|inc|corp|corporation|co|ltd|company|transport|trucking|logistics)\b/g, " ")
    .replace(/\s+/g, " ").trim();

const sweep = JSON.parse(readFileSync("C:/Users/User/Downloads/msgplane-order-carriers.json", "utf8"));
const pairs = [];
for (const rows of Object.values(sweep)) {
  for (const r of rows) {
    const [n, name, phone] = String(r).split("~");
    if (n && name) pairs.push({ core: core(n), load_number: n, name: name.trim(), phone: digits(phone) });
  }
}

const carriers = await page("carriers", "id, company_name, phone");
const byPhone = new Map(), byName = new Map();
for (const c of carriers) {
  const d = digits(c.phone);
  if (d.length === 10 && !byPhone.has(d)) byPhone.set(d, c);
  const k = norm(c.company_name);
  if (k && !byName.has(k)) byName.set(k, c);
}
const loads = await page("loads", "id, load_number, status, carrier_id");
const loadByCore = new Map();
for (const l of loads) { const c = core(l.load_number); if (c) loadByCore.set(c, l); }

const toCreate = new Map(); // normalised name -> {name, phone, loads:[]}
const toLink = [];
let already = 0, noLoad = 0;
for (const p of pairs) {
  const l = loadByCore.get(p.core);
  if (!l) { noLoad++; continue; }
  const match = (p.phone.length === 10 ? byPhone.get(p.phone) : null) || byName.get(norm(p.name));
  if (match) {
    if (l.carrier_id === match.id) already++;
    else toLink.push({ loadId: l.id, load_number: l.load_number, carrierId: match.id, carrier: match.company_name });
    continue;
  }
  const key = norm(p.name) || p.name.toLowerCase();
  if (!toCreate.has(key)) toCreate.set(key, { name: p.name, phone: p.phone, loads: [] });
  toCreate.get(key).loads.push({ id: l.id, load_number: l.load_number, status: l.status });
}

console.log(`swept pairs ${pairs.length} | already linked ${already} | relink ${toLink.length} | no load ${noLoad}`);
console.log(`\ncarriers to create: ${toCreate.size}`);
for (const [, c] of toCreate) {
  console.log(`  ${c.name.padEnd(34)} ${c.phone || "(no phone)"}  -> ${c.loads.map((l) => `${l.load_number}[${l.status}]`).join(", ")}`);
}

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }
let created = 0, linked = 0;
for (const [, c] of toCreate) {
  const { data: row, error } = await db
    .from("carriers")
    .insert({ company_name: c.name, phone: c.phone || null, source: "msgplane-import" })
    .select("id")
    .single();
  if (error || !row) { console.log("  create FAIL", c.name, error?.message); continue; }
  created++;
  for (const l of c.loads) {
    const { error: e2 } = await db.from("loads").update({ carrier_id: row.id }).eq("id", l.id);
    if (e2) console.log("  link FAIL", l.load_number, e2.message); else linked++;
  }
}
for (const t of toLink) {
  const { error } = await db.from("loads").update({ carrier_id: t.carrierId }).eq("id", t.loadId);
  if (error) console.log("  link FAIL", t.load_number, error.message); else linked++;
}
console.log(`\ncreated ${created} carriers, linked ${linked} loads`);
