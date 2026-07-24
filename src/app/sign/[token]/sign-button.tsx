"use client";

import { useActionState, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signByToken, type SignState } from "./sign-actions";

// The signature block: agreement checkbox + full name + email. The typed name
// is the electronic signature (previewed live in script, stored with email,
// IP, and timestamp).
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
  const [name, setName] = useState("");

  if (state.signed) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-4 text-center text-green-700 dark:text-green-400">
          <p className="text-lg font-bold">Signed — thank you.</p>
          {state.signedName && <p className="mt-1 font-[cursive] text-2xl">{state.signedName}</p>}
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="full_name" className="text-sm font-semibold">
            Full legal name
          </label>
          <Input
            id="full_name"
            name="full_name"
            required
            minLength={3}
            maxLength={100}
            placeholder="Full name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-semibold">
            Email address
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            maxLength={200}
            placeholder="you@email.com"
            autoComplete="email"
            className="h-11"
          />
        </div>
      </div>

      {/* Live signature preview — the typed name IS the signature. */}
      <div className="rounded-md border border-dashed bg-muted/30 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Signature
        </p>
        <p className="min-h-9 font-[cursive] text-2xl leading-snug">{name || " "}</p>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Submitting…" : "Agree & sign"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your typed name, email, the date, and your IP address are recorded as your electronic
        signature.
      </p>
    </form>
  );
}
