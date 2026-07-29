"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { blockedFromWritingLoad } from "@/lib/record-access";

// Internal notes thread with attachments (migration 0018). Uploads go to the
// private "load-files" bucket; downloads are short-lived signed URLs minted
// per click, so nothing is ever publicly reachable.

const BUCKET = "load-files";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 8;

export type NoteState = { error: string | null };

function safeName(name: string): string {
  return (name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80);
}

export async function addNote(
  loadId: string,
  _prev: NoteState,
  formData: FormData
): Promise<NoteState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const notMine = await blockedFromWritingLoad(loadId, profile);
  if (notMine) return { error: notMine };
  const body = (formData.get("body") || "").toString().trim();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (!body && files.length === 0) return { error: "Write a note or attach a file." };
  if (files.length > MAX_FILES) return { error: `Up to ${MAX_FILES} files per note.` };
  for (const f of files) {
    if (f.size > MAX_BYTES) return { error: `${f.name} is over 20 MB.` };
  }

  const supabase = await createClient();
  // RLS decides whether this rep may attach to this load.
  const { data: note, error } = await supabase
    .from("load_notes")
    .insert({ load_id: loadId, body, author_id: profile.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (files.length > 0) {
    // Storage writes and the documents rows go through the service role: the
    // bucket is private with no per-user policies, and access was already
    // authorised by the note insert above.
    const admin = createAdminClient();
    const rows: Record<string, unknown>[] = [];
    for (const file of files) {
      const path = `loads/${loadId}/${note.id}/${randomUUID()}-${safeName(file.name)}`;
      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) {
        console.error("Attachment upload failed:", upErr);
        return { error: `Note saved, but ${file.name} didn't upload: ${upErr.message}` };
      }
      rows.push({
        entity_type: "load",
        entity_id: loadId,
        note_id: note.id,
        doc_type: "other",
        storage_path: path,
        file_name: file.name.slice(0, 200),
        content_type: file.type || null,
        uploaded_by: profile.id,
      });
    }
    const { error: docErr } = await admin.from("documents").insert(rows);
    if (docErr) return { error: `Files uploaded but not linked: ${docErr.message}` };
  }

  revalidatePath(`/loads/${loadId}`);
  return { error: null };
}

export async function updateNote(
  loadId: string,
  noteId: string,
  body: string
): Promise<NoteState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const notMine = await blockedFromWritingLoad(loadId, profile);
  if (notMine) return { error: notMine };
  const supabase = await createClient();
  // RLS allows the author, or a manager, to edit.
  const { error } = await supabase
    .from("load_notes")
    .update({ body: body.trim(), updated_at: new Date().toISOString() })
    .eq("id", noteId);
  if (error) return { error: error.message };
  revalidatePath(`/loads/${loadId}`);
  return { error: null };
}

export async function deleteNote(loadId: string, noteId: string): Promise<NoteState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  const notMine = await blockedFromWritingLoad(loadId, profile);
  if (notMine) return { error: notMine };
  const supabase = await createClient();

  // Collect the storage paths BEFORE the cascade removes the document rows,
  // otherwise the objects are orphaned in the bucket forever.
  const { data: docs } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("note_id", noteId);

  const { error } = await supabase.from("load_notes").delete().eq("id", noteId);
  if (error) return { error: error.message };

  const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: rmErr } = await createAdminClient().storage.from(BUCKET).remove(paths);
    if (rmErr) console.error("Orphaned attachments after note delete:", rmErr);
  }

  revalidatePath(`/loads/${loadId}`);
  return { error: null };
}

// Signed URL minted on demand — the bucket is private, so this is the only
// way an attachment can be opened, and the link dies in 60 seconds.
export async function attachmentUrl(noteId: string, storagePath: string): Promise<string | null> {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  // Re-check through RLS that the caller may see this note's load before
  // signing anything — the path alone must never be enough.
  const { data: note } = await supabase.from("load_notes").select("id").eq("id", noteId).single();
  if (!note) return null;

  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error) {
    console.error("Signing attachment failed:", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
