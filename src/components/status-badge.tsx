import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";
import type { LoadStatus } from "@/types/database";

const VARIANT_BY_STATUS: Record<LoadStatus, "default" | "secondary" | "destructive" | "outline"> = {
  quote: "outline",
  booked: "secondary",
  dispatched: "secondary",
  picked_up: "default",
  in_transit: "default",
  delivered: "default",
  invoiced: "outline",
  paid: "outline",
  cancelled: "destructive",
};

export function StatusBadge({ status }: { status: LoadStatus }) {
  return <Badge variant={VARIANT_BY_STATUS[status]}>{titleCase(status)}</Badge>;
}
