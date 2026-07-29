// Defect 3: 2,160 notes never imported — the orders-sweep and detail-sweep
// note panels were never backfilled, so 344 orders have none of theirs.
// Joins on the 8-digit core, which is what the corrupted load numbers broke.
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

const tzOffsetMin = (utcMs) => {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).format(new Date(utcMs));
  const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  return m ? Number(m[1]) * 60 + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) : 0) : -300;
};
const toIso = (date, time) => {
  const [mm, dd, yyyy] = date.split("/").map(Number);
  const t = time.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!t) return null;
  let h = Number(t[1]) % 12;
  if (/PM/i.test(t[3])) h += 12;
  const naive = Date.UTC(yyyy, mm - 1, dd, h, Number(t[2]));
  return new Date(naive - tzOffsetMin(naive) * 60_000).toISOString();
};

// Each entry of detail.__notes is ONE note, already plain text:
//   "07/24/2026 12:45 PM Leo Carter remove edit <body>"
// Parsing the stringified record instead matches note-shaped text anywhere in
// the JSON and welds syntax onto the body — which is what the first attempt
// did, and why it claimed 5,481 notes none of which matched the 4,018 already
// imported.
const ONE_NOTE = /^\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(.*?)\s+remove\s+edit\s+([\s\S]*)$/i;
function parseNote(entry) {
  const text = String(entry).replace(/\s+/g, " ").trim();
  const m = text.match(ONE_NOTE);
  if (!m) return null;
  const body = m[4].trim();
  return body ? { date: m[1], time: m[2], author: m[3].trim(), body } : null;
}

function notesOf(record) {
  const buckets = [record?.detail?.__notes, record?.fields?.__notes, record?.__notes];
  const out = [];
  for (const b of buckets) {
    if (!Array.isArray(b)) continue;
    for (const e of b) {
      const n = parseNote(e);
      if (n) out.push(n);
    }
  }
  return out;
}

const found = new Map(); // core -> notes[]
let recordsWithNotes = 0;
for (const f of ["msgplane-orders-sweep.json", "msgplane-detail-sweep.json"]) {
  let j;
  try { j = JSON.parse(readFileSync("C:/Users/User/Downloads/" + f, "utf8")); } catch { continue; }
  const rows = Array.isArray(j) ? j : j.rows || j.records || j.data || [];
  for (const r of rows) {
    const c = core(r.order || r.load_number || r.id);
    if (!c) continue;
    const notes = notesOf(r);
    if (!notes.length) continue;
    recordsWithNotes++;
    const prev = found.get(c) || [];
    for (const n of notes) if (!prev.some((p) => p.body === n.body && p.date === n.date && p.time === n.time)) prev.push(n);
    found.set(c, prev);
  }
}
console.log(`records carrying a __notes array: ${recordsWithNotes}`);
console.log(`loads with notes in the sweeps: ${found.size}`);
console.log(`notes parsed: ${[...found.values()].reduce((a, b) => a + b.length, 0)}`);

const loads = await page("loads", "id, load_number, status");
const idByCore = new Map();
for (const l of loads) { const c = core(l.load_number); if (c) idByCore.set(c, l); }
const existing = await page("load_notes", "load_id, body, created_at");
const seen = new Set(existing.map((n) => `${n.load_id}|${(n.body || "").trim()}|${n.created_at?.slice(0, 16)}`));

const rows = [];
let noLoad = 0, dupe = 0, badDate = 0;
const byStatus = new Map();
for (const [c, notes] of found) {
  const l = idByCore.get(c);
  if (!l) { noLoad++; continue; }
  for (const n of notes) {
    const created = toIso(n.date, n.time);
    if (!created) { badDate++; continue; }
    const key = `${l.id}|${n.body}|${created.slice(0, 16)}`;
    if (seen.has(key)) { dupe++; continue; }
    seen.add(key);
    byStatus.set(l.status, (byStatus.get(l.status) || 0) + 1);
    rows.push({ load_id: l.id, body: n.body, imported_author: n.author || null, author_id: null, created_at: created, updated_at: created });
  }
}
console.log(`\nto insert : ${rows.length}`);
console.log(`already in: ${dupe}`);
console.log(`no load   : ${noLoad}`);
console.log(`bad date  : ${badDate}`);
console.log("by load status:", JSON.stringify([...byStatus].sort((a, b) => b[1] - a[1])));
if (rows[0]) console.log("sample:", JSON.stringify({ ...rows[0], body: rows[0].body.slice(0, 70) }));

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }
let ok = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const { error } = await db.from("load_notes").insert(chunk);
  if (error) console.log("  FAIL chunk", i, error.message);
  else ok += chunk.length;
}
console.log(`\ninserted ${ok}/${rows.length}`);
