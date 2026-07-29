// Sweep msgplane's "Booked Orders" report, one day at a time, into
// msgplane_bookings (migration 0044).
//
// The report is the only bulk view of which orders were signed: the signed fact
// otherwise lives in a per-record ticket, and the Tickets module is access-
// denied for our login. It takes a single date — a range throws a PHP error —
// and msgplane serialises requests from one session (PHP session file locking),
// so concurrency buys nothing and this runs at roughly one day per second.
//
// Resumable: days already present in the table are skipped, so an interrupted
// run is restarted by running it again.
//
// AUTH — AND WHY THIS SCRIPT DOES NOT CURRENTLY WORK.
//
// It reads a msgplane PHPSESSID from --cookie-file and replays it with
// Sec-Fetch-Mode: navigate. Tried on 2026-07-29: msgplane returns the login
// page (2,060 bytes) every time. PHPSESSID is the only cookie JavaScript can
// see, so there are HttpOnly cookies in the real session that cannot be copied
// out, and the session is not portable.
//
// The sweep therefore runs INSIDE the browser instead — a same-origin fetch
// loop on a logged-in msgplane tab, posting batches to
// ingest_msgplane_bookings (migration 0045). This file is kept because the
// parser and the resume logic are the same, and because msgplane may one day
// be reachable with a proper API credential; run it and read the error before
// assuming a cookie will do.
//
// DRY RUN unless --apply.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire("C:/Users/User/car-hauling-tms/package.json");
const { createClient } = require("@supabase/supabase-js");

const ROOT = "C:/Users/User/car-hauling-tms";
const env = {};
for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

const APPLY = process.argv.includes("--apply");
const COOKIE_FILE = arg("cookie-file", `${process.env.TEMP || "."}/msgplane-session.txt`);
const FROM = arg("from", "2022-01-01");
const TO = arg("to", new Date().toISOString().slice(0, 10));
const BASE = "https://usst.msgplane.com";

const cookie = readFileSync(COOKIE_FILE, "utf8").trim();
if (!/^PHPSESSID=/.test(cookie)) throw new Error(`${COOKIE_FILE} does not hold a PHPSESSID`);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const pad = (n) => String(n).padStart(2, "0");
const days = [];
for (let d = new Date(`${FROM}T00:00:00Z`); d <= new Date(`${TO}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  days.push({
    iso: d.toISOString().slice(0, 10),
    us: `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`,
  });
}

// Skip days already swept.
const seen = new Set();
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from("msgplane_bookings").select("booked_on").range(f, f + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  for (const r of data) seen.add(r.booked_on);
  if (data.length < 1000) break;
}
const todo = days.filter((d) => !seen.has(d.iso));
console.log(`${days.length} days in range, ${seen.size} already swept, ${todo.length} to fetch`);
if (!todo.length) process.exit(0);

// The report is grouped by rep:
//   Khorezm Team - Andrew Kane( Andrew )   31543169-US 31542449-US ...   3
const ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function parse(html, iso) {
  const out = [];
  for (const m of html.matchAll(ROW)) {
    const text = strip(m[1]);
    const orders = text.match(/\d{8}-?US/g);
    if (!orders) continue;
    // "<team> - <Name>( login )" — team prefix is optional.
    const who = text.match(/(?:^|\|)?\s*([^()|]{2,60}?)\(\s*([^)]{1,40}?)\s*\)/);
    const repName = who ? who[1].replace(/^.*?-\s*/, "").trim() : null;
    const repLogin = who ? who[2].trim() : null;
    for (const o of new Set(orders)) {
      out.push({ order_number: o, booked_on: iso, rep_name: repName, rep_login: repLogin });
    }
  }
  return out;
}

let fetched = 0, rows = 0, failures = 0;
const started = Date.now();
let buffer = [];

const flush = async () => {
  if (!buffer.length) return;
  if (APPLY) {
    const { error } = await db
      .from("msgplane_bookings")
      .upsert(buffer, { onConflict: "order_number,booked_on", ignoreDuplicates: true });
    if (error) console.log(`  insert failed: ${error.message}`);
  }
  rows += buffer.length;
  buffer = [];
};

for (const day of todo) {
  const url =
    `${BASE}/index.php?module=Reports&action=detailview&record=sales&yes=yes` +
    `&filter_date=${encodeURIComponent(day.us)}&submit=Run`;
  let html;
  try {
    const r = await fetch(url, {
      headers: {
        Cookie: cookie,
        // msgplane serves only top-level navigations; a plain fetch is refused.
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(30_000),
    });
    html = await r.text();
  } catch (e) {
    failures++;
    if (failures > 20) throw new Error(`giving up after 20 failures: ${e.message}`);
    continue;
  }
  // A dead session returns the login page, not an empty report. Writing those
  // as "no bookings that day" would silently blank out real history.
  if (/name=["']?password|Log\s?in/i.test(html) && !/Booked Orders/i.test(html)) {
    throw new Error(`session expired at ${day.iso} — log in again and re-run; swept days are kept`);
  }
  buffer.push(...parse(html, day.iso));
  fetched++;
  if (buffer.length >= 400) await flush();
  if (fetched % 50 === 0) {
    const rate = fetched / ((Date.now() - started) / 1000);
    const left = Math.round((todo.length - fetched) / Math.max(rate, 0.01) / 60);
    console.log(`  ${fetched}/${todo.length} days, ${rows + buffer.length} bookings, ~${left} min left`);
  }
}
await flush();

console.log(`\nfetched ${fetched} days, ${failures} failures, ${rows} bookings ${APPLY ? "written" : "(dry run)"}`);
if (!APPLY) console.log("(dry run — pass --apply to write)");
