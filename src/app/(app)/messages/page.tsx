import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isSmsConfigured } from "@/lib/messaging/ringcentral";
import { formatRelativeTime } from "@/lib/format";
import { markAllMessagesRead } from "./actions";
import { WebhookSyncButton } from "./webhook-sync-button";
import { WebhookDiagnostics } from "./webhook-diagnostics";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/database";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  sent: "secondary",
  delivered: "default",
  failed: "destructive",
};

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  const messages = (data ?? []) as Message[];
  const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read_at).length;

  const customerIds = [...new Set(messages.map((m) => m.customer_id).filter(Boolean) as string[])];
  const { data: customers } = customerIds.length
    ? await supabase.from("customers").select("id, contact_name").in("id", customerIds)
    : { data: [] as { id: string; contact_name: string }[] };
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[15px]">Messages</h1>
          <p className="text-sm text-muted-foreground">
            {isSmsConfigured()
              ? "RingCentral connected — messages send immediately."
              : "RingCentral not connected yet — sends are logged as Queued until credentials are added."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unreadCount > 0 && (
            <form action={markAllMessagesRead}>
              <Button type="submit" variant="outline" className="max-md:min-h-12">
                Mark all read ({unreadCount})
              </Button>
            </form>
          )}
          {profile.role === "admin" && <WebhookSyncButton />}
          <Button
            variant="outline"
            className="max-md:min-h-12"
            render={<Link href="/messages/templates" />}
          >
            Templates
          </Button>
          <Button className="max-md:min-h-12" render={<Link href="/messages/new" />}>
            New blast
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {profile.role === "admin" && <WebhookDiagnostics />}

      {/* Six columns of `whitespace-nowrap` plus a max-w-md body come to ~900px
          of min-content. It scrolls in the Table's own container so the page
          never does, but on a phone that puts Customer and Message — the two
          a rep opens this page for — behind a horizontal pan on every row.
          Same rows, same order, as cards below md. */}
      {/* Both layouts share one space-y slot on purpose: `space-y-*` puts its
          margin on `:not(:last-child)`, so leaving the card list as a bare
          sibling would hand the desktop table a bottom margin it never had. */}
      <div>
      <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Number</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((m) => {
            const unread = m.direction === "inbound" && !m.read_at;
            return (
              // A left bar rather than a row tint. Any tint strong enough to
              // read drags --msg-link and --muted-foreground on that row under
              // 4.5:1 — and these are the rows that most need reading. The bar
              // is also a shape, so it survives a color-blind reader and a
              // greyscale print, which the "· new" label below already backs up.
              <TableRow
                key={m.id}
                className={cn(unread && "border-l-4 border-l-primary")}
              >
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(m.created_at).toLocaleString("en-US", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell>
                  {m.direction === "inbound" ? (
                    <Badge variant="default">↓ In{unread ? " · new" : ""}</Badge>
                  ) : (
                    <Badge variant="outline">↑ Out</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {m.customer_id ? (
                    <Link href={`/customers/${m.customer_id}`} className="text-msg-link hover:underline">
                      {customerById.get(m.customer_id)?.contact_name ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {(m.direction === "inbound" ? m.from_addr : m.to_addr) || "—"}
                </TableCell>
                <TableCell className="max-w-md truncate text-muted-foreground" title={m.body}>
                  {m.body}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[m.status] ?? "outline"}>{m.status}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
          {messages.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No messages yet — send your first blast.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      <ul className="divide-y divide-msg-rule overflow-hidden rounded-md border bg-card md:hidden">
        {messages.map((m) => {
          const unread = m.direction === "inbound" && !m.read_at;
          const addr = (m.direction === "inbound" ? m.from_addr : m.to_addr) || "—";
          return (
            <li key={m.id} className={cn("p-3", unread && "border-l-4 border-l-primary")}>
              <div className="flex flex-wrap items-center gap-2">
                {m.direction === "inbound" ? (
                  <Badge variant="default">↓ In{unread ? " · new" : ""}</Badge>
                ) : (
                  <Badge variant="outline">↑ Out</Badge>
                )}
                {m.customer_id ? (
                  <Link
                    href={`/customers/${m.customer_id}`}
                    className="focus-ring inline-flex min-h-12 min-w-0 items-center break-words text-msg-link"
                  >
                    {customerById.get(m.customer_id)?.contact_name ?? "—"}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTime(m.created_at)}
                </span>
              </div>
              {/* No max-w-md cap: that is a table-column constraint, and the
                  body is what the rep came to read. */}
              <p className="line-clamp-6 break-words text-sm text-muted-foreground">{m.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[m.status] ?? "outline"}>{m.status}</Badge>
                <span className="min-w-0 break-all text-xs tabular-nums text-muted-foreground">
                  {addr}
                </span>
              </div>
            </li>
          );
        })}
        {messages.length === 0 && (
          <li className="p-3 text-center text-muted-foreground">
            No messages yet — send your first blast.
          </li>
        )}
      </ul>
      </div>
    </div>
  );
}
