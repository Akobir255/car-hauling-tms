"use client";

import { useActionState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signByToken, type SignState } from "./sign-actions";

// The signature block: typed full name + explicit agreement checkbox. The
// typed name is the electronic signature (stored with IP + timestamp).
export function SignatureForm({
  token,
  alreadySigned,
  signedName,
}: {
  token: string;
  alreadySigned: boolean;
  signedName: string | null;
}) {
  const action = signByToken.bind(null, token);
  const [state, formAction, pending] = useActionState<SignState, FormData>(action, {
    error: null,
    signed: alreadySigned,
    signedName,
  });

  if (state.signed) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-4 text-center text-green-700 dark:text-green-400">
          <p className="text-lg font-bold">Signed — thank you.</p>
          {state.signedName && (
            <p className="mt-1 font-[cursive] text-xl">{state.signedName}</p>
          )}
          <p className="mt-1 text-sm">
            Your agreement has been received. Keep a copy for your records.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full print:hidden"
          onClick={() => window.print()}
        >
          <Printer className="size-4" aria-hidden="true" />
          Print / save a copy
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 print:hidden">
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="agree" required className="mt-0.5 size-4 accent-primary" />
        <span>
          I have read and agree to the Additional Information, Cancellation Fees, and Terms &
          Conditions above, and I authorize transport of the listed vehicle(s).
        </span>
      </label>

      <div className="space-y-1.5">
        <label htmlFor="full_name" className="text-sm font-semibold">
          Type your full legal name as your signature
        </label>
        <Input
          id="full_name"
          name="full_name"
          required
          minLength={3}
          maxLength={100}
          placeholder="Full name"
          autoComplete="name"
          className="h-11 font-[cursive] text-lg"
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Submitting…" : "Agree & sign"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your typed name, the date, and your IP address are recorded as your electronic signature.
      </p>
    </form>
  );
}
