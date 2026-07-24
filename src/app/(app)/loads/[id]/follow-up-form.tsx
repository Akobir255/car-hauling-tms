"use client";

import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) toast.success("Follow-up set.");
  }, [state]);

  const current = load.follow_up_at ? new Date(load.follow_up_at) : null;

  return (
    <div className="space-y-3">
      {current && (
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
          <p>
            Next follow-up:{" "}
            <span className="font-medium">
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
            disabled={clearing}
            onClick={() => startClearing(() => onClear())}
          >
            {clearing ? "Clearing..." : "Clear"}
          </Button>
        </div>
      )}
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              type="submit"
              name="preset"
              value={p.value}
              variant="outline"
              size="sm"
              disabled={pending}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Or pick a date/time</label>
          <Input name="follow_up_at" type="datetime-local" className="w-52" />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Note (optional)</label>
          <Input name="follow_up_note" placeholder="Left message / spoke to someone..." />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : "Set follow-up"}
        </Button>
      </form>
    </div>
  );
}
