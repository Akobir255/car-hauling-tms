"use server";

import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { buildContext, renderTemplate } from "@/lib/messaging/render";
import {
  INBOUND_SMS_EVENT_FILTER,
  createInboundSubscription,
  deleteSubscription,
  getWebhookVerificationToken,
  isSmsConfigured,
  listSubscriptions,
  sendSms,
  toE164,
} from "@/lib/messaging/ringcentral";
import { isEmailConfigured, isPlausibleEmail, sendEmailBatch } from "@/lib/messaging/email";
import { SMS_CHUNK_MAX, runSmsChunk } from "@/lib/messaging/sms-bulk";
import type { Customer, Load } from "@/types/database";

export type MessageFormState = {
  error: string | null;
  result?: { sent: number; queued: number; skipped: number } | null;
};

// ---- Templates CRUD ----

const templateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
  channel: z.enum(["sms", "email"]),
  subject: z.string().optional(),
  body: z.string().min(1, "Message body is required"),
});

export async function saveTemplate(
  id: string | null,
  _prevState: MessageFormState,
  formData: FormData
): Promise<MessageFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const parsed = templateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = {
    name: parsed.data.name,
    channel: parsed.data.channel,
    subject: parsed.data.subject || null,
    body: parsed.data.body,
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("message_templates").update(values).eq("id", id)
    : await supabase.from("message_templates").insert({ ...values, created_by: profile.id });
  if (error) return { error: error.message };

  revalidatePath("/messages/templates");
  redirect("/messages/templates");
}

export async function deleteTemplate(id: string): Promise<void> {
  await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  await supabase.from("message_templates").delete().eq("id", id);
  revalidatePath("/messages/templates");
}

// ---- Bulk send ----
// Renders the template per recipient, logs every message, and sends when the
// channel's provider is configured. Without credentials the rows stay `queued`
// so nothing is lost — they can be retried once the provider is connected.
//
// Email goes out as ONE Resend batch request. SMS has no batch endpoint and
// RingCentral rate-limits at 40 sends/minute, so the client submits SMS in
// chunks via sendSmsBulkChunk below — never in one long invocation.

const BATCH_LIMIT = 100;

// Carriers bill per 153-character segment, so a pasted email thread sent to
// 100 customers is a real bill, not a typo. Email has no such limit.
const MAX_SMS_LENGTH = 1600;

type Recipient = {
  customerId: string;
  loadId: string | null;
  to: string;
  text: string;
  subject: string;
};

// Fetch the requested customers (RLS decides which are visible), drop anyone
// who can't receive this channel, and render the template per recipient.
// `skipped` includes ids RLS filtered out, so counts always reconcile with
// what the operator selected.
async function resolveRecipients(opts: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  role: string;
  agent: string;
  customerIds: string[];
  isEmail: boolean;
  body: string;
  subject: string;
}): Promise<{ recipients: Recipient[]; skipped: number } | { error: string }> {
  const { supabase, role, agent, customerIds, isEmail, body, subject } = opts;

  const { data: customersData, error: customersError } = await supabase
    .from("customers")
    .select("*")
    .in("id", customerIds);
  if (customersError) return { error: customersError.message };
  const customers = (customersData ?? []) as Customer[];

  // Latest load per customer for template variables ({{route}}, {{quote_price}}...).
  // Views, not the base table: select("*") there would hit the revoked margin
  // columns, and sales must read through the safe view anyway.
  const { data: loadsData } = await supabase
    .from(role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE)
    .select("*")
    .in("customer_id", customerIds)
    .order("created_at", { ascending: false });
  const latestLoadByCustomer = new Map<string, Load>();
  for (const load of (loadsData ?? []) as Load[]) {
    if (!latestLoadByCustomer.has(load.customer_id)) {
      latestLoadByCustomer.set(load.customer_id, load);
    }
  }

  // First vehicle of each latest load, for the {{vehicle}} variable.
  const latestLoadIds = [...latestLoadByCustomer.values()].map((l) => l.id);
  const { data: vehicleRows } = latestLoadIds.length
    ? await supabase
        .from("load_vehicles")
        .select("load_id, year, make, model")
        .in("load_id", latestLoadIds)
        .order("created_at")
    : { data: [] as { load_id: string; year: number | null; make: string | null; model: string | null }[] };
  const vehicleByLoad = new Map<string, string>();
  for (const v of vehicleRows ?? []) {
    if (!vehicleByLoad.has(v.load_id)) {
      vehicleByLoad.set(v.load_id, [v.year, v.make, v.model].filter(Boolean).join(" "));
    }
  }

  let skipped = customerIds.length - customers.length;
  const recipients: Recipient[] = [];
  for (const customer of customers) {
    // Per-channel opt-out is legally required for SMS and expected for email.
    if (isEmail ? customer.email_opt_out : customer.sms_opt_out) {
      skipped++;
      continue;
    }
    const to = isEmail
      ? isPlausibleEmail(customer.email)
        ? customer.email!.trim()
        : null
      : toE164(customer.phone);
    if (!to) {
      skipped++;
      continue;
    }
    const load = latestLoadByCustomer.get(customer.id) ?? null;
    const context = buildContext(customer, load, {
      agent,
      vehicle: load ? (vehicleByLoad.get(load.id) ?? "") : "",
    });
    recipients.push({
      customerId: customer.id,
      loadId: load?.id ?? null,
      to,
      text: renderTemplate(body, context),
      subject: isEmail ? renderTemplate(subject, context) : "",
    });
  }
  return { recipients, skipped };
}

function logBlastRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recipients: Recipient[],
  statuses: { status: string; providerMessageId: string | null }[],
  isEmail: boolean,
  sentBy: string
) {
  if (recipients.length === 0) return Promise.resolve({ error: null });
  // One insert for the whole batch instead of N round-trips.
  return supabase.from("messages").insert(
    recipients.map((r, i) => ({
      customer_id: r.customerId,
      load_id: r.loadId,
      channel: isEmail ? "email" : "sms",
      direction: "outbound",
      to_addr: r.to,
      subject: isEmail ? r.subject : null,
      body: r.text,
      provider_message_id: statuses[i].providerMessageId,
      status: statuses[i].status,
      sent_by: sentBy,
    }))
  );
}

export async function sendBulk(
  _prevState: MessageFormState,
  formData: FormData
): Promise<MessageFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  const body = (formData.get("body") || "").toString().trim();
  if (!body) return { error: "Message body is required." };

  const isEmail = (formData.get("channel") || "sms").toString() === "email";
  if (!isEmail) {
    // SMS is chunked client-side through sendSmsBulkChunk; only a stale tab
    // still submits the whole blast here.
    return { error: "This page has been updated — refresh and send again." };
  }
  const subject = (formData.get("subject") || "").toString().trim();
  if (!subject) return { error: "Email needs a subject line." };

  const customerIds = formData.getAll("customer_ids").map(String).filter(Boolean);
  if (customerIds.length === 0) return { error: "Pick at least one recipient." };
  if (customerIds.length > BATCH_LIMIT) {
    return { error: `Max ${BATCH_LIMIT} recipients per send — narrow the selection.` };
  }

  const supabase = await createClient();
  const resolved = await resolveRecipients({
    supabase,
    role: profile.role,
    agent: profile.full_name || profile.email || "",
    customerIds,
    isEmail: true,
    body,
    subject,
  });
  if ("error" in resolved) return { error: resolved.error };
  const { recipients } = resolved;
  let { skipped } = resolved;

  const statuses: { status: string; providerMessageId: string | null }[] = [];
  if (!isEmailConfigured()) {
    recipients.forEach(() => statuses.push({ status: "queued", providerMessageId: null }));
  } else {
    const result = await sendEmailBatch(
      recipients.map((r) => ({ to: r.to, subject: r.subject, text: r.text }))
    );
    if (result.ok) {
      result.ids.forEach((id) => statuses.push({ status: "sent", providerMessageId: id }));
    } else {
      // The whole batch failed as one request — mark them all failed and
      // surface why, rather than leaving the operator guessing.
      console.error("Email batch failed:", result.error);
      recipients.forEach(() => statuses.push({ status: "failed", providerMessageId: null }));
    }
  }

  const { error: logError } = await logBlastRows(supabase, recipients, statuses, true, profile.id);
  if (logError) console.error("Logging the blast failed:", logError);

  let sent = 0;
  let queued = 0;
  for (const s of statuses) {
    if (s.status === "sent") sent++;
    else if (s.status === "queued") queued++;
    else skipped++;
  }

  revalidatePath("/messages");
  return { error: null, result: { sent, queued, skipped } };
}

// ---- Chunked SMS send ----
// The compose page splits an SMS blast into chunks of SMS_CHUNK_MAX and calls
// this once per chunk. Each invocation paces its sends (~1.7s apart) to stay
// under RingCentral's 40/minute limit and returns within seconds, so no
// single request can hit the function timeout. On persistent rate limiting
// the unattempted tail comes back in `unprocessedIds` for the client to
// resume after `retryAfterMs`. Rows are logged per chunk — closing the tab
// mid-blast loses nothing that was already attempted.

const smsChunkSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message body is required.")
    .max(MAX_SMS_LENGTH, `Keep the message under ${MAX_SMS_LENGTH} characters.`),
  customerIds: z.array(z.string().min(1)).min(1).max(SMS_CHUNK_MAX),
});

export type SmsChunkResult = {
  error: string | null;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  unprocessedIds: string[];
  retryAfterMs: number | null;
};

const emptySmsChunk = (error: string): SmsChunkResult => ({
  error,
  sent: 0,
  queued: 0,
  skipped: 0,
  failed: 0,
  unprocessedIds: [],
  retryAfterMs: null,
});

export async function sendSmsBulkChunk(input: {
  body: string;
  customerIds: string[];
}): Promise<SmsChunkResult> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const parsed = smsChunkSchema.safeParse(input);
  if (!parsed.success) {
    return emptySmsChunk(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const resolved = await resolveRecipients({
    supabase,
    role: profile.role,
    agent: profile.full_name || profile.email || "",
    customerIds: parsed.data.customerIds,
    isEmail: false,
    body: parsed.data.body,
    subject: "",
  });
  if ("error" in resolved) return emptySmsChunk(resolved.error);
  const { recipients, skipped } = resolved;

  const run = await runSmsChunk(recipients, {
    ready: isSmsConfigured(),
    send: sendSms,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  });

  const attempted = recipients.slice(0, run.outcomes.length);
  const { error: logError } = await logBlastRows(
    supabase,
    attempted,
    run.outcomes,
    false,
    profile.id
  );

  let sent = 0;
  let queued = 0;
  let failed = 0;
  for (const o of run.outcomes) {
    if (o.status === "sent") sent++;
    else if (o.status === "queued") queued++;
    else failed++;
  }

  // Texts that went out but couldn't be logged are the one state the operator
  // must hear about loudly: the Messages page won't show them, so a naive
  // resend would double-text real customers. sendReply handles this the same
  // way. A provider outage likewise surfaces as an error so the client stops
  // instead of grinding every recipient into a "failed" row.
  let error: string | null = null;
  if (logError && sent > 0) {
    console.error("Logging the blast failed:", logError);
    error = `${sent} text(s) were SENT but could not be logged (${logError.message}). Do not resend to this selection until Messages is checked.`;
  } else if (logError) {
    console.error("Logging the blast failed:", logError);
    error = `Logging failed: ${logError.message}`;
  } else if (run.providerError) {
    error = `RingCentral problem — blast stopped: ${run.providerError}`;
  }

  // No revalidatePath here: refreshing /messages once per chunk would re-run
  // its queries up to 10 times per blast. The client calls finalizeSmsBlast()
  // when the blast ends (or aborts) instead.
  return {
    error,
    sent,
    queued,
    skipped,
    failed,
    unprocessedIds: recipients.slice(run.outcomes.length).map((r) => r.customerId),
    retryAfterMs: run.retryAfterMs,
  };
}

// One cheap revalidation at the end of a chunked blast (success or abort),
// instead of one per chunk.
export async function finalizeSmsBlast(): Promise<void> {
  await requireRole("admin", "dispatcher", "sales");
  revalidatePath("/messages");
}

// ---- Two-way SMS ----

const replySchema = z.object({
  body: z.string().trim().min(1, "Message is required").max(1600, "Message is too long"),
});

// Direct reply in a customer thread. Uses the session client on purpose:
// RLS scopes which customers a sales rep can even fetch, so a rep can't
// text someone else's customer by forging the id.
export async function sendReply(
  customerId: string,
  _prevState: MessageFormState,
  formData: FormData
): Promise<MessageFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const parsed = replySchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: customerData } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();
  if (!customerData) return { error: "Customer not found." };
  const customer = customerData as Customer;

  if (customer.sms_opt_out) {
    return { error: "This customer has opted out of SMS (replied STOP)." };
  }
  const to = toE164(customer.phone);
  if (!to) return { error: "Customer has no valid US phone number." };
  if (!isSmsConfigured()) return { error: "RingCentral is not connected." };

  let providerMessageId: string | null = null;
  try {
    const result = await sendSms(to, parsed.data.body);
    providerMessageId = result.providerMessageId;
  } catch (err) {
    console.error(`SMS reply to ${to} failed:`, err);
    return { error: "Send failed — RingCentral rejected the message." };
  }

  const { error } = await supabase.from("messages").insert({
    customer_id: customer.id,
    channel: "sms",
    direction: "outbound",
    to_addr: to,
    body: parsed.data.body,
    provider_message_id: providerMessageId,
    status: "sent",
    sent_by: profile.id,
  });
  if (error) return { error: `Sent, but logging failed: ${error.message}` };

  // Replying means the thread was seen — clear its unread flags.
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("customer_id", customer.id)
    .eq("direction", "inbound")
    .is("read_at", null);

  revalidatePath(`/customers/${customer.id}`);
  revalidatePath("/messages");
  revalidatePath("/", "layout");
  return { error: null };
}

export async function markAllMessagesRead(): Promise<void> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("direction", "inbound")
    .is("read_at", null);
  revalidatePath("/messages");
  revalidatePath("/", "layout");
}

// ---- Inbound webhook registration (admin) ----

function webhookAddress(): string | null {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (explicit) return `${explicit}/api/webhooks/ringcentral`;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (vercel) return `https://${vercel}/api/webhooks/ringcentral`;
  return null;
}

export type WebhookSyncState = {
  error: string | null;
  status?: string | null;
};

// Registers (or repairs) the RingCentral subscription that pushes inbound
// SMS to our webhook. Safe to click repeatedly — it converges on exactly one
// active subscription for our address.
export async function syncInboundWebhook(
  _prevState: WebhookSyncState,
  _formData: FormData
): Promise<WebhookSyncState> {
  await requireRole("admin");

  if (!isSmsConfigured()) {
    return { error: "RingCentral credentials are not configured." };
  }
  if (!getWebhookVerificationToken()) {
    return { error: "Set RINGCENTRAL_WEBHOOK_TOKEN (any long random string) in the env first." };
  }
  const address = webhookAddress();
  if (!address) {
    return { error: "Set NEXT_PUBLIC_APP_URL so RingCentral knows where to deliver." };
  }

  try {
    const subs = await listSubscriptions();
    const ours = subs.filter(
      (s) =>
        s.deliveryMode?.transportType === "WebHook" &&
        s.deliveryMode?.address === address &&
        s.eventFilters?.includes(INBOUND_SMS_EVENT_FILTER)
    );
    const active = ours.find((s) => s.status === "Active");
    // Clear out anything stale (blacklisted after delivery failures, etc.).
    for (const sub of ours) {
      if (sub !== active) await deleteSubscription(sub.id);
    }
    if (active) {
      revalidatePath("/messages");
      return { error: null, status: `Active — delivering to ${address}` };
    }
    const created = await createInboundSubscription(address);
    revalidatePath("/messages");
    return { error: null, status: `Created (${created.status}) — delivering to ${address}` };
  } catch (err) {
    console.error("Webhook sync failed:", err);
    return { error: err instanceof Error ? err.message : "Webhook sync failed." };
  }
}
