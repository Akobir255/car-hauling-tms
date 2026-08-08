import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractIntake, isAiConfigured, MAX_TEXT_CHARS } from "@/lib/ai/extract-intake";
import { extractionToNormalizedLead } from "@/lib/leads/from-extraction";
import { hasContact } from "@/lib/leads/normalize";
import { createLeadFromNormalized } from "@/lib/leads/create";
import {
  authorizeSource,
  clientIp,
  logDelivery,
  rateLimited,
  tokenFromHeaders,
} from "@/lib/leads/webhook-shared";

// Inbound lead webhook (EMAIL): POST /api/webhooks/email/<source>
//
// For lead generators that only EMAIL leads — the common case for the cheaper
// ones — instead of POSTing JSON. An inbound-email service (Resend inbound,
// SendGrid Inbound Parse, Mailgun Routes, Postmark, …) is pointed at this URL;
// it delivers the parsed message as JSON, we read the plaintext, and the model
// that already backs the intake screen (extract-intake.ts) pulls the shipper,
// lane, vehicle and dates out of it. From there it converges on exactly the
// same createLeadFromNormalized() the JSON webhook uses — one lead shape, one
// dedupe, one attribution row.
//
// SAME BOUNDARY AS THE JSON ROUTE. /api/webhooks bypasses the middleware, so
// the guards in webhook-shared.ts (constant-time token, fail-closed source,
// rate limit) are the whole boundary. The provider — or a thin forwarding rule
// in front of it — must send the source token in X-Lead-Token.
//
// WHY AN EMAIL LEAD NEEDS THE MODEL. A JSON lead carries labelled fields; an
// email is prose, and the CUSTOMER'S phone and email live inside that prose,
// not in the envelope (the envelope's From is usually the provider's own
// system address). So without the model there is no reliable contact to build
// a customer from. When ANTHROPIC_API_KEY is not set the message is accepted
// and kept raw in webhook_events, but no half-blank lead is invented — it
// waits, recoverable, for the key. This is why the feature is naturally dark:
// no provider is pointed at it yet, and the parser is off until configured.

export const runtime = "nodejs";
// The model call dominates; give the request room, matching the intake page.
export const maxDuration = 120;

// Emails with long quoted history / signatures run large; cap generously.
const MAX_BODY_BYTES = 1024 * 1024;

type Loose = Record<string, unknown>;
const canon = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(obj: Loose, aliases: string[]): string | null {
  const byCanon = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const c = canon(k);
    if (!byCanon.has(c)) byCanon.set(c, v);
  }
  for (const a of aliases) {
    const v = byCanon.get(canon(a));
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return null;
}

// Inbound-email services each shape their payload differently; read a wide set
// of aliases the same way the JSON normalizer does. Only the plaintext body,
// the subject, the sender and a message id are needed here — the model does
// the rest from the body.
type ParsedEmail = { text: string; subject: string | null; from: string | null; messageId: string | null };

function parseInboundEmail(payload: unknown): ParsedEmail {
  const p = (payload && typeof payload === "object" ? payload : {}) as Loose;
  // Some providers nest under `email`, `message` or `data`.
  const merged: Loose = { ...p };
  for (const w of ["email", "message", "data", "payload"]) {
    const nested = p[w];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      for (const [k, v] of Object.entries(nested as Loose)) if (merged[k] === undefined) merged[k] = v;
    }
  }

  const text =
    pick(merged, ["text", "plain", "body-plain", "bodyplain", "TextBody", "stripped-text", "strippedtext"]) ||
    // Last resort: an HTML-only email, tags crudely stripped. The model reads
    // through the leftover noise; this is not meant to be clean.
    (pick(merged, ["html", "body-html", "bodyhtml", "HtmlBody"]) || "").replace(/<[^>]+>/g, " ");

  return {
    text: text.slice(0, MAX_TEXT_CHARS),
    subject: pick(merged, ["subject", "Subject"]),
    from: pick(merged, ["from", "From", "sender", "from_email", "fromaddress"]),
    messageId: pick(merged, ["message-id", "messageid", "message_id", "Message-ID"]),
  };
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const ip = clientIp(request.headers);
  const { source: sourceParam } = await ctx.params;
  const source = (sourceParam || "").toLowerCase().slice(0, 64);

  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = createAdminClient();

  // ---- 1. Auth — identical to the JSON route --------------------------------
  const auth = await authorizeSource(supabase, source, tokenFromHeaders(request.headers));
  if (!auth.ok) {
    await logDelivery(supabase, source, "email", { outcome: auth.outcome, token_ok: auth.tokenOk, from_addr: ip });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // ---- 2. Body ------------------------------------------------------------
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    await logDelivery(supabase, source, "email", { outcome: "ignored_too_large", token_ok: true, from_addr: ip });
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await logDelivery(supabase, source, "email", {
      outcome: "error_bad_json",
      token_ok: true,
      detail: raw.slice(0, 300),
      from_addr: ip,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = parseInboundEmail(parsed);

  if (!email.text.trim()) {
    await logDelivery(supabase, source, "email", {
      outcome: "rejected_empty",
      token_ok: true,
      detail: "no readable email body",
      raw: parsed,
      from_addr: email.from || ip,
    });
    return NextResponse.json({ error: "No email body" }, { status: 422 });
  }

  // ---- 3. The parser is what makes an email a lead ------------------------
  // Not configured yet: accept and keep the raw so nothing is lost, but do not
  // fabricate a lead with no real contact. 200 so the provider does not retry.
  if (!isAiConfigured()) {
    await logDelivery(supabase, source, "email", {
      outcome: "received_pending_ai",
      token_ok: true,
      detail: `subject: ${(email.subject || "").slice(0, 140)}`,
      raw: parsed,
      from_addr: email.from || ip,
    });
    return NextResponse.json({ ok: true, pending: "ai_not_configured" });
  }

  let extraction;
  try {
    extraction = await extractIntake({ kind: "text", text: email.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logDelivery(supabase, source, "email", {
      outcome: "error_ai_extract",
      token_ok: true,
      detail: message.slice(0, 400),
      raw: parsed,
      from_addr: email.from || ip,
    });
    console.error(`lead email (${source}) extract threw:`, message);
    // 200: the raw is kept and can be re-run; a retry storm helps nobody.
    return NextResponse.json({ ok: false, error: "extraction_failed" });
  }

  if (!extraction.ok) {
    await logDelivery(supabase, source, "email", {
      outcome: "ai_no_result",
      token_ok: true,
      detail: `${extraction.stopReason ?? "no reason"}: ${extraction.error}`.slice(0, 400),
      raw: parsed,
      from_addr: email.from || ip,
    });
    return NextResponse.json({ ok: false, error: "no_extraction" });
  }

  const lead = extractionToNormalizedLead(extraction.extraction);
  // Message-Id is the natural dedup key for email: a forwarded/retried delivery
  // carries the same one.
  const sourceRef = email.messageId ? email.messageId.slice(0, 300) : null;

  if (!hasContact(lead)) {
    await logDelivery(supabase, source, "email", {
      outcome: "rejected_no_contact",
      token_ok: true,
      detail: "model found no phone or email in the body",
      raw: parsed,
      from_addr: email.from || ip,
    });
    return NextResponse.json({ error: "No contact found in email" }, { status: 422 });
  }

  try {
    const result = await createLeadFromNormalized(supabase, lead, source, sourceRef);

    if (result.duplicate) {
      await logDelivery(supabase, source, "email", {
        outcome: "duplicate",
        token_ok: true,
        detail: `message-id ${sourceRef}`,
        from_addr: email.from || ip,
      });
      return NextResponse.json({ ok: true, duplicate: true, load_id: result.loadId });
    }

    await logDelivery(supabase, source, "email", {
      outcome: "stored",
      token_ok: true,
      detail: `load ${result.loadNumber}`,
      raw: parsed,
      from_addr: email.from || ip,
    });
    return NextResponse.json({
      ok: true,
      load_id: result.loadId,
      load_number: result.loadNumber,
      assigned: result.assigned,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logDelivery(supabase, source, "email", {
      outcome: "error_store",
      token_ok: true,
      detail: message.slice(0, 500),
      raw: parsed,
      from_addr: email.from || ip,
    });
    console.error(`lead email (${source}) store failed:`, message);
    return NextResponse.json({ error: "Could not store lead" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, method: "POST", parser: isAiConfigured() ? "on" : "pending" }, { status: 200 });
}
