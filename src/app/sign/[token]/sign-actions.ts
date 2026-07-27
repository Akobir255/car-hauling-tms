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
    .select("id, date_signed, contract_signed_name, contract_sent_at, contract_requires_card")
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

  // Card-required contracts: validate the MASKED card details. The full card
  // number and CVV never reach this server — the signing page strips them
  // client-side and submits brand/last4/expiry/billing only.
  type CardInsert = {
    cardholder_first: string;
    cardholder_last: string;
    brand: string | null;
    last4: string;
    exp_month: number;
    exp_year: number;
    billing_address: string | null;
    billing_city: string | null;
    billing_state: string | null;
    billing_zip: string | null;
  };
  let card: CardInsert | null = null;
  if (load.contract_requires_card) {
    const first = (formData.get("card_first") || "").toString().trim().slice(0, 80);
    const last = (formData.get("card_last") || "").toString().trim().slice(0, 80);
    const last4 = (formData.get("card_last4") || "").toString().trim();
    const brand = (formData.get("card_brand") || "").toString().trim().slice(0, 20) || null;
    const exp = (formData.get("card_exp") || "").toString().trim();
    const expMatch = exp.match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!first || !last) {
      return { error: "Please enter the cardholder's first and last name.", signed: false };
    }
    if (!/^\d{4}$/.test(last4)) {
      return { error: "Please enter your card number.", signed: false };
    }
    if (!expMatch) {
      return { error: "Please enter the card expiry as MM/YY.", signed: false };
    }
    const expMonth = Number(expMatch[1]);
    const expYear = 2000 + Number(expMatch[2]);
    const now = new Date();
    if (expMonth < 1 || expMonth > 12) {
      return { error: "Please enter the card expiry as MM/YY.", signed: false };
    }
    if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
      return { error: "That card looks expired — please use another one.", signed: false };
    }
    card = {
      cardholder_first: first,
      cardholder_last: last,
      brand,
      last4,
      exp_month: expMonth,
      exp_year: expYear,
      billing_address: (formData.get("billing_address") || "").toString().trim().slice(0, 200) || null,
      billing_city: (formData.get("billing_city") || "").toString().trim().slice(0, 120) || null,
      billing_state: (formData.get("billing_state") || "").toString().trim().slice(0, 40) || null,
      billing_zip: (formData.get("billing_zip") || "").toString().trim().slice(0, 12) || null,
    };
  }

  // Optional drawn signature (PNG data URL from the pad). Size-capped; the
  // typed name remains the signature of record either way.
  let signatureImage = (formData.get("signature_image") || "").toString();
  if (!signatureImage.startsWith("data:image/png;base64,") || signatureImage.length > 300_000) {
    signatureImage = "";
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

  // Stamp the signed version (view-all shows which document was executed)
  // and keep the drawn signature with it.
  const { data: version } = await supabase
    .from("contract_versions")
    .select("id")
    .eq("token", token)
    .maybeSingle();
  if (version) {
    await supabase
      .from("contract_versions")
      .update({
        signed_at: new Date().toISOString(),
        signed_name: fullName,
        signature_image: signatureImage || null,
      })
      .eq("id", version.id);
  }

  // Card on file (masked). Written only here, only through the service role.
  if (card) {
    await supabase
      .from("contract_cards")
      .insert({ load_id: load.id, contract_version_id: version?.id ?? null, ...card });
  }

  await supabase.from("load_status_history").insert({
    load_id: load.id,
    status: "quote",
    changed_by: null,
    note: `Contract signed by ${fullName}`,
  });

  revalidatePath(`/loads/${load.id}`);
  return { error: null, signed: true, signedName: fullName };
}
