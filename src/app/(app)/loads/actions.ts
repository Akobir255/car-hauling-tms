"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { generateLoadNumber } from "@/lib/load-number";
import { LOAD_STATUSES } from "@/types/database";

export type LoadFormState = { error: string | null };

const vehicleSchema = z.object({
  year: z.coerce.number().int().optional().nullable(),
  make: z.string().optional(),
  model: z.string().optional(),
  vin: z.string().optional(),
  vehicle_type: z.string().optional(),
  condition: z.string().optional(),
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
  transport_type: z.enum(["open", "enclosed"]),
  distance_miles: numeric,
  customer_rate: numeric,
  deposit_amount: numeric,
  balance_due: numeric,
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

  const supabase = await createClient();
  const payload = {
    ...coreValues(parsedCore.data),
    customer_id,
    status: "booked" as const,
    sales_owner_id: profile.role === "sales" ? profile.id : null,
  };

  let load = null;
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 5 && !load; attempt++) {
    const load_number = generateLoadNumber();
    const { data, error } = await supabase
      .from("loads")
      .insert({ ...payload, load_number })
      .select()
      .single();
    if (data) {
      load = data;
    } else if (error && !error.message.toLowerCase().includes("duplicate")) {
      lastError = error;
      break;
    } else {
      lastError = error;
    }
  }
  if (!load) {
    return { error: lastError?.message ?? "Could not create load — try again." };
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
    }))
  );
  if (vehiclesError) {
    return { error: `Load created but vehicles failed to save: ${vehiclesError.message}` };
  }

  await supabase
    .from("load_status_history")
    .insert({ load_id: load.id, status: "booked", changed_by: profile.id, note: "Load created" });

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
  const supabase = await createClient();
  const { error } = await supabase.from("load_vehicles").insert({
    load_id: loadId,
    year: year ? Number(year) : null,
    make: (formData.get("make") || "").toString().trim() || null,
    model: (formData.get("model") || "").toString().trim() || null,
    vin: (formData.get("vin") || "").toString().trim() || null,
    vehicle_type: (formData.get("vehicle_type") || "sedan").toString(),
    condition: (formData.get("condition") || "running").toString(),
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
