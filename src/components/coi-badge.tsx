import { Badge } from "@/components/ui/badge";
import { daysUntil, formatDate } from "@/lib/format";

export function CoiBadge({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) return <Badge variant="outline">No COI on file</Badge>;

  const days = daysUntil(expiryDate);
  if (days === null) return <Badge variant="outline">{formatDate(expiryDate)}</Badge>;

  if (days < 0) {
    return <Badge variant="destructive">Expired {formatDate(expiryDate)}</Badge>;
  }
  if (days <= 30) {
    return (
      <Badge className="border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Expires {formatDate(expiryDate)} ({days}d)
      </Badge>
    );
  }
  return <Badge variant="outline">Valid until {formatDate(expiryDate)}</Badge>;
}
