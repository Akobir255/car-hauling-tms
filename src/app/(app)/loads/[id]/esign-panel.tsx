"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CreditCard, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/form-section";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import type { ContractVersion } from "@/types/database";
import {
  sendContract,
  changeTermsAndSend,
  makeContractCurrent,
  markContractSigned,
  voidSignature,
  type EsignState,
} from "../actions";

export type ContractEventRow = { event: string; ip: string | null; created_at: string };
export type CardOnFile = {
  brand: string | null;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  cardholder_first: string;
  cardholder_last: string;
};

const initial: EsignState = { error: null };

// msgplane's E-Sign band: "⊞ Customer Contract" with a row of small boxed
// actions — open / resend / sms / view all / change terms & send (red).
// "view all" expands the version list + the who-opened-it audit;
// "change terms & send" mints a NEW contract version (fresh token).
export function EsignPanel({
  loadId,
  token,
  signedAt,
  sentAt,
  sentUndated = false,
  canManage,
  signedName,
  signedIp,
  signedEmail,
  requiresCard,
  card,
  versions = [],
  events = [],
}: {
  loadId: string;
  token: string | null;
  signedAt: string | null;
  sentAt: string | null;
  /** Imported order: a contract went out, send date unrecorded. */
  sentUndated?: boolean;
  canManage: boolean;
  signedName?: string | null;
  signedIp?: string | null;
  signedEmail?: string | null;
  requiresCard: boolean;
  card?: CardOnFile | null;
  versions?: ContractVersion[];
  events?: ContractEventRow[];
}) {
  const send = sendContract.bind(null, loadId);
  const [state, formAction] = useActionState(send, initial);
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<"none" | "all" | "terms">("none");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.sentVia?.includes("sms")) toast.success("Contract texted to the customer.");
    else if (state.sentVia) toast.success("Contract emailed to the customer.");
    else if (state.link && !state.error) toast.success("Contract link ready.");
  }, [state]);

  const signHref = token ? `/sign/${token}` : null;
  // Two of these boxes void a contract, so below md they take the full touch
  // target; a <button> centers its own label in the taller box.
  const boxBtn =
    "h-8 rounded-md border bg-card px-3 text-sm lowercase text-foreground transition-colors hover:bg-msg-hover disabled:opacity-40 max-md:min-h-12";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-[15px] text-foreground">
          <SquarePlus className="size-4" aria-hidden="true" />
          Customer Contract
        </span>
        {/* The accents are the spec's own (chart-5 green, chart-2 orange,
            msg-shipper blue) but carried as a tint behind body ink — those
            hues are icon-grade, well under 4.5:1 as text on white. */}
        {signedAt ? (
          <span
            className="rounded-md bg-chart-5/20 px-2.5 py-0.5 text-xs text-foreground"
            title={signedIp ? `Signed from IP ${signedIp}` : undefined}
          >
            Signed {formatDate(signedAt)}
            {signedName ? ` — ${signedName}` : ""}
          </span>
        ) : sentAt ? (
          <span className="rounded-md bg-chart-2/20 px-2.5 py-0.5 text-xs text-foreground">
            Sent {formatDate(sentAt)} · awaiting signature
          </span>
        ) : sentUndated ? (
          // Imported from the old system, which recorded that a contract went
          // out but never when. Saying "Not sent" here would be wrong; naming a
          // date would be invented.
          <span
            className="rounded-md bg-chart-2/20 px-2.5 py-0.5 text-xs text-foreground"
            title="Imported: the old system did not record a send date."
          >
            Sent · awaiting signature
          </span>
        ) : (
          <span className="rounded-md bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            Not sent
          </span>
        )}
        {requiresCard && (
          <span className="inline-flex items-center gap-1 rounded-md bg-msg-shipper/20 px-2.5 py-0.5 text-xs text-foreground">
            <CreditCard className="size-3" aria-hidden="true" />
            card info required
          </span>
        )}
        {card && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-0.5 text-xs tabular-nums text-foreground">
            <CreditCard className="size-3" aria-hidden="true" />
            {(card.brand || "CARD").toUpperCase()} •••• {card.last4}
            {card.exp_month && card.exp_year
              ? ` · ${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`
              : ""}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 max-md:gap-3">
        {signHref && sentAt && (
          <a href={signHref} target="_blank" rel="noopener noreferrer" className={cn(boxBtn, "inline-flex items-center")}>
            open
          </a>
        )}

        {!signedAt && (
          <>
            {!sentAt ? (
              <>
                <form action={formAction}>
                  <input type="hidden" name="require_card" value="0" />
                  <button type="submit" className={boxBtn}>send</button>
                </form>
                <form action={formAction}>
                  <input type="hidden" name="require_card" value="1" />
                  <button type="submit" className={boxBtn}>send + card info</button>
                </form>
              </>
            ) : (
              <form action={formAction}>
                <button type="submit" className={boxBtn}>resend</button>
              </form>
            )}
            <form action={formAction}>
              <input type="hidden" name="via" value="sms" />
              <button type="submit" className={boxBtn}>sms</button>
            </form>
          </>
        )}

        <button type="button" className={boxBtn} onClick={() => setPanel(panel === "all" ? "none" : "all")}>
          view all
        </button>

        {!signedAt && (
          <button
            type="button"
            onClick={() => setPanel(panel === "terms" ? "none" : "terms")}
            className={cn(boxBtn, "border-destructive/40 text-destructive hover:bg-destructive/10")}
          >
            change terms &amp; send
          </button>
        )}

        {signHref && (
          <button
            type="button"
            className={cn(boxBtn, "border-transparent shadow-none")}
            onClick={() => {
              // Always derive from the CURRENT token — after a version change
              // rotates it, a stale action-state link would be a dead URL.
              navigator.clipboard?.writeText(`${window.location.origin}${signHref}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "copied" : "copy link"}
          </button>
        )}

        {canManage && !signedAt && sentAt && (
          <button
            type="button"
            className={cn(boxBtn, "border-transparent shadow-none")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markContractSigned(loadId);
                toast.success("Marked signed.");
              })
            }
          >
            mark signed
          </button>
        )}
        {canManage && signedAt && (
          <button
            type="button"
            className={cn(boxBtn, "border-transparent text-destructive shadow-none")}
            disabled={pending}
            onClick={() => {
              if (!confirm("Void this signature so a new contract can be sent?")) return;
              start(async () => {
                await voidSignature(loadId);
                toast.success("Signature voided.");
              });
            }}
          >
            void signature
          </button>
        )}
      </div>

      {panel === "terms" && <ChangeTermsPanel loadId={loadId} requiresCard={requiresCard} onDone={() => setPanel("none")} />}

      {panel === "all" && (
        <ViewAllPanel
          loadId={loadId}
          currentToken={token}
          versions={versions}
          events={events}
          canManage={canManage}
          signed={Boolean(signedAt)}
        />
      )}

      {/* Compact audit line, always visible once there's activity. */}
      {(events.length > 0 || signedEmail) && (
        <p className="border-t pt-2.5 text-xs text-muted-foreground">
          {(() => {
            const views = events.filter((e) => e.event === "viewed");
            const ips = new Set(views.map((v) => v.ip).filter(Boolean));
            const parts: string[] = [];
            if (views.length > 0) {
              parts.push(`Link opened ${views.length}× from ${ips.size} IP${ips.size === 1 ? "" : "s"}`);
            }
            if (signedIp) parts.push(`signed from ${signedIp}`);
            if (signedEmail) parts.push(signedEmail);
            return parts.join(" · ");
          })()}
        </p>
      )}
    </div>
  );
}

// msgplane's "change terms & send": adjust price/deposit, choose whether the
// signing page asks for card details, and send a brand-new version. The old
// link dies and any signature is voided — that's the point.
function ChangeTermsPanel({
  loadId,
  requiresCard,
  onDone,
}: {
  loadId: string;
  requiresCard: boolean;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(changeTermsAndSend.bind(null, loadId), initial);
  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initial) {
      toast.success("New contract version sent.");
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border bg-muted p-3">
      <div className="space-y-1">
        <FieldLabel>New tariff ($)</FieldLabel>
        <Input name="tariff" inputMode="decimal" placeholder="keep current" className="h-8 w-28 max-md:min-h-12" />
      </div>
      <div className="space-y-1">
        <FieldLabel>New deposit ($)</FieldLabel>
        <Input name="deposit" inputMode="decimal" placeholder="keep current" className="h-8 w-28 max-md:min-h-12" />
      </div>
      <div className="min-w-40 flex-1 space-y-1 max-md:basis-full">
        <FieldLabel>Note (shown in view all)</FieldLabel>
        <Input name="note" maxLength={300} placeholder="What changed…" className="h-8 max-md:min-h-12" />
      </div>
      {/* The label wraps the box, so the whole 44px row is the hit area and the
          15px checkbox itself is untouched. */}
      <label className="flex items-center gap-1.5 pb-1.5 text-sm max-md:min-h-12">
        <input type="checkbox" name="require_card" defaultChecked={requiresCard} className="size-4 accent-primary" />
        Require card info
      </label>
      <label className="flex items-center gap-1.5 pb-1.5 text-sm max-md:min-h-12">
        <input type="checkbox" name="also_sms" className="size-4 accent-primary" />
        Also SMS
      </label>
      <Button type="submit" size="sm" className="max-md:min-h-12" disabled={pending}>
        {pending ? "Sending…" : "Send new version"}
      </Button>
      <p className="basis-full text-xs text-muted-foreground">
        Sends a fresh signing link. The previous link stops working and any existing signature is voided.
      </p>
    </form>
  );
}

// msgplane's "view all" popup: every contract version (current one on top,
// "make current" to restore an older one) and the open/sign audit with a
// check-location link per IP.
function ViewAllPanel({
  loadId,
  currentToken,
  versions,
  events,
  canManage,
  signed,
}: {
  loadId: string;
  currentToken: string | null;
  versions: ContractVersion[];
  events: ContractEventRow[];
  canManage: boolean;
  signed: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 rounded-md border bg-muted p-3 text-sm">
      <div className="space-y-1.5">
        {versions.length === 0 && (
          <p className="text-muted-foreground">No contract versions yet — versions appear when a contract is sent.</p>
        )}
        {versions.map((v) => {
          const isCurrent = v.token === currentToken;
          return (
            <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2">
              <span className={cn(v.signed_at || isCurrent ? "text-foreground" : "text-muted-foreground")}>
                Contract{v.signed_at ? " — signed" : ""}
              </span>
              <span className="tabular-nums text-muted-foreground">{formatDateTime(v.sent_at ?? v.created_at)}</span>
              {v.tariff != null && <span className="tabular-nums">{formatCurrency(v.tariff)}</span>}
              {v.deposit != null && <span className="tabular-nums text-muted-foreground">dep {formatCurrency(v.deposit)}</span>}
              {v.requires_card && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary">card</span>
              )}
              {v.sent_via && <span className="text-xs uppercase text-muted-foreground">{v.sent_via}</span>}
              {v.note && <span className="italic text-muted-foreground">“{v.note}”</span>}
              {v.signed_at && v.signed_name && <span className="text-muted-foreground">by {v.signed_name}</span>}
              <span className="ml-auto">
                {isCurrent ? (
                  // Solid accent chip: the green reads at a glance and the
                  // dark accent ink clears contrast on it in both themes.
                  <span className="rounded-md bg-chart-5 px-1.5 py-0.5 text-xs uppercase text-msg-selected-foreground">current</span>
                ) : canManage && !signed ? (
                  <button
                    type="button"
                    className="text-xs text-msg-link hover:underline disabled:opacity-50 max-md:min-h-12"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await makeContractCurrent(loadId, v.id);
                        if (!res.ok) toast.error(res.error ?? "Couldn't restore.");
                        else toast.success("Version restored as current.");
                      })
                    }
                  >
                    make current
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">superseded</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {events.length > 0 && (
        <ul className="space-y-0.5 border-t pt-2">
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 tabular-nums text-xs text-muted-foreground">
              <span className={e.event === "signed" ? "text-foreground" : undefined}>
                {e.event === "signed" ? "contract SIGNED" : "contract opened"}
              </span>
              <span>— {e.ip ?? "unknown IP"}</span>
              {e.ip && (
                <a
                  href={`https://ipinfo.io/${encodeURIComponent(e.ip)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-msg-link hover:underline max-md:inline-flex max-md:min-h-12 max-md:items-center"
                >
                  check location
                </a>
              )}
              <span className="ml-auto">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
