"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addNote } from "@/app/(app)/loads/[id]/notes-actions";

type QuickNote = {
  id: string;
  body: string;
  created_at: string;
  authorName: string;
  attachments: number;
};

// msgplane habit: add a note straight from the list, without opening the
// record. The notes counter on a row is this button; it opens a bottom sheet
// showing the thread and a compose box (files included).
export function NotesQuickButton({
  loadId,
  loadNumber,
  count,
}: {
  loadId: string;
  loadNumber: string;
  count: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<QuickNote[] | null>(null);
  const [body, setBody] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/loads/${loadId}/notes`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d) => alive && setNotes(d.notes ?? []))
      .catch(() => alive && setNotes([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, loadId]);

  const save = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("body", body);
      for (const f of Array.from(files ?? [])) fd.append("files", f);
      const r = await addNote(loadId, { error: null }, fd);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Note added.");
      setBody("");
      setFiles(null);
      setFileNames([]);
      const res = await fetch(`/api/loads/${loadId}/notes`);
      if (res.ok) setNotes((await res.json()).notes ?? []);
      router.refresh();
    });

  const stamp = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Notes on ${loadNumber}`}
        aria-label={`Notes on ${loadNumber}`}
        className={cn(
          "inline-flex min-w-6 items-center justify-center gap-1 rounded border px-1.5 py-0.5 text-[13px] tabular-nums transition-colors hover:bg-muted",
          count > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
        )}
      >
        <StickyNote className="size-3" aria-hidden="true" />
        {count}
      </button>

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
          <div className="w-full max-w-2xl rounded-xl border bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <StickyNote className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Notes — {loadNumber}</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="space-y-3 p-4">
              <Textarea
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add a note without opening the order…"
              />
              <div className="flex flex-wrap items-center gap-2">
                {["Left message", "Spoke to someone"].map((quick) => (
                  <Button
                    key={quick}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setBody(quick)}
                  >
                    {quick}
                  </Button>
                ))}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                  <Paperclip className="size-3.5" aria-hidden="true" />
                  Attach
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      setFiles(e.target.files);
                      setFileNames(Array.from(e.target.files ?? []).map((f) => f.name));
                    }}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  className="ml-auto"
                  disabled={busy || (!body.trim() && fileNames.length === 0)}
                  onClick={save}
                >
                  {busy ? "Saving…" : "Save note"}
                </Button>
              </div>
              {fileNames.length > 0 && (
                <p className="text-xs text-muted-foreground">{fileNames.join(", ")}</p>
              )}

              <div className="max-h-64 divide-y overflow-y-auto border-t">
                {notes === null && (
                  <p className="pt-3 text-xs text-muted-foreground">Loading…</p>
                )}
                {notes?.length === 0 && (
                  <p className="pt-3 text-sm text-muted-foreground">No notes yet.</p>
                )}
                {notes?.map((n) => (
                  <div key={n.id} className="space-y-0.5 py-2.5">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{n.authorName}</span>{" "}
                      <span className="tabular-nums">{stamp(n.created_at)}</span>
                      {n.attachments > 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5">
                          <Paperclip className="size-3" aria-hidden="true" />
                          {n.attachments}
                        </span>
                      )}
                    </p>
                    {n.body && <p className="whitespace-pre-wrap text-sm">{n.body}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
