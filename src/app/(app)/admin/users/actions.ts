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

// Set a new password for somebody else.
//
// There is deliberately no "show me their current password" counterpart, and
// there cannot be one: Supabase stores a one-way hash, so the plaintext does
// not exist anywhere to be shown. Keeping a readable copy so an admin could
// look it up would mean storing 200 employees' passwords in a form a leaked
// backup hands straight to an attacker — and most people reuse passwords, so
// the damage would not stop at this system. Resetting and handing over the new
// one does the same job without ever holding the old.
export async function setUserPassword(
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireRole("admin");
  const id = (formData.get("id") || "").toString();
  const password = (formData.get("password") || "").toString();
  if (!id) return { error: "No user selected." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("email")
    .eq("id", id)
    .maybeSingle();
  if (!target) return { error: "That user no longer exists." };

  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return { error: error.message };

  // Boot any session they already had. Our gate treats a session with no
  // verified row as stale and signs it out on its next request, so clearing
  // these is what stops the old password's session outliving the reset.
  await admin.from("login_verifications").delete().eq("user_id", id);
  await admin.from("pending_logins").delete().eq("user_id", id);

  revalidatePath("/admin/users");
  return { error: null, success: `New password set for ${target.email}. They are signed out everywhere.` };
}

// Removing a person from the system.
//
// Every foreign key into profiles is NO ACTION, so a plain delete fails the
// moment someone has touched anything — which is everyone. The references
// split into two kinds and they must NOT be treated the same:
//
//   OWNERSHIP  (who works this account) — moves to whoever takes over.
//   AUTHORSHIP (who wrote this note, who changed this status) — is set to
//              NULL. Reassigning it would put one person's words in another
//              person's mouth, which is falsifying a record, not tidying one.
//
// The app already renders a null author as "Unknown", so history survives
// readable; it just stops naming someone who no longer exists.
const OWNERSHIP: [string, string][] = [
  ["customers", "sales_owner_id"],
  ["loads", "sales_owner_id"],
  ["loads", "dispatcher_id"],
  ["tickets", "assigned_to"],
];
const AUTHORSHIP: [string, string][] = [
  ["carriers", "created_by"],
  // 0049: the status history is a VIEW now, and a view is not updatable — the
  // authorship it carries lives on load_events.actor_user_id.
  ["load_events", "actor_user_id"],
  // The 0049 rollback copy still carries `changed_by uuid references profiles`
  // with no ON DELETE, so leaving it out here does not merely skip a table — it
  // makes deleteUser fail outright on the profiles cascade. Goes away with the
  // migration that drops the copy.
  ["load_status_history_pre_0049", "changed_by"],
  ["documents", "uploaded_by"],
  ["messages", "sent_by"],
  ["message_templates", "created_by"],
  ["tickets", "created_by"],
  ["ticket_comments", "author_id"],
  ["load_notes", "author_id"],
  ["load_requests", "created_by"],
  ["contract_versions", "created_by"],
  ["sms_suppressions", "created_by"],
];

export async function deleteUser(
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const me = await requireRole("admin");
  const id = (formData.get("id") || "").toString();
  const reassignTo = (formData.get("reassign_to") || "").toString() || null;
  if (!id) return { error: "No user selected." };
  if (id === me.id) return { error: "You cannot delete your own account." };
  if (reassignTo === id) return { error: "Reassign the work to somebody else." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("id", id)
    .maybeSingle();
  if (!target) return { error: "That user no longer exists." };

  // Never leave the system without a way back in.
  if (target.role === "admin") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("active", true);
    if ((count ?? 0) <= 1) {
      return { error: "This is the last active admin. Promote somebody else first." };
    }
  }

  for (const [table, column] of OWNERSHIP) {
    const { error } = await admin.from(table).update({ [column]: reassignTo }).eq(column, id);
    if (error) return { error: `Could not reassign ${table}.${column}: ${error.message}` };
  }
  for (const [table, column] of AUTHORSHIP) {
    const { error } = await admin.from(table).update({ [column]: null }).eq(column, id);
    if (error) return { error: `Could not clear ${table}.${column}: ${error.message}` };
  }

  // profiles.id references auth.users on delete cascade, so removing the auth
  // user removes the profile with it.
  const { error: delError } = await admin.auth.admin.deleteUser(id);
  if (delError) return { error: delError.message };

  revalidatePath("/admin/users");
  return {
    error: null,
    success: reassignTo
      ? `${target.email} deleted; their accounts were reassigned.`
      : `${target.email} deleted; their accounts are now unassigned.`,
  };
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
