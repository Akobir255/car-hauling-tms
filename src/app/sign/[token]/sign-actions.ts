"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isContractLinkExpired } from "@/lib/esign-terms";

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
  const email = (formData.get("email") || "").toString().trim().toLowerCase();
  const agreed = formData.get("agree") === "on";

  const supabase = createAdminClient();

  const { data: load } = await supabase
    .from("loads")
    .select("id, date_signed, contract_signed_name, contract_sent_at")
    .eq("contract_token", token)
    .maybeSingle();

  if (!load) return { error: "This contract link is invalid or expired.", signed: false };
  if (load.date_signed) {
    return { error: null, signed: true, signedName: load.contract_signed_name };
  }
  // A token only becomes signable once the contract was formally sent —
  // otherwise every load's default token would be signable forever.
  if (!load.contract_sent_at) {
    return {
      error: "This contract hasn't been sent for signature yet — please ask your agent.",
      signed: false,
    };
  }
  if (isContractLinkExpired(load.contract_sent_at, load.date_signed)) {
    return {
      error: "This signing link has expired — please ask your agent to send a fresh one.",
      signed: false,
    };
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address.", signed: false };
  }

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const ua = (hdrs.get("user-agent") || "").slice(0, 300) || null;

  // Atomic: the `is("date_signed", null)` condition means exactly one of two
  // concurrent submissions can win; `.select("id")` tells us whether we did.
  const { data: updated, error } = await supabase
    .from("loads")
    .update({
      date_signed: new Date().toISOString(),
      contract_signed_ip: ip,
      contract_signed_name: fullName,
      contract_signed_email: email,
    })
    .eq("contract_token", token)
    .is("date_signed", null)
    .select("id");
  if (error) return { error: "Something went wrong — please try again.", signed: false };
  if (!updated || updated.length === 0) {
    // Lost the race — someone signed a moment ago. Report their signature,
    // and log nothing: only the winning request writes audit rows.
    const { data: current } = await supabase
      .from("loads")
      .select("contract_signed_name")
      .eq("contract_token", token)
      .maybeSingle();
    return { error: null, signed: true, signedName: current?.contract_signed_name ?? null };
  }

  // Audit: the signing event, distinguishable from mere opens.
  await supabase
    .from("contract_events")
    .insert({ load_id: load.id, event: "signed", ip, user_agent: ua });

  await supabase.from("load_status_history").insert({
    load_id: load.id,
    status: "quote",
    changed_by: null,
    note: `Contract signed by ${fullName}`,
  });

  revalidatePath(`/loads/${load.id}`);
  return { error: null, signed: true, signedName: fullName };
}
