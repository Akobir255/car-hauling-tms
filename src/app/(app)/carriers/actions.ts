"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export type CarrierFormState = { error: string | null };

const carrierSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  mc_number: z.string().optional(),
  dot_number: z.string().optional(),
  contact_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.literal(""), z.string().email("Invalid email")]),
  address: z.string().optional(),
  insurance_carrier: z.string().optional(),
  insurance_policy_number: z.string().optional(),
  coi_expiry_date: z.string().optional(),
  safety_rating: z.string().optional(),
  notes: z.string().optional(),
});

function parseCarrierForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const parsed = carrierSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  return {
    success: true as const,
    values: {
      company_name: d.company_name,
      mc_number: d.mc_number || null,
      dot_number: d.dot_number || null,
      contact_name: d.contact_name || null,
      phone: d.phone || null,
      email: d.email || null,
      address: d.address || null,
      insurance_carrier: d.insurance_carrier || null,
      insurance_policy_number: d.insurance_policy_number || null,
      coi_expiry_date: d.coi_expiry_date || null,
      safety_rating: d.safety_rating || null,
      notes: d.notes || null,
      equipment_types: formData.getAll("equipment_types").map(String),
      preferred: formData.get("preferred") === "on",
      blacklisted: formData.get("blacklisted") === "on",
    },
  };
}

export async function createCarrier(
  _prevState: CarrierFormState,
  formData: FormData
): Promise<CarrierFormState> {
  const profile = await requireRole("admin", "dispatcher");
  const parsed = parseCarrierForm(formData);
  if (!parsed.success) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("carriers")
    .insert({ ...parsed.values, created_by: profile.id });
  if (error) return { error: error.message };

  revalidatePath("/carriers");
  redirect("/carriers");
}

export async function updateCarrier(
  id: string,
  _prevState: CarrierFormState,
  formData: FormData
): Promise<CarrierFormState> {
  await requireRole("admin", "dispatcher");
  const parsed = parseCarrierForm(formData);
  if (!parsed.success) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("carriers").update(parsed.values).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/carriers");
  redirect("/carriers");
}

export async function deleteCarrier(id: string): Promise<void> {
  await requireRole("admin");
  const supabase = await createClient();
  await supabase.from("carriers").delete().eq("id", id);
  revalidatePath("/carriers");
}
