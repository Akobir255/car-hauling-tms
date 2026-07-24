"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { signByToken } from "./sign-actions";

const initial = { error: null as string | null, signed: false };

export function SignButton({ token, alreadySigned }: { token: string; alreadySigned: boolean }) {
  const action = signByToken.bind(null, token);
  const [state, formAction, pending] = useActionState(action, {
    ...initial,
    signed: alreadySigned,
  });

  if (state.signed) {
    return (
      <div className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-3 text-center text-green-700 dark:text-green-400">
        <p className="font-semibold">Signed — thank you.</p>
        <p className="text-sm">Your agreement has been received. You can close this page.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <p className="text-sm text-muted-foreground">
        By clicking below you agree to the terms of this vehicle transport agreement and confirm
        the details above are correct.
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Submitting…" : "Agree & sign"}
      </Button>
    </form>
  );
}
