"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

export type UserFormState = { error: string | null; success?: string | null };

const inviteSchema = z.object({
  email: z.string().email("Invalid email"),
  full_name: z.string().min(1, "Name is required"),
  role: z.enum(["admin", "dispatcher", "sales"]),
});

export async function inviteUser(
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireRole("admin");
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, full_name, role } = parsed.data;

  // Send invitees to the in-app set-password page on whatever host the
  // admin is using (production URL in prod, localhost in dev).
  const hdrs = await headers();
  const forwardedHost = hdrs.get("x-forwarded-host");
  const origin =
    hdrs.get("origin") ??
    (forwardedHost
      ? `${hdrs.get("x-forwarded-proto") ?? "https"}://${forwardedHost}`
      : "http://localhost:3000");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role },
    redirectTo: `${origin}/set-password`,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { error: null, success: `Invite sent to ${email}.` };
}

export async function updateUserRole(id: string, formData: FormData): Promise<void> {
  await requireRole("admin");
  const role = (formData.get("role") || "").toString();
  const active = formData.get("active") === "on";
  if (!["admin", "dispatcher", "sales"].includes(role)) return;

  const supabase = await createClient();
  await supabase.from("profiles").update({ role, active }).eq("id", id);
  revalidatePath("/admin/users");
}
