"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail, MessageSquareText } from "lucide-react";
import { TemplateSheet } from "@/components/messaging/template-sheet";
import { bulkEmail } from "@/app/(app)/loads/actions";
import { sendSmsBulkChunk } from "@/app/(app)/messages/actions";

// The little "SMS" / "Email" buttons beside a row's phone and email, matching
// msgplane's inline send. Both open the template sheet for this one customer,
// then reuse the same paced/logged send paths as a blast.
export function RowMessageButton({
  channel,
  loadId,
  customerId,
  customerName,
}: {
  channel: "sms" | "email";
  loadId: string;
  customerId: string;
  customerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const send = ({ body, subject }: { body: string; subject: string }) =>
    start(async () => {
      if (channel === "sms") {
        const r = await sendSmsBulkChunk({ body, customerIds: [customerId] });
        if (r.error) toast.error(r.error);
        else if (r.sent > 0) toast.success("Text sent.");
        else if (r.queued > 0) toast.success("Queued — SMS isn't connected yet.");
        else toast.error("Not sent — opted out or no valid mobile number.");
      } else {
        const r = await bulkEmail([loadId], subject, body);
        if (r.error) toast.error(r.error);
        else if (r.sent > 0) toast.success("Email sent.");
        else if (r.queued > 0) toast.success("Queued — email isn't connected yet.");
        else toast.error("Not sent — opted out or no valid email address.");
      }
      setOpen(false);
    });

  const Icon = channel === "email" ? Mail : MessageSquareText;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${channel === "email" ? "Email" : "Text"} ${customerName}`}
        title={`${channel === "email" ? "Email" : "Text"} ${customerName}`}
        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon className="size-3" aria-hidden="true" />
        {channel === "email" ? "Email" : "SMS"}
      </button>
      {open && (
        <TemplateSheet
          channel={channel}
          title={`${channel === "email" ? "Email" : "Text"} ${customerName}`}
          recipientCount={1}
          busy={pending}
          onClose={() => setOpen(false)}
          onSend={send}
        />
      )}
    </>
  );
}
