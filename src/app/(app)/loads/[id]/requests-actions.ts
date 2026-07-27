"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { assignCarrier } from "../actions";

// msgplane's Load Requests: dispatchers log carrier offers by hand — the
// price, who called, and their dates — tagged CD or SD. Pure notebook; the
// only side effect is the optional per-row Dispatch, which routes through
// the same carrier-assignment rule as everything else.

export type RequestFormState = { error: string | null; ok?: boolean };

function dateOrNull(v: FormDataEntryValue | null): string | null {
  const s = (v || "").toString().trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function addLoadRequest(
  loadId: string,
  _prev: RequestFormState,
  formData: FormData
): Promise<RequestFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  const carrierName = (formData.get("carrier_name") || "").toString().trim().slice(0, 200);
  if (!carrierName) return { error: "Type the carrier name." };

  const priceRaw = (formData.get("price") || "").toString().trim();
  const price = priceRaw === "" ? null : Number(priceRaw.replace(/[$,]/g, ""));
  if (price != null && (Number.isNaN(price) || price < 0)) {
    return { error: "Price must be a positive amount." };
  }

  const sourceRaw = (formData.get("source") || "").toString();
  const source = sourceRaw === "cd" || sourceRaw === "sd" ? sourceRaw : null;
  const carrierId = (formData.get("carrier_id") || "").toString() || null;
  let phone = (formData.get("phone") || "").toString().trim().slice(0, 40) || null;
  let city = (formData.get("city") || "").toString().trim().slice(0, 120) || null;
  let state = (formData.get("state") || "").toString().trim().slice(0, 40) || null;

  const supabase = await createClient();
  // A picked directory carrier fills in whatever the form didn't.
  if (carrierId) {
    const { data: c } = await supabase
      .from("carriers")
      .select("phone, city, state")
      .eq("id", carrierId)
      .maybeSingle();
    if (c) {
      phone = phone || c.phone;
      city = city || c.city;
      state = state || c.state;
    }
  }

  const { error } = await supabase.from("load_requests").insert({
    load_id: loadId,
    price,
    carrier_id: carrierId,
    carrier_name: carrierName,
    phone,
    city,
    state,
    pickup_date: dateOrNull(formData.get("pickup_date")),
    delivery_date: dateOrNull(formData.get("delivery_date")),
    source,
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/loads/${loadId}`);
  return { error: null, ok: true };
}

export async function deleteLoadRequest(
  id: string,
  loadId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  const { error } = await supabase.from("load_requests").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/loads/${loadId}`);
  return { ok: true };
}

// Dispatch straight from a logged request. If the request was typed free-hand
// (no directory match), the carrier gets a directory record first — dispatch
// always means a real carrier on file.
export async function dispatchFromRequest(
  requestId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("load_requests")
    .select("id, load_id, carrier_id, carrier_name, phone, city, state")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "Request not found." };

  let carrierId = request.carrier_id as string | null;
  if (!carrierId) {
    const { data: created, error } = await supabase
      .from("carriers")
      .insert({
        company_name: request.carrier_name,
        phone: request.phone,
        city: request.city,
        state: request.state,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: error?.message ?? "Couldn't save carrier." };
    carrierId = created.id as string;
    await supabase.from("load_requests").update({ carrier_id: carrierId }).eq("id", requestId);
  }
  if (!carrierId) return { ok: false, error: "Couldn't resolve the carrier." };

  return assignCarrier(request.load_id, carrierId);
}
