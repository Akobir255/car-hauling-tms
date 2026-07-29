"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Profile } from "@/types/database";
import { deleteUser, updateUserRole, type UserFormState } from "./actions";

const initialState: UserFormState = { error: null };

export function UserRow({
  profile,
  isSelf,
  others,
}: {
  profile: Profile;
  isSelf: boolean;
  /** Everyone else, as candidates to inherit this person's accounts. */
  others: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [state, deleteAction, deleting] = useActionState(deleteUser, initialState);
  const boundUpdate = updateUserRole.bind(null, profile.id);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <TableRow>
      <TableCell>
        {profile.full_name || "—"}
        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
      </TableCell>
      <TableCell className="text-muted-foreground">{profile.email}</TableCell>
      <TableCell colSpan={2}>
        <div className="space-y-2">
          <form
            className="flex flex-wrap items-center gap-3"
            action={(formData) => {
              startTransition(async () => {
                try {
                  await boundUpdate(formData);
                  toast.success("Updated.");
                } catch {
                  toast.error("Update failed.");
                }
              });
            }}
          >
            <NativeSelect name="role" defaultValue={profile.role} className="w-36" disabled={isSelf}>
              <option value="admin">Admin</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="sales">Sales</option>
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={profile.active} disabled={isSelf} />
              Active
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={pending || isSelf}>
              {pending ? "Saving..." : "Save"}
            </Button>
            {!isSelf && !confirming && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setConfirming(true)}
              >
                Delete
              </Button>
            )}
          </form>

          {confirming && !isSelf && (
            // Deleting is permanent, so it asks who takes over first. Notes and
            // status history keep their timestamps but stop naming this person
            // — their words are not handed to somebody else.
            <form action={deleteAction} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <input type="hidden" name="id" value={profile.id} />
              <span className="text-sm">Delete {profile.email}. Give their leads, quotes and orders to:</span>
              <NativeSelect name="reassign_to" defaultValue="" className="h-8 w-48">
                <option value="">Nobody (leave unassigned)</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete permanently"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </form>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
