"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatPhone } from "@/lib/format";
import { issueTrackingLink, textDriverLink } from "./tracking-actions";

// The way into Phase 2. Two links per order:
//
//   DRIVER   — writes positions, dies when the load is delivered. Text it to
//              whoever is actually hauling.
//   CUSTOMER — read-only status and distance, no carrier, no money, no contacts.
//
// Issuing REPLACES any live link of the same kind, which kills the old URL. That
// is said on the button rather than discovered by a driver mid-haul.
//
// The URL itself is shown once, at mint time, and never again — but the FACT of
// a live token (issued when, pinged when) is staff-readable in tracking_tokens,
// so the server passes that in as props and the panel stops looking amnesiac.

export type TrackingTokenSummary = {
  issuedAt: string;
  /** tracking_tokens.last_used_at — stamped by the ingest route on every accepted ping. */
  lastPingAt: string | null;
};

type Issued = { kind: "driver" | "customer"; url: string };

function fenceWarning(missing: ("pickup" | "delivery")[]): string {
  return missing
    .map((k) => `The ${k} address could not be geocoded — no arrival detection at ${k}.`)
    .join(" ");
}

function TokenStatus({
  label,
  token,
  showPing,
}: {
  label: string;
  token: TrackingTokenSummary | null;
  showPing: boolean;
}) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <span className="font-medium">{label}</span>{" "}
      {token ? (
        <span className="text-muted-foreground">
          live — issued {formatDateTime(token.issuedAt)}
          {/* Only the driver link pings; the customer page never stamps last_used_at. */}
          {showPing &&
            (token.lastPingAt
              ? ` · last ping ${formatDateTime(token.lastPingAt)}`
              : " · no pings yet")}
        </span>
      ) : (
        <span className="text-muted-foreground">none live</span>
      )}
    </div>
  );
}

export function TrackingPanel({
  loadId,
  readOnly,
  driverToken,
  customerToken,
  driverPhone,
}: {
  loadId: string;
  readOnly: boolean;
  driverToken: TrackingTokenSummary | null;
  customerToken: TrackingTokenSummary | null;
  driverPhone: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [texting, startTexting] = useTransition();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [fenceNote, setFenceNote] = useState<string | null>(null);

  const issue = (kind: "driver" | "customer") => {
    startTransition(async () => {
      const result = await issueTrackingLink(loadId, kind);
      if (result.error || !result.url) {
        toast.error(result.error ?? "Couldn't create the link.");
        return;
      }
      setIssued({ kind, url: result.url });
      if (result.fencesMissing?.length) setFenceNote(fenceWarning(result.fencesMissing));
      toast.success(`${kind === "driver" ? "Driver" : "Customer"} link ready.`);
    });
  };

  const textToDriver = () => {
    startTexting(async () => {
      const result = await textDriverLink(loadId);
      if (result.fencesMissing?.length) setFenceNote(fenceWarning(result.fencesMissing));
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Driver link texted to ${formatPhone(result.sentTo)}.`);
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

      <div className="grid gap-2 sm:grid-cols-2">
        <TokenStatus label="Driver link" token={driverToken} showPing />
        <TokenStatus label="Customer link" token={customerToken} showPing={false} />
      </div>

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => issue("driver")}>
            {pending ? "Working…" : "New driver link"}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => issue("customer")}>
            {pending ? "Working…" : "New customer link"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={texting || pending || !driverPhone}
            onClick={textToDriver}
          >
            {texting ? "Texting…" : "Text link to driver"}
          </Button>
        </div>
      )}

      {!readOnly && (
        <p className="text-[12px] text-muted-foreground">
          {driverPhone
            ? `Texting sends the live driver link to ${formatPhone(driverPhone)} — a new one is minted first if none is live.`
            : "To text the driver, add their phone on the dispatch sheet first."}
        </p>
      )}

      {fenceNote && (
        <p className="rounded-md border border-chart-2 bg-chart-2/15 px-3 py-2 text-sm">
          {fenceNote} Positions still record; only automatic arrival detection is lost.
        </p>
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
