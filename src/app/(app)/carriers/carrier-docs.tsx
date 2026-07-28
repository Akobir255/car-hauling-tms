"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FieldLabel } from "@/components/form-section";
import { formatDate } from "@/lib/format";
import {
  addCarrierDoc,
  carrierDocUrl,
  deleteCarrierDoc,
  type CarrierDocState,
} from "./docs-actions";

export type CarrierDoc = {
  id: string;
  doc_type: string;
  file_name: string | null;
  expires_at: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  coi_insurance: "COI (insurance)",
  w9: "W-9",
  mc_authority: "MC authority",
  other: "Other",
};

const initialState: CarrierDocState = { error: null };

// The carrier's document drawer — COIs front and center. Upload multiple
// files, tag the type, optionally record the COI expiry (which also lands on
// the carrier row so lists can flag stale insurance).
export function CarrierDocs({
  carrierId,
  docs,
  canManage,
}: {
  carrierId: string;
  docs: CarrierDoc[];
  canManage: boolean;
}) {
  const bound = addCarrierDoc.bind(null, carrierId);
  const [state, formAction, pending] = useActionState(bound, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [busy, start] = useTransition();

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state === initialState) return;
    const t = setTimeout(() => {
      toast.success("Documents attached.");
      formRef.current?.reset();
      setFileNames([]);
    }, 0);
    return () => clearTimeout(t);
  }, [state]);

  const open = (doc: CarrierDoc) =>
    start(async () => {
      const url = await carrierDocUrl(doc.id);
      if (!url) toast.error("Couldn't open that file.");
      else window.open(url, "_blank", "noopener,noreferrer");
    });

  const remove = (doc: CarrierDoc) =>
    start(async () => {
      if (!confirm(`Remove ${doc.file_name ?? "this document"}?`)) return;
      const r = await deleteCarrierDoc(carrierId, doc.id);
      if (r.error) toast.error(r.error);
      else toast.success("Removed.");
    });

  const expired = (d: CarrierDoc) => d.expires_at && new Date(d.expires_at) < new Date();

  return (
    <div className="space-y-4">
      {canManage && (
        <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
          {/* Width lives on the wrapper too: the fixed w-44 is what sizes this
              flex item, so the field can only go full-bleed if both give. */}
          <div className="space-y-1 max-md:w-full">
            <FieldLabel>Type</FieldLabel>
            <NativeSelect name="doc_type" defaultValue="coi_insurance" className="w-44 max-md:w-full">
              <option value="coi_insurance">COI (insurance)</option>
              <option value="w9">W-9</option>
              <option value="mc_authority">MC authority</option>
              <option value="other">Other</option>
            </NativeSelect>
          </div>
          <div className="space-y-1 max-md:w-full">
            <FieldLabel>Expires (COI)</FieldLabel>
            <Input type="date" name="expires_at" className="w-40 max-md:w-full" />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-msg-hover max-md:min-h-12">
            <Paperclip className="size-4" aria-hidden="true" />
            Pick files
            <input
              type="file"
              name="files"
              multiple
              className="hidden"
              onChange={(e) => setFileNames(Array.from(e.target.files ?? []).map((f) => f.name))}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className="max-md:min-h-12"
            disabled={pending || fileNames.length === 0}
          >
            {pending ? "Uploading…" : `Attach${fileNames.length ? ` ${fileNames.length}` : ""}`}
          </Button>
          {fileNames.length > 0 && (
            <p className="w-full text-xs text-muted-foreground">{fileNames.join(", ")}</p>
          )}
        </form>
      )}

      <div className="divide-y border-t">
        {docs.length === 0 && (
          <p className="pt-3 text-sm text-muted-foreground">
            No documents yet — attach the carrier&apos;s COI here.
          </p>
        )}
        {docs.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() => open(d)}
              className="inline-flex items-center gap-1.5 text-msg-link hover:underline max-md:min-h-12"
            >
              <FileText className="size-4 shrink-0" aria-hidden="true" />
              {d.file_name ?? "document"}
            </button>
            <span className="rounded-md border px-1.5 text-xs uppercase text-muted-foreground">
              {TYPE_LABEL[d.doc_type] ?? d.doc_type}
            </span>
            {d.expires_at && (
              <span
                className={
                  // Stale insurance has to stay loud, so EXPIRED keeps a solid
                  // destructive fill rather than a tint.
                  expired(d)
                    ? "rounded-md bg-destructive px-1.5 text-xs text-background"
                    : "text-xs text-muted-foreground"
                }
              >
                {expired(d) ? "EXPIRED " : "expires "}
                {formatDate(d.expires_at)}
              </span>
            )}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {formatDate(d.created_at)}
            </span>
            {canManage && (
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(d)}
                aria-label={`Remove ${d.file_name ?? "document"}`}
                // Grows into a real box on touch rather than a bare 15px glyph;
                // the display switch is mobile-only so the desktop baseline of
                // the icon in this row is untouched.
                className="text-destructive hover:opacity-70 max-md:flex max-md:size-12 max-md:items-center max-md:justify-center"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
