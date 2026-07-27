"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

// Uploading the REAL photo of a vehicle, overriding the make/model lookup.
// Same private bucket as every other upload; only /api/vehicles/image reads
// it back, so the bucket stays private.

export type PhotoState = { error: string | null; ok?: boolean };

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export async function uploadVehiclePhoto(
  loadId: string,
  vehicleId: string,
  _prev: PhotoState,
  formData: FormData
): Promise<PhotoState> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  // RLS check first: the caller must be able to see this vehicle's load.
  const { data: vehicle } = await supabase
    .from("load_vehicles")
    .select("id, photo_path")
    .eq("id", vehicleId)
    .eq("load_id", loadId)
    .maybeSingle();
  if (!vehicle) return { error: "Vehicle not found." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (file.size > MAX_BYTES) return { error: "That image is larger than 6MB." };
  if (!ALLOWED.includes(file.type)) return { error: "Use a JPEG, PNG or WebP image." };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `vehicles/${loadId}/${vehicleId}-${Date.now()}.${ext}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("load-files")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: upErr.message };

  const { error } = await supabase
    .from("load_vehicles")
    .update({ photo_path: path })
    .eq("id", vehicleId)
    .eq("load_id", loadId);
  if (error) {
    await admin.storage.from("load-files").remove([path]);
    return { error: error.message };
  }

  // Replace, don't accumulate: the previous override is no longer reachable.
  if (vehicle.photo_path) {
    await admin.storage.from("load-files").remove([vehicle.photo_path]);
  }

  revalidatePath(`/loads/${loadId}`);
  return { error: null, ok: true };
}

export async function clearVehiclePhoto(
  loadId: string,
  vehicleId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  const { data: vehicle } = await supabase
    .from("load_vehicles")
    .select("photo_path")
    .eq("id", vehicleId)
    .eq("load_id", loadId)
    .maybeSingle();
  if (!vehicle) return { ok: false, error: "Vehicle not found." };

  const { error } = await supabase
    .from("load_vehicles")
    .update({ photo_path: null })
    .eq("id", vehicleId)
    .eq("load_id", loadId);
  if (error) return { ok: false, error: error.message };

  if (vehicle.photo_path) {
    await createAdminClient().storage.from("load-files").remove([vehicle.photo_path]);
  }
  revalidatePath(`/loads/${loadId}`);
  return { ok: true };
}
