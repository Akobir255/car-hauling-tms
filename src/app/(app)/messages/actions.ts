"use server";

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
// Renders the template per recipient, logs every message, and sends via
// RingCentral when configured. Without credentials the rows stay `queued`
// so nothing is lost — they can be retried once RingCentral is connected.

const BATCH_LIMIT = 100;

export async function sendBulk(
  _prevState: MessageFormState,
  formData: FormData
): Promise<MessageFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  const body = (formData.get("body") || "").toString().trim();
  if (!body) return { error: "Message body is required." };

  const customerIds = formData.getAll("customer_ids").map(String).filter(Boolean);
  if (customerIds.length === 0) return { error: "Pick at least one recipient." };
  if (customerIds.length > BATCH_LIMIT) {
    return { error: `Max ${BATCH_LIMIT} recipients per send — narrow the selection.` };
  }

  const supabase = await createClient();

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
    .from(profile.role === "sales" ? "loads_sales_safe" : "loads_full")
    .select("*")
    .in("customer_id", customerIds)
    .order("created_at", { ascending: false });
  const latestLoadByCustomer = new Map<string, Load>();
  for (const load of (loadsData ?? []) as Load[]) {
    if (!latestLoadByCustomer.has(load.customer_id)) {
      latestLoadByCustomer.set(load.customer_id, load);
    }
  }

  const smsReady = isSmsConfigured();
  let sent = 0;
  let queued = 0;
  let skipped = 0;

  for (const customer of customers) {
    if (customer.sms_opt_out) {
      skipped++;
      continue;
    }
    const to = toE164(customer.phone);
    if (!to) {
      skipped++;
      continue;
    }

    const load = latestLoadByCustomer.get(customer.id) ?? null;
    const text = renderTemplate(body, buildContext(customer, load));

    let status = "queued";
    let providerMessageId: string | null = null;
    if (smsReady) {
      try {
        const result = await sendSms(to, text);
        providerMessageId = result.providerMessageId;
        status = "sent";
      } catch (err) {
        console.error(`SMS to ${to} failed:`, err);
        status = "failed";
      }
    }

    await supabase.from("messages").insert({
      customer_id: customer.id,
      load_id: load?.id ?? null,
      channel: "sms",
      direction: "outbound",
      to_addr: to,
      body: text,
      provider_message_id: providerMessageId,
      status,
      sent_by: profile.id,
    });

    if (status === "sent") sent++;
    else if (status === "queued") queued++;
    else skipped++;
  }

  revalidatePath("/messages");
  return { error: null, result: { sent, queued, skipped } };
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
