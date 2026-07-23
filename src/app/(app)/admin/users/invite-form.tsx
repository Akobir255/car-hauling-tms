"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { inviteUser, type UserFormState } from "./actions";

const initialState: UserFormState = { error: null };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteUser, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) {
      toast.success(state.success);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border p-4">
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
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send invite"}
      </Button>
    </form>
  );
}
