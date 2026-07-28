"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  resend: resendPost,
  hold: holdOrder,
  archive: archiveOrder,
  reactivate: reactivateOrder,
  unpost: unpostOrder,
};

// Each board posts straight from its own box — no intermediate panel.
const POST_BOARD: Partial<Record<OrderAction, "cd" | "sd" | "all">> = {
  post_cd: "cd",
  post_sd: "sd",
  post_all: "all",
};

// Spelled out for the tooltip and the toast, where "All" alone reads as a
// board name rather than as "both of them".
const POST_TARGET: Record<"cd" | "sd" | "all", string> = {
  cd: "Central Dispatch",
  sd: "Super Dispatch",
  all: "both boards",
};

const LABEL: Record<OrderAction, string> = {
  convert_to_quote: "Move to Quote",
  convert_to_order: "Convert to Order",
  post_cd: "Post CD",
  post_sd: "Post SD",
  post_all: "Post All",
  unpost: "Unpost",
  dispatch: "Dispatch",
  resend: "Resend",
  mark_lost: "Mark as Lost",
  record_payment: "Create Payment",
  hold: "Hold",
  archive: "Archive",
  reactivate: "Reactivate",
};

const PANEL_ACTIONS: OrderAction[] = ["record_payment", "mark_lost"];
const CONFIRM: Partial<Record<OrderAction, string>> = {
  unpost: "Unpost this order and return it to Ready?",
};

// The header/sidebar action bar. The FIRST action for the status is the
// primary next step (loud); everything else is secondary, Mark Lost is a quiet
// danger. `stack` lays the buttons out full-width for the sidebar column.
const LOADBOARD_LABEL: Record<string, string> = {
  all: "All",
  cd: "Central Dispatch",
  sd: "Super Dispatch",
};

export function OrderActionBar({
  loadId,
  actions,
  stack = false,
  loadboard = null,
}: {
  loadId: string;
  actions: OrderAction[];
  stack?: boolean;
  /** The order's Loadboard setting, so Post highlights the intended board. */
  loadboard?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openPanel, setOpenPanel] = useState<OrderAction | null>(null);

  const runInline = (a: OrderAction) => {
    // DISPATCH opens the Dispatch Sheet (msgplane's dispatch_to_cd screen);
    // assigning the carrier THERE is what dispatches.
    if (a === "dispatch") {
      router.push(`/loads/${loadId}/dispatch`);
      return;
    }
    const board = POST_BOARD[a];
    if (board) {
      start(async () => {
        await postOrder(loadId, board);
        toast.success(`Posted to ${POST_TARGET[board]}.`);
      });
      return;
    }
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
          // Materialize's .btn, which is what these were: uppercase, 500
          // weight, half a pixel of tracking. The label is the whole button,
          // so the letterform matters as much as the fill.
          "gap-2 [&_button]:h-8 [&_button]:text-xs [&_button]:font-medium [&_button]:uppercase [&_button]:tracking-wide max-md:[&_button]:min-h-12",
          stack
            ? "flex flex-col [&_button]:w-full [&_button]:justify-center"
            // Right-aligned, these wrap into a ragged staircase on a phone.
            : "flex flex-wrap items-center justify-end max-md:justify-start"
        )}
      >
        {actions.map((a) => {
          // msgplane's header bar: EVERY action is the same solid gray box
          // with a white uppercase label — including Mark as Lost, which used
          // to carry red text. Red ink on this fill is unreadable, and the box
          // opens a confirm panel rather than firing, so the warning lives
          // there instead of in the color.
          // The boxes are all one color, so which board this order was MEANT
          // for has to come from somewhere — the header's Loadboard field says
          // it, and the tooltip repeats it where the mistake would happen.
          const board = POST_BOARD[a];
          const title = board
            ? `Post to ${POST_TARGET[board]}` +
              (loadboard && loadboard !== board
                ? ` — this order's Loadboard is set to ${LOADBOARD_LABEL[loadboard] ?? loadboard}.`
                : ".")
            : undefined;
          return (
            <Button
              key={a}
              size="sm"
              title={title}
              className="bg-msg-btn text-msg-btn-foreground hover:bg-msg-btn-hover"
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
    <form
      ref={ref}
      action={formAction}
      className={cn(
        "flex flex-wrap items-end gap-2 rounded-md border bg-card p-2 max-md:gap-3",
        full && "w-full"
      )}
    >
      <div className="space-y-1">
        <FieldLabel>Amount ($)</FieldLabel>
        <Input name="amount" inputMode="decimal" required className="w-28" />
      </div>
      <div className="space-y-1">
        <FieldLabel>Method</FieldLabel>
        <Input name="method" placeholder="Card / Zelle…" className="w-32" />
      </div>
      <Button type="submit" size="sm" className="max-md:min-h-12" disabled={pending}>
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
    <form
      action={formAction}
      className={cn(
        "flex flex-wrap items-end gap-2 rounded-md border bg-card p-2 max-md:gap-3",
        full && "w-full"
      )}
    >
      <div className="space-y-1 flex-1 max-md:basis-full">
        <FieldLabel>Reason (optional)</FieldLabel>
        <Input name="lost_reason" placeholder="Went with another broker…" className="w-full min-w-40" />
      </div>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="text-destructive max-md:min-h-12"
        disabled={pending}
      >
        {pending ? "Saving…" : "Confirm lost"}
      </Button>
    </form>
  );
}
