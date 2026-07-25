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
import type { Customer, MessageTemplate } from "@/types/database";
import { sendBulk, type MessageFormState } from "../actions";

const initialState: MessageFormState = { error: null };

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
  const isEmail = channel === "email";

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.result) {
      const { sent, queued, skipped } = state.result;
      toast.success(`Done: ${sent} sent, ${queued} queued, ${skipped} skipped.`);
    }
  }, [state]);

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

  const optedOut = customers.length - eligible.length;

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-2">
      {effectiveSelected.map((id) => (
        <input key={id} type="hidden" name="customer_ids" value={id} />
      ))}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Recipients — {effectiveSelected.length} selected
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={toggleAllVisible}>
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
        <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-2">
          {visible.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span className="font-medium">{c.contact_name}</span>
              <span className="truncate text-muted-foreground">
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
        <h2 className="text-sm font-semibold">Message</h2>

        {/* Channel switch — drives eligibility, the editor, and validation. */}
        <input type="hidden" name="channel" value={channel} />
        <div className="inline-flex rounded-md border p-0.5">
          {(["sms", "email"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={
                channel === c
                  ? "rounded px-3 py-1 text-sm font-semibold bg-primary text-primary-foreground"
                  : "rounded px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
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
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_VARIABLES.map((v) => (
            <Badge
              key={v}
              variant="outline"
              className="cursor-pointer"
              onClick={() => setBody((prev) => `${prev}{{${v}}}`)}
            >
              {`{{${v}}}`}
            </Badge>
          ))}
        </div>
        <Button type="submit" disabled={pending || effectiveSelected.length === 0}>
          {pending
            ? "Sending..."
            : `Send to ${effectiveSelected.length} recipient${effectiveSelected.length === 1 ? "" : "s"}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Variables fill in per customer from their latest load. Opted-out numbers are always excluded.
        </p>
      </section>
    </form>
  );
}
