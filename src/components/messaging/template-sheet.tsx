"use client";

import { useEffect, useState } from "react";
import { Mail, MessageSquareText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/form-section";
import { cn } from "@/lib/utils";
import type { MessageTemplate } from "@/types/database";

export type TemplateSheetChannel = "sms" | "email";

// Bottom sheet for picking a canned message and sending it — the msgplane
// habit of "click, pick a template, send" without leaving the list. Templates
// are fetched on open (not with the page) so a 54-template library never
// weighs down a list render.
export function TemplateSheet({
  channel,
  title,
  recipientCount,
  requireSubject = channel === "email",
  busy = false,
  onClose,
  onSend,
}: {
  channel: TemplateSheetChannel;
  title: string;
  recipientCount: number;
  requireSubject?: boolean;
  busy?: boolean;
  onClose: () => void;
  onSend: (payload: { body: string; subject: string }) => void;
}) {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/templates?channel=${channel}`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => alive && setTemplates(d.templates ?? []))
      .catch(() => alive && setTemplates([]));
    return () => {
      alive = false;
    };
  }, [channel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (t: MessageTemplate) => {
    setPickedId(t.id);
    setBody(t.body);
    if (t.subject) setSubject(t.subject);
  };

  const Icon = channel === "email" ? Mail : MessageSquareText;
  const canSend =
    !busy && body.trim().length > 0 && (!requireSubject || subject.trim().length > 0);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
      {/* No shadow: the nav bar is the only raised surface in msgplane, so the
          border gray is what lifts the sheet off the list behind it. */}
      <div className="w-full max-w-3xl rounded-md border border-border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm">{title}</h2>
          <span className="text-xs text-muted-foreground">
            {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-[15rem_1fr]">
          <div className="space-y-1.5">
            <FieldLabel>Templates</FieldLabel>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
              {templates === null && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
              )}
              {templates?.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  No {channel} templates yet.
                </p>
              )}
              {templates?.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t)}
                  className={cn(
                    "block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    pickedId === t.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-msg-hover"
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {requireSubject && (
              <div className="space-y-1">
                <FieldLabel>Subject</FieldLabel>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Your car shipping quote"
                />
              </div>
            )}
            <div className="space-y-1">
              <FieldLabel>{channel === "email" ? "Email body" : "Message"}</FieldLabel>
              <Textarea
                rows={channel === "email" ? 7 : 4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  channel === "email"
                    ? "Pick a template above, or write your own…"
                    : "Pick a template above, or type a custom message…"
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={!canSend}
                onClick={() => onSend({ body: body.trim(), subject: subject.trim() })}
              >
                {busy ? "Sending…" : `Send to ${recipientCount}`}
              </Button>
              <p className="text-xs text-muted-foreground">
                {`{{variables}} fill in per customer.`}
                {channel === "sms" && body.length > 160
                  ? ` · ~${Math.ceil(body.length / 153)} segments`
                  : ""}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
