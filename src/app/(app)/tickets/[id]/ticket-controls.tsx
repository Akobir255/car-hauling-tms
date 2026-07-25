"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/form-section";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from "@/types/database";
import { addTicketComment, updateTicket, type TicketFormState } from "../actions";

const initialState: TicketFormState = { error: null };

// Status / priority / assignee. Each control submits on change — no Save button
// to forget.
export function TicketControls({
  ticketId,
  status,
  priority,
  assignedTo,
  reps,
}: {
  ticketId: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTo: string | null;
  reps: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();

  const submit = (field: string, value: string) => {
    const fd = new FormData();
    fd.set(field, value);
    start(async () => {
      await updateTicket(ticketId, fd);
      toast.success("Updated.");
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <FieldLabel htmlFor="status">Status</FieldLabel>
        <NativeSelect
          id="status"
          value={status}
          disabled={pending}
          onChange={(e) => submit("status", e.target.value)}
        >
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="priority">Priority</FieldLabel>
        <NativeSelect
          id="priority"
          value={priority}
          disabled={pending}
          onChange={(e) => submit("priority", e.target.value)}
        >
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p} className="capitalize">
              {p}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="assigned_to">Assigned to</FieldLabel>
        <NativeSelect
          id="assigned_to"
          value={assignedTo ?? ""}
          disabled={pending}
          onChange={(e) => submit("assigned_to", e.target.value)}
        >
          {!assignedTo && <option value="">— unassigned —</option>}
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

export function CommentForm({ ticketId }: { ticketId: string }) {
  const bound = addTicketComment.bind(null, ticketId);
  const [state, formAction, pending] = useActionState(bound, initialState);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <Textarea
        name="body"
        rows={3}
        required
        placeholder="Add an update… (posting on a resolved ticket reopens it)"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Posting…" : "Post update"}
        </Button>
      </div>
    </form>
  );
}
