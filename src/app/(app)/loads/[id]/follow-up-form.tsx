"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/form-section";
import type { Load } from "@/types/database";
import type { LoadFormState } from "../actions";

const initialState: LoadFormState = { error: null };

const PRESETS = [
  { value: "1d", label: "1 Day" },
  { value: "2d", label: "2 Days" },
  { value: "3d", label: "3 Days" },
  { value: "1w", label: "1 Week" },
];

export function FollowUpForm({
  load,
  action,
  onClear,
}: {
  load: Load;
  action: (state: LoadFormState, formData: FormData) => Promise<LoadFormState>;
  onClear: () => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [clearing, startClearing] = useTransition();
  const [note, setNote] = useState("");

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) toast.success("Follow-up set.");
  }, [state]);

  const current = load.follow_up_at ? new Date(load.follow_up_at) : null;

  return (
    <div className="space-y-3">
      {current && (
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm max-md:flex-wrap max-md:gap-2">
          <p>
            Next follow-up:{" "}
            <span className="tabular-nums">
              {current.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </span>
            {load.follow_up_note ? (
              <span className="text-muted-foreground"> — {load.follow_up_note}</span>
            ) : null}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-md:min-h-12"
            disabled={clearing}
            onClick={() => startClearing(() => onClear())}
          >
            {clearing ? "Clearing..." : "Clear"}
          </Button>
        </div>
      )}
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        {/* Every preset is a submit that fires on tap — they get the full 44px
            and their own line rather than four cramped chips. */}
        <div className="flex gap-1.5 max-md:w-full max-md:flex-wrap max-md:gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              type="submit"
              name="preset"
              value={p.value}
              variant="outline"
              size="sm"
              className="max-md:min-h-12"
              disabled={pending}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="space-y-1 max-md:w-full">
          <FieldLabel>Or pick a date/time</FieldLabel>
          <Input name="follow_up_at" type="datetime-local" className="w-52 max-md:w-full" />
        </div>
        <div className="flex-1 space-y-1 max-md:basis-full">
          <FieldLabel>Note (optional)</FieldLabel>
          <Input
            name="follow_up_note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Left message / spoke to someone..."
          />
          {/* msgplane's one-tap call outcomes — they prefill the note. */}
          <div className="flex gap-1.5 pt-1 max-md:flex-wrap max-md:gap-3">
            {["Left message", "Spoke to someone"].map((quick) => (
              <Button
                key={quick}
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground max-md:min-h-12"
                onClick={() => setNote(quick)}
              >
                {quick}
              </Button>
            ))}
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          className="max-md:min-h-12 max-md:w-full"
          disabled={pending}
        >
          {pending ? "Saving..." : "Set follow-up"}
        </Button>
      </form>
    </div>
  );
}
