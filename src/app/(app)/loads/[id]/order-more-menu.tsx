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
  readOnly = false,
}: {
  loadId: string;
  customerId: string | null;
  blacklisted: boolean;
  canManage: boolean;
  /** Viewing another rep's order: history and tickets stay, copies do not. */
  readOnly?: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="w-full max-md:min-h-12" disabled={pending} />
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
        {/* Duplicating somebody else's order would hand you a copy of their
            work under your own name. Reading it is allowed; taking it is not. */}
        {!readOnly && (
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
        )}

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
