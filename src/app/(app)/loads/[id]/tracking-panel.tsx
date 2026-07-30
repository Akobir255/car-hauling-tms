"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { issueTrackingLink } from "./tracking-actions";

// The way into Phase 2. Two links per order:
//
//   DRIVER   — writes positions, dies when the load is delivered. Text it to
//              whoever is actually hauling.
//   CUSTOMER — read-only status and distance, no carrier, no money, no contacts.
//
// Issuing REPLACES any live link of the same kind, which kills the old URL. That
// is said on the button rather than discovered by a driver mid-haul.

type Issued = { kind: "driver" | "customer"; url: string };

export function TrackingPanel({
  loadId,
  readOnly,
}: {
  loadId: string;
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<Issued | null>(null);

  const issue = (kind: "driver" | "customer") => {
    startTransition(async () => {
      const result = await issueTrackingLink(loadId, kind);
      if (result.error || !result.url) {
        toast.error(result.error ?? "Couldn't create the link.");
        return;
      }
      setIssued({ kind, url: result.url });
      toast.success(`${kind === "driver" ? "Driver" : "Customer"} link ready.`);
    });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied.");
    } catch {
      // Clipboard is permission-gated and fails silently in some browsers; the
      // link is on screen and selectable either way.
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        A driver link shares location for this order only and stops working on delivery. A customer
        link is read-only — status and distance, never the carrier or the price.
      </p>

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => issue("driver")}>
            {pending ? "Working…" : "New driver link"}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => issue("customer")}>
            {pending ? "Working…" : "New customer link"}
          </Button>
        </div>
      )}

      {issued && (
        <div className="space-y-1 rounded-md border p-3">
          <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
            {issued.kind} link — any previous one is now dead
          </p>
          <p className="break-all text-sm">{issued.url}</p>
          <Button size="sm" variant="ghost" onClick={() => copy(issued.url)}>
            Copy
          </Button>
        </div>
      )}

      {!issued && (
        <p className="text-[12px] text-muted-foreground">
          Links are shown once, here, when you create them — they are credentials, so they are not
          stored on the page.
        </p>
      )}
    </div>
  );
}
