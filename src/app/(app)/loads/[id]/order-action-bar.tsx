"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/form-section";
import { cn } from "@/lib/utils";
import type { OrderAction } from "@/lib/order-status";
import {
  convertToQuote,
  convertToOrder,
  postOrder,
  unpostOrder,
  dispatchOrder,
  markPickedUp,
  markDelivered,
  holdOrder,
  archiveOrder,
  reactivateOrder,
  resendPost,
  markLost,
  recordPayment,
  type LoadFormState,
} from "../actions";

const initialState: LoadFormState = { error: null };

// Actions that run immediately (no extra input). Post / Create Payment /
// Mark Lost need a small form, so they open a disclosure instead. Actions
// may return a result — a guard failure ("assign a carrier first") must
// reach the operator as an error toast, not a false "Done."
type ActionResult = { ok: boolean; error?: string } | void;
const INLINE: Partial<Record<OrderAction, (id: string) => Promise<ActionResult>>> = {
  convert_to_quote: convertToQuote,
  convert_to_order: convertToOrder,
  dispatch: dispatchOrder,
  mark_picked_up: markPickedUp,
  mark_delivered: markDelivered,
  resend: resendPost,
  hold: holdOrder,
  archive: archiveOrder,
  reactivate: reactivateOrder,
  unpost: unpostOrder,
};

const LABEL: Record<OrderAction, string> = {
  convert_to_quote: "Move to Quote",
  convert_to_order: "Convert to Order",
  post: "Post",
  unpost: "Unpost",
  resend: "Resend",
  dispatch: "Dispatch",
  mark_picked_up: "Mark Picked-Up",
  mark_delivered: "Mark Delivered",
  mark_lost: "Mark as Lost",
  record_payment: "Create Payment",
  hold: "Hold",
  archive: "Archive",
  reactivate: "Reactivate",
};

const PANEL_ACTIONS: OrderAction[] = ["post", "record_payment", "mark_lost"];
const CONFIRM: Partial<Record<OrderAction, string>> = {
  unpost: "Unpost this order and return it to Ready?",
};

// The header/sidebar action bar. The FIRST action for the status is the
// primary next step (loud); everything else is secondary, Mark Lost is a quiet
// danger. `stack` lays the buttons out full-width for the sidebar column.
export function OrderActionBar({
  loadId,
  actions,
  stack = false,
}: {
  loadId: string;
  actions: OrderAction[];
  stack?: boolean;
}) {
  const [pending, start] = useTransition();
  const [openPanel, setOpenPanel] = useState<OrderAction | null>(null);

  const runInline = (a: OrderAction) => {
    const fn = INLINE[a];
    if (!fn) return;
    if (CONFIRM[a] && !confirm(CONFIRM[a])) return;
    start(async () => {
      const result = await fn(loadId);
      if (result && !result.ok) toast.error(result.error ?? "Couldn't do that.");
      else toast.success("Done.");
    });
  };

  if (actions.length === 0) {
    return <p className="text-sm text-muted-foreground">No actions for this status.</p>;
  }

  return (
    <div className={cn("flex flex-col gap-2", stack ? "items-stretch" : "items-end")}>
      <div
        className={cn(
          "gap-2 [&_button]:h-8 [&_button]:text-xs [&_button]:font-semibold [&_button]:uppercase [&_button]:tracking-wide",
          stack
            ? "flex flex-col [&_button]:w-full [&_button]:justify-center"
            : "flex flex-wrap items-center justify-end"
        )}
      >
        {actions.map((a, i) => {
          const primary = i === 0;
          const danger = a === "mark_lost";
          return (
            <Button
              key={a}
              size="sm"
              variant={primary ? "default" : danger ? "outline" : "secondary"}
              className={danger ? "text-destructive hover:text-destructive" : undefined}
              disabled={pending}
              onClick={() =>
                PANEL_ACTIONS.includes(a)
                  ? setOpenPanel(openPanel === a ? null : a)
                  : runInline(a)
              }
            >
              {LABEL[a]}
            </Button>
          );
        })}
      </div>

      {openPanel === "post" && (
        <div className={cn("flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 shadow-sm", stack && "w-full")}>
          <span className="text-xs text-muted-foreground">Post to:</span>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { await postOrder(loadId, "all"); toast.success("Posted."); })}>
            All
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await postOrder(loadId, "cd"); toast.success("Posted."); })}>
            Central Dispatch
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await postOrder(loadId, "sd"); toast.success("Posted."); })}>
            Super Dispatch
          </Button>
        </div>
      )}

      {openPanel === "record_payment" && (
        <PaymentPanel loadId={loadId} onDone={() => setOpenPanel(null)} full={stack} />
      )}
      {openPanel === "mark_lost" && (
        <LostPanel loadId={loadId} onDone={() => setOpenPanel(null)} full={stack} />
      )}
    </div>
  );
}

function PaymentPanel({ loadId, onDone, full }: { loadId: string; onDone: () => void; full: boolean }) {
  const [state, formAction, pending] = useActionState(recordPayment.bind(null, loadId), initialState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) {
      toast.success("Payment recorded.");
      ref.current?.reset();
      onDone();
    }
  }, [state, onDone]);
  return (
    <form ref={ref} action={formAction} className={cn("flex flex-wrap items-end gap-2 rounded-md border bg-card p-2 shadow-sm", full && "w-full")}>
      <div className="space-y-1">
        <FieldLabel>Amount ($)</FieldLabel>
        <Input name="amount" inputMode="decimal" required className="w-28" />
      </div>
      <div className="space-y-1">
        <FieldLabel>Method</FieldLabel>
        <Input name="method" placeholder="Card / Zelle…" className="w-32" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Record"}
      </Button>
    </form>
  );
}

function LostPanel({ loadId, onDone, full }: { loadId: string; onDone: () => void; full: boolean }) {
  const [state, formAction, pending] = useActionState(markLost.bind(null, loadId), initialState);
  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) {
      toast.success("Marked as lost.");
      onDone();
    }
  }, [state, onDone]);
  return (
    <form action={formAction} className={cn("flex flex-wrap items-end gap-2 rounded-md border bg-card p-2 shadow-sm", full && "w-full")}>
      <div className="space-y-1 flex-1">
        <FieldLabel>Reason (optional)</FieldLabel>
        <Input name="lost_reason" placeholder="Went with another broker…" className="w-full min-w-40" />
      </div>
      <Button type="submit" size="sm" variant="outline" className="text-destructive" disabled={pending}>
        {pending ? "Saving…" : "Confirm lost"}
      </Button>
    </form>
  );
}
