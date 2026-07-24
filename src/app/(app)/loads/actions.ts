"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { LOAD_STATUSES } from "@/types/database";

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
  pickup_ready_date: z.string().optional(),
  delivery_address: z.string().optional(),
  delivery_city: z.string().optional(),
  delivery_state: z.string().optional(),
  delivery_zip: z.string().optional(),
  delivery_contact_name: z.string().optional(),
  delivery_contact_phone: z.string().optional(),
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
    pickup_ready_date: d.pickup_ready_date || null,
    delivery_address: d.delivery_address || null,
    delivery_city: d.delivery_city || null,
    delivery_state: d.delivery_state || null,
    delivery_zip: d.delivery_zip || null,
    delivery_contact_name: d.delivery_contact_name || null,
    delivery_contact_phone: d.delivery_contact_phone || null,
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

  const customer_id = (formData.get("customer_id") || "").toString();
  if (!customer_id) return { error: "Customer is required." };

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

  // "Save as quote" vs full order — whitelisted here, never a free-form
  // status from the client.
  const createAs = formData.get("create_as") === "quote" ? ("quote" as const) : ("booked" as const);

  const supabase = await createClient();
  const payload = {
    ...coreValues(parsedCore.data),
    customer_id,
    status: createAs,
    sales_owner_id: profile.role === "sales" ? profile.id : null,
  };

  const { data: seq, error: seqError } = await supabase.rpc("next_load_number");
  if (seqError || seq == null) {
    return { error: "Could not generate a load number — is migration 0004 applied?" };
  }

  const { data: load, error: insertError } = await supabase
    .from("loads")
    .insert({ ...payload, load_number: `${seq}-US` })
    .select()
    .single();
  if (!load) {
    return { error: insertError?.message ?? "Could not create load — try again." };
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
    status: createAs,
    changed_by: profile.id,
    note: createAs === "quote" ? "Quote created" : "Load created",
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
  if (profile.role === "admin" || profile.role === "dispatcher") {
    const carrier_id = (formData.get("carrier_id") || "").toString();
    values.carrier_id = carrier_id || null;
    values.carrier_pay = numeric.parse(formData.get("carrier_pay")?.toString());
    if (carrier_id) values.dispatcher_id = profile.id;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("loads").update(values).eq("id", id);
  if (error) return { error: error.message };

  // "Save and convert to order" — only meaningful from `quote`, re-checked
  // here rather than trusting the button's presence in the UI.
  if (formData.get("convert") === "1") {
    const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
    const { data: current } = await supabase.from(table).select("status").eq("id", id).single();
    if (current?.status === "quote") {
      const { error: convertError } = await supabase
        .from("loads")
        .update({ status: "booked" })
        .eq("id", id);
      if (!convertError) {
        await supabase.from("load_status_history").insert({
          load_id: id,
          status: "booked",
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

// msgplane's "Save and convert to order": a quote becomes a booked order.
// Only valid from `quote` — re-checked server-side, not trusted from the UI.
export async function convertToOrder(id: string): Promise<void> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
  const { data: load } = await supabase.from(table).select("id, status").eq("id", id).single();
  if (!load || load.status !== "quote") return;

  const { error } = await supabase.from("loads").update({ status: "booked" }).eq("id", id);
  if (error) return;

  await supabase.from("load_status_history").insert({
    load_id: id,
    status: "booked",
    changed_by: profile.id,
    note: "Converted to order",
  });

  revalidatePath(`/loads/${id}`);
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
  const table = profile.role === "sales" ? "loads_sales_safe" : "loads";
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

  const { data: newLoad, error } = await supabase
    .from("loads")
    .insert({ ...copy, load_number: `${seq}US` })
    .select()
    .single();
  if (error || !newLoad) return;

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
