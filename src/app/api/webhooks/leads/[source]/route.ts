import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasContact, normalizeLead, type NormalizedLead } from "@/lib/leads/normalize";

// Inbound lead webhook: POST /api/webhooks/leads/<source>
//
// READ THIS BEFORE CHANGING ANYTHING HERE.
//
// src/proxy.ts returns early for every path under /api/webhooks, so NOTHING
// authenticates this request before it arrives. There is no session, no
// middleware check, no RLS in front of it -- the handler is the whole boundary,
// and it runs with the SERVICE ROLE. Every guard below is load-bearing:
//
//   * the shared secret, compared in constant time against a stored hash;
//   * fail-closed when a source is unknown or inactive, so deleting a row in
//     lead_sources actually revokes a provider;
//   * a body size cap, because the body is read before it is trusted;
//   * a rate limit, because the URL is guessable and the secret is not.
//
// It writes with the service role because that is the point: the provider has
// no account, and a lead has to become a row a rep can see. It only ever
// writes the four things a lead consists of -- a customer, a load at stage
// `lead`, its vehicle, and the attribution row -- and never touches a margin
// column. carrier_pay is not settable from the internet.

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

// Per-IP, in-process, same shape as the RingCentral webhook. Deliberately
// modest: a lead generator sending more than this a minute is malfunctioning,
// and the cap is what stops a guessed URL being hammered while the secret
// holds it shut anyway.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const rateWindow = new Map<string, { count: number; startedAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateWindow.get(ip);
  if (!entry || now - entry.startedAt > RATE_WINDOW_MS) {
    rateWindow.set(ip, { count: 1, startedAt: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Both sides are hex of a fixed length, so the length check leaks nothing and
// timingSafeEqual does the rest. Comparing the HASHES rather than the tokens
// means a wrong-length token cannot be distinguished by timing either.
function hashMatches(provided: string, expectedHash: string): boolean {
  const a = Buffer.from(sha256(provided));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Best-effort receipt log into the table 0007 already created for RingCentral.
// Never throws: a diagnostics failure must not cost us the lead.
async function logDelivery(
  supabase: SupabaseClient,
  source: string,
  row: { token_ok?: boolean | null; outcome: string; detail?: string | null; from_addr?: string | null; raw?: unknown }
) {
  try {
    const rawStr = row.raw != null ? JSON.stringify(row.raw).slice(0, 4000) : null;
    await supabase.from("webhook_events").insert({
      source: `lead:${source}`.slice(0, 100),
      token_ok: row.token_ok ?? null,
      event_type: "lead",
      direction: "Inbound",
      from_addr: row.from_addr ?? null,
      outcome: row.outcome,
      detail: row.detail ?? null,
      raw: rawStr ? JSON.parse(rawStr) : null,
    });
  } catch (err) {
    console.error("lead webhook_events log failed:", err);
  }
}

// Match an existing customer before making another one. `phone_digits` is the
// generated column from 0017 and is what the rest of the app dedupes on;
// email is the fallback for the web-form providers that collect no phone.
// Hidden rows are excluded deliberately -- 0052 hid the old book, and matching
// a new lead onto a hidden record would attach live work to an invisible row.
async function findCustomer(
  supabase: SupabaseClient,
  lead: NormalizedLead
): Promise<string | null> {
  if (lead.phone) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("phone_digits", lead.phone)
      .is("hidden_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  if (lead.email) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .ilike("email", lead.email)
      .is("hidden_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const { source: sourceParam } = await ctx.params;
  const source = (sourceParam || "").toLowerCase().slice(0, 64);

  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = createAdminClient();

  // ---- 1. Who is calling, and are they still allowed to ------------------
  const { data: src, error: srcError } = await supabase
    .from("lead_sources")
    .select("key, secret_hash, active")
    .eq("key", source)
    .maybeSingle();

  if (srcError) {
    await logDelivery(supabase, source, { outcome: "error_source_lookup", detail: srcError.message, from_addr: ip });
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
  // Unknown and inactive are the same answer on purpose: a 404 that
  // distinguished them would confirm which source keys exist.
  if (!src || !src.active) {
    await logDelivery(supabase, source, { outcome: "unauthorized_unknown_source", token_ok: false, from_addr: ip });
    return NextResponse.json({ error: "Unknown source" }, { status: 404 });
  }

  const provided =
    request.headers.get("x-lead-token") ||
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    "";

  if (!provided || !hashMatches(provided, src.secret_hash as string)) {
    await logDelivery(supabase, source, { outcome: "unauthorized_bad_token", token_ok: false, from_addr: ip });
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // ---- 2. The body, read only after the caller is known ------------------
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    await logDelivery(supabase, source, { outcome: "ignored_too_large", token_ok: true, from_addr: ip });
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await logDelivery(supabase, source, {
      outcome: "error_bad_json",
      token_ok: true,
      detail: raw.slice(0, 300),
      from_addr: ip,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lead = normalizeLead(parsed);

  // No phone and no email is not a lead. Logged with the body so the mapping
  // can be fixed from the record rather than from a guess.
  if (!hasContact(lead)) {
    await logDelivery(supabase, source, {
      outcome: "rejected_no_contact",
      token_ok: true,
      detail: "no usable phone or email",
      raw: parsed,
      from_addr: ip,
    });
    return NextResponse.json({ error: "A phone or email is required" }, { status: 422 });
  }

  // ---- 3. Have we already got this one ----------------------------------
  // Providers retry, and they resend. The unique index on
  // (source, source_ref) is the real guard; this check just makes the
  // duplicate answer cheap and gives the provider its original load id back.
  if (lead.sourceRef) {
    const { data: existing } = await supabase
      .from("lead_intake")
      .select("load_id")
      .eq("source", source)
      .eq("source_ref", lead.sourceRef)
      .maybeSingle();
    if (existing?.load_id) {
      await logDelivery(supabase, source, {
        outcome: "duplicate",
        token_ok: true,
        detail: `source_ref ${lead.sourceRef}`,
        from_addr: ip,
      });
      // 200, not 409: a duplicate is handled, and a provider that gets an
      // error status will retry this forever.
      return NextResponse.json({ ok: true, duplicate: true, load_id: existing.load_id });
    }
  }

  try {
    // ---- 4. The customer ------------------------------------------------
    let customerId = await findCustomer(supabase, lead);
    if (!customerId) {
      const { data: created, error } = await supabase
        .from("customers")
        .insert({
          contact_name: lead.contactName || "Unknown (web lead)",
          phone: lead.phone,
          email: lead.email,
          source: `lead:${source}`,
        })
        .select("id")
        .single();
      if (error) throw new Error(`customer insert: ${error.message}`);
      customerId = created.id as string;
    }

    // ---- 5. The load, at stage `lead` -----------------------------------
    const { data: seq, error: seqError } = await supabase.rpc("next_load_number");
    if (seqError) throw new Error(`next_load_number: ${seqError.message}`);

    const { data: owner } = await supabase.rpc("next_lead_owner");

    const { data: load, error: loadError } = await supabase
      .from("loads")
      .insert({
        load_number: `${seq}-US`,
        customer_id: customerId,
        // Set STATUS, not pipeline_stage. trg_loads_pipeline_stage (0030)
        // derives the stage from the status on insert, so a row inserted with
        // only pipeline_stage set would have it overwritten to 'quote' (the
        // status default). status 'lead' is what the trigger maps to stage
        // 'lead', and it is what the Leads pipeline filters on.
        status: "lead",
        sales_owner_id: owner ?? null,
        transport_type: lead.transportType,
        pickup_city: lead.originCity,
        pickup_state: lead.originState,
        pickup_zip: lead.originZip,
        delivery_city: lead.destCity,
        delivery_state: lead.destState,
        delivery_zip: lead.destZip,
        pickup_ready_date: lead.readyDate,
        notes: lead.notes,
      })
      .select("id, load_number")
      .single();
    if (loadError) throw new Error(`load insert: ${loadError.message}`);

    // ---- 6. The vehicle, when they sent one ------------------------------
    if (lead.vehicleYear || lead.vehicleMake || lead.vehicleModel) {
      const { error: vErr } = await supabase.from("load_vehicles").insert({
        load_id: load.id,
        year: lead.vehicleYear,
        make: lead.vehicleMake,
        model: lead.vehicleModel,
        condition: lead.operable ? "running" : "non_running",
      });
      // A bad vehicle row must not cost us the lead -- the rep can add the car.
      if (vErr) console.error(`lead ${load.id} vehicle insert failed:`, vErr.message);
    }

    // ---- 7. Attribution --------------------------------------------------
    const { error: attrError } = await supabase.from("lead_intake").insert({
      load_id: load.id,
      source,
      source_ref: lead.sourceRef,
    });
    if (attrError) throw new Error(`lead_intake insert: ${attrError.message}`);

    await logDelivery(supabase, source, {
      outcome: "stored",
      token_ok: true,
      detail: `load ${load.load_number}`,
      raw: parsed,
      from_addr: ip,
    });

    return NextResponse.json({
      ok: true,
      load_id: load.id,
      load_number: load.load_number,
      assigned: Boolean(owner),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The raw body is kept on every failure, so a lead that could not be
    // stored can still be recovered by hand from webhook_events.
    await logDelivery(supabase, source, {
      outcome: "error_store",
      token_ok: true,
      detail: message.slice(0, 500),
      raw: parsed,
      from_addr: ip,
    });
    console.error(`lead webhook (${source}) failed:`, message);
    return NextResponse.json({ error: "Could not store lead" }, { status: 500 });
  }
}

// Providers frequently GET the URL to check it is live before they configure
// it. Answer without leaking whether the source exists.
export async function GET() {
  return NextResponse.json({ ok: true, method: "POST" }, { status: 200 });
}
