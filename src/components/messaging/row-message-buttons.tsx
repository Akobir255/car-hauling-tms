"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
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

  return (
    <>
      {/* msgplane look: the phone gets a small black "…" chip, the email a
          red envelope — both open the compose sheet for this customer. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${channel === "email" ? "Email" : "Text"} ${customerName}`}
        title={`${channel === "email" ? "Email" : "Text"} ${customerName}`}
        // The chip takes --foreground (msgplane's phone glyph is #000000) and
        // the envelope --destructive, rather than Tailwind's own neutral/red,
        // which carry no theme and land off the spec's palette.
        className={
          channel === "sms"
            ? "focus-ring inline-flex h-4 items-center rounded-sm bg-foreground px-1.5 text-xs leading-none text-background transition-opacity hover:opacity-80"
            : "focus-ring inline-flex items-center text-destructive transition-opacity hover:opacity-70"
        }
      >
        {channel === "sms" ? "•••" : <Mail className="size-3.5" aria-hidden="true" />}
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
