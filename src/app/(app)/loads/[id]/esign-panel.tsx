"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { sendContract, markContractSigned, voidSignature, type EsignState } from "../actions";

const initial: EsignState = { error: null };

// The msgplane-style E-Sign row: status + Send / SMS / Resend / View / Mark
// signed. Signing itself happens on the public /sign/<token> page.
export function EsignPanel({
  loadId,
  token,
  signedAt,
  sentAt,
  canManage,
  signedName,
  signedIp,
}: {
  loadId: string;
  token: string | null;
  signedAt: string | null;
  sentAt: string | null;
  canManage: boolean;
  signedName?: string | null;
  signedIp?: string | null;
}) {
  const send = sendContract.bind(null, loadId);
  const [state, formAction] = useActionState(send, initial);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.sentVia === "sms") toast.success("Contract texted to the customer.");
    else if (state.link && !state.error) toast.success("Contract link ready.");
  }, [state]);

  const signHref = token ? `/sign/${token}` : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Customer Contract</span>
        {signedAt ? (
          <span
            className="rounded-full bg-green-600/10 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400"
            title={signedIp ? `Signed from IP ${signedIp}` : undefined}
          >
            Signed {formatDate(signedAt)}
            {signedName ? ` — ${signedName}` : ""}
          </span>
        ) : sentAt ? (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            Sent {formatDate(sentAt)} · awaiting signature
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            Not sent
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 [&_button]:h-8 [&_button]:text-xs [&_button]:font-semibold [&_button]:uppercase [&_button]:tracking-wide">
        {!signedAt && (
          <>
            <form action={formAction}>
              <Button type="submit" size="sm" variant="secondary">
                {sentAt ? "Change terms & resend" : "Send for signature"}
              </Button>
            </form>
            <form action={formAction}>
              <input type="hidden" name="via" value="sms" />
              <Button type="submit" size="sm" variant="outline">
                SMS
              </Button>
            </form>
          </>
        )}

        {signHref && (
          <Button size="sm" variant="outline" render={<a href={signHref} target="_blank" rel="noopener noreferrer" />}>
            View
          </Button>
        )}

        {signHref && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const url = state.link ?? `${window.location.origin}${signHref}`;
              navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        )}

        {canManage && !signedAt && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markContractSigned(loadId);
                toast.success("Marked signed.");
              })
            }
          >
            Mark signed
          </Button>
        )}
        {canManage && signedAt && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              if (!confirm("Void this signature so it can be re-sent?")) return;
              start(async () => {
                await voidSignature(loadId);
                toast.success("Signature voided.");
              });
            }}
          >
            Void signature
          </Button>
        )}
      </div>
    </div>
  );
}
