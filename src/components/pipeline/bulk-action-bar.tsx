"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck2, Mail, MessageSquareText, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { TemplateSheet } from "@/components/messaging/template-sheet";
import { useSelection } from "./selection-context";
import { bulkEmail, bulkReassign, bulkSetFollowUp, bulkSmsChunk } from "@/app/(app)/loads/actions";
import { finalizeSmsBlast } from "@/app/(app)/messages/actions";
import { SMS_CHUNK_MAX } from "@/lib/messaging/sms-bulk";

type Rep = { id: string; name: string };
type Panel = "reassign" | "followup" | "sms" | "email" | null;

const FOLLOW_UP_PRESETS: { key: string; label: string }[] = [
  { key: "1d", label: "1 Day" },
  { key: "2d", label: "2 Days" },
  { key: "3d", label: "3 Days" },
  { key: "1w", label: "1 Week" },
];

// Floating bar that appears when rows are selected — msgplane-style bulk
// actions. SMS and Email both open the template sheet, so a rep picks a
// canned message (or types one) and sends without leaving the list.
export function BulkActionBar({ reps, canReassign }: { reps: Rep[]; canReassign: boolean }) {
  const { selected, setMany, clear } = useSelection();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, start] = useTransition();
  const [repId, setRepId] = useState("");

  const ids = [...selected];
  if (ids.length === 0) return null;

  const done = (msg: string) => {
    toast.success(msg);
    setPanel(null);
    clear();
  };

  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  // Chunked, paced SMS: on any abort the processed loads are DESELECTED so a
  // retry only hits the unsent ones.
  const sendSms = (body: string) =>
    start(async () => {
      const tally = { sent: 0, queued: 0, skipped: 0, failed: 0 };
      let pendingIds = [...ids];
      let stalls = 0;
      try {
        while (pendingIds.length > 0) {
          const chunk = pendingIds.slice(0, SMS_CHUNK_MAX);
          const r = await bulkSmsChunk(chunk, body);
          tally.sent += r.sent;
          tally.queued += r.queued;
          tally.skipped += r.skipped;
          tally.failed += r.failed;
          const nothingHappened =
            r.error !== null &&
            r.unprocessedLoadIds.length === 0 &&
            r.sent + r.queued + r.skipped + r.failed === 0;
          const next = nothingHappened
            ? pendingIds
            : [...r.unprocessedLoadIds, ...pendingIds.slice(chunk.length)];
          const consumed = pendingIds.filter((id) => !next.includes(id));
          setMany(consumed, false);
          pendingIds = next;

          if (r.error) {
            toast.error(
              r.error +
                (pendingIds.length > 0 ? ` The ${pendingIds.length} unsent stay selected.` : "")
            );
            return;
          }
          stalls = r.unprocessedLoadIds.length > 0 && r.sent + r.failed === 0 ? stalls + 1 : 0;
          if (stalls >= 3) {
            toast.error(
              `RingCentral keeps rate-limiting — stopped with ${pendingIds.length} unsent (still selected). Try again in a few minutes.`
            );
            return;
          }
          if (pendingIds.length > 0 && r.retryAfterMs) {
            await new Promise((resolve) => setTimeout(resolve, r.retryAfterMs ?? 1000));
          }
        }
        done(
          `SMS: ${tally.sent} sent, ${tally.queued} queued, ${tally.failed} failed, ${tally.skipped} skipped.`
        );
      } finally {
        finalizeSmsBlast().catch(() => {});
      }
    });

  const sendEmail = (subject: string, body: string) =>
    start(async () => {
      const r = await bulkEmail(ids, subject, body);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      done(
        `Email: ${r.sent} sent, ${r.queued} queued, ${r.failed} failed, ${r.skipped} skipped.`
      );
    });

  return (
    <>
      {panel === "sms" && (
        <TemplateSheet
          channel="sms"
          title="Text selected customers"
          recipientCount={ids.length}
          busy={pending}
          onClose={() => setPanel(null)}
          onSend={({ body }) => sendSms(body)}
        />
      )}
      {panel === "email" && (
        <TemplateSheet
          channel="email"
          title="Email selected customers"
          recipientCount={ids.length}
          busy={pending}
          onClose={() => setPanel(null)}
          onSend={({ body, subject }) => sendEmail(subject, body)}
        />
      )}

      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        {/* Shadows belong to the nav bar alone, so the bar lifts off the page
            by taking msgplane's raised fill plus the border gray. */}
        <div className="w-full max-w-3xl rounded-md border bg-msg-rail">
          {panel === "reassign" && (
            <div className="flex flex-wrap items-end gap-2 border-b p-3">
              {/* Every control in this bar fires an irreversible action on up
                  to 100 records, so below md each one takes a 45px box; the
                  md: value is the size variant's own height, verbatim. */}
              <NativeSelect
                value={repId}
                onChange={(e) => setRepId(e.target.value)}
                className="h-12 max-w-56 md:h-8"
              >
                <option value="">Unassigned</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                className="h-12 md:h-7"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await bulkReassign(ids, repId);
                    done(`Reassigned ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
                  })
                }
              >
                Apply
              </Button>
            </div>
          )}

          {panel === "followup" && (
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <span className="text-sm text-muted-foreground">Next follow-up in:</span>
              {FOLLOW_UP_PRESETS.map((p) => (
                <Button
                  key={p.key}
                  size="sm"
                  variant="outline"
                  className="h-12 md:h-7"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await bulkSetFollowUp(ids, p.key);
                      done(`Follow-up set on ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
                    })
                  }
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}

          {/* The four labels plus the clear button measure ~359px, which does
              not fit a 375px screen: the group wrapped to two 48px rows and
              the count took a third, leaving a ~150px bar sitting on top of
              the list. Below md the labels go to sr-only and each control
              becomes a 45px square (5 x 45 + gaps = 255px, one row), and the
              count takes its own line rather than competing for the 60px that
              were left. pipeline-list's list margin and FAB offset are
              measured against the ~90px this produces. */}
          <div className="flex flex-wrap items-center gap-2 p-2 pl-4 max-md:pl-2">
            <span className="text-sm max-md:basis-full">
              {ids.length} record{ids.length === 1 ? "" : "s"} selected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0">
              {canReassign && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-12 max-md:w-12 md:h-7"
                  onClick={() => togglePanel("reassign")}
                >
                  <User className="size-5 md:hidden" aria-hidden="true" />
                  <span className="max-md:sr-only">Reassign</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-12 max-md:w-12 md:h-7"
                onClick={() => togglePanel("sms")}
              >
                <MessageSquareText className="size-5 md:hidden" aria-hidden="true" />
                <span className="max-md:sr-only">SMS</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-12 max-md:w-12 md:h-7"
                onClick={() => togglePanel("email")}
              >
                <Mail className="size-5 md:hidden" aria-hidden="true" />
                <span className="max-md:sr-only">Email</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-12 max-md:w-12 md:h-7"
                onClick={() => togglePanel("followup")}
              >
                <CalendarCheck2 className="size-5 md:hidden" aria-hidden="true" />
                <span className="max-md:sr-only">Next Follow Up</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-12 md:size-8"
                onClick={clear}
                aria-label="Clear selection"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
