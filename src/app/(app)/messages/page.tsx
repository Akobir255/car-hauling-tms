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
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-sm text-muted-foreground">
            {isSmsConfigured()
              ? "RingCentral connected — messages send immediately."
              : "RingCentral not connected yet — sends are logged as Queued until credentials are added."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unreadCount > 0 && (
            <form action={markAllMessagesRead}>
              <Button type="submit" variant="outline">
                Mark all read ({unreadCount})
              </Button>
            </form>
          )}
          {profile.role === "admin" && <WebhookSyncButton />}
          <Button variant="outline" render={<Link href="/messages/templates" />}>
            Templates
          </Button>
          <Button render={<Link href="/messages/new" />}>New blast</Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {profile.role === "admin" && <WebhookDiagnostics />}

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
              <TableRow key={m.id} className={cn(unread && "bg-blue-500/5 font-medium")}>
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
                    <Link href={`/customers/${m.customer_id}`} className="hover:underline">
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
  );
}
