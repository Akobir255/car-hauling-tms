import { STATUS_LABEL } from "@/lib/order-status";
import type { LoadStatus } from "@/types/database";
import { cn } from "@/lib/utils";
import { STATUS_COLORS } from "@/components/pipeline/status-tone";

// msgplane renders the status as a bare word, not a chip — no fill, no ring, no
// pill. Spec departure #1: we keep that weight and position but let each status
// carry its own hue, because msgplane's single #cccccc makes "cancelled" and
// "picked up" identical and fails contrast besides. The hues live in
// status-tone so the pipeline list and this badge cannot drift apart.

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
        "inline-flex items-center whitespace-nowrap",
        size === "lg" ? "text-sm" : "text-xs",
        STATUS_COLORS[status] ?? STATUS_COLORS.lead
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
