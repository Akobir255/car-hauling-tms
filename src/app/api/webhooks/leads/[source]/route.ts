import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasContact, normalizeLead } from "@/lib/leads/normalize";
import { createLeadFromNormalized } from "@/lib/leads/create";
import {
  authorizeSource,
  clientIp,
  logDelivery,
  rateLimited,
  tokenFromHeaders,
} from "@/lib/leads/webhook-shared";

// Inbound lead webhook (JSON): POST /api/webhooks/leads/<source>
//
// A lead generator posts a JSON body and it lands as a load at stage `lead`,
// in a rep's queue, deduped, with the source recorded.
//
// THE HANDLER IS THE BOUNDARY. src/proxy.ts returns early for every
// /api/webhooks path, so nothing authenticates this before it runs and it runs
// with the SERVICE ROLE. The guards — constant-time token, fail-closed on an
// unknown source, body cap, rate limit — all live in webhook-shared.ts, shared
// with the email route so the two cannot drift apart. See src/lib/leads/.

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const ip = clientIp(request.headers);
  const { source: sourceParam } = await ctx.params;
  const source = (sourceParam || "").toLowerCase().slice(0, 64);

  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = createAdminClient();

  // ---- 1. Who is calling, and are they still allowed to ------------------
  const auth = await authorizeSource(supabase, source, tokenFromHeaders(request.headers));
  if (!auth.ok) {
    await logDelivery(supabase, source, "json", { outcome: auth.outcome, token_ok: auth.tokenOk, from_addr: ip });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // ---- 2. The body, read only after the caller is known ------------------
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    await logDelivery(supabase, source, "json", { outcome: "ignored_too_large", token_ok: true, from_addr: ip });
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await logDelivery(supabase, source, "json", {
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
    await logDelivery(supabase, source, "json", {
      outcome: "rejected_no_contact",
      token_ok: true,
      detail: "no usable phone or email",
      raw: parsed,
      from_addr: ip,
    });
    return NextResponse.json({ error: "A phone or email is required" }, { status: 422 });
  }

  try {
    const result = await createLeadFromNormalized(supabase, lead, source, lead.sourceRef);

    if (result.duplicate) {
      await logDelivery(supabase, source, "json", {
        outcome: "duplicate",
        token_ok: true,
        detail: `source_ref ${lead.sourceRef}`,
        from_addr: ip,
      });
      // 200, not 409: a duplicate is handled, and a provider that gets an
      // error status will retry it forever.
      return NextResponse.json({ ok: true, duplicate: true, load_id: result.loadId });
    }

    await logDelivery(supabase, source, "json", {
      outcome: "stored",
      token_ok: true,
      detail: `load ${result.loadNumber}`,
      raw: parsed,
      from_addr: ip,
    });
    return NextResponse.json({
      ok: true,
      load_id: result.loadId,
      load_number: result.loadNumber,
      assigned: result.assigned,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The raw body is kept on every failure, so a lead that could not be
    // stored can still be recovered by hand from webhook_events.
    await logDelivery(supabase, source, "json", {
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

// Providers frequently GET the URL to check it is live before configuring it.
// Answer without leaking whether the source exists.
export async function GET() {
  return NextResponse.json({ ok: true, method: "POST" }, { status: 200 });
}
