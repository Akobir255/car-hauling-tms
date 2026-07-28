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
      // --chart-2 is msgplane's warning orange (#ff9800, lifted to #ffb74d in
      // dark). It carries the border and the tint only — the text stays on
      // --foreground, since neither orange clears 4.5:1 as body copy.
      <Badge className="border-chart-2 bg-chart-2/15 text-foreground">
        Expires {formatDate(expiryDate)} ({days}d)
      </Badge>
    );
  }
  return <Badge variant="outline">Valid until {formatDate(expiryDate)}</Badge>;
}
