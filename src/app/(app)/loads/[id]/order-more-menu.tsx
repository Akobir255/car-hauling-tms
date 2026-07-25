"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Copy, Ban, Ticket, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { duplicateLoad, toggleBlacklist } from "../actions";

// The msgplane-style "⋯ more options" overflow for the order detail. Holds the
// less-common actions so the sidebar stays to the primary lifecycle steps.
export function OrderMoreMenu({
  loadId,
  customerId,
  blacklisted,
  canManage,
}: {
  loadId: string;
  customerId: string | null;
  blacklisted: boolean;
  canManage: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="w-full" disabled={pending} />
        }
      >
        <MoreHorizontal className="size-4" />
        More
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem render={<a href="#history" />}>
          <History />
          View history
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            start(async () => {
              await duplicateLoad(loadId);
            })
          }
        >
          <Copy />
          Duplicate
        </DropdownMenuItem>

        {canManage && customerId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant={blacklisted ? "default" : "destructive"}
              onClick={() =>
                start(async () => {
                  await toggleBlacklist(customerId, !blacklisted);
                  toast.success(blacklisted ? "Removed from blacklist." : "Customer blacklisted.");
                })
              }
            >
              <Ban />
              {blacklisted ? "Remove from blacklist" : "Add to blacklist"}
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <a
              href={`/tickets/new?load=${loadId}${customerId ? `&customer=${customerId}` : ""}`}
            />
          }
        >
          <Ticket />
          Create ticket
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
