"use server";

import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { isSmsConfigured, sendSms, toE164 } from "@/lib/messaging/ringcentral";
import { LOAD_STATUSES, type LoadStatus } from "@/types/database";

export type LoadFormState = { error: string | null };

// "" from an untouched form field must become null, not Number("") === 0.
const emptyToNullNumber = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().nullable()
);

const vehicleSchema = z.object({
  year: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().nullable()
  ).optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  vin: z.string().optional(),
  vehicle_type: z.string().optional(),
  condition: z.string().optional(),
  tariff: emptyToNullNumber.optional(),
});

const numeric = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? Number(v) : null));

const loadCoreSchema = z.object({
  pickup_address: z.string().optional(),
  pickup_city: z.string().optional(),
  pickup_state: z.string().optional(),
  pickup_zip: z.string().optional(),
  pickup_contact_name: z.string().optional(),
  pickup_contact_phone: z.string().optional(),
  pickup_company: z.string().optional(),
  pickup_contact_cell: z.string().optional(),
  pickup_ready_date: z.string().optional(),
  delivery_address: z.string().optional(),
  delivery_city: z.string().optional(),
  delivery_state: z.string().optional(),
  delivery_zip: z.string().optional(),
  delivery_contact_name: z.string().optional(),
  delivery_contact_phone: z.string().optional(),
  delivery_company: z.string().optional(),
  delivery_contact_cell: z.string().optional(),
  delivery_eta: z.string().optional(),
  transport_type: z.enum(["open", "enclosed", "driveaway"]),
  distance_miles: numeric,
  customer_rate: numeric,
  deposit_amount: numeric,
  balance_due: numeric,
  notes: z.string().optional(),
});

function coreValues(d: z.infer<typeof loadCoreSchema>) {
  return {
    pickup_address: d.pickup_address || null,
    pickup_city: d.pickup_city || null,
    pickup_state: d.pickup_state || null,
    pickup_zip: d.pickup_zip || null,
    pickup_contact_name: d.pickup_contact_name || null,
    pickup_contact_phone: d.pickup_contact_phone || null,
    pickup_company: d.pickup_company || null,
    pickup_contact_cell: d.pickup_contact_cell || null,
    pickup_ready_date: d.pickup_ready_date || null,
    delivery_address: d.delivery_address || null,
    delivery_city: d.delivery_city || null,
    delivery_state: d.delivery_state || null,
    delivery_zip: d.delivery_zip || null,
    delivery_contact_name: d.delivery_contact_name || null,
    delivery_contact_phone: d.delivery_contact_phone || null,
    delivery_company: d.delivery_company || null,
    delivery_contact_cell: d.delivery_contact_cell || null,
    delivery_eta: d.delivery_eta || null,
    transport_type: d.transport_type,
    distance_miles: d.distance_miles,
    customer_rate: d.customer_rate,
    deposit_amount: d.deposit_amount,
    balance_due: d.balance_due,
    notes: d.notes || null,
  };
}

export async function createLoad(
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  const customerName = (formData.get("customer_name") || "").toString().trim();
  const customerEmail = (formData.get("customer_email") || "").toString().trim();
  const customerPhone = (formData.get("customer_phone") || "").toString().trim();
  if (!customerName) return { error: "Customer name is required." };

  const parsedCore = loadCoreSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsedCore.success) {
    return { error: parsedCore.error.issues[0]?.message ?? "Invalid input" };
  }

  let vehicles: z.infer<typeof vehicleSchema>[] = [];
  try {
    const raw = JSON.parse((formData.get("vehicles_json") || "[]").toString());
    vehicles = z.array(vehicleSchema).parse(raw);
  } catch {
    return { error: "Invalid vehicle data." };
  }
  if (vehicles.length === 0) {
    return { error: "At least one vehicle is required." };
  }

  // Pipeline entry point: a priced record is a Quote, an unpriced one a Lead.
  const initialStatus = parsedCore.data.customer_rate != null ? ("quote" as const) : ("lead" as const);

  const supabase = await createClient();

  // Find-or-create the customer from the name/email/phone captured up front,
  // so a repeat customer's phone/email reuses their record instead of duping.
  //
  // The LOOKUP runs through the service-role client on purpose: sales reps'
  // RLS only shows their own customers, so a caller-scoped search would
  // re-create every cross-rep repeat customer. Only the matched id is used —
  // nothing else crosses back. The INSERT stays on the caller's client so the
  // normal RLS insert policy applies.
  const admin = createAdminClient();
  let customer_id: string | null = null;
  if (customerEmail) {
    // Escape LIKE wildcards: "_" is common in real emails and would otherwise
    // match any character ("john_doe@" would also match "johnadoe@").
    const escaped = customerEmail.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const { data } = await admin.from("customers").select("id").ilike("email", escaped).limit(1);
    if (data && data[0]) customer_id = data[0].id;
  }
  if (!customer_id && customerPhone.replace(/\D/g, "").length >= 10) {
    // Indexed exact match on the last 10 digits (same RPC the SMS webhook uses).
    const { data } = await admin.rpc("find_customer_by_phone", { p_phone: customerPhone });
    customer_id = (data as string | null) ?? null;
  }
  if (!customer_id) {
    const { data: newCust, error: custErr } = await supabase
      .from("customers")
      .insert({
        contact_name: customerName,
        email: customerEmail || null,
        phone: customerPhone || null,
        sales_owner_id: profile.role === "sales" ? profile.id : null,
      })
      .select("id")
      .single();
    if (custErr || !newCust) {
      console.error("Customer create failed:", custErr);
      return { error: "Could not create the customer — try again." };
    }
    customer_id = newCust.id;
  }

  // Carrier pay is derived, never taken from the client: the customer's total
  // minus the reservation fee we keep. That's the figure posted to CD/SD.
  const totalRate = parsedCore.data.customer_rate;
  const reservationFee = parsedCore.data.deposit_amount;
  const derivedCarrierPay =
    totalRate != null ? Math.max(0, Math.round((totalRate - (reservationFee ?? 0)) * 100) / 100) : null;

  // carrier_pay deliberately NOT in this payload: that column's INSERT is
  // revoked for the user client (margin protection) — it's written below via
  // the service role.
  const payload = {
    ...coreValues(parsedCore.data),
    customer_id,
    status: initialStatus,
    sales_owner_id: profile.role === "sales" ? profile.id : null,
  };

  const { data: seq, error: seqError } = await supabase.rpc("next_load_number");
  if (seqError || seq == null) {
    return { error: "Could not generate a load number — is migration 0004 applied?" };
  }

  // Id generated here instead of RETURNING: `.select()` after insert would
  // try to return the margin columns, which the user client can't read.
  const loadId = crypto.randomUUID();
  const { error: insertError } = await supabase
    .from("loads")
    .insert({ ...payload, id: loadId, load_number: `${seq}-US` });
  if (insertError) {
    console.error("Load insert failed:", insertError);
    return { error: "Could not create load — try again." };
  }
  const load = { id: loadId };

  if (derivedCarrierPay != null) {
    const { error: cpError } = await createAdminClient()
      .from("loads")
      .update({ carrier_pay: derivedCarrierPay })
      .eq("id", loadId);
    if (cpError) console.error("Setting derived carrier_pay failed:", cpError);
  }

  const { error: vehiclesError } = await supabase.from("load_vehicles").insert(
    vehicles.map((v) => ({
      load_id: load.id,
      year: v.year ?? null,
      make: v.make || null,
      model: v.model || null,
      vin: v.vin || null,
      vehicle_type: v.vehicle_type || "sedan",
      condition: v.condition || "running",
      tariff: v.tariff ?? null,
    }))
  );
  if (vehiclesError) {
    return { error: `Load created but vehicles failed to save: ${vehiclesError.message}` };
  }

  await supabase.from("load_status_history").insert({
    load_id: load.id,
    status: initialStatus,
    changed_by: profile.id,
    note: initialStatus === "quote" ? "Quote created" : "Lead created",
  });

  revalidatePath("/loads");
  redirect(`/loads/${load.id}`);
}

export async function updateLoad(
  id: string,
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  const parsedCore = loadCoreSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsedCore.success) {
    return { error: parsedCore.error.issues[0]?.message ?? "Invalid input" };
  }

  const values: Record<string, unknown> = coreValues(parsedCore.data);

  // Only admin/dispatcher may assign a carrier or set carrier pay — never
  // trust these fields from a sales-submitted form, regardless of what a
  // client sends, since that's how broker margin stays hidden from sales.
  const isManager = profile.role === "admin" || profile.role === "dispatcher";
  if (isManager) {
    const carrier_id = (formData.get("carrier_id") || "").toString();
    values.carrier_id = carrier_id || null;
    values.carrier_pay = numeric.parse(formData.get("carrier_pay")?.toString());
    if (carrier_id) values.dispatcher_id = profile.id;
  }

  const supabase = await createClient();
  // Carrier/margin columns are not writable through the user client (column
  // grants) — manager updates go through the service role AFTER the
  // requireRole check above.
  const writer = isManager ? createAdminClient() : supabase;
  const { error } = await writer.from("loads").update(values).eq("id", id);
  if (error) return { error: error.message };

  // "Save and convert to order" — only from lead/quote, re-checked here
  // rather than trusting the button's presence in the UI.
  if (formData.get("convert") === "1") {
    const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
    const { data: current } = await supabase.from(table).select("status").eq("id", id).single();
    if (current?.status === "quote" || current?.status === "lead") {
      const { error: convertError } = await supabase
        .from("loads")
        .update({ status: "ready" })
        .eq("id", id);
      if (!convertError) {
        await supabase.from("load_status_history").insert({
          load_id: id,
          status: "ready",
          changed_by: profile.id,
          note: "Converted to order",
        });
      }
    }
  }

  revalidatePath(`/loads/${id}`);
  revalidatePath("/loads");
  redirect(`/loads/${id}`);
}

// ---- Pipeline transitions ----
// Each re-reads the current status server-side and only advances from a
// permitted state, so a stale/forged button can't drive an invalid move.

async function transition(
  id: string,
  allowedFrom: LoadStatus[],
  updates: Record<string, unknown>,
  toStatus: LoadStatus,
  note: string
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data: current } = await supabase.from(table).select("status").eq("id", id).single();
  if (!current) return { ok: false, error: "Not found." };
  if (!allowedFrom.includes(current.status as LoadStatus)) {
    return { ok: false, error: `Can't do that from ${current.status}.` };
  }
  const { error } = await supabase
    .from("loads")
    .update({ status: toStatus, ...updates })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("load_status_history")
    .insert({ load_id: id, status: toStatus, changed_by: profile.id, note });

  revalidatePath(`/loads/${id}`);
  revalidatePath("/loads");
  revalidatePath("/leads");
  revalidatePath("/quotes");
  revalidatePath("/orders");
  return { ok: true };
}

export async function convertToQuote(id: string): Promise<void> {
  await transition(id, ["lead"], {}, "quote", "Priced — moved to Quotes");
}

// Standalone quote → order (the header button), separate from the edit-form
// convert path above.
export async function convertToOrder(id: string): Promise<void> {
  await transition(id, ["lead", "quote"], {}, "ready", "Converted to order");
}

export async function postOrder(id: string, board: "cd" | "sd" | "all"): Promise<void> {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {};
  let toStatus: LoadStatus = "posted_cd";
  if (board === "sd") {
    updates.posted_to_super_dispatch_at = now;
    toStatus = "posted_sd";
  } else if (board === "all") {
    updates.posted_to_central_dispatch_at = now;
    updates.posted_to_super_dispatch_at = now;
    toStatus = "posted_cd";
  } else {
    updates.posted_to_central_dispatch_at = now;
    toStatus = "posted_cd";
  }
  const label = board === "all" ? "All boards" : board.toUpperCase();
  await transition(id, ["ready", "booked"], updates, toStatus, `Posted to ${label}`);
}

export async function unpostOrder(id: string): Promise<void> {
  await transition(
    id,
    ["posted_cd", "posted_sd", "dispatched"],
    {
      posted_to_central_dispatch_at: null,
      posted_to_super_dispatch_at: null,
      cd_external_id: null,
      sd_external_id: null,
    },
    "ready",
    "Unposted — back to Ready"
  );
}

export async function dispatchOrder(id: string): Promise<void> {
  await transition(
    id,
    ["posted_cd", "posted_sd", "ready", "booked"],
    { dispatched_at: new Date().toISOString().slice(0, 10) },
    "dispatched",
    "Dispatched"
  );
}

export async function markPickedUp(id: string): Promise<void> {
  await transition(
    id,
    ["dispatched", "in_transit"],
    { picked_up_at: new Date().toISOString().slice(0, 10) },
    "picked_up",
    "Picked up"
  );
}

export async function markDelivered(id: string): Promise<void> {
  await transition(
    id,
    ["picked_up", "in_transit", "dispatched"],
    { delivered_at: new Date().toISOString().slice(0, 10) },
    "delivered",
    "Delivered"
  );
}

export async function holdOrder(id: string): Promise<void> {
  await transition(id, ["ready", "posted_cd", "posted_sd", "booked"], {}, "hold", "Put on hold");
}

export async function archiveOrder(id: string): Promise<void> {
  await transition(
    id,
    ["delivered", "invoiced", "paid", "hold"],
    {},
    "archived",
    "Archived"
  );
}

export async function reactivateOrder(id: string): Promise<void> {
  await transition(id, ["hold", "archived", "lost", "cancelled"], {}, "ready", "Reactivated");
}

// Resend the posting notification without changing status (no board API yet,
// so this just records that we re-sent it).
export async function resendPost(id: string): Promise<void> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data: current } = await supabase.from(table).select("status").eq("id", id).single();
  if (!current) return;
  await supabase.from("load_status_history").insert({
    load_id: id,
    status: current.status as LoadStatus,
    changed_by: profile.id,
    note: "Re-sent to load board",
  });
  revalidatePath(`/loads/${id}`);
}

export async function markLost(id: string, _prevState: LoadFormState, formData: FormData): Promise<LoadFormState> {
  const reason = (formData.get("lost_reason") || "").toString().trim() || null;
  const profile = await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data: current } = await supabase.from(table).select("status").eq("id", id).single();
  if (!current) return { error: "Not found." };
  const { error } = await supabase
    .from("loads")
    .update({ status: "lost", lost_reason: reason })
    .eq("id", id);
  if (error) return { error: error.message };
  await supabase.from("load_status_history").insert({
    load_id: id,
    status: "lost",
    changed_by: profile.id,
    note: reason ? `Marked lost — ${reason}` : "Marked lost",
  });
  revalidatePath(`/loads/${id}`);
  revalidatePath("/orders");
  revalidatePath("/quotes");
  return { error: null };
}

// Records a customer payment against the order (adds to received_amount).
export async function recordPayment(
  id: string,
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const amount = Number((formData.get("amount") || "").toString());
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a payment amount greater than 0." };
  }
  const supabase = await createClient();
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data: current } = await supabase
    .from(table)
    .select("received_amount, status")
    .eq("id", id)
    .single();
  if (!current) return { error: "Not found." };

  const newReceived = Number(current.received_amount ?? 0) + amount;
  const { error } = await supabase
    .from("loads")
    .update({ received_amount: newReceived })
    .eq("id", id);
  if (error) return { error: error.message };

  const method = (formData.get("method") || "").toString().trim();
  await supabase.from("load_status_history").insert({
    load_id: id,
    status: current.status as LoadStatus,
    changed_by: profile.id,
    note: `Payment received: $${amount}${method ? ` (${method})` : ""}`,
  });
  revalidatePath(`/loads/${id}`);
  return { error: null };
}

const statusSchema = z.enum(LOAD_STATUSES as [string, ...string[]]);

export async function updateLoadStatus(
  id: string,
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  const parsed = statusSchema.safeParse(formData.get("status"));
  if (!parsed.success) return { error: "Invalid status." };
  const note = (formData.get("note") || "").toString().trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("loads").update({ status: parsed.data }).eq("id", id);
  if (error) return { error: error.message };

  await supabase
    .from("load_status_history")
    .insert({ load_id: id, status: parsed.data, changed_by: profile.id, note });

  revalidatePath(`/loads/${id}`);
  revalidatePath("/loads");
  return { error: null };
}

export async function deleteLoad(id: string): Promise<void> {
  await requireRole("admin");
  const supabase = await createClient();
  await supabase.from("loads").delete().eq("id", id);
  revalidatePath("/loads");
}

// Per-vehicle tariffs, saved in one submit: inputs are named tariff_<vehicleId>.
export async function saveVehicleTariffs(
  loadId: string,
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("tariff_")) continue;
    const vehicleId = key.slice("tariff_".length);
    const raw = value.toString().trim();
    const tariff = raw === "" ? null : Number(raw);
    if (tariff !== null && (Number.isNaN(tariff) || tariff < 0)) {
      return { error: "Tariff must be a positive number." };
    }
    const { error } = await supabase
      .from("load_vehicles")
      .update({ tariff })
      .eq("id", vehicleId)
      .eq("load_id", loadId);
    if (error) return { error: error.message };
  }

  revalidatePath(`/loads/${loadId}`);
  return { error: null };
}

// Duplicate a load: everything copies over, the new load gets the next
// sequential number WITHOUT the hyphen (msgplane convention for duplicates:
// 22222222-US -> 22222223US).
export async function duplicateLoad(id: string): Promise<void> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  // Sales reps read via the safe view, so a sales-made duplicate simply
  // won't carry carrier_pay — consistent with what they're allowed to see.
  // Managers read loads_full (base-table select("*") would hit the revoked
  // margin columns).
  const table = profile.role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE;
  const { data: source } = await supabase.from(table).select("*").eq("id", id).single();
  if (!source) return;

  const { data: seq, error: seqError } = await supabase.rpc("next_load_number");
  if (seqError || seq == null) return;

  const copy = { ...(source as Record<string, unknown>) };
  const sourceNumber = copy.load_number as string;
  delete copy.id;
  delete copy.load_number;
  delete copy.created_at;
  delete copy.updated_at;
  // A duplicate is a NEW deal: it must not inherit the source's signature or
  // its signing token (contract_token is UNIQUE — copying it fails the insert).
  delete copy.contract_token;
  delete copy.contract_sent_at;
  delete copy.contract_signed_ip;
  delete copy.contract_signed_name;
  delete copy.contract_signed_email;
  delete copy.date_signed;

  // Service role: an admin's copy carries carrier_pay (column-revoked for the
  // user client), and sales need the RETURNING row despite having no SELECT
  // policy on the base table. Role check happened above; sales copies come
  // from the safe view, so they can't smuggle margin fields in.
  const { data: newLoad, error } = await createAdminClient()
    .from("loads")
    .insert({ ...copy, load_number: `${seq}US` })
    .select()
    .single();
  if (error || !newLoad) {
    console.error("Duplicate load failed:", error);
    return;
  }

  const { data: vehicles } = await supabase
    .from("load_vehicles")
    .select("year, make, model, vin, vehicle_type, condition, tariff, notes")
    .eq("load_id", id);
  if (vehicles && vehicles.length > 0) {
    await supabase
      .from("load_vehicles")
      .insert(vehicles.map((v) => ({ ...v, load_id: newLoad.id })));
  }

  await supabase.from("load_status_history").insert({
    load_id: newLoad.id,
    status: newLoad.status,
    changed_by: profile.id,
    note: `Duplicated from ${sourceNumber}`,
  });

  revalidatePath("/loads");
  redirect(`/loads/${newLoad.id}`);
}

// ---- E-sign ----
// A per-order signing link the customer opens at /sign/<token>. "Send" marks
// it sent (and can text the link via RingCentral); the customer signs on that
// public page; staff can also mark it signed manually.

function appBaseUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  return vercel ? `https://${vercel}` : "";
}

export type EsignState = { error: string | null; link?: string; sentVia?: string };

// Ensures the load has a signing token, records the send, and optionally texts
// the link to the customer. `resend` uses the same path.
export async function sendContract(
  loadId: string,
  _prevState: EsignState,
  formData: FormData
): Promise<EsignState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const viaSms = formData.get("via") === "sms";
  const supabase = await createClient();

  const { data: load } = await supabase
    .from("loads")
    .select("contract_token, customer_id")
    .eq("id", loadId)
    .single();
  if (!load) return { error: "Order not found." };

  let token = load.contract_token as string | null;
  if (!token) {
    const { randomUUID } = await import("node:crypto");
    token = randomUUID();
  }

  const { error } = await supabase
    .from("loads")
    .update({ contract_token: token, contract_sent_at: new Date().toISOString() })
    .eq("id", loadId);
  if (error) return { error: error.message };

  const base = appBaseUrl();
  const link = base ? `${base}/sign/${token}` : `/sign/${token}`;

  let sentVia: string | undefined;
  if (viaSms) {
    const { data: customer } = await supabase
      .from("customers")
      .select("phone, sms_opt_out")
      .eq("id", load.customer_id)
      .single();
    const to = toE164(customer?.phone);
    if (customer?.sms_opt_out) return { error: "Customer opted out of SMS — can't text the link.", link };
    if (!to) return { error: "No valid customer phone on file to text the link.", link };
    if (!isSmsConfigured()) return { error: "SMS isn't connected yet — copy the link and send it manually.", link };
    if (!base) return { error: "Set NEXT_PUBLIC_APP_URL so the link is a full URL.", link };
    try {
      await sendSms(to, `Please review and sign your vehicle transport agreement: ${link}`);
      sentVia = "sms";
    } catch (err) {
      console.error("E-sign SMS failed:", err);
      return { error: "Couldn't text the link — copy it and send manually.", link };
    }
  }

  await supabase.from("load_status_history").insert({
    load_id: loadId,
    status: "quote" as LoadStatus, // history note only; status unchanged
    changed_by: profile.id,
    note: sentVia === "sms" ? "Contract texted to customer" : "Contract link generated",
  });

  revalidatePath(`/loads/${loadId}`);
  return { error: null, link, sentVia };
}

// Staff override: mark the contract signed without the customer using the link.
export async function markContractSigned(loadId: string): Promise<void> {
  const profile = await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  const { error } = await supabase
    .from("loads")
    .update({ date_signed: new Date().toISOString() })
    .eq("id", loadId);
  if (error) return;
  await supabase.from("load_status_history").insert({
    load_id: loadId,
    status: "quote" as LoadStatus,
    changed_by: profile.id,
    note: "Contract marked signed (manual)",
  });
  revalidatePath(`/loads/${loadId}`);
}

// Clear a signature (e.g. sent in error), so it can be re-sent. Rotates the
// signing token so any previously shared link stops working.
export async function voidSignature(loadId: string): Promise<void> {
  const profile = await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  const { error } = await supabase
    .from("loads")
    .update({
      date_signed: null,
      contract_signed_ip: null,
      contract_signed_name: null,
      contract_signed_email: null,
      contract_sent_at: null,
      contract_token: crypto.randomUUID(),
    })
    .eq("id", loadId);
  if (error) return;
  await supabase.from("load_status_history").insert({
    load_id: loadId,
    status: "quote" as LoadStatus,
    changed_by: profile.id,
    note: "Signature voided",
  });
  revalidatePath(`/loads/${loadId}`);
}

// ---- Follow-ups ----

const FOLLOW_UP_PRESET_DAYS: Record<string, number> = {
  "1d": 1,
  "2d": 2,
  "3d": 3,
  "1w": 7,
};

export async function setFollowUp(
  id: string,
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  await requireRole("admin", "dispatcher", "sales");

  const preset = (formData.get("preset") || "").toString();
  const custom = (formData.get("follow_up_at") || "").toString();
  const note = (formData.get("follow_up_note") || "").toString().trim() || null;

  let followUpAt: Date;
  if (preset && FOLLOW_UP_PRESET_DAYS[preset]) {
    followUpAt = new Date();
    followUpAt.setDate(followUpAt.getDate() + FOLLOW_UP_PRESET_DAYS[preset]);
  } else if (custom) {
    followUpAt = new Date(custom);
    if (Number.isNaN(followUpAt.getTime())) return { error: "Invalid follow-up date." };
  } else {
    return { error: "Pick a follow-up time." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("loads")
    .update({ follow_up_at: followUpAt.toISOString(), follow_up_note: note })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/loads/${id}`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function clearFollowUp(id: string): Promise<void> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  await supabase
    .from("loads")
    .update({ follow_up_at: null, follow_up_note: null })
    .eq("id", id);
  revalidatePath(`/loads/${id}`);
  revalidatePath("/dashboard");
}

// ---- Vehicles (edit after creation) ----

export async function addVehicle(
  loadId: string,
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  await requireRole("admin", "dispatcher", "sales");

  const year = (formData.get("year") || "").toString().trim();
  const tariffRaw = (formData.get("tariff") || "").toString().trim();
  const supabase = await createClient();
  const { error } = await supabase.from("load_vehicles").insert({
    load_id: loadId,
    year: year ? Number(year) : null,
    make: (formData.get("make") || "").toString().trim() || null,
    model: (formData.get("model") || "").toString().trim() || null,
    vin: (formData.get("vin") || "").toString().trim() || null,
    vehicle_type: (formData.get("vehicle_type") || "sedan").toString(),
    condition: (formData.get("condition") || "running").toString(),
    tariff: tariffRaw && !Number.isNaN(Number(tariffRaw)) ? Number(tariffRaw) : null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/loads/${loadId}`);
  return { error: null };
}

export async function removeVehicle(loadId: string, vehicleId: string): Promise<void> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  await supabase.from("load_vehicles").delete().eq("id", vehicleId).eq("load_id", loadId);
  revalidatePath(`/loads/${loadId}`);
}

// ---- Bulk actions (list selection) ----
// Applied to whatever rows are checked in the Leads/Quotes/Orders list.

function revalidatePipeline() {
  revalidatePath("/leads");
  revalidatePath("/quotes");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
}

export async function bulkReassign(loadIds: string[], repId: string): Promise<void> {
  await requireRole("admin", "dispatcher");
  if (loadIds.length === 0) return;
  const supabase = await createClient();
  await supabase.from("loads").update({ sales_owner_id: repId || null }).in("id", loadIds);
  revalidatePipeline();
}

export async function bulkSetFollowUp(loadIds: string[], preset: string): Promise<void> {
  await requireRole("admin", "dispatcher", "sales");
  const days = FOLLOW_UP_PRESET_DAYS[preset];
  if (loadIds.length === 0 || !days) return;
  const followUpAt = new Date();
  followUpAt.setDate(followUpAt.getDate() + days);
  const supabase = await createClient();
  await supabase
    .from("loads")
    .update({ follow_up_at: followUpAt.toISOString() })
    .in("id", loadIds);
  revalidatePipeline();
}

// Flag/unflag a customer as blacklisted (from the order ⋯ menu).
export async function toggleBlacklist(customerId: string, on: boolean): Promise<void> {
  await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  await supabase.from("customers").update({ blacklisted: on }).eq("id", customerId);
  revalidatePipeline();
  revalidatePath(`/customers/${customerId}`);
}

export async function bulkSms(
  loadIds: string[],
  body: string
): Promise<{ sent: number; failed: number; skipped: number }> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const text = body.trim();
  if (loadIds.length === 0 || !text) return { sent: 0, failed: 0, skipped: 0 };

  const supabase = await createClient();
  const { data: loads } = await supabase.from("loads").select("id, customer_id").in("id", loadIds);
  const customerIds = [...new Set((loads ?? []).map((l) => l.customer_id).filter(Boolean))];
  const { data: customers } = customerIds.length
    ? await supabase.from("customers").select("id, phone, sms_opt_out").in("id", customerIds)
    : { data: [] as { id: string; phone: string | null; sms_opt_out: boolean }[] };
  const custById = new Map((customers ?? []).map((c) => [c.id, c]));

  const ready = isSmsConfigured();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const l of loads ?? []) {
    const c = custById.get(l.customer_id);
    const to = toE164(c?.phone);
    if (!c || c.sms_opt_out || !to || !ready) {
      skipped++;
      continue;
    }
    let status = "sent";
    try {
      await sendSms(to, text);
      sent++;
    } catch (err) {
      console.error(`Bulk SMS to ${to} failed:`, err);
      status = "failed";
      failed++;
    }
    await supabase.from("messages").insert({
      customer_id: c.id,
      load_id: l.id,
      channel: "sms",
      direction: "outbound",
      to_addr: to,
      body: text,
      status,
      sent_by: profile.id,
    });
  }

  revalidatePath("/messages");
  return { sent, failed, skipped };
}
