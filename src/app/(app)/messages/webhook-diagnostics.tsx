import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  INBOUND_SMS_EVENT_FILTER,
  isSmsConfigured,
  listSubscriptions,
  type RcSubscription,
} from "@/lib/messaging/ringcentral";

type WebhookEvent = {
  id: string;
  received_at: string;
  token_ok: boolean | null;
  event_type: string | null;
  direction: string | null;
  from_addr: string | null;
  outcome: string;
  detail: string | null;
};

const OUTCOME_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  stored: "default",
  stored_no_customer: "secondary",
  duplicate: "outline",
  validation: "outline",
  ignored_not_sms: "outline",
  unauthorized: "destructive",
  error_insert: "destructive",
  error_bad_json: "destructive",
  error_bad_shape: "destructive",
};

// Admin-only troubleshooting for inbound SMS: is RingCentral delivering, and
// what happens to each event when it arrives? Rendered only for admins.
export async function WebhookDiagnostics() {
  const supabase = await createClient();
  const { data: eventsData } = await supabase
    .from("webhook_events")
    .select("id, received_at, token_ok, event_type, direction, from_addr, outcome, detail")
    .order("received_at", { ascending: false })
    .limit(15);
  const events = (eventsData ?? []) as WebhookEvent[];

  let subs: RcSubscription[] = [];
  let subError: string | null = null;
  if (isSmsConfigured()) {
    try {
      subs = (await listSubscriptions()).filter((s) =>
        s.eventFilters?.includes(INBOUND_SMS_EVENT_FILTER)
      );
    } catch (err) {
      subError = err instanceof Error ? err.message : "Could not read subscription status.";
    }
  }
  const active = subs.find((s) => s.status === "Active");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbound SMS diagnostics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">RingCentral subscription:</span>
          {subError ? (
            <span className="text-destructive">{subError}</span>
          ) : active ? (
            <Badge variant="default">Active</Badge>
          ) : subs.length > 0 ? (
            <Badge variant="destructive">{subs[0].status}</Badge>
          ) : (
            <Badge variant="outline">None — click “Connect inbound webhook”</Badge>
          )}
          {active?.expirationTime && (
            <span className="text-xs text-muted-foreground">
              expires {new Date(active.expirationTime).toLocaleString("en-US")}
            </span>
          )}
        </div>

        {subs.some((s) => s.status === "Blacklisted") && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
            The subscription is <strong>Blacklisted</strong> — RingCentral stopped delivering after
            repeated failures. Click “Connect inbound webhook” again to recreate it.
          </p>
        )}

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Last {events.length} webhook receipt{events.length === 1 ? "" : "s"}
          </p>
          {events.length === 0 ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground">
              No receipts logged yet. If you&apos;ve texted the number and nothing shows here,
              RingCentral isn&apos;t reaching the webhook — the subscription is likely inactive or the
              number isn&apos;t provisioned for inbound SMS.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">From</th>
                    <th className="px-3 py-2 font-medium">Type/Dir</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                        {new Date(e.received_at).toLocaleString("en-US", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                        {e.from_addr || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {[e.event_type, e.direction].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={OUTCOME_VARIANT[e.outcome] ?? "outline"}>{e.outcome}</Badge>
                      </td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground" title={e.detail ?? ""}>
                        {e.detail || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
