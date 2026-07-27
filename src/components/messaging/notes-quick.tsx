"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, StickyNote } from "lucide-react";
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

const PANEL_WIDTH = 340;

// msgplane habit: add a note straight from the list, without opening the
// record. The notes counter on a row is this button; it opens a small popup
// anchored AT the row — textarea, SAVE / CANCEL — with the recent thread and
// attachments tucked underneath. Fixed-positioned from the button's rect so
// the list's overflow container can't clip it.
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [notes, setNotes] = useState<QuickNote[] | null>(null);
  const [body, setBody] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, start] = useTransition();
  const open = anchor !== null;

  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 260);
    setAnchor({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/loads/${loadId}/notes`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d) => alive && setNotes(d.notes ?? []))
      .catch(() => alive && setNotes([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAnchor(null);
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
        ref={btnRef}
        type="button"
        onClick={() => (open ? setAnchor(null) : place())}
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
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setAnchor(null)} />
          <div
            className="fixed z-50 rounded-md border-2 border-neutral-800 bg-card p-2 shadow-2xl dark:border-neutral-300"
            style={{ top: anchor.top, left: anchor.left, width: PANEL_WIDTH }}
          >
            <Textarea
              rows={4}
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label={`New note on ${loadNumber}`}
              className="resize-y border-neutral-400"
            />
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={busy || (!body.trim() && fileNames.length === 0)}
                onClick={save}
                className="h-7 rounded-sm bg-neutral-700 px-3 text-xs font-bold uppercase text-white hover:bg-neutral-800"
              >
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setAnchor(null)}
                className="h-7 rounded-sm bg-neutral-500 px-3 text-xs font-bold uppercase text-white hover:bg-neutral-600"
              >
                Cancel
              </Button>
              <label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted">
                <Paperclip className="size-3" aria-hidden="true" />
                {fileNames.length > 0 ? fileNames.length : "Attach"}
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
            </div>
            <div className="mt-1 flex gap-1">
              {["Left message", "Spoke to someone"].map((quick) => (
                <button
                  key={quick}
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => setBody(quick)}
                >
                  {quick}
                </button>
              ))}
            </div>

            <div className="mt-2 max-h-44 divide-y overflow-y-auto border-t">
              {notes === null && <p className="pt-2 text-xs text-muted-foreground">Loading…</p>}
              {notes?.length === 0 && (
                <p className="pt-2 text-xs text-muted-foreground">No notes yet.</p>
              )}
              {notes?.map((n) => (
                <div key={n.id} className="space-y-0.5 py-2">
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{n.authorName}</span>{" "}
                    <span className="tabular-nums">{stamp(n.created_at)}</span>
                    {n.attachments > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5">
                        <Paperclip className="size-2.5" aria-hidden="true" />
                        {n.attachments}
                      </span>
                    )}
                  </p>
                  {n.body && <p className="whitespace-pre-wrap text-[13px]">{n.body}</p>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
