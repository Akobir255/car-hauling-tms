// Import US Star's carrier directory from a TSV export of the old system.
//   node scripts/import-carriers.mjs <path-to.tsv>
//
// Columns: type(cd|sd) name contact address city state phone
// Idempotent: matches on lower(company_name) + phone digits, so re-running
// updates blanks rather than creating duplicates. The old list legitimately
// holds the same company twice when it came from both loadboards with
// different contact details — those are kept, tagged by `source`.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(path.resolve(here, "../.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/import-carriers.mjs <path-to.tsv>");
  process.exit(1);
}

const digits = (v) => (v || "").replace(/\D/g, "");
const clean = (v) => {
  const t = (v || "").trim();
  return t && t !== "-" ? t : null;
};

// The contact column often carries a phone number and a name together
// ("929-278-5797 Richard", "Maria ‪(201) 430-5189‬"). Keep the name part as
// the contact and treat any number as a fallback phone.
function splitContact(raw) {
  const t = clean(raw);
  if (!t) return { name: null, phone: null };
  const phoneMatch = t.match(/[\d()+\-.‪‬ ]{7,}/);
  const phone = phoneMatch ? digits(phoneMatch[0]) : "";
  const name = t.replace(/[\d()+\-.‪‬]{7,}/g, "").replace(/\s{2,}/g, " ").trim();
  return { name: name || null, phone: phone.length >= 10 ? phone : null };
}

const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const header = lines.shift();
if (!/^type\tname/.test(header)) {
  console.error(`unexpected header: ${header.slice(0, 80)}`);
  process.exit(1);
}

const rows = [];
const seen = new Set();
for (const line of lines) {
  const [type, name, contact, address, city, state, phone] = line.split("\t");
  const company = clean(name);
  if (!company) continue;
  const c = splitContact(contact);
  const phoneDigits = digits(phone) || c.phone || null;
  const key = `${company.toLowerCase().replace(/[^a-z0-9]/g, "")}|${phoneDigits ?? ""}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({
    company_name: company,
    contact_name: c.name,
    phone: phoneDigits && phoneDigits.length >= 10 ? phoneDigits : null,
    address: clean(address),
    city: clean(city),
    state: clean(state),
    source: clean(type)?.toLowerCase() ?? null,
    notes: "Imported from the previous system",
  });
}

console.log(`parsed ${rows.length} unique carriers from ${lines.length} lines`);

// What's already there (by name+phone) so a re-run is a no-op.
const existingKeys = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from("carriers")
    .select("company_name, phone")
    .range(from, from + 999);
  if (error) throw error;
  for (const c of data ?? []) {
    existingKeys.add(
      `${(c.company_name || "").toLowerCase().replace(/[^a-z0-9]/g, "")}|${digits(c.phone) ?? ""}`
    );
  }
  if (!data || data.length < 1000) break;
}

const fresh = rows.filter(
  (r) =>
    !existingKeys.has(
      `${r.company_name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${r.phone ?? ""}`
    )
);
console.log(`${rows.length - fresh.length} already present, inserting ${fresh.length}`);

let inserted = 0;
for (let i = 0; i < fresh.length; i += 500) {
  const chunk = fresh.slice(i, i + 500);
  const { error } = await admin.from("carriers").insert(chunk);
  if (error) {
    console.error(`chunk at ${i} failed: ${error.message}`);
    process.exit(1);
  }
  inserted += chunk.length;
  process.stdout.write(`\r inserted ${inserted}/${fresh.length}`);
}
console.log(`\ndone — ${inserted} carriers imported`);
