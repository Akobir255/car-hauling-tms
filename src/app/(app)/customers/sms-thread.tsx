"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/database";
import type { MessageFormState } from "../messages/actions";

const initialState: MessageFormState = { error: null };

// msgplane-style conversation: inbound bubbles left, outbound right, reply
// box underneath. Server passes the RLS-scoped message list.
export function SmsThread({
  messages,
  action,
  optedOut,
  hasPhone,
}: {
  messages: Message[];
  action: (state: MessageFormState, formData: FormData) => Promise<MessageFormState>;
  optedOut: boolean;
  hasPhone: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) {
      toast.success("Reply sent.");
      formRef.current?.reset();
    }
  }, [state]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  return (
    <div className="space-y-3">
      <div
        ref={scrollRef}
        className="max-h-96 space-y-2.5 overflow-y-auto rounded-lg border bg-muted/30 p-4"
      >
        {messages.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No SMS history with this customer yet.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                m.direction === "outbound"
                  ? "rounded-br-sm bg-blue-700 text-blue-50 dark:bg-blue-600"
                  : "rounded-bl-sm border bg-card text-card-foreground"
              )}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p
                className={cn(
                  "mt-1 text-[11px] tabular-nums",
                  m.direction === "outbound" ? "text-blue-200/90" : "text-muted-foreground"
                )}
              >
                {new Date(m.created_at).toLocaleString("en-US", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                {m.status === "failed" && " · failed"}
                {m.status === "queued" && " · queued"}
              </p>
            </div>
          </div>
        ))}
      </div>

      {optedOut ? (
        <p className="text-sm text-destructive">
          This customer replied STOP — SMS is blocked until they text START.
        </p>
      ) : !hasPhone ? (
        <p className="text-sm text-muted-foreground">
          Add a valid US phone number to text this customer.
        </p>
      ) : (
        <form ref={formRef} action={formAction} className="flex items-end gap-2">
          <Textarea
            name="body"
            placeholder="Type a reply..."
            required
            maxLength={1600}
            rows={2}
            className="flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Sending..." : "Send"}
          </Button>
        </form>
      )}
    </div>
  );
}
