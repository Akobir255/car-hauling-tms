"use server";

import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { isSmsConfigured, sendSms, toE164 } from "@/lib/messaging/ringcentral";
import { isEmailConfigured, isPlausibleEmail, sendEmail, sendEmailBatch } from "@/lib/messaging/email";
import { buildContext, renderTemplate } from "@/lib/messaging/render";
import { SMS_CHUNK_MAX, runSmsChunk } from "@/lib/messaging/sms-bulk";
import { isSuppressed, phoneDigits, suppressedAmong } from "@/lib/messaging/suppression";
import { LOAD_STATUSES, type Customer, type Load, type LoadStatus } from "@/types/database";

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
  shipper_info: z.string().optional(),
  campaign: z.string().optional(),
  loadboard: z.string().optional(),
  pickup_buyer_number: z.string().optional(),
  delivery_buyer_number: z.string().optional(),
  balance_paid_by: z.string().optional(),
  cod_method: z.string().optional(),
  payment_terms: z.string().optional(),
  terms_begin: z.string().optional(),
  payment_method: z.string().optional(),
  invoice_payment_method: z.string().optional(),
  driver_first_name: z.string().optional(),
  driver_last_name: z.string().optional(),
  driver_phone: z.string().optional(),
  cd_note: z.string().optional(),
  dispatch_instructions: z.string().optional(),
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
    shipper_info: d.shipper_info || null,
    campaign: d.campaign?.trim() || null,
    loadboard: ["all", "cd", "sd"].includes(d.loadboard ?? "") ? d.loadboard : null,
    pickup_buyer_number: d.pickup_buyer_number || null,
    delivery_buyer_number: d.delivery_buyer_number || null,
    balance_paid_by: d.balance_paid_by || null,
    cod_method: d.cod_method || null,
    payment_terms: d.payment_terms || null,
    terms_begin: d.terms_begin || null,
    payment_method: d.payment_method || null,
    invoice_payment_method: d.invoice_payment_method || null,
    driver_first_name: d.driver_first_name || null,
    driver_last_name: d.driver_last_name || null,
    driver_phone: d.driver_phone || null,
    cd_note: (d.cd_note || "").slice(0, 60) || null,
    dispatch_instructions: d.dispatch_instructions || null,
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

  // msgplane's "Request Credit Card Information" checkbox: only honored when
  // the form actually carried it (the marker input), so partial forms can't
  // silently reset the flag.
  if (formData.has("require_card_present")) {
    values.contract_requires_card = formData.get("contract_requires_card") === "on";
  }

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
  // Pre-update snapshot: the pipeline rules below need to know what the
  // status and carrier were BEFORE this save.
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data: prev } = await supabase
    .from(table)
    .select("status, carrier_id")
    .eq("id", id)
    .single();

  // Carrier/margin columns are not writable through the user client (column
  // grants) — manager updates go through the service role AFTER the
  // requireRole check above.
  const writer = isManager ? createAdminClient() : supabase;
  const { error } = await writer.from("loads").update(values).eq("id", id);
  if (error) return { error: error.message };

  // Pipeline rules on save (mirrors msgplane): pricing is what promotes a
  // lead to a quote — automatically, not via a button — only a priced QUOTE
  // converts to an order, and assigning a carrier to a POSTED order is what
  // dispatches it. No button does any of this; the save does.
  let status = prev?.status as string | undefined;
  const priced = parsedCore.data.customer_rate != null;

  if (
    isManager &&
    values.carrier_id &&
    !prev?.carrier_id &&
    (status === "posted_cd" || status === "posted_sd" || status === "booked")
  ) {
    const { error: dispatchError } = await supabase
      .from("loads")
      .update({ status: "dispatched", dispatched_at: new Date().toISOString().slice(0, 10) })
      .eq("id", id);
    if (!dispatchError) {
      await supabase.from("load_status_history").insert({
        load_id: id,
        status: "dispatched",
        changed_by: profile.id,
        note: "Dispatched — carrier assigned",
      });
      status = "dispatched";
    }
  }

  if (status === "lead" && priced) {
    const { error: quoteError } = await supabase.from("loads").update({ status: "quote" }).eq("id", id);
    if (!quoteError) {
      await supabase.from("load_status_history").insert({
        load_id: id,
        status: "quote",
        changed_by: profile.id,
        note: "Priced — moved to Quotes",
      });
      status = "quote";
    }
  }

  if (formData.get("convert") === "1") {
    if (status !== "quote") {
      return {
        error:
          status === "lead"
            ? "Add a price first — a priced lead becomes a quote, and quotes convert to orders."
            : `Can't convert to order from ${status ?? "unknown"}.`,
      };
    }
    if (!priced) {
      return { error: "Add a price first — an order needs a tariff." };
    }
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
      // msgplane behavior: a new order automatically emails the customer
      // their contract. Failure is advisory (history + timeline), not fatal.
      await generateAndSendContract(supabase, profile, id, { email: true, sms: false });
    }
  }

  revalidatePath(`/loads/${id}`);
  revalidatePath("/loads");
  redirect(`/loads/${id}`);
}

// ---- Pipeline transitions ----
// Each re-reads the current status server-side and only advances from a
// permitted state, so a stale/forged button can't drive an invalid move.
// The pipeline is deliberately strict, mirroring how the business runs:
// lead --(price)--> quote --(convert)--> ready --(post)--> posted_cd/sd
// --(assign carrier + dispatch)--> dispatched --> picked_up --> delivered.
// No skipping stages, and the post-dispatch statuses belong to the dispatch
// desk (they mirror what the carrier reports), never to sales.

type StaffRole = "admin" | "dispatcher" | "sales";
const ALL_STAFF: StaffRole[] = ["admin", "dispatcher", "sales"];

async function transition(
  id: string,
  allowedFrom: LoadStatus[],
  updates: Record<string, unknown>,
  toStatus: LoadStatus,
  note: string,
  roles: StaffRole[] = ALL_STAFF
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole(...roles);
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

// A lead becomes a quote by being PRICED — the button is just a shortcut, so
// it refuses until a price exists.
export async function convertToQuote(id: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole(...ALL_STAFF);
  const supabase = await createClient();
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data } = await supabase.from(table).select("customer_rate").eq("id", id).single();
  if (data && data.customer_rate == null) {
    return { ok: false, error: "Add a price first — a priced lead becomes a quote." };
  }
  return transition(id, ["lead"], {}, "quote", "Priced — moved to Quotes");
}

// Standalone quote → order (the header button), separate from the edit-form
// convert path above. Only from QUOTE — a lead has to be priced first.
// msgplane behavior: creating the order automatically emails the customer
// their contract. A failed email never blocks the conversion — it lands in
// the history and message timeline for the rep to see and resend.
export async function convertToOrder(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await transition(id, ["quote"], {}, "ready", "Converted to order");
  if (result.ok) {
    const profile = await requireRole(...ALL_STAFF);
    const supabase = await createClient();
    await generateAndSendContract(supabase, profile, id, { email: true, sms: false });
  }
  return result;
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

// There is deliberately no dispatchOrder / markPickedUp / markDelivered
// action for ANYONE, admin included. Dispatched is set by updateLoad when a
// carrier is assigned to a posted order, and picked-up / delivered /
// cancelled-after-dispatch will be reported by the carrier through the
// CD/SD integration (Phase 4) — exactly how msgplane behaves.

export async function unpostOrder(id: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole(...ALL_STAFF);
  const supabase = await createClient();
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data: current } = await supabase.from(table).select("status").eq("id", id).single();
  if (!current) return { ok: false, error: "Not found." };

  // Reversing a dispatch undoes a carrier assignment — dispatch desk only.
  if (current.status === "dispatched" && profile.role === "sales") {
    return { ok: false, error: "Only dispatch can unpost a dispatched order." };
  }
  const result = await transition(
    id,
    ["posted_cd", "posted_sd", "dispatched"],
    {
      posted_to_central_dispatch_at: null,
      posted_to_super_dispatch_at: null,
      cd_external_id: null,
      sd_external_id: null,
      dispatched_at: null,
    },
    "ready",
    "Unposted — back to Ready"
  );
  // Un-dispatching also releases the carrier, so re-assigning one later
  // re-triggers the automatic dispatch. Carrier columns are only writable
  // via the service role (column grants) — after the role check above.
  if (result.ok && current.status === "dispatched") {
    await createAdminClient()
      .from("loads")
      .update({ carrier_id: null, dispatcher_id: null })
      .eq("id", id);
  }
  return result;
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

// Per-vehicle details, saved in one submit: inputs are named
// <field>_<vehicleId>. Longest prefixes FIRST — "plate_state_x" must not
// match the "plate" prefix and mangle the vehicle id.
const VEHICLE_ROW_FIELDS = ["plate_state", "lot_number", "tariff", "deposit", "plate", "color"] as const;

export async function saveVehicleTariffs(
  loadId: string,
  _prevState: LoadFormState,
  formData: FormData
): Promise<LoadFormState> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  const updates = new Map<string, Record<string, unknown>>();
  for (const [key, value] of formData.entries()) {
    const field = VEHICLE_ROW_FIELDS.find((f) => key.startsWith(`${f}_`));
    if (!field) continue;
    const vehicleId = key.slice(field.length + 1);
    const raw = value.toString().trim();
    let parsed: string | number | null;
    if (field === "tariff" || field === "deposit") {
      parsed = raw === "" ? null : Number(raw);
      if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
        return { error: "Amounts must be positive numbers." };
      }
    } else {
      parsed = raw.slice(0, 60) || null;
    }
    const u = updates.get(vehicleId) ?? {};
    u[field] = parsed;
    updates.set(vehicleId, u);
  }

  for (const [vehicleId, u] of updates) {
    const { error } = await supabase
      .from("load_vehicles")
      .update(u)
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

// Core of the e-sign flow, msgplane-style "generate_and_send": ensure the
// signing token exists, record the send, EMAIL the link to the customer
// (the default channel — this is also what fires automatically when a quote
// converts to an order), optionally text it, and log the email into the
// order's message timeline. Email problems never throw — callers decide
// whether they're fatal (manual send) or advisory (auto-send on convert).
async function generateAndSendContract(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: { id: string },
  loadId: string,
  via: { email: boolean; sms: boolean },
  // rotate mints a NEW contract version (change terms & send): fresh token,
  // old links dead, any signature voided. requiresCard flips whether the
  // signing page asks for card details; omitted = keep the current setting.
  opts: { rotate?: boolean; requiresCard?: boolean; note?: string } = {}
): Promise<{ error: string | null; link?: string; sentVia?: string }> {
  const { data: load } = await supabase
    .from("loads")
    .select(
      "contract_token, customer_id, load_number, contract_requires_card, customer_rate, deposit_amount, date_signed"
    )
    .eq("id", loadId)
    .single();
  if (!load) return { error: "Order not found." };

  const rotate = Boolean(opts.rotate);
  if (load.date_signed && !rotate) {
    return { error: "Already signed — use Change terms & send for a new version." };
  }

  let token = load.contract_token as string | null;
  const isNewVersion = rotate || !token;
  if (isNewVersion) {
    const { randomUUID } = await import("node:crypto");
    token = randomUUID();
  }
  const requiresCard = opts.requiresCard ?? Boolean(load.contract_requires_card);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    contract_token: token,
    contract_sent_at: now,
    contract_requires_card: requiresCard,
  };
  if (rotate) {
    // A new version is a new agreement — the old signature (if any) is void.
    updates.date_signed = null;
    updates.contract_signed_ip = null;
    updates.contract_signed_name = null;
    updates.contract_signed_email = null;
  }
  const { error } = await supabase.from("loads").update(updates).eq("id", loadId);
  if (error) return { error: error.message };

  // Version bookkeeping for "view all" / "make current". A re-send updates
  // the current version's stamp; legacy contracts (sent before versioning)
  // get their row created on the first re-send.
  const sentViaLabel =
    [via.email ? "email" : null, via.sms ? "sms" : null].filter(Boolean).join("+") || null;
  const versionStamp = {
    requires_card: requiresCard,
    tariff: load.customer_rate,
    deposit: load.deposit_amount,
    sent_at: now,
    sent_via: sentViaLabel,
  };
  if (isNewVersion) {
    await supabase
      .from("contract_versions")
      .update({ superseded_at: now })
      .eq("load_id", loadId)
      .is("superseded_at", null);
    await supabase.from("contract_versions").insert({
      load_id: loadId,
      token,
      note: opts.note || null,
      created_by: profile.id,
      ...versionStamp,
    });
  } else {
    const { data: existing } = await supabase
      .from("contract_versions")
      .select("id")
      .eq("token", token)
      .maybeSingle();
    if (existing) {
      await supabase.from("contract_versions").update(versionStamp).eq("id", existing.id);
    } else {
      await supabase.from("contract_versions").insert({
        load_id: loadId,
        token,
        note: opts.note || null,
        created_by: profile.id,
        ...versionStamp,
      });
    }
  }

  const base = appBaseUrl();
  const link = base ? `${base}/sign/${token}` : `/sign/${token}`;

  const { data: customer } = await supabase
    .from("customers")
    .select("contact_name, email, email_opt_out, phone, sms_opt_out")
    .eq("id", load.customer_id)
    .single();

  const sentVia: string[] = [];
  let softError: string | null = null;

  if (via.email) {
    // Transactional, one recipient — opt-out doesn't apply to a contract the
    // customer asked for, but a missing/implausible address does.
    if (!isPlausibleEmail(customer?.email)) {
      softError = "No valid customer email on file — send the link another way.";
    } else if (!isEmailConfigured()) {
      softError = "Email isn't connected — copy the link and send it manually.";
    } else if (!base) {
      softError = "Set NEXT_PUBLIC_APP_URL so the link is a full URL.";
    } else {
      const firstName = (customer?.contact_name || "there").split(/\s+/)[0];
      const subject = `Your vehicle transport agreement — order ${load.load_number}`;
      const body =
        `Hi ${firstName},\n\n` +
        `Your vehicle transport order ${load.load_number} with US Star Trucking is ready. ` +
        `Please review and sign your transport agreement here:\n\n${link}\n\n` +
        `Reply to this email or text us with any questions.\n\n— US Star Trucking LLC`;
      let status = "sent";
      let providerMessageId: string | null = null;
      try {
        const r = await sendEmail(customer!.email!.trim(), subject, body);
        providerMessageId = r.providerMessageId;
        sentVia.push("email");
      } catch (err) {
        console.error("E-sign email failed:", err);
        status = "failed";
        softError = "Couldn't email the link — copy it and send manually.";
      }
      // Into the order's message timeline either way, so a failed send is
      // visible instead of silent.
      await supabase.from("messages").insert({
        customer_id: load.customer_id,
        load_id: loadId,
        channel: "email",
        direction: "outbound",
        to_addr: customer!.email!.trim(),
        subject,
        body,
        provider_message_id: providerMessageId,
        status,
        sent_by: profile.id,
      });
    }
  }

  if (via.sms) {
    const to = toE164(customer?.phone);
    if (customer?.sms_opt_out) return { error: "Customer opted out of SMS — can't text the link.", link };
    if (await isSuppressed(customer?.phone)) {
      return { error: "That number is on the do-not-text list — can't text the link.", link };
    }
    if (!to) return { error: "No valid customer phone on file to text the link.", link };
    if (!isSmsConfigured()) return { error: "SMS isn't connected yet — copy the link and send it manually.", link };
    if (!base) return { error: "Set NEXT_PUBLIC_APP_URL so the link is a full URL.", link };
    try {
      await sendSms(to, `Please review and sign your vehicle transport agreement: ${link}`);
      sentVia.push("sms");
    } catch (err) {
      console.error("E-sign SMS failed:", err);
      return { error: "Couldn't text the link — copy it and send manually.", link };
    }
  }

  await supabase.from("load_status_history").insert({
    load_id: loadId,
    status: "quote" as LoadStatus, // history note only; status unchanged
    changed_by: profile.id,
    note:
      (sentVia.length > 0
        ? `Contract sent to customer (${sentVia.join(" + ")})`
        : softError
          ? `Contract link generated — ${softError}`
          : "Contract link generated") +
      (rotate ? " — new terms" : "") +
      (requiresCard ? " · card info required" : ""),
  });

  revalidatePath(`/loads/${loadId}`);
  return { error: softError, link, sentVia: sentVia.join("+") || undefined };
}

// Manual send from the E-Sign panel. Default = email (matching msgplane's
// generate-and-send); via=sms texts the link instead. require_card "1"/"0"
// picks the with-card / without-card contract; blank keeps the current one.
export async function sendContract(
  loadId: string,
  _prevState: EsignState,
  formData: FormData
): Promise<EsignState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const viaSms = formData.get("via") === "sms";
  const cardField = (formData.get("require_card") || "").toString();
  const supabase = await createClient();
  return generateAndSendContract(
    supabase,
    profile,
    loadId,
    { email: !viaSms, sms: viaSms },
    cardField === "" ? {} : { requiresCard: cardField === "1" }
  );
}

// msgplane's red "change terms & send": update price/deposit, flip the card
// requirement, and mint a NEW contract version — fresh token, old links dead,
// any existing signature voided. The customer gets the new link by email
// (and SMS if ticked).
export async function changeTermsAndSend(
  loadId: string,
  _prevState: EsignState,
  formData: FormData
): Promise<EsignState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const tariff = numeric.parse(formData.get("tariff")?.toString());
  const deposit = numeric.parse(formData.get("deposit")?.toString());
  const requiresCard = formData.get("require_card") === "on";
  const note = (formData.get("note") || "").toString().trim().slice(0, 300);
  const alsoSms = formData.get("also_sms") === "on";
  if (tariff != null && (Number.isNaN(tariff) || tariff < 0)) {
    return { error: "Tariff must be a positive amount." };
  }
  if (deposit != null && (Number.isNaN(deposit) || deposit < 0)) {
    return { error: "Deposit must be a positive amount." };
  }

  const supabase = await createClient();
  if (tariff != null || deposit != null) {
    const upd: Record<string, unknown> = {};
    if (tariff != null) upd.customer_rate = tariff;
    if (deposit != null) upd.deposit_amount = deposit;
    const { error } = await supabase.from("loads").update(upd).eq("id", loadId);
    if (error) return { error: error.message };
  }
  return generateAndSendContract(
    supabase,
    profile,
    loadId,
    { email: true, sms: alsoSms },
    { rotate: true, requiresCard, note: note || undefined }
  );
}

// "make current" in the view-all popup: point the signing link back at an
// older version (its token + card setting). Refused while a signature exists —
// void it first. Manager-gated: this changes which document is live.
export async function makeContractCurrent(
  loadId: string,
  versionId: string
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  const { data: version } = await supabase
    .from("contract_versions")
    .select("id, token, requires_card")
    .eq("id", versionId)
    .eq("load_id", loadId)
    .maybeSingle();
  if (!version) return { ok: false, error: "Contract version not found." };

  const { data: load } = await supabase
    .from("loads")
    .select("date_signed")
    .eq("id", loadId)
    .single();
  if (load?.date_signed) {
    return { ok: false, error: "Void the current signature first." };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("loads")
    .update({
      contract_token: version.token,
      contract_requires_card: version.requires_card,
      // Fresh send stamp so the restored link gets a full expiry window.
      contract_sent_at: now,
    })
    .eq("id", loadId);
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("contract_versions")
    .update({ superseded_at: now })
    .eq("load_id", loadId)
    .is("superseded_at", null)
    .neq("id", versionId);
  await supabase.from("contract_versions").update({ superseded_at: null }).eq("id", versionId);
  await supabase.from("load_status_history").insert({
    load_id: loadId,
    status: "quote" as LoadStatus,
    changed_by: profile.id,
    note: "Contract version restored as current",
  });
  revalidatePath(`/loads/${loadId}`);
  return { ok: true };
}

// msgplane's Edit Dispatch Sheet: saves the dispatch-side fields (dates,
// driver, instructions, terms, money), and "Save & dispatch" additionally
// assigns the carrier — which is the one and only thing that flips a posted
// order to Dispatched. Dispatch desk only.
export type DispatchSheetState = LoadFormState & { dispatched?: boolean };

export async function saveDispatchSheet(
  loadId: string,
  _prevState: DispatchSheetState,
  formData: FormData
): Promise<DispatchSheetState> {
  await requireRole("admin", "dispatcher");
  const supabase = await createClient();

  const s = (name: string, max = 200) =>
    (formData.get(name) || "").toString().trim().slice(0, max) || null;
  const date = (name: string) => {
    const v = (formData.get(name) || "").toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const money = (name: string) => {
    const v = (formData.get(name) || "").toString().trim().replace(/[$,]/g, "");
    if (v === "") return undefined; // absent = leave alone
    const n = Number(v);
    return Number.isNaN(n) || n < 0 ? null : n;
  };

  const tariff = money("customer_rate");
  const deposit = money("deposit_amount");
  if (tariff === null || deposit === null) {
    return { error: "Amounts must be positive numbers." };
  }

  const values: Record<string, unknown> = {
    pickup_ready_date: date("pickup_ready_date"),
    delivery_eta: date("delivery_eta"),
    driver_first_name: s("driver_first_name", 80),
    driver_last_name: s("driver_last_name", 80),
    driver_phone: s("driver_phone", 40),
    dispatch_instructions: s("dispatch_instructions", 2000),
    cd_note: s("cd_note", 60),
    balance_paid_by: s("balance_paid_by", 60),
    cod_method: s("cod_method", 60),
    payment_terms: s("payment_terms", 60),
    terms_begin: s("terms_begin", 60),
    payment_method: s("payment_method", 60),
    invoice_payment_method: s("invoice_payment_method", 60),
  };
  if (tariff !== undefined) values.customer_rate = tariff;
  if (deposit !== undefined) values.deposit_amount = deposit;

  const { error } = await supabase.from("loads").update(values).eq("id", loadId);
  if (error) return { error: error.message };

  // Carrier pay is margin — written through the service role only, and only
  // after the requireRole above (same boundary as updateLoad).
  const carrierPay = money("carrier_pay");
  if (carrierPay === null) return { error: "Amounts must be positive numbers." };
  if (carrierPay !== undefined) {
    const { error: payError } = await createAdminClient()
      .from("loads")
      .update({ carrier_pay: carrierPay })
      .eq("id", loadId);
    if (payError) return { error: payError.message };
  }

  if (formData.get("dispatch") === "1") {
    const carrierId = (formData.get("carrier_id") || "").toString();
    if (!carrierId) return { error: "Pick a carrier to dispatch to." };
    const result = await assignCarrier(loadId, carrierId);
    if (!result.ok) return { error: result.error ?? "Couldn't dispatch." };
    return { error: null, dispatched: true };
  }

  revalidatePath(`/loads/${loadId}`);
  return { error: null };
}

// The DISPATCH button. Deliberately NOT a status flip: it assigns a carrier
// to a posted order, and that assignment is what dispatches — the same rule
// updateLoad enforces on the edit form. Dispatch desk only.
export async function assignCarrier(
  loadId: string,
  carrierId: string
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("loads")
    .select("status")
    .eq("id", loadId)
    .single();
  if (!current) return { ok: false, error: "Not found." };
  if (!["posted_cd", "posted_sd", "booked"].includes(current.status)) {
    return { ok: false, error: `Dispatch works on a posted order — can't from ${current.status}.` };
  }
  const { data: carrier } = await supabase
    .from("carriers")
    .select("id, company_name")
    .eq("id", carrierId)
    .maybeSingle();
  if (!carrier) return { ok: false, error: "Carrier not found." };

  // carrier_id / dispatcher_id are column-revoked for the user client —
  // written through the service role AFTER the requireRole above.
  const admin = createAdminClient();
  const { error } = await admin
    .from("loads")
    .update({ carrier_id: carrier.id, dispatcher_id: profile.id })
    .eq("id", loadId);
  if (error) return { ok: false, error: error.message };

  const { error: dispatchError } = await supabase
    .from("loads")
    .update({ status: "dispatched", dispatched_at: new Date().toISOString().slice(0, 10) })
    .eq("id", loadId);
  if (dispatchError) return { ok: false, error: dispatchError.message };
  await supabase.from("load_status_history").insert({
    load_id: loadId,
    status: "dispatched",
    changed_by: profile.id,
    note: `Dispatched — carrier assigned (${carrier.company_name})`,
  });
  revalidatePath(`/loads/${loadId}`);
  revalidatePath("/loads");
  revalidatePath("/orders");
  return { ok: true };
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
  // The rotated token belongs to no version — everything prior is superseded
  // until the next send mints a fresh version.
  await supabase
    .from("contract_versions")
    .update({ superseded_at: new Date().toISOString() })
    .eq("load_id", loadId)
    .is("superseded_at", null);
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
  const str = (name: string) => (formData.get(name) || "").toString().trim().slice(0, 60) || null;
  const { error } = await supabase.from("load_vehicles").insert({
    load_id: loadId,
    year: year ? Number(year) : null,
    make: (formData.get("make") || "").toString().trim() || null,
    model: (formData.get("model") || "").toString().trim() || null,
    vin: (formData.get("vin") || "").toString().trim() || null,
    vehicle_type: (formData.get("vehicle_type") || "sedan").toString(),
    condition: (formData.get("condition") || "running").toString(),
    tariff: tariffRaw && !Number.isNaN(Number(tariffRaw)) ? Number(tariffRaw) : null,
    plate: str("plate"),
    plate_state: str("plate_state"),
    lot_number: str("lot_number"),
    color: str("color"),
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

// Bulk cancel, the old system's "Selected records have been cancelled".
//
// The reason this exists on the bar rather than only per-record: the common
// use is filtering the list to people who opted out of messaging and closing
// all of them at once. Working through a hundred records one at a time is how
// a rep ends up texting someone who asked them to stop.
//
// Already-cancelled rows are skipped rather than re-stamped, so the history
// keeps the date they were actually cancelled.
export async function bulkCancel(
  loadIds: string[],
  reason?: string
): Promise<{ cancelled: number; skipped: number }> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  if (loadIds.length === 0) return { cancelled: 0, skipped: 0 };
  const supabase = await createClient();

  // RLS scopes this: a sales rep can only cancel loads they can already see.
  const { data: rows } = await supabase
    .from("loads")
    .select("id, status")
    .in("id", loadIds);

  const target = (rows ?? []).filter((l) => l.status !== "cancelled").map((l) => l.id);
  const skipped = (rows ?? []).length - target.length;
  if (target.length === 0) return { cancelled: 0, skipped };

  const { error } = await supabase
    .from("loads")
    .update({ status: "cancelled", cancelled_reason: reason?.slice(0, 200) || null })
    .in("id", target);
  if (error) return { cancelled: 0, skipped };

  // Same trail a single cancel leaves, so a bulk action is not invisible in
  // the record's history.
  await supabase.from("load_status_history").insert(
    target.map((id) => ({
      load_id: id,
      status: "cancelled" as const,
      changed_by: profile.id,
      note: reason?.slice(0, 200) || "Cancelled in bulk from the list",
    }))
  );

  revalidatePipeline();
  return { cancelled: target.length, skipped };
}

// Flag/unflag a customer as blacklisted (from the order ⋯ menu).
export async function toggleBlacklist(customerId: string, on: boolean): Promise<void> {
  await requireRole("admin", "dispatcher");
  const supabase = await createClient();
  await supabase.from("customers").update({ blacklisted: on }).eq("id", customerId);
  revalidatePipeline();
  revalidatePath(`/customers/${customerId}`);
}

// One paced chunk of a pipeline SMS blast. The bulk bar splits its selection
// into chunks of SMS_CHUNK_MAX and calls this per chunk — same contract as
// the compose page's sendSmsBulkChunk: pacing under RingCentral's 40/min
// limit happens in runSmsChunk, a rate-limit or provider stop returns the
// unattempted tail in unprocessedLoadIds, and rows are logged per chunk in
// one insert. Unconfigured sends log as "queued" (they used to vanish as
// "skipped" here, unlike every other send path).
export type BulkSmsChunkResult = {
  error: string | null;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  unprocessedLoadIds: string[];
  retryAfterMs: number | null;
};

// Bulk email from a pipeline selection. One Resend batch request (never a
// loop — see docs/STATUS.md), rendered per recipient, logged per row.
export async function bulkEmail(
  loadIds: string[],
  subject: string,
  body: string
): Promise<{ error: string | null; sent: number; queued: number; skipped: number; failed: number }> {
  const empty = (error: string | null) => ({ error, sent: 0, queued: 0, skipped: 0, failed: 0 });
  const profile = await requireRole(...ALL_STAFF);
  const text = body.trim();
  const subj = subject.trim();
  if (loadIds.length === 0) return empty(null);
  if (!text) return empty("Message is required.");
  if (!subj) return empty("Email needs a subject line.");
  if (loadIds.length > 100) return empty("Max 100 recipients per send — narrow the selection.");

  const supabase = await createClient();
  const { data: loads, error: loadsError } = await supabase
    .from(profile.role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE)
    .select("id, customer_id, customer_rate, load_number, pickup_city, pickup_state, delivery_city, delivery_state, pickup_ready_date")
    .in("id", loadIds);
  if (loadsError) return empty(loadsError.message);

  const customerIds = [...new Set((loads ?? []).map((l) => l.customer_id).filter(Boolean))];
  const { data: customers } = customerIds.length
    ? await supabase.from("customers").select("*").in("id", customerIds)
    : { data: [] as Customer[] };
  const custById = new Map(((customers ?? []) as Customer[]).map((c) => [c.id, c]));

  const { data: vehicleRows } = loadIds.length
    ? await supabase.from("load_vehicles").select("load_id, year, make, model").in("load_id", loadIds).order("created_at")
    : { data: [] as { load_id: string; year: number | null; make: string | null; model: string | null }[] };
  const vehicleByLoad = new Map<string, string>();
  for (const v of vehicleRows ?? []) {
    if (!vehicleByLoad.has(v.load_id)) {
      vehicleByLoad.set(v.load_id, [v.year, v.make, v.model].filter(Boolean).join(" "));
    }
  }

  let skipped = loadIds.length - (loads ?? []).length;
  const agent = profile.full_name || profile.email || "";
  const recipients: { loadId: string; customerId: string; to: string; subject: string; text: string }[] = [];
  for (const l of loads ?? []) {
    const c = custById.get(l.customer_id);
    if (!c || c.email_opt_out || !isPlausibleEmail(c.email)) {
      skipped++;
      continue;
    }
    const ctx = buildContext(c, l as unknown as Load, { agent, vehicle: vehicleByLoad.get(l.id) ?? "" });
    recipients.push({
      loadId: l.id,
      customerId: c.id,
      to: c.email!.trim(),
      subject: renderTemplate(subj, ctx),
      text: renderTemplate(text, ctx),
    });
  }
  if (recipients.length === 0) return { ...empty(null), skipped };

  const statuses: { status: string; id: string | null }[] = [];
  if (!isEmailConfigured()) {
    recipients.forEach(() => statuses.push({ status: "queued", id: null }));
  } else {
    const result = await sendEmailBatch(
      recipients.map((r) => ({ to: r.to, subject: r.subject, text: r.text }))
    );
    if (result.ok) result.ids.forEach((id) => statuses.push({ status: "sent", id }));
    else {
      console.error("Bulk email failed:", result.error);
      recipients.forEach(() => statuses.push({ status: "failed", id: null }));
    }
  }

  const { error: logError } = await supabase.from("messages").insert(
    recipients.map((r, i) => ({
      customer_id: r.customerId,
      load_id: r.loadId,
      channel: "email",
      direction: "outbound",
      to_addr: r.to,
      subject: r.subject,
      body: r.text,
      provider_message_id: statuses[i].id,
      status: statuses[i].status,
      sent_by: profile.id,
    }))
  );

  let sent = 0;
  let queued = 0;
  let failed = 0;
  for (const s of statuses) {
    if (s.status === "sent") sent++;
    else if (s.status === "queued") queued++;
    else failed++;
  }
  revalidatePath("/messages");
  return {
    error:
      logError && sent > 0
        ? `${sent} email(s) were SENT but could not be logged (${logError.message}).`
        : logError
          ? `Logging failed: ${logError.message}`
          : null,
    sent,
    queued,
    skipped,
    failed,
  };
}

export async function bulkSmsChunk(loadIds: string[], body: string): Promise<BulkSmsChunkResult> {
  const empty = (error: string | null): BulkSmsChunkResult => ({
    error,
    sent: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    unprocessedLoadIds: [],
    retryAfterMs: null,
  });

  const profile = await requireRole("admin", "dispatcher", "sales");
  const text = body.trim();
  if (loadIds.length === 0) return empty(null);
  if (!text) return empty("Message is required.");
  if (text.length > 1600) return empty("Keep the message under 1600 characters.");
  if (loadIds.length > SMS_CHUNK_MAX) {
    return empty(`Max ${SMS_CHUNK_MAX} loads per chunk — this is a client bug.`);
  }

  const supabase = await createClient();
  // Role-appropriate view, not the base table — the standing rule for every
  // loads read, even though only id/customer_id are selected here.
  const { data: loads, error: loadsError } = await supabase
    .from(profile.role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE)
    .select("id, customer_id")
    .in("id", loadIds);
  if (loadsError) return empty(loadsError.message);

  const customerIds = [...new Set((loads ?? []).map((l) => l.customer_id).filter(Boolean))];
  const { data: customers } = customerIds.length
    ? await supabase.from("customers").select("id, phone, sms_opt_out").in("id", customerIds)
    : { data: [] as { id: string; phone: string | null; sms_opt_out: boolean }[] };
  const custById = new Map((customers ?? []).map((c) => [c.id, c]));

  // Checked by number as well as by row: the same person often has several
  // orders, and they opted out of being texted, not out of one order.
  const suppressed = await suppressedAmong((customers ?? []).map((c) => c.phone));

  // RLS-hidden loads count as skipped so the operator's totals reconcile.
  let skipped = loadIds.length - (loads ?? []).length;
  const recipients: { loadId: string; customerId: string; to: string; text: string }[] = [];
  for (const l of loads ?? []) {
    const c = custById.get(l.customer_id);
    const to = toE164(c?.phone);
    if (!c || c.sms_opt_out || !to || suppressed.has(phoneDigits(c.phone))) {
      skipped++;
      continue;
    }
    recipients.push({ loadId: l.id, customerId: c.id, to, text });
  }

  const run = await runSmsChunk(recipients, {
    ready: isSmsConfigured(),
    send: sendSms,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  });

  const attempted = recipients.slice(0, run.outcomes.length);
  const { error: logError } =
    attempted.length === 0
      ? { error: null }
      : await supabase.from("messages").insert(
          attempted.map((r, i) => ({
            customer_id: r.customerId,
            load_id: r.loadId,
            channel: "sms",
            direction: "outbound",
            to_addr: r.to,
            body: r.text,
            provider_message_id: run.outcomes[i].providerMessageId,
            status: run.outcomes[i].status,
            sent_by: profile.id,
          }))
        );

  let sent = 0;
  let queued = 0;
  let failed = 0;
  for (const o of run.outcomes) {
    if (o.status === "sent") sent++;
    else if (o.status === "queued") queued++;
    else failed++;
  }

  let error: string | null = null;
  if (logError && sent > 0) {
    console.error("Logging the bulk SMS failed:", logError);
    error = `${sent} text(s) were SENT but could not be logged (${logError.message}). Do not resend to this selection until Messages is checked.`;
  } else if (logError) {
    console.error("Logging the bulk SMS failed:", logError);
    error = `Logging failed: ${logError.message}`;
  } else if (run.providerError) {
    error = `RingCentral problem — blast stopped: ${run.providerError}`;
  }

  return {
    error,
    sent,
    queued,
    skipped,
    failed,
    unprocessedLoadIds: recipients.slice(run.outcomes.length).map((r) => r.loadId),
    retryAfterMs: run.retryAfterMs,
  };
}
