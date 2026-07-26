"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

// Carrier documents — above all the COI (certificate of insurance) — attached
// straight to the carrier, so dispatch never hunts through order notes for
// them. Same storage model as load-note attachments: private bucket,
// 60-second signed URLs.

const BUCKET = "load-files";
const MAX_BYTES = 20 * 1024 * 1024;

export type CarrierDocState = { error: string | null };

function safeName(name: string): string {
  return (name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80);
}

export async function addCarrierDoc(
  carrierId: string,
  _prev: CarrierDocState,
  formData: FormData
): Promise<CarrierDocState> {
  const profile = await requireRole("admin", "dispatcher");
  const docType = (formData.get("doc_type") || "coi_insurance").toString();
  const expires = (formData.get("expires_at") || "").toString();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) return { error: "Pick at least one file." };
  if (files.length > 8) return { error: "Up to 8 files at a time." };
  for (const f of files) if (f.size > MAX_BYTES) return { error: `${f.name} is over 20 MB.` };
  if (!["coi_insurance", "w9", "mc_authority", "other"].includes(docType)) {
    return { error: "Unknown document type." };
  }

  const supabase = await createClient();
  const { data: carrier } = await supabase
    .from("carriers")
    .select("id")
    .eq("id", carrierId)
    .single();
  if (!carrier) return { error: "Carrier not found." };

  const admin = createAdminClient();
  const rows: Record<string, unknown>[] = [];
  for (const file of files) {
    const path = `carriers/${carrierId}/${randomUUID()}-${safeName(file.name)}`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upErr) return { error: `${file.name} didn't upload: ${upErr.message}` };
    rows.push({
      entity_type: "carrier",
      entity_id: carrierId,
      doc_type: docType,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      content_type: file.type || null,
      expires_at: expires || null,
      uploaded_by: profile.id,
    });
  }
  const { error } = await admin.from("documents").insert(rows);
  if (error) return { error: `Uploaded but not linked: ${error.message}` };

  // COI expiry lives on the carrier row too, so lists can flag it.
  if (docType === "coi_insurance" && expires) {
    await admin.from("carriers").update({ coi_expiry_date: expires }).eq("id", carrierId);
  }

  revalidatePath(`/carriers/${carrierId}`);
  return { error: null };
}

export async function deleteCarrierDoc(carrierId: string, docId: string): Promise<CarrierDocState> {
  await requireRole("admin", "dispatcher");
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("documents")
    .select("storage_path, entity_id")
    .eq("id", docId)
    .single();
  if (!doc || doc.entity_id !== carrierId) return { error: "Not found." };
  const { error } = await admin.from("documents").delete().eq("id", docId);
  if (error) return { error: error.message };
  await admin.storage.from(BUCKET).remove([doc.storage_path]);
  revalidatePath(`/carriers/${carrierId}`);
  return { error: null };
}

export async function carrierDocUrl(docId: string): Promise<string | null> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  // Session read re-checks visibility through RLS before anything is signed.
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", docId)
    .single();
  if (!doc) return null;
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrl(doc.storage_path, 60);
  if (error) {
    console.error("Signing carrier doc failed:", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
