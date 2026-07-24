import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWebhookVerificationToken, toE164 } from "@/lib/messaging/ringcentral";

// Public endpoint — RingCentral POSTs here for every new SMS on our number.
// Auth model: no user session; instead every notification must carry the
// Verification-Token we registered with the subscription (checked
// timing-safe below). All DB work uses the service-role client, so this file
// is server-only by construction.
//
// Every receipt is logged to webhook_events (admin-visible on /messages)
// with its outcome, so we can tell whether RingCentral is delivering at all
// and why any given event was or wasn't stored.

const RATE_LIMIT = 240; // requests per minute per IP
const rateWindow = new Map<string, { count: number; startedAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (rateWindow.size > 10_000) rateWindow.clear();
  const entry = rateWindow.get(ip);
  if (!entry || now - entry.startedAt > 60_000) {
    rateWindow.set(ip, { count: 1, startedAt: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Best-effort receipt log. Never throws — diagnostics must not break delivery.
async function logEvent(
  supabase: SupabaseClient,
  row: {
    token_ok?: boolean | null;
    event_type?: string | null;
    direction?: string | null;
    from_addr?: string | null;
    outcome: string;
    detail?: string | null;
    raw?: unknown;
  }
) {
  try {
    const rawStr = row.raw != null ? JSON.stringify(row.raw).slice(0, 4000) : null;
    await supabase.from("webhook_events").insert({
      source: "ringcentral",
      token_ok: row.token_ok ?? null,
      event_type: row.event_type ?? null,
      direction: row.direction ?? null,
      from_addr: row.from_addr ?? null,
      outcome: row.outcome,
      detail: row.detail ?? null,
      raw: rawStr ? JSON.parse(rawStr) : null,
    });
  } catch (err) {
    console.error("webhook_events log failed:", err);
  }
}

const notificationSchema = z.object({
  body: z
    .object({
      id: z.union([z.string(), z.number()]).optional(),
      type: z.string().optional(),
      direction: z.string().optional(),
      subject: z.string().optional(),
      text: z.string().optional(),
      from: z.object({ phoneNumber: z.string().optional() }).optional(),
      to: z.array(z.object({ phoneNumber: z.string().optional() })).optional(),
    })
    .optional(),
});

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "CONTINUE"]);

function optKeyword(text: string): "stop" | "start" | null {
  const word = text.trim().toUpperCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return null;
}

export async function POST(request: NextRequest) {
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = createAdminClient();

  // Subscription-creation / renewal handshake: echo the Validation-Token.
  const validationToken = request.headers.get("validation-token");
  if (validationToken) {
    await logEvent(supabase, { outcome: "validation", event_type: "validation" });
    return new NextResponse(null, {
      status: 200,
      headers: { "Validation-Token": validationToken },
    });
  }

  const expectedToken = getWebhookVerificationToken();
  if (!expectedToken) {
    await logEvent(supabase, { outcome: "error_unconfigured", token_ok: false });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const providedToken = request.headers.get("verification-token") || "";
  const tokenOk = tokenMatches(providedToken, expectedToken);
  if (!tokenOk) {
    await logEvent(supabase, {
      outcome: "unauthorized",
      token_ok: false,
      detail: "Verification-Token header did not match RINGCENTRAL_WEBHOOK_TOKEN",
    });
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > 100_000) {
    await logEvent(supabase, { outcome: "ignored_too_large", token_ok: true });
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    await logEvent(supabase, { outcome: "error_bad_json", token_ok: true, detail: raw.slice(0, 300) });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = notificationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    await logEvent(supabase, { outcome: "error_bad_shape", token_ok: true, raw: parsedJson });
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const msg = parsed.data.body;
  const eventType = msg?.type ?? null;
  const direction = msg?.direction ?? null;

  // We record SMS in both directions so the TMS shows a complete thread —
  // inbound customer replies AND texts a rep sends straight from the
  // RingCentral app (which the TMS didn't originate). Non-SMS events (renewal
  // pings, etc.) are logged and acknowledged.
  const isSms = (eventType ?? "").toUpperCase() === "SMS";
  const isInbound = (direction ?? "").toLowerCase() === "inbound";
  if (!msg || !isSms) {
    await logEvent(supabase, {
      outcome: "ignored_not_sms",
      token_ok: true,
      event_type: eventType,
      direction,
      raw: parsedJson,
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const providerMessageId = msg.id != null ? String(msg.id) : null;
  const fromNumber = toE164(msg.from?.phoneNumber) ?? msg.from?.phoneNumber ?? null;
  const toNumber = toE164(msg.to?.[0]?.phoneNumber) ?? msg.to?.[0]?.phoneNumber ?? null;
  // The other party's number is who we match to a customer: sender if inbound,
  // recipient if outbound.
  const counterparty = isInbound ? fromNumber : toNumber;
  const storedDirection = isInbound ? "inbound" : "outbound";
  // RingCentral puts SMS text in `subject`; fall back to `text`.
  const text = (msg.subject ?? msg.text ?? "").trim();

  // Drop duplicates in EITHER direction: RingCentral retries, and TMS-sent
  // outbound texts already have a row with this provider id.
  if (providerMessageId) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("provider_message_id", providerMessageId)
      .limit(1);
    if (existing && existing.length > 0) {
      await logEvent(supabase, {
        outcome: "duplicate",
        token_ok: true,
        event_type: eventType,
        direction,
        from_addr: fromNumber,
      });
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  // Match the other party to a customer by normalized phone.
  let customerId: string | null = null;
  if (counterparty) {
    const { data } = await supabase.rpc("find_customer_by_phone", { p_phone: counterparty });
    customerId = (data as string | null) ?? null;
  }

  // Attach the customer's latest load so the reply shows up in load context.
  let loadId: string | null = null;
  if (customerId) {
    const { data: loads } = await supabase
      .from("loads")
      .select("id")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1);
    loadId = loads?.[0]?.id ?? null;
  }

  // STOP/START compliance — inbound only — flip the opt-out flag.
  const keyword = isInbound ? optKeyword(text) : null;
  if (customerId && keyword) {
    await supabase
      .from("customers")
      .update({ sms_opt_out: keyword === "stop" })
      .eq("id", customerId);
  }

  const { error: insertError } = await supabase.from("messages").insert({
    customer_id: customerId,
    load_id: loadId,
    channel: "sms",
    direction: storedDirection,
    from_addr: fromNumber,
    to_addr: toNumber,
    body: text || "(empty message)",
    provider_message_id: providerMessageId,
    status: "delivered",
    sent_by: null,
    // Outbound isn't "unread" — only inbound drives the badge.
    read_at: isInbound ? null : new Date().toISOString(),
  });
  if (insertError) {
    console.error("Inbound SMS insert failed:", insertError);
    await logEvent(supabase, {
      outcome: "error_insert",
      token_ok: true,
      event_type: eventType,
      direction,
      from_addr: fromNumber,
      detail: insertError.message,
    });
    // Non-200 makes RingCentral retry later instead of dropping the message.
    return NextResponse.json({ error: "Storage error" }, { status: 500 });
  }

  await logEvent(supabase, {
    outcome: customerId ? "stored" : "stored_no_customer",
    token_ok: true,
    event_type: eventType,
    direction,
    from_addr: fromNumber,
    detail: customerId ? null : "No customer matched this phone number",
  });

  return NextResponse.json({ ok: true });
}
