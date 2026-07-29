// Defect 1: carrier_pay. The importer fell back to (tariff - deposit) whenever
// it could not find a real figure, and wrote the guess into the same column as
// imported fact. msgplane prints the real number in every list row as
// "Carrier:$N", so that is the source of truth.
// DRY RUN unless --apply.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
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
const money = (s) => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// Real carrier figure per load, from the list row text.
const carrierFromList = new Map();
for (const f of readdirSync("C:/Users/User/Downloads/").filter((f) => /^msgplane-.*\.json$/.test(f))) {
  let j;
  try { j = JSON.parse(readFileSync("C:/Users/User/Downloads/" + f, "utf8")); } catch { continue; }
  const rows = j.records || (Array.isArray(j) ? j : j.rows || j.data || []);
  if (!Array.isArray(rows)) continue;
  for (const r of rows) {
    const c = core(r.load_number || r.order || r.id);
    const txt = r.row_text || "";
    if (!c || !txt) continue;
    const m = String(txt).match(/Carrier:\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
    if (m && !carrierFromList.has(c)) carrierFromList.set(c, money(m[1]));
  }
}
console.log("loads with a real Carrier:$ figure in the export:", carrierFromList.size);

const loads = await page("loads", "id, load_number, status, customer_rate, deposit_amount, carrier_pay");
let corrected = 0, agree = 0, noSource = 0, noSourceOrders = 0;
const updates = [];
const examples = [];
const noSourceByStatus = new Map();
for (const l of loads) {
  const c = core(l.load_number);
  const real = c ? carrierFromList.get(c) : undefined;
  if (real === undefined) {
    noSource++;
    noSourceByStatus.set(l.status, (noSourceByStatus.get(l.status) || 0) + 1);
    if (l.status !== "quote" && l.status !== "cancelled") noSourceOrders++;
    continue;
  }
  if (Number(l.carrier_pay) === real) { agree++; continue; }
  corrected++;
  updates.push({ id: l.id, load_number: l.load_number, from: l.carrier_pay, to: real });
  if (examples.length < 8) {
    examples.push(`${l.load_number} (${l.status}): db=$${l.carrier_pay} -> export=$${real}  [tariff ${l.customer_rate} - deposit ${l.deposit_amount} = ${Number(l.customer_rate) - Number(l.deposit_amount || 0)}]`);
  }
}
console.log(`\nagree with export       : ${agree}`);
console.log(`WRONG, will correct     : ${corrected}`);
console.log(`no export source at all : ${noSource}  (of which not quote/cancelled: ${noSourceOrders})`);
console.log("no-source by status:", JSON.stringify([...noSourceByStatus].sort((a, b) => b[1] - a[1])));
console.log("\nexamples of the correction:");
examples.forEach((e) => console.log("  " + e));
const delta = updates.reduce((a, u) => a + Math.abs(Number(u.to) - Number(u.from || 0)), 0);
console.log(`\ntotal absolute error being corrected: $${delta.toLocaleString()}`);

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }
let ok = 0;
for (let i = 0; i < updates.length; i++) {
  const u = updates[i];
  const { error } = await db.from("loads").update({ carrier_pay: u.to }).eq("id", u.id);
  if (error) console.log("  FAIL", u.load_number, error.message);
  else ok++;
}
console.log(`\ncorrected ${ok}/${updates.length}`);
