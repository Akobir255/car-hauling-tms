"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createUser, type UserFormState } from "./actions";

const initialState: UserFormState = { error: null };

// A strong password the admin can still read off the screen and hand over.
// Ambiguous glyphs are left out — someone is going to read this down a phone.
function suggestPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // The password field is uncontrolled and read through a ref: form.reset()
  // then clears it on success without an effect writing React state, which is
  // what react-hooks/set-state-in-effect is there to stop.
  const pwRef = useRef<HTMLInputElement>(null);
  const [reveal, setReveal] = useState(true);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) {
      toast.success(state.success);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Name</Label>
          <Input id="full_name" name="full_name" required className="w-44" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required className="w-56" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <NativeSelect id="role" name="role" defaultValue="sales" className="w-36">
            <option value="admin">Admin</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="sales">Sales</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          {/* Shown in clear by default and typed by the admin, because the
              whole point is that they are the one handing it over. */}
          <Input
            ref={pwRef}
            id="password"
            name="password"
            type={reveal ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-56 font-mono"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create account"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => {
            if (pwRef.current) pwRef.current.value = suggestPassword();
            setReveal(true);
          }}
          className="text-msg-link hover:underline"
        >
          Suggest a strong one
        </button>
        <button type="button" onClick={() => setReveal((v) => !v)} className="text-msg-link hover:underline">
          {reveal ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          onClick={() => {
            const v = pwRef.current?.value ?? "";
            if (!v) return toast.error("Nothing to copy yet.");
            navigator.clipboard?.writeText(v);
            toast.success("Password copied.");
          }}
          className="text-msg-link hover:underline"
        >
          Copy
        </button>
        <span>
          At least 8 characters. The account works immediately — no invitation
          email. They will still be emailed a 6-digit code at this address every
          time they sign in, so it has to be a mailbox they can actually read.
        </span>
      </div>
    </form>
  );
}
