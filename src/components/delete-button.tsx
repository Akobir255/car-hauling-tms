"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DeleteButton({
  onDelete,
  confirmMessage,
  label = "Delete",
}: {
  onDelete: () => Promise<void>;
  confirmMessage: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(confirmMessage)) return;
        startTransition(async () => {
          try {
            await onDelete();
          } catch {
            toast.error("Delete failed.");
          }
        });
      }}
    >
      {pending ? "Deleting..." : label}
    </Button>
  );
}
