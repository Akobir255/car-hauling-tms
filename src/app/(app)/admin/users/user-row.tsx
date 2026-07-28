"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Profile } from "@/types/database";
import { updateUserRole } from "./actions";

export function UserRow({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();
  const boundUpdate = updateUserRole.bind(null, profile.id);

  return (
    <TableRow>
      <TableCell>
        {profile.full_name || "—"}
        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
      </TableCell>
      <TableCell className="text-muted-foreground">{profile.email}</TableCell>
      <TableCell colSpan={2}>
        <form
          className="flex items-center gap-3"
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
        </form>
      </TableCell>
    </TableRow>
  );
}
