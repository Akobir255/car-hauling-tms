import { cn } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/types/database";

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-blue-100 text-blue-800 ring-blue-600/20 dark:bg-blue-400/15 dark:text-blue-300",
  pending: "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-400/15 dark:text-amber-300",
  resolved: "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-400/15 dark:text-green-300",
  closed: "bg-slate-100 text-slate-600 ring-slate-600/20 dark:bg-slate-400/15 dark:text-slate-400",
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: "bg-slate-100 text-slate-600 ring-slate-600/20 dark:bg-slate-400/15 dark:text-slate-400",
  normal: "bg-sky-100 text-sky-800 ring-sky-600/20 dark:bg-sky-400/15 dark:text-sky-300",
  high: "bg-orange-100 text-orange-800 ring-orange-600/20 dark:bg-orange-400/15 dark:text-orange-300",
  urgent: "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-400/15 dark:text-red-300",
};

const PILL = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset";

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
