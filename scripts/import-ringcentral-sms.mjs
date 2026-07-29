// Pull the RingCentral SMS message store and file it against our shippers.
//
// RingCentral is the COMPLETE record: it sees texts sent from the old system
// AND texts a rep sent straight from the RingCentral app, which msgplane never
// logged. It is also shallow — the store holds a rolling 7 days, and every
// older window returns zero (the archive API and the account-level store are
// both 404 on this plan). So this is written to run DAILY: each pass takes
// whatever is in the window and adds what we have not seen, and after a month
// of running the 30-day question is answerable from a source that misses
// nothing. Run it any less often than weekly and there will be holes.
//
// Idempotent: messages carry the RingCentral id as provider_message_id, and
// migration 0013's unique index on (direction, provider_message_id) is the
// backstop. Re-running is free.
//
// last_sms_at is NOT written here — the trigger from 0043 does it, and only for
// statuses that actually reached somebody.
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
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const APPLY = process.argv.includes("--apply");
const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 8);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const digits = (p) => (p || "").replace(/\D/g, "").slice(-10);

// RingCentral's vocabulary -> ours. Anything that did not reach the handset is
// 'failed', so 0043's trigger will not stamp it as contact.
const STATUS = {
  Delivered: "delivered",
  Received: "delivered",
  Sent: "sent",
  Queued: "queued",
  SendingFailed: "failed",
  DeliveryFailed: "failed",
};

async function ringcentral() {
  const SERVER = (env.RINGCENTRAL_SERVER_URL || "https://platform.ringcentral.com").trim();
  const tok = await fetch(`${SERVER}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${env.RINGCENTRAL_CLIENT_ID}:${env.RINGCENTRAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: env.RINGCENTRAL_JWT,
    }),
  });
  if (!tok.ok) throw new Error(`RingCentral auth ${tok.status}: ${(await tok.text()).slice(0, 200)}`);
  const { access_token } = await tok.json();

  // dateFrom is REQUIRED: omit it and RingCentral quietly defaults to the last
  // 24 hours, which looks like a successful pull that silently loses six days.
  const from = new Date(Date.now() - DAYS * 86400000).toISOString();
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(
      `${SERVER}/restapi/v1.0/account/~/extension/~/message-store` +
        `?messageType=SMS&dateFrom=${from}&perPage=1000&page=${page}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!r.ok) throw new Error(`message-store page ${page}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const recs = j.records || [];
    all.push(...recs);
    if (recs.length < 1000) break;
    await new Promise((s) => setTimeout(s, 400)); // stay inside the rate limit
  }
  return all;
}

const page = async (table, cols, tweak = (q) => q) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await tweak(db.from(table).select(cols)).order("id").range(f, f + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

const records = await ringcentral();
console.log(`RingCentral returned ${records.length} SMS over the last ${DAYS} days`);
if (!records.length) process.exit(0);
const times = records.map((r) => r.creationTime).sort();
console.log(`  window: ${times[0]} .. ${times[times.length - 1]}`);

const customers = await page("customers", "id, phone");
const byPhone = new Map();
for (const c of customers) {
  const d = digits(c.phone);
  if (d.length === 10 && !byPhone.has(d)) byPhone.set(d, c.id);
}
console.log(`  shippers with a usable phone: ${byPhone.size} of ${customers.length}`);

const existing = new Set(
  (await page("messages", "provider_message_id, direction", (q) => q.not("provider_message_id", "is", null)))
    .map((m) => `${m.direction}:${m.provider_message_id}`)
);
console.log(`  already held: ${existing.size} provider ids`);

const rows = [];
let unmatched = 0, skipped = 0;
for (const r of records) {
  const direction = r.direction === "Inbound" ? "inbound" : "outbound";
  const key = `${direction}:${r.id}`;
  if (existing.has(key)) { skipped++; continue; }
  // Outbound: the shipper is the recipient. Inbound: the sender.
  const counterpart =
    direction === "outbound" ? digits((r.to || [])[0]?.phoneNumber) : digits(r.from?.phoneNumber);
  const customerId = byPhone.get(counterpart) ?? null;
  if (!customerId) unmatched++;
  rows.push({
    customer_id: customerId,
    channel: "sms",
    direction,
    from_addr: r.from?.phoneNumber ?? null,
    to_addr: (r.to || [])[0]?.phoneNumber ?? null,
    body: r.subject || "",
    provider_message_id: String(r.id),
    status: STATUS[r.messageStatus] ?? "sent",
    created_at: r.creationTime,
    // Historical inbound is not news — leaving it unread would drop 440 fake
    // notifications on the team the moment this lands.
    read_at: direction === "inbound" ? r.creationTime : null,
  });
}

const tally = {};
for (const r of rows) tally[`${r.direction}/${r.status}`] = (tally[`${r.direction}/${r.status}`] ?? 0) + 1;
console.log(`\nto insert: ${rows.length}   already held: ${skipped}   no matching shipper: ${unmatched}`);
console.log("  by direction/status:", tally);

const willStamp = new Set(
  rows.filter((r) => r.direction === "outbound" && r.customer_id && ["sent", "delivered"].includes(r.status))
      .map((r) => r.customer_id)
);
const wouldHaveStamped = new Set(
  rows.filter((r) => r.direction === "outbound" && r.customer_id).map((r) => r.customer_id)
);
console.log(`\nshippers that will get a last-texted stamp: ${willStamp.size}`);
console.log(`  (stamping every attempt regardless of outcome would have marked ${wouldHaveStamped.size},`);
console.log(`   wrongly hiding ${wouldHaveStamped.size - willStamp.size} whose only texts failed)`);

if (!APPLY) {
  console.log("\n(dry run — pass --apply to write)");
  process.exit(0);
}

let inserted = 0;
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  const { error } = await db.from("messages").insert(chunk);
  if (error) {
    console.log(`  batch ${i / 500 + 1} FAILED: ${error.message}`);
    continue;
  }
  inserted += chunk.length;
  process.stdout.write(`  inserted ${inserted}/${rows.length}\r`);
}
console.log(`\ninserted ${inserted} messages`);

const { count: stamped } = await db
  .from("customers")
  .select("id", { count: "exact", head: true })
  .not("last_sms_at", "is", null);
console.log(`shippers now carrying last_sms_at: ${stamped}`);
