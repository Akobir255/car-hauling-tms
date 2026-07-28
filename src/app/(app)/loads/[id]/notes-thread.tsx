"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, Trash2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addNote, attachmentUrl, deleteNote, updateNote, type NoteState } from "./notes-actions";

export type NoteAttachment = { id: string; file_name: string | null; storage_path: string };
export type ThreadNote = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  authorName: string;
  canEdit: boolean;
  attachments: NoteAttachment[];
};

const initialState: NoteState = { error: null };

// Internal-notes thread: a compose box with quick-note buttons and a multi-file
// picker, then the notes newest-first with per-note edit/remove and attachment
// links (signed on click, since the bucket is private).
export function NotesThread({ loadId, notes }: { loadId: string; notes: ThreadNote[] }) {
  const boundAdd = addNote.bind(null, loadId);
  const [state, formAction, pending] = useActionState(boundAdd, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, start] = useTransition();

  // Clearing the composer is deferred into a timer: setState straight from an
  // effect body is a build-failing lint error in this repo.
  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state === initialState) return;
    const t = setTimeout(() => {
      toast.success("Note added.");
      formRef.current?.reset();
      setBody("");
      setFileNames([]);
    }, 0);
    return () => clearTimeout(t);
  }, [state]);

  const open = (note: ThreadNote, a: NoteAttachment) =>
    start(async () => {
      const url = await attachmentUrl(note.id, a.storage_path);
      if (!url) {
        toast.error("Couldn't open that file.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    });

  const saveEdit = (noteId: string) =>
    start(async () => {
      const r = await updateNote(loadId, noteId, editBody);
      if (r.error) toast.error(r.error);
      else {
        toast.success("Note updated.");
        setEditingId(null);
      }
    });

  const remove = (noteId: string) =>
    start(async () => {
      if (!confirm("Remove this note and its attachments?")) return;
      const r = await deleteNote(loadId, noteId);
      if (r.error) toast.error(r.error);
      else toast.success("Note removed.");
    });

  const stamp = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="space-y-2">
        <Textarea
          name="body"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add an internal note…"
        />
        <div className="flex flex-wrap items-center gap-2 max-md:gap-3">
          {["Left message", "Spoke to someone"].map((quick) => (
            <Button
              key={quick}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground max-md:min-h-12"
              onClick={() => setBody(quick)}
            >
              {quick}
            </Button>
          ))}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-msg-hover max-md:min-h-12">
            <Paperclip className="size-3.5" aria-hidden="true" />
            Attach files
            <input
              type="file"
              name="files"
              multiple
              className="hidden"
              onChange={(e) =>
                setFileNames(Array.from(e.target.files ?? []).map((f) => f.name))
              }
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className="ml-auto max-md:min-h-12 max-md:w-full"
            disabled={pending}
          >
            {pending ? "Saving…" : "Save note"}
          </Button>
        </div>
        {fileNames.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {fileNames.length} file{fileNames.length === 1 ? "" : "s"}: {fileNames.join(", ")}
          </p>
        )}
      </form>

      <div className="divide-y border-t">
        {notes.length === 0 && (
          <p className="pt-3 text-sm text-muted-foreground">No notes yet.</p>
        )}
        {notes.map((note) => (
          <div key={note.id} className="space-y-1.5 py-3">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="text-foreground">{note.authorName}</span>
              <span className="tabular-nums">{stamp(note.created_at)}</span>
              {note.updated_at !== note.created_at && <span>(edited)</span>}
              {/* remove deletes the note and its files — it must not sit a few
                  px from edit under a thumb. */}
              {note.canEdit && (
                <span className="ml-auto flex items-center gap-1 max-md:gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(note.id);
                      setEditBody(note.body);
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-msg-hover hover:text-foreground max-md:min-h-12 max-md:px-3"
                  >
                    <Pencil className="size-3" aria-hidden="true" /> edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(note.id)}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-destructive hover:bg-destructive/10 max-md:min-h-12 max-md:px-3"
                  >
                    <Trash2 className="size-3" aria-hidden="true" /> remove
                  </button>
                </span>
              )}
            </div>

            {editingId === note.id ? (
              <div className="space-y-2">
                <Textarea
                  rows={2}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                />
                <div className="flex gap-2 max-md:gap-3">
                  <Button
                    size="sm"
                    className="max-md:min-h-12"
                    disabled={busy}
                    onClick={() => saveEdit(note.id)}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="max-md:min-h-12"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    <X className="size-3.5" aria-hidden="true" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              note.body && <p className="whitespace-pre-wrap text-sm">{note.body}</p>
            )}

            {note.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {note.attachments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={busy}
                    onClick={() => open(note, a)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-xs text-msg-link hover:bg-secondary max-md:min-h-12"
                  >
                    <Paperclip className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{a.file_name ?? "attachment"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
