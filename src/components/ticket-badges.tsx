import { cn } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/types/database";

// Tickets keep the chip that load status gives up. The spec measured msgplane's
// load list, where status is a bare word under the ID; it has no ticket queue,
// and a ticket row needs its state to survive being scanned next to a subject
// line. So: a flat Material chip — 3px, tinted fill, weight 400, no ring.
//
// Fills are the same hue at 10-15% so the tint tracks whatever the text color
// is. Every value below was measured against its OWN composited fill, not
// against white — green 800 is 4.5:1 on white but only 4.49:1 on its tint, and
// --destructive is 4.25:1 on its own, which is what --destructive-ink exists
// for. Tokens are used wherever one already carries the right meaning.
const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-primary/10 text-primary",
  pending: "bg-[#bf360c]/10 text-[#bf360c] dark:bg-[#ffb74d]/15 dark:text-[#ffb74d]",
  resolved: "bg-[#2e7d32]/10 text-[#1b5e20] dark:bg-[#81c784]/15 dark:text-[#81c784]",
  closed: "bg-muted text-muted-foreground",
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-primary/10 text-primary",
  high: "bg-[#bf360c]/10 text-[#bf360c] dark:bg-[#ffb74d]/15 dark:text-[#ffb74d]",
  urgent: "bg-destructive/10 text-destructive-ink",
};

const PILL = "inline-flex items-center rounded-md px-2 py-0.5 text-xs capitalize";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={cn(PILL, STATUS_STYLES[status] ?? STATUS_STYLES.open)}>{status}</span>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  // Only surface priority when it's actionable — "normal" on every row is noise.
  if (priority === "normal") return null;
  return (
    <span className={cn(PILL, PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.normal)}>
      {priority}
    </span>
  );
}
