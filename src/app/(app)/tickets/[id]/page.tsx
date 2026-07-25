import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/delete-button";
import { SectionBand } from "@/components/section-band";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/ticket-badges";
import { formatDateTime } from "@/lib/format";
import type { Profile, Ticket, TicketComment } from "@/types/database";
import { CommentForm, TicketControls } from "./ticket-controls";
import { deleteTicket } from "../actions";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: ticketData } = await supabase.from("tickets").select("*").eq("id", id).single();
  if (!ticketData) notFound();
  const ticket = ticketData as Ticket;

  const [{ data: commentRows }, { data: profs }, { data: load }] = await Promise.all([
    supabase.from("ticket_comments").select("*").eq("ticket_id", id).order("created_at"),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
    ticket.load_id
      ? supabase.from("loads_sales_safe").select("id, load_number").eq("id", ticket.load_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const comments = (commentRows ?? []) as TicketComment[];
  const people = (profs ?? []) as Pick<Profile, "id" | "full_name" | "email">[];
  const byId = new Map(people.map((p) => [p.id, p]));
  const reps = people.map((p) => ({ id: p.id, name: p.full_name || p.email }));
  const who = (uid: string | null) => {
    if (!uid) return "System";
    const p = byId.get(uid);
    return p ? p.full_name || p.email : "Unknown";
  };
  const canDelete = profile.role === "admin" || profile.role === "dispatcher";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold tabular-nums text-primary">
                #{ticket.ticket_number}
              </span>
              <TicketStatusBadge status={ticket.status} />
              <TicketPriorityBadge priority={ticket.priority} />
            </div>
            <h1 className="text-xl font-semibold">{ticket.subject}</h1>
            <p className="text-sm text-muted-foreground">
              Opened {formatDateTime(ticket.created_at)} by {who(ticket.created_by)}
              {ticket.resolved_at ? ` · resolved ${formatDateTime(ticket.resolved_at)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {load?.load_number && (
              <Button variant="outline" render={<Link href={`/loads/${ticket.load_id}`} />}>
                Order {load.load_number}
              </Button>
            )}
            {ticket.customer_id && (
              <Button variant="outline" render={<Link href={`/customers/${ticket.customer_id}`} />}>
                Customer
              </Button>
            )}
            {canDelete && (
              <DeleteButton
                onDelete={deleteTicket.bind(null, ticket.id)}
                confirmMessage={`Delete ticket #${ticket.ticket_number}? This cannot be undone.`}
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {ticket.body && (
            <SectionBand title="Details">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{ticket.body}</p>
            </SectionBand>
          )}

          <SectionBand title={`Updates (${comments.length})`} bodyClassName="p-0">
            <div className="divide-y">
              {comments.map((c) => (
                <div key={c.id} className="space-y-1 px-5 py-3">
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{who(c.author_id)}</span>
                    {formatDateTime(c.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{c.body}</p>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  No updates yet.
                </p>
              )}
              <div className="px-5 py-4">
                <CommentForm ticketId={ticket.id} />
              </div>
            </div>
          </SectionBand>
        </div>

        <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <SectionBand title="Ticket">
            <TicketControls
              ticketId={ticket.id}
              status={ticket.status}
              priority={ticket.priority}
              assignedTo={ticket.assigned_to}
              reps={reps}
            />
          </SectionBand>
        </div>
      </div>

      <Button variant="outline" size="sm" render={<Link href="/tickets" />}>
        ‹ Back to tickets
      </Button>
    </div>
  );
}
