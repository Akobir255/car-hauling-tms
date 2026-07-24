"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { buildContext, renderTemplate } from "@/lib/messaging/render";
import { isSmsConfigured, sendSms, toE164 } from "@/lib/messaging/ringcentral";
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

  // Latest load per customer for template variables ({{route}}, {{quote_price}}...)
  const { data: loadsData } = await supabase
    .from("loads")
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
