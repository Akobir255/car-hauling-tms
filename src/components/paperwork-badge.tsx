import { formatDate } from "@/lib/format";

/**
 * Where a record's contract stands, in one box.
 *
 * The same four states, the same words and the same three colours the E-Sign
 * band uses on the record itself, pulled out so a list can say it too. Until
 * now the only way to find out whether a quote was signed was to open it, and
 * a search result sat next to msgplane's own screen looking like we did not
 * know — which we did, on `loads.date_signed`; we just never showed it.
 *
 * Accents are the spec's own (chart-5 green, chart-2 orange) carried as a tint
 * behind body ink. Those hues are icon-grade and land well under 4.5:1 used as
 * text on white.
 */
export function PaperworkBadge({
  signedAt,
  sentAt,
  /** Imported order: a contract went out, on a date the old system never kept. */
  sentUndated = false,
}: {
  signedAt: string | null;
  sentAt: string | null;
  sentUndated?: boolean;
}) {
  if (signedAt) {
    return (
      <span className="inline-block whitespace-nowrap rounded-md bg-chart-5/20 px-2 py-0.5 text-xs text-foreground">
        Signed {formatDate(signedAt)}
      </span>
    );
  }
  if (sentAt) {
    return (
      <span className="inline-block whitespace-nowrap rounded-md bg-chart-2/20 px-2 py-0.5 text-xs text-foreground">
        Sent {formatDate(sentAt)}
      </span>
    );
  }
  if (sentUndated) {
    return (
      <span
        className="inline-block whitespace-nowrap rounded-md bg-chart-2/20 px-2 py-0.5 text-xs text-foreground"
        title="Imported: the old system recorded that a contract went out, but not when."
      >
        Sent
      </span>
    );
  }
  return (
    <span className="inline-block whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      Not sent
    </span>
  );
}
