"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/types/database";

export type TicketFormState = { error: string | null };

const ticketSchema = z.object({
  subject: z.string().min(3, "Give the ticket a subject."),
  body: z.string().optional(),
  priority: z.enum(TICKET_PRIORITIES as [string, ...string[]]).optional(),
  load_id: z.string().uuid().optional().or(z.literal("")),
  customer_id: z.string().uuid().optional().or(z.literal("")),
  assigned_to: z.string().uuid().optional().or(z.literal("")),
});

export async function createTicket(
  _prevState: TicketFormState,
  formData: FormData
): Promise<TicketFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const parsed = ticketSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .insert({
      subject: d.subject,
      body: d.body || null,
      priority: d.priority || "normal",
      load_id: d.load_id || null,
      customer_id: d.customer_id || null,
      // Default to self so a ticket is never orphaned.
      assigned_to: d.assigned_to || profile.id,
      created_by: profile.id, // required by the insert policy
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("Ticket create failed:", error);
    return { error: "Could not create the ticket — try again." };
  }

  revalidatePath("/tickets");
  redirect(`/tickets/${data.id}`);
}

// Status/priority/assignee changes, each optional — the detail page posts
// whichever control the user touched.
export async function updateTicket(id: string, formData: FormData): Promise<void> {
  await requireRole("admin", "dispatcher", "sales");

  const status = (formData.get("status") || "").toString();
  const priority = (formData.get("priority") || "").toString();
  const assignedTo = (formData.get("assigned_to") || "").toString();

  const values: Record<string, unknown> = {};
  if (TICKET_STATUSES.includes(status as never)) {
    values.status = status;
    // Stamp/clear the resolution time so "time to resolve" stays truthful.
    values.resolved_at =
      status === "resolved" || status === "closed" ? new Date().toISOString() : null;
  }
  if (TICKET_PRIORITIES.includes(priority as never)) values.priority = priority;
  if (assignedTo) values.assigned_to = assignedTo;
  if (Object.keys(values).length === 0) return;

  const supabase = await createClient();
  await supabase.from("tickets").update(values).eq("id", id);
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${id}`);
}

export async function addTicketComment(
  ticketId: string,
  _prevState: TicketFormState,
  formData: FormData
): Promise<TicketFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const body = (formData.get("body") || "").toString().trim();
  if (!body) return { error: "Write a comment first." };
  if (body.length > 5000) return { error: "That comment is too long." };

  const supabase = await createClient();
  const { error } = await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    body,
    author_id: profile.id, // required by the insert policy
  });
  if (error) {
    console.error("Ticket comment failed:", error);
    return { error: "Could not post the comment — try again." };
  }

  // A comment on a resolved ticket reopens it — that's what replying means.
  await supabase
    .from("tickets")
    .update({ status: "open", resolved_at: null })
    .eq("id", ticketId)
    .in("status", ["resolved", "closed"]);

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return { error: null };
}

export async function deleteTicket(id: string): Promise<void> {
  await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  await supabase.from("tickets").delete().eq("id", id);
  revalidatePath("/tickets");
  redirect("/tickets");
}
