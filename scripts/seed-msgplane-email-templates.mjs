// One-shot import of the msgplane EMAIL template library (captured live from
// msgplane's email composer on 2026-07-26) into message_templates.
//
// msgplane renders templates server-side, so what the composer shows is
// already filled in for the sample record. Variables were reverse-mapped:
//   "Leo Carter" -> {{agent}}, "Jane"/"Jane sarphie" -> {{first_name}}/{{name}},
//   "32053901-US" -> {{load_number}}, "2017 toyota RAV4 Hybrid" -> {{vehicle}},
//   "$1280" -> {{quote_price}}, pickup/delivery cities -> {{pickup_city}} /
//   {{delivery_city}} (and {{route}} where both appear together).
//
// Their originals are table-heavy HTML wrapped in a branded shell with links
// back to msgplane-hosted pages. We keep US Star's WORDS and structure but
// send them through our own plain-text -> clean-HTML renderer, so nothing
// points at msgplane and the emails stay readable on phones. Purely
// duplicate templates (three near-identical "Initial Quote" variants, two
// stub/test rows) are collapsed or skipped.
//
// Idempotent: skips any template whose name already exists.
//   node scripts/seed-msgplane-email-templates.mjs
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

// The quote-details block every quote email repeats.
const QUOTE_DETAILS = `Quote ID: {{load_number}}

Customer: {{name}}
Pickup: {{pickup_city}}
Delivery: {{delivery_city}}
Vehicle: {{vehicle}}
Total: {{quote_price}}

Please check the details above and let us know right away if anything needs correcting.`;

const SIGNATURE = `Sincerely,
{{agent}}
US Star Trucking LLC
(865) 312-6670
9111 Cross Park Dr D200 #1013, Knoxville, TN 37923`;

const T = (name, subject, body) => ({ name, channel: "email", subject, body });

const TEMPLATES = [
  T(
    "Initial Quote",
    "Auto Shipping Quote {{load_number}}",
    `Hi {{first_name}},

Here is the personalized auto shipping quote you requested — our team is committed to top-notch service for your vehicle.

${QUOTE_DETAILS}

Pickup and delivery process: the driver and/or dispatcher will notify you of the pickup time at least a day in advance, and will call ahead before arriving. Door-to-door service, fully insured.

Ready to book? Reply to this email or call {{agent}} directly.

${SIGNATURE}`
  ),
  T(
    "Exclusive Quote (Book Now)",
    "{{name}} Exclusive Auto Shipping Quote: Book Now for an Unbeatable Deal!",
    `Hi {{first_name}},

We hope this message finds you well! As promised, here is your personalized auto shipping quote to make your move seamless and stress-free.

${QUOTE_DETAILS}

Our team is committed to providing top-notch service for your vehicle, from pickup through delivery.

${SIGNATURE}`
  ),
  T(
    "Quote Follow-up: Limited Time",
    "Exclusive Auto Shipping Quote - Limited Time Offer! {{load_number}}",
    `Hi {{first_name}},

Following up on the quote we prepared for you — it's still available and ready to book.

${QUOTE_DETAILS}

Reply to this email or call {{agent}} and we'll get your vehicle scheduled.

${SIGNATURE}`
  ),
  T(
    "Quote Follow-up: Left Message",
    "Auto Shipping Quote {{load_number}}",
    `Hi {{first_name}},

I tried reaching you by phone and left a message. Here's your quote again for reference.

${QUOTE_DETAILS}

Give me a call back whenever it's convenient and we'll get you scheduled.

${SIGNATURE}`
  ),
  T(
    "Quote Follow-up: Spoke To You",
    "Auto Shipping Quote {{load_number}}",
    `Hi {{first_name}},

Great speaking with you. As discussed, here's your quote in writing.

${QUOTE_DETAILS}

Just reply or call when you're ready to book.

${SIGNATURE}`
  ),
  T(
    "Your Quote — Let's Go",
    "Your Quote — Let's GO",
    `HELLO {{first_name}}!

Your personalized quote to transport your {{vehicle}} is ready.

Summary for quote {{load_number}}
Order ID: {{load_number}}
Pick up: {{pickup_city}}
Delivery: {{delivery_city}}
Vehicle: {{vehicle}}
Type of service: door-to-door
Your total: {{quote_price}}

Please verify all of the information above is accurate before booking.

Please call to book your order — {{agent}}, (865) 312-6670.

${SIGNATURE}`
  ),
  T(
    "Discounted Quote (Quality Policy)",
    "Discounted Auto shipping quote {{load_number}}",
    `Hey {{first_name}},

Thank you for requesting a quote with US Star Trucking — we would love to work with you on getting your vehicle transported. We understand that your vehicle is valuable to you, so our company motto is "Quality Service is the Key to Any Successful Business."

Our quality customer service policy:
- Honesty is our priority
- Our customers always come first
- Our customers can reach us any time, 7 days a week
- We answer any missed calls and emails within the hour

${QUOTE_DETAILS}

${SIGNATURE}`
  ),
  T(
    "Care Free Auto Transportation (Last Touch)",
    "Care Free Auto Transportation",
    `Hi {{first_name}}!

I'm reaching out one last time. If you still need any assistance with your vehicle shipping needs, feel free to give me a call back at (865) 312-6670.

We have drivers on your route three times a week who are ready to pick up your vehicle, and we're trusted by 76,000 car shippers nationwide.

Reply anytime for an updated quote or to check on pickup dates.

${SIGNATURE}
Hours: Mon-Fri 8:30 AM - 8 PM`
  ),
  T(
    "Alaska Shipping Quote",
    "Alaska auto shipping quote {{load_number}}",
    `Hi {{first_name}},

Here is the quote you requested for your Alaska vehicle shipment.

${QUOTE_DETAILS}

Service note: door-to-port service, after tax of export. An agent will notify you of the pickup time at least a week in advance, and in door-to-port service the driver calls about 2 hours before pickup. This quote includes full tax of export and port-to-port service, with insurance.

Documents needed by email: license plate number and VIN.

${SIGNATURE}`
  ),
  T(
    "Hawaii Shipping Quote",
    "Hawaii auto shipping order form",
    `Hi {{first_name}},

Here is the quote you requested for your Hawaii vehicle shipment.

${QUOTE_DETAILS}

Service note: door-to-port service, after tax of export. An agent will notify you of the pickup time at least a week in advance, and the driver calls about 2 hours before pickup. Includes full tax of export and port-to-port service, with insurance.

Documents needed by email: license plate number and VIN.

${SIGNATURE}`
  ),
  T(
    "Order Confirmation",
    "Car Shipping Order Placed",
    `Hi {{first_name}},

Your car shipping order is placed. Here are the details on file:

${QUOTE_DETAILS}

Pickup and delivery process: the driver and/or dispatcher will notify you of the pickup time in advance and call ahead before arriving.

${SIGNATURE}`
  ),
  T(
    "Non-signers Reminder",
    "Your transport agreement is waiting",
    `Hello, this is {{agent}} from US Star Trucking LLC.

You made arrangements regarding your vehicle shipment — are you still in need of service? If yes, please sign the contract we sent to your email address and we'll get your vehicle moving.

${SIGNATURE}`
  ),
  T(
    "Order Dispatched Notification",
    "Vehicle Dispatched",
    `Dear {{name}},

We want to let you know that we have dispatched your {{vehicle}} and you should be hearing from the driver soon to schedule the pickup.

If you have any questions, don't hesitate to call us at (865) 312-6670.

${SIGNATURE}`
  ),
  T(
    "Dispatch Sheet Attached",
    "Auto Shipping Dispatch Sheet",
    `Dear {{name}},

The attached dispatch sheet contains detailed information about order {{load_number}} — your {{vehicle}} to be picked up in {{pickup_city}} and delivered to {{delivery_city}}.

At your earliest convenience, please sign and return the dispatch sheet per the instructions on the sheet. Don't hesitate to contact us with any questions.

${SIGNATURE}`
  ),
  T(
    "Payment Received",
    "Payment received",
    `Dear {{name}},

We have received your payment. Thank you very much for your business.

${SIGNATURE}`
  ),
  T(
    "Order Receipt",
    "Order Receipt — {{load_number}}",
    `Order receipt for vehicle transport — order {{load_number}}

Thank you for the opportunity to serve your automobile transport needs. Please review the information below and contact us immediately with any corrections.

Shipper: {{name}}
Pickup: {{pickup_city}}
Delivery: {{delivery_city}}
Vehicle: {{vehicle}}
Price quote: {{quote_price}}

Salesperson: {{agent}}
Phone: (865) 312-6670

${SIGNATURE}`
  ),
  T(
    "Shipper Invoice",
    "Auto Shipping Shipper Invoice",
    `INVOICE — US Star Trucking LLC
9111 Cross Park Dr D200 #1013, Knoxville, TN 37923

Customer: {{name}}
Order ID: {{load_number}}
Vehicle: {{vehicle}}
Pickup: {{pickup_city}}
Delivery: {{delivery_city}}

Total tariff: {{quote_price}}

Thank you for your business. US Star Trucking has auto shipping specialists ready to answer any of your automobile transport questions. We do NOT require you to sign a long-term contract, and there are NO cancellation fees. Call us at (865) 312-6670.

${SIGNATURE}`
  ),
  T(
    "Delivered — Review Request",
    "Thanks for shipping with us — how did we do?",
    `Hello, this is {{agent}} with US Star Trucking LLC.

Your vehicle has been delivered — thank you for your business! If we served you well, a quick review helps our small team a lot. Please mention my name in your review.

${SIGNATURE}`
  ),
  T(
    "Thank You (After Delivery)",
    "Thank you",
    `Dear {{name}},

Thank you for giving us the opportunity to transport your vehicle. We sincerely hope we've served you well and that you'll consider recommending us to your friends and family.

If you have any questions or future transportation needs, don't hesitate to call us at (865) 312-6670.

We're here from 8am to 5pm and look forward to serving you again.

${SIGNATURE}`
  ),
  T(
    "Repeat Customer / Referral Offer",
    "{{first_name}}, a discount on your next shipment",
    `Hi {{first_name}},

As a valued customer, enjoy a discount on repeat car shipments — and earn $50 for every referral you send our way.

Kindly contact {{agent}} at (865) 312-6670 whenever you're ready.

${SIGNATURE}`
  ),
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
  console.log("Nothing to do — all email templates already present.");
  process.exit(0);
}
const { error } = await admin
  .from("message_templates")
  .insert(fresh.map((t) => ({ ...t, created_by: leo.id })));
if (error) throw error;
console.log(`Inserted ${fresh.length} email templates (${have.size} rows already existed).`);
