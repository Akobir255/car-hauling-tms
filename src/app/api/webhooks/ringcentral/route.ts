import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWebhookVerificationToken, toE164 } from "@/lib/messaging/ringcentral";

// Public endpoint — RingCentral POSTs here for every new SMS on our number.
// Auth model: no user session; instead every notification must carry the
// Verification-Token we registered with the subscription (checked
// timing-safe below). All DB work uses the service-role client, so this file
// is server-only by construction.

// Best-effort in-memory rate limit. Serverless instances each get their own
// window, so this is a brake on abuse/floods, not a precise quota — the
// verification token is the real gate.
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

const notificationSchema = z.object({
  body: z
    .object({
      id: z.union([z.string(), z.number()]).optional(),
      type: z.string().optional(),
      direction: z.string().optional(),
      subject: z.string().optional(),
      from: z.object({ phoneNumber: z.string().optional() }).optional(),
      to: z.array(z.object({ phoneNumber: z.string().optional() })).optional(),
    })
    .optional(),
});

// CTIA opt-out/opt-in keywords: the message must be just the keyword
// (trailing punctuation allowed) to count.
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

  // Subscription-creation handshake: RingCentral sends a Validation-Token
  // header and expects it echoed back. Nothing is processed or revealed.
  const validationToken = request.headers.get("validation-token");
  if (validationToken) {
    return new NextResponse(null, {
      status: 200,
      headers: { "Validation-Token": validationToken },
    });
  }

  const expectedToken = getWebhookVerificationToken();
  if (!expectedToken) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const providedToken = request.headers.get("verification-token") || "";
  if (!tokenMatches(providedToken, expectedToken)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > 100_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = notificationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const msg = parsed.data.body;
  // Ignore anything that isn't an inbound SMS (renewal pings, outbound echoes).
  if (!msg || msg.type !== "SMS" || msg.direction !== "Inbound") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const providerMessageId = msg.id != null ? String(msg.id) : null;
  const fromNumber = toE164(msg.from?.phoneNumber) ?? msg.from?.phoneNumber ?? null;
  const toNumber = msg.to?.[0]?.phoneNumber ?? null;
  const text = (msg.subject ?? "").trim();

  const supabase = createAdminClient();

  // RingCentral retries deliveries — drop exact duplicates.
  if (providerMessageId) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("provider_message_id", providerMessageId)
      .eq("direction", "inbound")
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  // Match the sender to a customer by normalized phone.
  let customerId: string | null = null;
  if (fromNumber) {
    const { data } = await supabase.rpc("find_customer_by_phone", { p_phone: fromNumber });
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

  // STOP/START compliance — flip the opt-out flag before logging the message.
  const keyword = optKeyword(text);
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
    direction: "inbound",
    from_addr: fromNumber,
    to_addr: toNumber,
    body: text || "(empty message)",
    provider_message_id: providerMessageId,
    status: "delivered",
    sent_by: null,
  });
  if (insertError) {
    console.error("Inbound SMS insert failed:", insertError);
    // Non-200 makes RingCentral retry later instead of dropping the message.
    return NextResponse.json({ error: "Storage error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
