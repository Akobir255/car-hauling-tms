"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useSelection } from "./selection-context";
import { bulkReassign, bulkSetFollowUp, bulkSmsChunk } from "@/app/(app)/loads/actions";
import { finalizeSmsBlast } from "@/app/(app)/messages/actions";
import { SMS_CHUNK_MAX } from "@/lib/messaging/sms-bulk";

type Rep = { id: string; name: string };
type Panel = "reassign" | "followup" | "sms" | null;

const FOLLOW_UP_PRESETS: { key: string; label: string }[] = [
  { key: "1d", label: "1 Day" },
  { key: "2d", label: "2 Days" },
  { key: "3d", label: "3 Days" },
  { key: "1w", label: "1 Week" },
];

// Floating bar that appears when rows are selected — msgplane-style bulk
// actions. Reassign / SMS / Next Follow Up work today; Email is stubbed until
// an email provider is wired.
export function BulkActionBar({ reps, canReassign }: { reps: Rep[]; canReassign: boolean }) {
  const { selected, setMany, clear } = useSelection();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, start] = useTransition();
  const [repId, setRepId] = useState("");
  const [smsBody, setSmsBody] = useState("");

  const ids = [...selected];
  if (ids.length === 0) return null;

  const done = (msg: string) => {
    toast.success(msg);
    setPanel(null);
    clear();
  };

  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="w-full max-w-3xl rounded-xl border bg-card shadow-lg">
        {panel === "reassign" && (
          <div className="flex flex-wrap items-end gap-2 border-b p-3">
            <NativeSelect
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              className="max-w-56"
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
              disabled={pending}
              onClick={() => start(async () => {
                await bulkReassign(ids, repId);
                done(`Reassigned ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
              })}
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
                disabled={pending}
                onClick={() => start(async () => {
                  await bulkSetFollowUp(ids, p.key);
                  done(`Follow-up set on ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
                })}
              >
                {p.label}
              </Button>
            ))}
          </div>
        )}

        {panel === "sms" && (
          <div className="space-y-2 border-b p-3">
            <Textarea
              rows={2}
              value={smsBody}
              onChange={(e) => setSmsBody(e.target.value)}
              placeholder="Text all selected customers… (opted-out numbers are skipped)"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={pending || !smsBody.trim()}
                onClick={() => start(async () => {
                  // Chunked like the compose page: paced server-side, resumed
                  // after rate-limit stops, and on any abort the processed
                  // loads are DESELECTED so retrying only hits the unsent.
                  const tally = { sent: 0, queued: 0, skipped: 0, failed: 0 };
                  let pendingIds = [...ids];
                  let stalls = 0;
                  try {
                    while (pendingIds.length > 0) {
                      const chunk = pendingIds.slice(0, SMS_CHUNK_MAX);
                      const r = await bulkSmsChunk(chunk, smsBody);
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
                            (pendingIds.length > 0
                              ? ` The ${pendingIds.length} unsent stay selected.`
                              : "")
                        );
                        return;
                      }
                      stalls =
                        r.unprocessedLoadIds.length > 0 && r.sent + r.failed === 0
                          ? stalls + 1
                          : 0;
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
                    setSmsBody("");
                  } finally {
                    finalizeSmsBlast().catch(() => {});
                  }
                })}
              >
                Send to {ids.length}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 p-2 pl-4">
          <span className="text-sm font-semibold">
            {ids.length} record{ids.length === 1 ? "" : "s"} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canReassign && (
              <Button size="sm" variant="outline" onClick={() => togglePanel("reassign")}>
                Reassign
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => togglePanel("sms")}>
              SMS
            </Button>
            <Button size="sm" variant="outline" disabled title="Email blasts need an email provider">
              Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => togglePanel("followup")}>
              Next Follow Up
            </Button>
            <Button size="icon" variant="ghost" onClick={clear} aria-label="Clear selection">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
