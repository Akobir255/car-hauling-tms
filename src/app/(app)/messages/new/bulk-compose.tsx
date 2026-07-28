"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { TEMPLATE_VARIABLES } from "@/lib/messaging/render";
import { SMS_BLAST_MAX, SMS_CHUNK_MAX } from "@/lib/messaging/sms-bulk";
import type { Customer, MessageTemplate } from "@/types/database";
import {
  finalizeSmsBlast,
  sendBulk,
  sendSmsBulkChunk,
  type MessageFormState,
} from "../actions";

const initialState: MessageFormState = { error: null };

// Progress of a chunked SMS blast. `done` counts attempted recipients (sent,
// queued, failed, or skipped) out of `total` selected.
type SmsProgress = {
  done: number;
  total: number;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  waiting: boolean;
  finished: boolean;
};

export function BulkCompose({
  customers,
  templates,
  emailReady = false,
}: {
  customers: Customer[];
  templates: MessageTemplate[];
  emailReady?: boolean;
}) {
  const [state, formAction, pending] = useActionState(sendBulk, initialState);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [subject, setSubject] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsProgress, setSmsProgress] = useState<SmsProgress | null>(null);
  const isEmail = channel === "email";

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.result) {
      const { sent, queued, skipped } = state.result;
      toast.success(`Done: ${sent} sent, ${queued} queued, ${skipped} skipped.`);
    }
  }, [state]);

  // A blast survives a closed tab only up to the current chunk — warn before
  // the operator walks away from an in-flight send.
  useEffect(() => {
    if (!smsSending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [smsSending]);

  // Eligibility follows the channel: a customer with no email can't receive an
  // email blast, and each channel has its own opt-out flag.
  const eligible = useMemo(
    () =>
      isEmail
        ? customers.filter((c) => c.email && !c.email_opt_out)
        : customers.filter((c) => c.phone && !c.sms_opt_out),
    [customers, isEmail]
  );

  // Switching channel must not carry over recipients who can't receive it.
  // Derived rather than pruned in an effect: the raw `selected` set is kept as
  // typed, and only eligible ids are ever counted or submitted — so flipping
  // back to SMS restores the earlier picks instead of silently losing them.
  const effectiveSelected = useMemo(() => {
    const allowed = new Set(eligible.map((c) => c.id));
    return [...selected].filter((id) => allowed.has(id));
  }, [selected, eligible]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter(
      (c) =>
        c.contact_name.toLowerCase().includes(q) ||
        (c.company_name ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q)
    );
  }, [eligible, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const allSelected = visible.every((c) => prev.has(c.id));
      const next = new Set(prev);
      for (const c of visible) {
        if (allSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  // Chunked SMS send: one server call per SMS_CHUNK_MAX recipients. The server
  // paces individual sends under RingCentral's 40/min limit and hands back any
  // rate-limited tail, which we resume after the suggested wait. Each chunk is
  // logged server-side as it completes, so progress is durable.
  async function runSmsBlast() {
    const total = effectiveSelected.length;
    if (total === 0) return;
    if (total > SMS_BLAST_MAX) {
      toast.error(`Max ${SMS_BLAST_MAX} recipients per send — narrow the selection.`);
      return;
    }
    if (!body.trim()) {
      toast.error("Message body is required.");
      return;
    }

    setSmsSending(true);
    const tally = { done: 0, sent: 0, queued: 0, skipped: 0, failed: 0 };
    const show = (waiting: boolean, finished = false) =>
      setSmsProgress({ ...tally, total, waiting, finished });
    show(false);

    let pendingIds = [...effectiveSelected];
    // After any abort, the selection becomes exactly the unsent remainder, so
    // pressing Send again RESUMES the blast instead of double-texting the
    // customers who already got it.
    const keepRemainder = () => setSelected(new Set(pendingIds));

    try {
      let stalls = 0;
      while (pendingIds.length > 0) {
        const chunk = pendingIds.slice(0, SMS_CHUNK_MAX);
        const res = await sendSmsBulkChunk({ body, customerIds: chunk });

        tally.sent += res.sent;
        tally.queued += res.queued;
        tally.skipped += res.skipped;
        tally.failed += res.failed;
        // A chunk that was rejected whole (validation, bad session) attempted
        // nothing, even though unprocessedIds is empty — keep it pending.
        const nothingHappened =
          res.error !== null &&
          res.unprocessedIds.length === 0 &&
          res.sent + res.queued + res.skipped + res.failed === 0;
        const attempted = nothingHappened ? 0 : chunk.length - res.unprocessedIds.length;
        tally.done += attempted;
        pendingIds = nothingHappened
          ? pendingIds
          : [...res.unprocessedIds, ...pendingIds.slice(chunk.length)];

        if (res.error) {
          keepRemainder();
          toast.error(
            res.error +
              (pendingIds.length > 0
                ? ` The selection now holds the ${pendingIds.length} unsent recipient${pendingIds.length === 1 ? "" : "s"}.`
                : "")
          );
          show(false, true);
          return;
        }

        // Only genuine send stalls count: a rate-limit stop with zero texts
        // delivered. Skipped (opted-out) recipients are not progress, but
        // they also must not mask a hard 429 wall.
        stalls =
          res.unprocessedIds.length > 0 && res.sent + res.failed === 0 ? stalls + 1 : 0;
        if (stalls >= 3) {
          keepRemainder();
          toast.error(
            `RingCentral keeps rate-limiting — stopped with ${pendingIds.length} unsent (kept in the selection). Try again in a few minutes.`
          );
          show(false, true);
          return;
        }

        if (pendingIds.length > 0 && res.retryAfterMs) {
          show(true);
          await new Promise((resolve) => setTimeout(resolve, res.retryAfterMs ?? 1000));
        }
        show(false, pendingIds.length === 0);
      }
      // Done — clear the selection so a second click can't repeat the blast.
      setSelected(new Set());
      toast.success(
        `Done: ${tally.sent} sent, ${tally.queued} queued, ${tally.skipped} skipped` +
          (tally.failed > 0 ? `, ${tally.failed} failed.` : ".")
      );
    } catch (err) {
      console.error("SMS blast stopped:", err);
      keepRemainder();
      toast.error(
        `Send interrupted after ${tally.done} of ${total} — the selection now holds only the unsent recipients. Press Send to resume.`
      );
      show(false, true);
    } finally {
      setSmsSending(false);
      // Refresh the Messages screens once per blast, not once per chunk.
      finalizeSmsBlast().catch(() => {});
    }
  }

  const optedOut = customers.length - eligible.length;
  const busy = pending || smsSending;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!isEmail) {
          e.preventDefault();
          if (!smsSending) void runSmsBlast();
        }
      }}
      className="grid gap-6 lg:grid-cols-2"
    >
      {effectiveSelected.map((id) => (
        <input key={id} type="hidden" name="customer_ids" value={id} />
      ))}

      <section className="space-y-3">
        <div className="flex items-center justify-between max-md:flex-wrap max-md:gap-2">
          <h2 className="text-sm text-msg-header">
            Recipients — {effectiveSelected.length} selected
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-md:min-h-12"
            onClick={toggleAllVisible}
          >
            Select all shown ({visible.length})
          </Button>
        </div>
        <Input
          placeholder="Search name, company, phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {optedOut > 0 && (
          <p className="text-xs text-muted-foreground">
            {optedOut} customer{optedOut === 1 ? "" : "s"} hidden (no{" "}
            {isEmail ? "email address" : "phone"} or opted out of{" "}
            {isEmail ? "email" : "SMS"}).
          </p>
        )}
        {/* A fixed 384px scroller eats more than half a phone screen and the
            page still scrolls behind it. */}
        <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-2 max-md:max-h-[50vh]">
          {visible.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-msg-hover max-md:min-h-12 max-md:flex-wrap"
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span>{c.contact_name}</span>
              {/* Company/phone is the disambiguator between two same-named
                  customers, so it gets its own line rather than truncating to
                  nothing beside the name. */}
              <span className="truncate text-muted-foreground max-md:w-full">
                {c.company_name ? `${c.company_name} · ` : ""}
                {isEmail ? c.email : c.phone}
              </span>
            </label>
          ))}
          {visible.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">No matching customers.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm text-msg-header">Message</h2>

        {/* Channel switch — drives eligibility, the editor, and validation. */}
        <input type="hidden" name="channel" value={channel} />
        <div className="inline-flex rounded-md border p-0.5">
          {(["sms", "email"] as const).map((c) => (
            <button
              key={c}
              type="button"
              disabled={smsSending}
              onClick={() => setChannel(c)}
              className={
                // Selected segment takes the coral, same as the list tabs.
                // max-md:py-3 rather than a min-height: these are plain buttons,
                // so padding is what keeps the label centred in the taller box.
                channel === c
                  ? "rounded-md bg-msg-selected px-3 py-1 text-sm text-msg-selected-foreground max-md:py-3"
                  : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground max-md:py-3"
              }
            >
              {c === "sms" ? "SMS" : "Email"}
            </button>
          ))}
        </div>
        {isEmail && !emailReady && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Email isn&apos;t connected yet (needs RESEND_API_KEY and EMAIL_FROM) — sends will
            be logged as <strong>Queued</strong> and can go out once it is.
          </p>
        )}

        {templates.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="template">Start from template</Label>
            <NativeSelect
              id="template"
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) {
                  setBody(t.body);
                  if (t.subject) setSubject(t.subject);
                }
              }}
            >
              <option value="">— pick a template —</option>
              {templates
                .filter((t) => t.channel === channel)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
        )}

        {isEmail && (
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Your car shipping quote for {{route}}"
              required
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="body">{isEmail ? "Email body" : "Text message"}</Label>
          <Textarea
            id="body"
            name="body"
            rows={isEmail ? 10 : 6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              isEmail
                ? "Hi {{first_name}},\n\nHere's your quote for {{route}} — {{quote_price}}.\n\nReply to this email with any questions.\n\n— US Star Trucking"
                : "Hi {{first_name}}, following up on your quote for {{route}} — {{quote_price}}. Ready to book? Reply STOP to opt out."
            }
            required
          />
          <p className="text-xs text-muted-foreground">
            {body.length} chars
            {!isEmail && body.length > 160
              ? ` (~${Math.ceil(body.length / 153)} SMS segments)`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 max-md:gap-2">
          {TEMPLATE_VARIABLES.map((v) => (
            // Sized at the call site, not in ui/badge.tsx — these ten are
            // clickable inserts; the status badges elsewhere are not.
            <Badge
              key={v}
              variant="outline"
              className="cursor-pointer max-md:h-12 max-md:px-3"
              onClick={() => setBody((prev) => `${prev}{{${v}}}`)}
            >
              {`{{${v}}}`}
            </Badge>
          ))}
        </div>
        <Button
          type="submit"
          className="max-md:min-h-12 max-md:w-full"
          disabled={busy || effectiveSelected.length === 0}
        >
          {busy
            ? "Sending..."
            : `Send to ${effectiveSelected.length} recipient${effectiveSelected.length === 1 ? "" : "s"}`}
        </Button>

        {!isEmail && smsProgress && (
          <div className="space-y-1.5 rounded-md border px-3 py-2">
            <div className="h-2 w-full overflow-hidden rounded-md bg-muted">
              <div
                className="h-full rounded-md bg-primary transition-all"
                style={{
                  width: `${smsProgress.total ? Math.round((smsProgress.done / smsProgress.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {smsProgress.finished
                ? `${smsProgress.done < smsProgress.total ? `Stopped at ${smsProgress.done} of ${smsProgress.total}` : "Finished"}: ` +
                  `${smsProgress.sent} sent, ${smsProgress.queued} queued, ${smsProgress.skipped} skipped` +
                  (smsProgress.failed > 0 ? `, ${smsProgress.failed} failed` : "")
                : smsProgress.waiting
                  ? `Rate-limited — pausing before the next batch... (${smsProgress.done} of ${smsProgress.total} done)`
                  : `Sending ${smsProgress.done} of ${smsProgress.total} — texts go out ~1.7s apart to stay under RingCentral's limit`}
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Variables fill in per customer from their latest load. Opted-out numbers are always excluded.
          {!isEmail &&
            " Carrier note: local numbers are limited to ~200 unique recipients and ~1,000 texts per day — beyond that, carriers filter silently."}
        </p>
      </section>
    </form>
  );
}
