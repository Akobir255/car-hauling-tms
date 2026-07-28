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
  const [anchor, setAnchor] = useState<{ top: number; left: number; phone: boolean } | null>(
    null
  );
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
    // Only read for autoFocus — the docking itself is CSS, so a rotate is
    // handled by the media query rather than by re-measuring.
    setAnchor({ top, left, phone: window.matchMedia("(max-width: 47.99rem)").matches });
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
          "focus-ring inline-flex min-w-6 items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-xs tabular-nums transition-colors hover:bg-msg-hover",
          count > 0 ? "text-foreground" : "text-muted-foreground"
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
            // Border gray and no shadow: the nav bar is the only raised
            // surface, and the popup separates the way every other one does.
            // The JS anchor only reserved 260px for a ~310px panel, so on a
            // phone the notes thread fell off the bottom of the screen. Below
            // md the panel docks instead — to the TOP, unlike quick-view's
            // bottom dock, because this one owns a textarea and the keyboard
            // takes the lower half. The anchor rides in custom properties so
            // the md rules win without !important; at >=768px this computes to
            // exactly today's 340px box at today's top/left.
            className="fixed left-2 right-2 top-2 z-50 max-h-[85vh] w-auto overflow-y-auto rounded-md border border-border bg-card p-2 md:right-auto md:left-[var(--nq-left)] md:top-[var(--nq-top)] md:max-h-none md:w-[var(--nq-width)] md:overflow-visible"
            style={
              {
                "--nq-top": `${anchor.top}px`,
                "--nq-left": `${anchor.left}px`,
                "--nq-width": `${PANEL_WIDTH}px`,
              } as React.CSSProperties
            }
          >
            <Textarea
              rows={4}
              // The keyboard would otherwise open over the panel before the
              // rep has decided they are writing rather than reading.
              autoFocus={!anchor.phone}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label={`New note on ${loadNumber}`}
              className="resize-y"
            />
            <div className="mt-2 flex items-center gap-1.5">
              {/* The size variant's 26px is a mouse target; below md each of
                  these takes a 45px box the way the card row they open from
                  already does. */}
              <Button
                type="button"
                size="sm"
                className="max-md:min-h-12 max-md:px-4"
                disabled={busy || (!body.trim() && fileNames.length === 0)}
                onClick={save}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="max-md:min-h-12 max-md:px-4"
                onClick={() => setAnchor(null)}
              >
                Cancel
              </Button>
              <label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 text-xs text-muted-foreground hover:bg-msg-hover max-md:min-h-12 max-md:px-4">
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
                  className="focus-ring rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-msg-hover max-md:min-h-12 max-md:px-4"
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
                  <p className="text-xs text-muted-foreground">
                    <span className="text-foreground">{n.authorName}</span>{" "}
                    <span className="tabular-nums">{stamp(n.created_at)}</span>
                    {n.attachments > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5">
                        <Paperclip className="size-2.5" aria-hidden="true" />
                        {n.attachments}
                      </span>
                    )}
                  </p>
                  {n.body && <p className="whitespace-pre-wrap text-xs">{n.body}</p>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
