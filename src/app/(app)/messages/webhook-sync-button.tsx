"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncInboundWebhook, type WebhookSyncState } from "./actions";

const initialState: WebhookSyncState = { error: null };

// Admin-only: registers the RingCentral push subscription for inbound SMS.
export function WebhookSyncButton() {
  const [state, formAction, pending] = useActionState(syncInboundWebhook, initialState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.status) toast.success(state.status);
  }, [state]);

  return (
    <form action={formAction}>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Connecting..." : "Connect inbound webhook"}
      </Button>
    </form>
  );
}
