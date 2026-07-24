"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export type SignState = { error: string | null; signed: boolean; signedName?: string | null };

// Public sign action — NO login. Authenticates by the unguessable token, uses
// the service-role client (RLS bypassed) exactly like the inbound webhooks.
// The click-wrap record = typed full name + IP + timestamp. Idempotent:
// signing an already-signed contract is a no-op that reports who signed.
export async function signByToken(
  token: string,
  _prevState: SignState,
  formData: FormData
): Promise<SignState> {
  const fullName = (formData.get("full_name") || "").toString().trim().replace(/\s+/g, " ");
  const agreed = formData.get("agree") === "on";

  const supabase = createAdminClient();

  const { data: load } = await supabase
    .from("loads")
    .select("id, date_signed, contract_signed_name")
    .eq("contract_token", token)
    .maybeSingle();

  if (!load) return { error: "This contract link is invalid or expired.", signed: false };
  if (load.date_signed) {
    return { error: null, signed: true, signedName: load.contract_signed_name };
  }

  if (!agreed) {
    return { error: "Please check the box to confirm you agree to the terms.", signed: false };
  }
  if (fullName.length < 3 || !/[a-z]/i.test(fullName)) {
    return { error: "Please type your full legal name as your signature.", signed: false };
  }
  if (fullName.length > 100) {
    return { error: "That name is too long.", signed: false };
  }

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") || "").split(",")[0].trim() || null;

  const { error } = await supabase
    .from("loads")
    .update({
      date_signed: new Date().toISOString(),
      contract_signed_ip: ip,
      contract_signed_name: fullName,
    })
    .eq("contract_token", token)
    .is("date_signed", null);
  if (error) return { error: "Something went wrong — please try again.", signed: false };

  await supabase.from("load_status_history").insert({
    load_id: load.id,
    status: "quote",
    changed_by: null,
    note: `Contract signed by ${fullName}`,
  });

  revalidatePath(`/loads/${load.id}`);
  return { error: null, signed: true, signedName: fullName };
}
