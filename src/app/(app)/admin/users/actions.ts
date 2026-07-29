"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

export type UserFormState = { error: string | null; success?: string | null };

const createSchema = z.object({
  email: z.string().email("Invalid email"),
  full_name: z.string().min(1, "Name is required"),
  role: z.enum(["admin", "dispatcher", "sales"]),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Accounts are created outright, with the password the admin chose — no
// invitation email, no set-password link to chase. Onboarding 200 agents by
// waiting for 200 people to click a link is not a workable afternoon.
export async function createUser(
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireRole("admin");
  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, full_name, role, password } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    // Confirmed on creation: there is no invite mail to click, and the second
    // factor at sign-in is what proves the person holds the mailbox.
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) {
    return {
      error: /already/i.test(error.message)
        ? `${email} already has an account.`
        : error.message,
    };
  }
  if (!data.user) return { error: "Account was not created. Try again." };

  // handle_new_user() creates the profile and always assigns 'sales', ignoring
  // any role in metadata — deliberately, so a signup cannot elevate itself.
  // Applying the real role is trusted admin-only work, done here.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name, role, active: true })
    .eq("id", data.user.id);
  if (profileError) {
    return { error: `Account created, but the profile update failed: ${profileError.message}` };
  }

  revalidatePath("/admin/users");
  // The password is never echoed back — the admin typed it and it is not this
  // server's job to repeat a credential into a response body or a toast.
  return { error: null, success: `${email} can sign in now.` };
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
