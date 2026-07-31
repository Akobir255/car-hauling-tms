"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/form-section";
import { recordQuoteOutcome, type OutcomeState } from "./quote-outcome-actions";

const REASONS = [
  { value: "", label: "Reason (optional but valuable)" },
  { value: "price", label: "Price — we were too high" },
  { value: "went_with_competitor", label: "Went with a competitor" },
  { value: "timing", label: "Timing — we couldn't cover it in time" },
  { value: "no_response", label: "Customer went quiet" },
  { value: "customer_cancelled", label: "Customer cancelled the move" },
  { value: "vehicle_not_ready", label: "Vehicle wasn't ready" },
  { value: "other", label: "Something else" },
];

/**
 * Closing the loop on a quote.
 *
 * Deliberately not buried behind a menu: 6,612 quotes in this book died with no
 * reason recorded, and the only way that number stops growing is if saying why
 * is faster than not saying why.
 */
export function QuoteOutcomeForm({ loadId, open }: { loadId: string; open: boolean }) {
  const bound = recordQuoteOutcome.bind(null, loadId);
  const [state, action, pending] = useActionState<OutcomeState, FormData>(bound, { error: null });
  const [outcome, setOutcome] = useState(open ? "lost" : "won");
  const [expanded, setExpanded] = useState(false);

  // toast only. Collapsing here would be a synchronous setState inside an
  // effect, which React 19 lints as an error — and the derived alternative
  // (close when state.success is set) cannot tell a fresh success from the one
  // still sitting in the previous action result. So the panel stays open with
  // its confirmation showing and the rep closes it, which is also one fewer
  // thing moving under the cursor.
  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);

  if (!expanded) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
        Record the outcome
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-md border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="outcome">What happened</FieldLabel>
          <NativeSelect
            id="outcome"
            name="outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="won">Won it</option>
            <option value="lost">Lost it</option>
            <option value="expired">Expired — never decided</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="reason">Why</FieldLabel>
          <NativeSelect id="reason" name="reason" defaultValue="">
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {outcome === "lost" && (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="competitor_price">What did the other broker quote?</FieldLabel>
          <Input id="competitor_price" name="competitor_price" inputMode="decimal" placeholder="e.g. 780" />
          <p className="text-xs text-muted-foreground">
            The single most useful number on this form. &ldquo;Lost at $900&rdquo; is a fact;
            &ldquo;lost at $900 to $780&rdquo; tells us what to do next time.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <FieldLabel htmlFor="reason_note">Anything worth remembering</FieldLabel>
        <Textarea id="reason_note" name="reason_note" rows={2} />
      </div>

      {state.success && <p className="text-sm text-ord-accent">{state.success}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Recording…" : "Record it"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(false)}>
          {state.success ? "Close" : "Cancel"}
        </Button>
        {outcome === "lost" && open && (
          <span className="text-xs text-muted-foreground">This will also move the order to Lost.</span>
        )}
      </div>
    </form>
  );
}
