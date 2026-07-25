// Email setup checker + test sender.
//
//   node scripts/email-setup.mjs                 → check config, list Resend domains
//   node scripts/email-setup.mjs you@email.com   → also send one real test email
//
// Reads RESEND_API_KEY / EMAIL_FROM from .env.local. Nothing is written; the
// key never leaves this machine.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const KEY = env.RESEND_API_KEY;
const FROM = env.EMAIL_FROM;
const to = process.argv[2];

const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => console.log(`  ✗ ${s}`);

console.log("\nEmail configuration");
if (!KEY) {
  bad("RESEND_API_KEY missing from .env.local");
} else {
  ok(`RESEND_API_KEY present (${KEY.slice(0, 3)}…${KEY.slice(-4)})`);
}
if (!FROM) bad("EMAIL_FROM missing from .env.local");
else ok(`EMAIL_FROM = ${FROM}`);
if (!KEY || !FROM) {
  console.log("\nBlasts will log as 'queued' until both are set.\n");
  process.exit(1);
}

// Which domains are verified on the account? A blast from an unverified
// domain is the #1 cause of silent spam-filing.
const res = await fetch("https://api.resend.com/domains", {
  headers: { Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  bad(`Resend rejected the key (${res.status}): ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const { data: domains = [] } = await res.json();
console.log("\nDomains on this Resend account");
if (domains.length === 0) bad("none — add one in Resend and verify its DNS records");
for (const d of domains) {
  const line = `${d.name} — ${d.status}`;
  d.status === "verified" ? ok(line) : bad(line);
}

// Does EMAIL_FROM actually use a verified domain?
const fromDomain = (FROM.match(/@([^>\s]+)/) ?? [])[1]?.toLowerCase();
const match = domains.find((d) => d.name.toLowerCase() === fromDomain);
console.log("");
if (!match) bad(`EMAIL_FROM uses @${fromDomain}, which is not on this account`);
else if (match.status !== "verified") bad(`@${fromDomain} is ${match.status}, not verified yet`);
else ok(`EMAIL_FROM domain @${fromDomain} is verified — ready to send`);

if (!to) {
  console.log("\nPass an address to send a live test:  node scripts/email-setup.mjs you@email.com\n");
  process.exit(0);
}

console.log(`\nSending a test email to ${to}…`);
const send = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: FROM,
    to: [to],
    subject: "US Star TMS — email test",
    text: "This is a test from the TMS. If you're reading it, email blasts are working.",
  }),
});
const body = await send.json();
if (send.ok) ok(`sent (id ${body.id}) — check the inbox, and the spam folder`);
else bad(`failed (${send.status}): ${JSON.stringify(body).slice(0, 300)}`);
console.log("");
