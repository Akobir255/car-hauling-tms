import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LoadStatus } from "@/types/database";
import type { LoadEventRow } from "@/lib/events/types";

// The order's timeline, off the event spine (migration 0049). This replaces the
// status-only History band: same position, same shape, but it will also carry
// GPS geofences, call summaries, AI drafts and risk flags as those phases land,
// instead of each one growing its own band.
//
// Rows are rendered from `payload` defensively. event_type is TEXT in the
// database on purpose, so a type this build has never heard of must still
// render as a legible row rather than throw — a timeline that breaks on an
// unknown event is worse than one that shows a plain label.

// Sources a human did not cause. Shown as a chip so a reader can tell at a
// glance what the system did versus what a person did.
const SOURCE_LABEL: Record<string, string> = {
  gps: "GPS",
  sms: "SMS",
  call: "Call",
  ai: "AI",
  integration: "System",
};

const humanize = (eventType: string) =>
  eventType.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** One line of detail under the label, built from whatever the payload holds. */
function summarize(event: LoadEventRow): string | null {
  const p = event.payload ?? {};
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : null);

  switch (event.event_type) {
    case "status_changed":
      return str("note");
    case "geofence_entered":
    case "geofence_exited":
      return str("fence");
    case "eta_updated":
      return [str("eta"), str("reason")].filter(Boolean).join(" — ") || null;
    case "risk_flagged": {
      const score = num("score");
      return [score == null ? null : `risk ${score}`, str("reason")]
        .filter(Boolean)
        .join(" — ") || null;
    }
    default: {
      // Unknown type: show the first short string in the payload rather than
      // dumping json at somebody trying to read a record.
      const first = Object.entries(p).find(
        ([, v]) => typeof v === "string" && v.length > 0 && v.length <= 120
      );
      return first ? (first[1] as string) : null;
    }
  }
}

export function EventTimeline({
  events,
  profById,
  emptyHint = "No history yet.",
}: {
  events: LoadEventRow[];
  profById: Map<string, { full_name: string | null; email: string }>;
  emptyHint?: string;
}) {
  if (events.length === 0) {
    return <p className="px-5 py-4 text-sm text-muted-foreground">{emptyHint}</p>;
  }

  return (
    <div className="divide-y">
      {events.map((e) => {
        const who = e.actor_user_id ? profById.get(e.actor_user_id) : null;
        const status =
          e.event_type === "status_changed" && typeof e.payload?.status === "string"
            ? (e.payload.status as LoadStatus)
            : null;
        const detail = summarize(e);
        const sourceLabel = SOURCE_LABEL[e.source];

        return (
          <div
            key={e.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm"
          >
            {status ? (
              <StatusBadge status={status} />
            ) : (
              <span className="text-foreground">{humanize(e.event_type)}</span>
            )}

            {/* "System" is the honest word for an event with no actor: the
                importer, a webhook, a cron sweep. Not a person's name. */}
            <span className="text-muted-foreground">
              {who?.full_name || who?.email || "System"}
              {detail ? ` — ${detail}` : ""}
            </span>

            {sourceLabel && (
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[12px] uppercase leading-none",
                  "text-muted-foreground"
                )}
              >
                {sourceLabel}
              </span>
            )}

            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {formatDate(e.occurred_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
