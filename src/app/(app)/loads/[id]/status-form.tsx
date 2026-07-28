"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/form-section";
import { LOAD_STATUSES, type LoadStatus } from "@/types/database";
import { titleCase } from "@/lib/format";
import type { LoadFormState } from "../actions";

const initialState: LoadFormState = { error: null };

export function StatusForm({
  currentStatus,
  action,
}: {
  currentStatus: LoadStatus;
  action: (state: LoadFormState, formData: FormData) => Promise<LoadFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) toast.success("Status updated.");
  }, [state]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5 max-md:w-full">
        <FieldLabel>New status</FieldLabel>
        <NativeSelect name="status" defaultValue={currentStatus} className="w-44 max-md:w-full">
          {LOAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex-1 space-y-1.5 max-md:basis-full">
        <FieldLabel>Note (optional)</FieldLabel>
        <Textarea name="note" rows={1} className="min-h-8 max-md:min-h-12" />
      </div>
      <Button type="submit" className="max-md:min-h-12 max-md:w-full" disabled={pending}>
        {pending ? "Updating..." : "Update status"}
      </Button>
    </form>
  );
}
