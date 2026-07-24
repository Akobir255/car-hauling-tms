import { STATUS_LABEL } from "@/lib/order-status";
import type { LoadStatus } from "@/types/database";
import { cn } from "@/lib/utils";

// One source of truth for status color. Each status gets a distinct, legible
// badge (light + dark) so the stage of a record is obvious at a glance —
// status is the most important fact on the detail page and in the lists.
const STATUS_COLORS: Record<LoadStatus, string> = {
  lead: "bg-slate-100 text-slate-700 ring-slate-600/20 dark:bg-slate-400/15 dark:text-slate-300",
  quote: "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-400/15 dark:text-amber-300",
  ready: "bg-blue-100 text-blue-800 ring-blue-600/20 dark:bg-blue-400/15 dark:text-blue-300",
  posted_cd: "bg-indigo-100 text-indigo-800 ring-indigo-600/20 dark:bg-indigo-400/15 dark:text-indigo-300",
  posted_sd: "bg-violet-100 text-violet-800 ring-violet-600/20 dark:bg-violet-400/15 dark:text-violet-300",
  booked: "bg-sky-100 text-sky-800 ring-sky-600/20 dark:bg-sky-400/15 dark:text-sky-300",
  dispatched: "bg-indigo-100 text-indigo-800 ring-indigo-600/20 dark:bg-indigo-400/15 dark:text-indigo-300",
  picked_up: "bg-teal-100 text-teal-800 ring-teal-600/20 dark:bg-teal-400/15 dark:text-teal-300",
  in_transit: "bg-cyan-100 text-cyan-800 ring-cyan-600/20 dark:bg-cyan-400/15 dark:text-cyan-300",
  delivered: "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-400/15 dark:text-green-300",
  hold: "bg-orange-100 text-orange-800 ring-orange-600/20 dark:bg-orange-400/15 dark:text-orange-300",
  archived: "bg-slate-100 text-slate-600 ring-slate-600/20 dark:bg-slate-400/15 dark:text-slate-400",
  lost: "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-400/15 dark:text-red-300",
  invoiced: "bg-violet-100 text-violet-800 ring-violet-600/20 dark:bg-violet-400/15 dark:text-violet-300",
  paid: "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-400/15 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 ring-red-600/20 dark:bg-red-400/15 dark:text-red-400",
};

export function StatusBadge({
  status,
  size = "sm",
}: {
  status: LoadStatus;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full font-semibold ring-1 ring-inset",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
        STATUS_COLORS[status] ?? STATUS_COLORS.lead
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
