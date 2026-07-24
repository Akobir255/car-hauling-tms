"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/form-section";
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

// Renders the msgplane-style header actions for whatever state the order is
// in. Simple transitions run inline; Post, Mark Lost and Create Payment open
// a small disclosure with the extra input they need.
export function OrderActionBar({ loadId, actions }: { loadId: string; actions: OrderAction[] }) {
  const [pending, start] = useTransition();
  const [openPanel, setOpenPanel] = useState<"post" | "lost" | "payment" | null>(null);

  const run = (fn: () => Promise<void>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    start(async () => {
      await fn();
      toast.success("Done.");
    });
  };

  const has = (a: OrderAction) => actions.includes(a);

  return (
    <div className="flex flex-col items-end gap-2 [&_button]:h-8 [&_button]:text-xs [&_button]:font-semibold [&_button]:uppercase [&_button]:tracking-wide">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {has("convert_to_quote") && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => convertToQuote(loadId))}>
            Move to Quote
          </Button>
        )}
        {has("convert_to_order") && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => convertToOrder(loadId))}>
            Convert to Order
          </Button>
        )}
        {has("record_payment") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpenPanel(openPanel === "payment" ? null : "payment")}
          >
            Create Payment
          </Button>
        )}
        {has("post") && (
          <Button size="sm" variant="secondary" onClick={() => setOpenPanel(openPanel === "post" ? null : "post")}>
            Post
          </Button>
        )}
        {has("dispatch") && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => dispatchOrder(loadId))}>
            Dispatch
          </Button>
        )}
        {has("mark_picked_up") && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => markPickedUp(loadId))}>
            Mark Picked-Up
          </Button>
        )}
        {has("mark_delivered") && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => markDelivered(loadId))}>
            Mark Delivered
          </Button>
        )}
        {has("resend") && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resendPost(loadId))}>
            Resend
          </Button>
        )}
        {has("unpost") && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => unpostOrder(loadId), "Unpost this order and return it to Ready?")}
          >
            Unpost
          </Button>
        )}
        {has("hold") && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => holdOrder(loadId))}>
            Hold
          </Button>
        )}
        {has("archive") && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => archiveOrder(loadId))}>
            Archive
          </Button>
        )}
        {has("reactivate") && (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => reactivateOrder(loadId))}>
            Reactivate
          </Button>
        )}
        {has("mark_lost") && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setOpenPanel(openPanel === "lost" ? null : "lost")}
          >
            Mark as Lost
          </Button>
        )}
      </div>

      {openPanel === "post" && (
        <div className="flex items-center gap-2 rounded-md border bg-card p-2 shadow-sm">
          <span className="text-xs text-muted-foreground">Post to:</span>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => postOrder(loadId, "all"))}>
            All
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => postOrder(loadId, "cd"))}>
            Central Dispatch
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => postOrder(loadId, "sd"))}>
            Super Dispatch
          </Button>
        </div>
      )}

      {openPanel === "payment" && (
        <PaymentPanel loadId={loadId} onDone={() => setOpenPanel(null)} />
      )}
      {openPanel === "lost" && <LostPanel loadId={loadId} onDone={() => setOpenPanel(null)} />}
    </div>
  );
}

function PaymentPanel({ loadId, onDone }: { loadId: string; onDone: () => void }) {
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
    <form ref={ref} action={formAction} className="flex items-end gap-2 rounded-md border bg-card p-2 shadow-sm">
      <div className="space-y-1">
        <FieldLabel>Amount ($)</FieldLabel>
        <Input name="amount" inputMode="decimal" required className="w-28" />
      </div>
      <div className="space-y-1">
        <FieldLabel>Method</FieldLabel>
        <Input name="method" placeholder="Card / Zelle…" className="w-36" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Record"}
      </Button>
    </form>
  );
}

function LostPanel({ loadId, onDone }: { loadId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(markLost.bind(null, loadId), initialState);
  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) {
      toast.success("Marked as lost.");
      onDone();
    }
  }, [state, onDone]);
  return (
    <form action={formAction} className="flex items-end gap-2 rounded-md border bg-card p-2 shadow-sm">
      <div className="space-y-1">
        <FieldLabel>Reason (optional)</FieldLabel>
        <Input name="lost_reason" placeholder="Went with another broker…" className="w-64" />
      </div>
      <Button type="submit" size="sm" variant="outline" className="text-destructive" disabled={pending}>
        {pending ? "Saving…" : "Confirm lost"}
      </Button>
    </form>
  );
}
