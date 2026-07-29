"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { abandon, sendCode, submitCode, type VerifyState } from "./actions";

const initial: VerifyState = { error: null, sent: true };

export function VerifyForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(submitCode, initial);
  const [resend, resendAction, resending] = useActionState(sendCode, initial);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">6-digit code</Label>
          {/* inputMode numeric + autocomplete one-time-code lets a phone
              offer the code straight from the mail app. */}
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            placeholder="000000"
            className="text-center text-lg tracking-[0.4em]"
          />
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {resend.error && <p className="text-sm text-destructive">{resend.error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Checking..." : "Verify"}
        </Button>
      </form>

      <div className="flex items-center justify-between text-xs">
        <form action={resendAction}>
          <button
            type="submit"
            disabled={resending}
            className="text-msg-link hover:underline disabled:opacity-50"
          >
            {resending ? "Sending..." : "Send a new code"}
          </button>
        </form>
        <form action={abandon}>
          <button type="submit" className="text-muted-foreground hover:underline">
            Sign in as someone else
          </button>
        </form>
      </div>

      {/* Say the rules up front: one attempt is unusual enough that finding
          out by burning the code is a bad way to learn it. */}
      <p className="text-center text-xs text-muted-foreground">
        Sent to {email}. Expires in 5 minutes. One attempt per code — get it
        wrong and a fresh one is sent automatically.
      </p>
    </div>
  );
}
