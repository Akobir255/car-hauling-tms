"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TICKET_PRIORITIES } from "@/types/database";
import { createTicket, type TicketFormState } from "../actions";

const initialState: TicketFormState = { error: null };

export function TicketForm({
  reps,
  loads,
  defaultLoadId,
  defaultCustomerId,
  currentUserId,
}: {
  reps: { id: string; name: string }[];
  loads: { id: string; label: string }[];
  defaultLoadId?: string;
  defaultCustomerId?: string;
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState(createTicket, initialState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="mx-auto max-w-2xl space-y-5">
      {defaultCustomerId && (
        <input type="hidden" name="customer_id" value={defaultCustomerId} />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          name="subject"
          required
          minLength={3}
          placeholder="Carrier no-show at pickup"
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <NativeSelect id="priority" name="priority" defaultValue="normal">
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p} className="capitalize">
                {p}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assigned_to">Assign to</Label>
          <NativeSelect id="assigned_to" name="assigned_to" defaultValue={currentUserId}>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="load_id">Related order (optional)</Label>
        <NativeSelect id="load_id" name="load_id" defaultValue={defaultLoadId ?? ""}>
          <option value="">— none —</option>
          {loads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">Details</Label>
        <Textarea
          id="body"
          name="body"
          rows={6}
          placeholder="What happened, what's needed, and by when."
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" render={<Link href="/tickets" />}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}
