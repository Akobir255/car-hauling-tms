// Defects 1 + 2: cod_to_carrier never written; carrier_pay overridden by a guess.
// Source of truth: msgplane-payments-dates.json (the order's Payments & Dates band).
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

const money = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const core = (n) => (String(n).match(/^(\d{8})/) || [])[1];

const pay = JSON.parse(readFileSync("C:/Users/User/Downloads/msgplane-payments-dates.json", "utf8"));
const payRows = Array.isArray(pay) ? pay : pay.rows || pay.records || pay.data || [];

const loads = await page("loads", "id, load_number, status, customer_rate, deposit_amount, carrier_pay, received_amount, carrier_received, cod_to_carrier");
const byCore = new Map();
for (const l of loads) { const c = core(l.load_number); if (c) byCore.set(c, l); }

const updates = [];
const stats = { matched: 0, noLoad: 0, cod: 0, codSum: 0, carrierPay: 0, received: 0, carrierReceived: 0 };
const examples = [];
for (const r of payRows) {
  const l = byCore.get(core(r.order));
  if (!l) { stats.noLoad++; continue; }
  stats.matched++;
  const f = r.f || {};
  const patch = {};

  const cod = money(f["COD to Carrier"]);
  if (cod !== null && l.cod_to_carrier === null) { patch.cod_to_carrier = cod; stats.cod++; stats.codSum += cod; }

  // carrier_pay: the export value is the FACT. Where the DB disagrees it is
  // the importer's tariff-minus-deposit guess having overwritten it.
  const cp = money(f["Carrier Pay"]);
  if (cp !== null && Number(l.carrier_pay) !== cp) {
    patch.carrier_pay = cp;
    stats.carrierPay++;
    if (examples.length < 6) examples.push(`${l.load_number}: carrier_pay db=${l.carrier_pay} -> export=${cp} (tariff=${l.customer_rate} deposit=${l.deposit_amount})`);
  }

  const rec = money(f["Received"]);
  if (rec !== null && l.received_amount === null) { patch.received_amount = rec; stats.received++; }
  const crec = money(f["Carrier received"]);
  if (crec !== null && l.carrier_received === null) { patch.carrier_received = crec; stats.carrierReceived++; }

  if (Object.keys(patch).length) updates.push({ id: l.id, load_number: l.load_number, patch });
}

console.log(`export rows ${payRows.length} | matched to a load ${stats.matched} | no load ${stats.noLoad}`);
console.log(`\ncod_to_carrier to write : ${stats.cod}  ($${stats.codSum.toLocaleString()})`);
console.log(`carrier_pay corrections : ${stats.carrierPay}`);
console.log(`received_amount fills   : ${stats.received}`);
console.log(`carrier_received fills  : ${stats.carrierReceived}`);
console.log(`rows to update          : ${updates.length}`);
console.log("\ncarrier_pay examples:");
examples.forEach((e) => console.log("  " + e));

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }
let ok = 0;
for (const u of updates) {
  const { error } = await db.from("loads").update(u.patch).eq("id", u.id);
  if (error) console.log("  FAIL", u.load_number, error.message);
  else ok++;
}
console.log(`\nupdated ${ok}/${updates.length}`);
