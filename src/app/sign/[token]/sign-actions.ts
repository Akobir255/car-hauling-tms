"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// Public sign action — NO login. Authenticates by the unguessable token, uses
// the service-role client (RLS bypassed) exactly like the inbound webhooks.
// Idempotent: signing an already-signed contract is a no-op.
export async function signByToken(
  token: string,
  _prevState: { error: string | null; signed: boolean },
  _formData: FormData
): Promise<{ error: string | null; signed: boolean }> {
  const supabase = createAdminClient();

  const { data: load } = await supabase
    .from("loads")
    .select("id, date_signed")
    .eq("contract_token", token)
    .maybeSingle();

  if (!load) return { error: "This contract link is invalid or expired.", signed: false };
  if (load.date_signed) return { error: null, signed: true };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") || "").split(",")[0].trim() || null;

  const { error } = await supabase
    .from("loads")
    .update({ date_signed: new Date().toISOString(), contract_signed_ip: ip })
    .eq("contract_token", token)
    .is("date_signed", null);
  if (error) return { error: "Something went wrong — please try again.", signed: false };

  await supabase.from("load_status_history").insert({
    load_id: load.id,
    status: "quote",
    changed_by: null,
    note: "Contract signed by customer",
  });

  revalidatePath(`/loads/${load.id}`);
  return { error: null, signed: true };
}
