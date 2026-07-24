import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT } from "@/lib/order-status";
import type { LoadStatus } from "@/types/database";

export function StatusBadge({ status }: { status: LoadStatus }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{STATUS_LABEL[status] ?? status}</Badge>;
}
