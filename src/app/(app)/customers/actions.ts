"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireRole } from "@/lib/auth";
import { blockedFromWriting } from "@/lib/record-access";

export type CustomerFormState = { error: string | null };

const customerSchema = z.object({
  company_name: z.string().optional(),
  contact_name: z.string().min(1, "Contact name is required"),
  phone: z.string().optional(),
  email: z.union([z.literal(""), z.string().email("Invalid email")]),
  billing_address: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  sales_owner_id: z.string().optional(),
});

async function parseCustomerForm(formData: FormData) {
  const profile = await requireProfile();
  const raw = Object.fromEntries(formData.entries());
  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  // Sales reps always own the customers they create/edit; only admin/
  // dispatcher can assign a different owner via the form.
  const sales_owner_id =
    profile.role === "sales" ? profile.id : d.sales_owner_id || profile.id;

  return {
    success: true as const,
    values: {
      company_name: d.company_name || null,
      contact_name: d.contact_name,
      phone: d.phone || null,
      email: d.email || null,
      billing_address: d.billing_address || null,
      source: d.source || null,
      notes: d.notes || null,
      sales_owner_id,
      sms_opt_out: formData.get("sms_opt_out") === "on",
      email_opt_out: formData.get("email_opt_out") === "on",
    },
  };
}

export async function createCustomer(
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  await requireRole("admin", "dispatcher", "sales");
  const parsed = await parseCustomerForm(formData);
  if (!parsed.success) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert(parsed.values);
  if (error) return { error: error.message };

  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(
  id: string,
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  // Shippers are readable by everyone since 0037. Saving one you don't own
  // would not just fail quietly — parseCustomerForm stamps sales_owner_id with
  // the editor's id, so a save from the wrong rep is an attempt to take the
  // account over. The policy already refuses it; this says so out loud.
  const notMine = await blockedFromWriting("customers", id, profile);
  if (notMine) return { error: notMine };
  const parsed = await parseCustomerForm(formData);
  if (!parsed.success) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(parsed.values).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/customers");
  redirect("/customers");
}

export async function deleteCustomer(id: string): Promise<void> {
  await requireRole("admin");
  const supabase = await createClient();
  await supabase.from("customers").delete().eq("id", id);
  revalidatePath("/customers");
}
