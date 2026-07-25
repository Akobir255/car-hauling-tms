import Link from "next/link";
import { Ticket as TicketIcon, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/ticket-badges";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TICKET_STATUSES, type Profile, type Ticket } from "@/types/database";

const TABS = [
  { key: "open", label: "Open", statuses: ["open", "pending"] as const },
  { key: "mine", label: "Assigned to me", statuses: ["open", "pending"] as const },
  { key: "resolved", label: "Resolved", statuses: ["resolved"] as const },
  { key: "closed", label: "Closed", statuses: ["closed"] as const },
  { key: "all", label: "All", statuses: TICKET_STATUSES },
];

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  let query = supabase
    .from("tickets")
    .select("*")
    .in("status", active.statuses as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(200);
  if (active.key === "mine") query = query.eq("assigned_to", profile.id);

  const [{ data, error }, { data: countRows }, { data: profs }] = await Promise.all([
    query,
    supabase.from("tickets").select("status, assigned_to"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const tickets = (data ?? []) as Ticket[];
  const byId = new Map(
    ((profs ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((p) => [p.id, p])
  );

  const counts = (t: (typeof TABS)[number]) => {
    const rows = (countRows ?? []) as { status: string; assigned_to: string | null }[];
    return rows.filter(
      (r) =>
        (t.statuses as readonly string[]).includes(r.status) &&
        (t.key !== "mine" || r.assigned_to === profile.id)
    ).length;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Internal issues — carrier problems, damage claims, billing disputes.
          </p>
        </div>
        <Button render={<Link href="/tickets/new" />}>New ticket</Button>
      </div>

      <div className="overflow-x-auto border-b pb-1">
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const isActive = active.key === t.key;
            return (
              <Link
                key={t.key}
                href={t.key === TABS[0].key ? "/tickets" : `/tickets?tab=${t.key}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums",
                    isActive ? "bg-white/25 text-white" : "bg-muted text-muted-foreground"
                  )}
                >
                  {counts(t)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="divide-y rounded-lg border bg-card shadow-sm">
        {tickets.map((t) => {
          const owner = t.assigned_to ? byId.get(t.assigned_to) : null;
          return (
            <Link
              key={t.id}
              href={`/tickets/${t.id}`}
              className="flex items-start gap-4 px-4 py-3 hover:bg-muted/40"
            >
              <span className="w-16 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-primary">
                #{t.ticket_number}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t.subject}</span>
                  <TicketStatusBadge status={t.status} />
                  <TicketPriorityBadge priority={t.priority} />
                </div>
                {t.body && (
                  <p className="truncate text-sm text-muted-foreground">{t.body}</p>
                )}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <User className="size-3.5" aria-hidden="true" />
                  {owner ? owner.full_name || owner.email : "Unassigned"}
                </p>
              </div>
              <span className="whitespace-nowrap pt-0.5 text-xs text-muted-foreground">
                {formatRelativeTime(t.created_at)}
              </span>
            </Link>
          );
        })}
        {tickets.length === 0 && (
          <EmptyState
            icon={TicketIcon}
            title={active.key === "open" ? "No open tickets" : "Nothing here"}
            hint="Tickets track problems that need follow-up — a damaged vehicle, a carrier no-show, a billing dispute."
            action={
              <Button size="sm" render={<Link href="/tickets/new" />}>
                New ticket
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
