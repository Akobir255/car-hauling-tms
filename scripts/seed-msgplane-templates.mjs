// One-shot import of the msgplane SMS template library (captured live from
// usst.msgplane.com's composer on 2026-07-26) into message_templates.
// Variables were reverse-mapped from the rendered sample record:
//   "Leo Carter" -> {{agent}}, "Jane" -> {{first_name}},
//   "2017 toyota RAV4 Hybrid" -> {{vehicle}}, "1280 USD" -> {{quote_price}},
//   "from Farragut TN to Rancho Cucamonga CA" -> {{route}},
//   "near Farragut TN" -> {{pickup_city}}.
// Their "signature link" template is intentionally skipped — our E-Sign
// panel sends per-order signing links itself.
// Idempotent: skips any template whose name already exists.
//   node scripts/seed-msgplane-templates.mjs
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

const T = (name, body) => ({ name, channel: "sms", subject: null, body });

const TEMPLATES = [
  T("Act Fast", "Ready to book Im available for the next 30 mins Reply YES for offers STOP to opt out"),
  T("After All Of Them", "US Star Trucking LLC Need car shipping Affordable insured door to door service Contact {{agent}} Reply YES for offers STOP to opt out"),
  T("After a Phone Call", "I updated your quote for a better rate and will send your driver status soon Thanks for your patience STOP to opt out"),
  T("Afternoon Update", "Hi it is {{agent}} your transporter Still planning to ship your vehicle No upfront payment driver in 48 hrs no hidden fees Reply YES for offers STOP to opt out"),
  T("All Of Them", "US Star Trucking LLC Need car shipping Call {{agent}} for a quote or booking Reply YES for offers STOP to opt out"),
  T("Old Follow-ups (Brian)", "Hi {{agent}} with US Star Trucking LLC We quoted your car shipment before Rates are low now Need shipping Reply YES for offers STOP to opt out"),
  T("Day 1", "Hi {{agent}} with US Star Trucking LLC Need car shipping Insured door to door service Reply YES for offers STOP to opt out"),
  T("Day 2", "Hi {{agent}} with US Star Trucking LLC Need reliable car shipping YES for offers STOP to opt out"),
  T("Day 3", "Is {{quote_price}} a good rate for your shipment Call or text {{agent}} Reply YES for offers STOP to opt out"),
  T("Day 4", "Hi {{agent}} with US Star Trucking LLC Your quote is still available Ready to book or have questions YES for offers STOP to opt out"),
  T("Day 5", "Hi {{agent}} with US Star Trucking LLC Still need car shipping Reply YES for offers STOP to opt out"),
  T("Day 6", "Hi {{agent}} with US Star Trucking LLC Last chance to lock in your quote Ready to book or have questions YES for offers STOP to opt out"),
  T("Evening Message", "US Star Trucking can ship your {{vehicle}} for {{quote_price}} No upfront fee Pickup as soon as tomorrow Reply YES for offers STOP to opt out"),
  T("Evening Text", "Hi need car shipping US Star Trucking LLC offers insured door to door service Contact {{agent}} Reply YES for offers STOP to opt out"),
  T("Friday Text", "We are available weekends Ready to ship We can arrange pickup today tomorrow or your preferred date Reply YES for offers STOP to opt out"),
  T("Getting Addresses (Manual)", "Please send pickup and delivery addresses plus contact names and numbers I ll email the contract for e signature and start your shipment once signed {{agent}} 8657227114"),
  T("Quote Ready (Harry Style)", "Hi {{first_name}} your quote is ready {{vehicle}} {{quote_price}} ETA 5 days Call or text to book YES for offers STOP to opt out"),
  T("Kay Day 1", "Hi {{agent}} with US Star Trucking LLC Need to ship your car We offer low rates and no upfront fee Reply YES for offers STOP to opt out"),
  T("Morning Message", "Need your car shipped Insured carriers Pickup and delivery updates No upfront fee {{agent}} 8657227114 YES for offers STOP to opt out"),
  T("New Quotes Update", "Hi this is {{agent}} with US Star Trucking I sent your quote by email What date would you like to ship Call or text {{agent}} Reply YES for offers STOP to opt out"),
  T("Old Follow-ups", "US Star Trucking Insured door-to-door car shipping No hidden fees Get a free quote Call {{agent}} 8657227114 Reply YES for offers STOP to opt out"),
  T("Order Finalizing Details 5", "Hi {{first_name}} {{agent}} here We are close to assigning your carrier and will send details soon YES for updates STOP to opt out"),
  T("Order Ongoing Update 4", "Hi {{first_name}} {{agent}} with US Star Trucking LLC We are finding the best carrier for your shipment and will update you soon Thanks for your patience"),
  T("Order Progress Update 2", "Hi {{first_name}} {{agent}} with US Star Trucking LLC We are making progress finding your carrier and will update you soon Thanks for your patience"),
  T("Order Status Check-In 3", "Hi {{first_name}} {{agent}} with US Star Trucking LLC We are finalizing your carrier Everything is on track and we will update you soon Thanks for your patience"),
  T("Order Update 1", "Hi {{agent}} here with an update we are still securing your carrier and will notify you once a driver is assigned"),
  T("Order Update 1 (Kay)", "Hi {{first_name}} {{agent}} with US Star Trucking LLC We are working to secure your carrier and will update you soon Thanks for your patience"),
  T("Order Update 2", "Hi {{agent}} here your shipment coordinator Call or text this number with any questions Reply YES for updates STOP to opt out"),
  T("Price Offering", "{{agent}} with US Star Trucking LLC Ship your vehicle for {{quote_price}} total Door to door insured 100 lb luggage included Reply YES for offers STOP to opt out"),
  T("Quote Cancel Win-back", "Hi {{first_name}} need another car shipped We still offer insured transport with no upfront fee Reply YES for offers or STOP to opt out"),
  T("Repeat Customer Discount", "Hi {{first_name}} thanks for choosing us You have a 50 USD discount on your next shipment Contact {{agent}} YES for offers STOP to opt out"),
  T("Quote Follow-up (Text 1 Edited)", "Hi {{first_name}} your quote for {{route}} is {{quote_price}} Still interested YES for offers STOP to opt out"),
  T("Quote With Vehicle (Text 1 Manual)", "Hi {{first_name}} {{agent}} with US Star Trucking We can ship your {{vehicle}} for {{quote_price}} total Door to door insured 100 lb luggage included Reply YES for offers STOP to opt out"),
  T("Carrier Available Follow-up", "Carrier available near {{pickup_city}} for your {{vehicle}} Ready to ship Reply YES for offers STOP to opt out"),
];

const { data: leo } = await admin
  .from("profiles")
  .select("id")
  .eq("email", "leo@usstrucking.org")
  .single();
if (!leo) throw new Error("Leo's profile not found");

const { data: existing } = await admin.from("message_templates").select("name");
const have = new Set((existing ?? []).map((t) => t.name));

const fresh = TEMPLATES.filter((t) => !have.has(t.name));
if (fresh.length === 0) {
  console.log("Nothing to do — all templates already present.");
  process.exit(0);
}
const { error } = await admin
  .from("message_templates")
  .insert(fresh.map((t) => ({ ...t, created_by: leo.id })));
if (error) throw error;
console.log(`Inserted ${fresh.length} templates (${have.size} already existed).`);
