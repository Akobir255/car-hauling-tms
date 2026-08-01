"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { blockedFromWritingLoad } from "@/lib/record-access";
import { mintTrackingToken, type TrackingTokenKind } from "@/lib/tracking/tokens";
import { ensureLoadGeofences } from "@/lib/tracking/setup-geofences";
import { recordEvent } from "@/lib/events/record-event";
import { isFeatureEnabled } from "@/lib/flags";
import { isSmsConfigured, sendSms, toE164 } from "@/lib/messaging/ringcentral";
import { isSuppressed } from "@/lib/messaging/suppression";
import { runSmsChunk } from "@/lib/messaging/sms-bulk";

// Issuing a tracking link is a WRITE on the order, so it goes through the same
// role gate as any other write and mintTrackingToken runs as the caller — the
// insert policy in 0050 decides whether this person may touch this load.

// Same fallback chain as every other link builder (appBaseUrl in
// loads/actions.ts, webhookAddress in messages/actions.ts): the explicit env
// first, then the Vercel production host, so a deployment without
// NEXT_PUBLIC_APP_URL still mints working URLs.
function appBaseUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  return vercel ? `https://${vercel}` : "";
}

export type TrackingLinkState = {
  url: string | null;
  error: string | null;
  /** Stops whose address would not geocode — no fence, so no arrival detection. */
  fencesMissing?: ("pickup" | "delivery")[];
};

// The Tracking band only renders on an order, but a server action is callable
// without the band — so the pre-order refusal has to live here too, not just
// in the page's !isPreOrder gate.
async function loadStageGate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  loadId: string
): Promise<{ error: string | null }> {
  const { data: load } = await supabase
    .from("loads")
    .select("pipeline_stage")
    .eq("id", loadId)
    .maybeSingle();
  if (!load) return { error: "Order not found." };
  if (load.pipeline_stage !== "order") {
    return {
      error: `Tracking links are for orders — this record is still a ${load.pipeline_stage}.`,
    };
  }
  return { error: null };
}

export async function issueTrackingLink(
  loadId: string,
  kind: TrackingTokenKind
): Promise<TrackingLinkState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  if (!(await isFeatureEnabled("gps_tracking"))) {
    return { url: null, error: "GPS tracking is switched off for this account." };
  }

  const supabase = await createClient();
  const gate = await loadStageGate(supabase, loadId);
  if (gate.error) return { url: null, error: gate.error };

  // Geocode the stops HERE rather than on the ingest route: this is a click by
  // a person at a desk, where a second of latency is free, and that route is
  // answering a phone in a moving truck.
  let fencesMissing: ("pickup" | "delivery")[] = [];
  if (kind === "driver") {
    const fences = await ensureLoadGeofences(loadId);
    // Not an error: the link still works and positions still record. Arrival
    // detection is what is lost, and the panel says so to the dispatcher now
    // instead of leaving it as a server-side console line.
    fencesMissing = fences.missing;
  }

  const { token, error } = await mintTrackingToken(loadId, kind, profile.id);
  if (error || !token) return { url: null, error: error ?? "Could not create the link." };

  // On the timeline, because "who gave the driver a tracking link, and when" is
  // exactly the kind of thing a dispatcher reconstructs after a delivery goes
  // wrong. The token itself is NEVER in the payload — that payload is readable
  // by all staff and the token is a credential.
  await recordEvent({
    loadId,
    type: "tracking_link_issued",
    payload: { kind },
    source: "user",
    actorUserId: profile.id,
  });

  const base = appBaseUrl();
  const path = kind === "driver" ? `/t/${token}` : `/track/${token}`;

  revalidatePath(`/loads/${loadId}`);
  return {
    url: `${base}${path}`,
    error: null,
    fencesMissing: fencesMissing.length ? fencesMissing : undefined,
  };
}

export type TextDriverLinkState = {
  error: string | null;
  /** E.164 number the link went to, for the toast. */
  sentTo?: string;
  fencesMissing?: ("pickup" | "delivery")[];
};

// Text the driver link to the dispatch sheet's driver phone. Reuses the LIVE
// driver token when one exists — texting must not kill a link already on
// somebody's phone — and mints one when there is none. The URL is rebuilt
// server-side from the staff-readable tracking_tokens row and goes only into
// the SMS: nothing here returns it to the page, so the show-once property of
// the panel holds.
export async function textDriverLink(loadId: string): Promise<TextDriverLinkState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  if (!(await isFeatureEnabled("gps_tracking"))) {
    return { error: "GPS tracking is switched off for this account." };
  }
  // Texting reuses an existing token, so no insert policy runs — the ownership
  // check has to be explicit here, same as every other action that writes on
  // someone's behalf.
  const notMine = await blockedFromWritingLoad(loadId, profile);
  if (notMine) return { error: notMine };

  const supabase = await createClient();
  const { data: load } = await supabase
    .from("loads")
    .select("load_number, pipeline_stage, driver_phone, customer_id")
    .eq("id", loadId)
    .maybeSingle();
  if (!load) return { error: "Order not found." };
  if (load.pipeline_stage !== "order") {
    return { error: `Tracking links are for orders — this record is still a ${load.pipeline_stage}.` };
  }

  const to = toE164(load.driver_phone);
  if (!to) return { error: "No driver phone on the dispatch sheet — add one there first." };
  if (await isSuppressed(load.driver_phone)) {
    return { error: "That number is on the do-not-text list — can't text the link." };
  }
  if (!isSmsConfigured()) {
    return { error: "SMS isn't connected — create the link and send it another way." };
  }
  const base = appBaseUrl();
  if (!base) return { error: "Set NEXT_PUBLIC_APP_URL so the link is a full URL." };

  const { data: existing } = await supabase
    .from("tracking_tokens")
    .select("token, expires_at")
    .eq("load_id", loadId)
    .eq("kind", "driver")
    .is("revoked_at", null)
    .maybeSingle();

  let token =
    existing && new Date(existing.expires_at).getTime() > Date.now() ? existing.token : null;
  let fencesMissing: ("pickup" | "delivery")[] = [];
  if (!token) {
    const fences = await ensureLoadGeofences(loadId);
    fencesMissing = fences.missing;
    const minted = await mintTrackingToken(loadId, "driver", profile.id);
    if (minted.error || !minted.token) {
      return { error: minted.error ?? "Could not create the link." };
    }
    token = minted.token;
    await recordEvent({
      loadId,
      type: "tracking_link_issued",
      payload: { kind: "driver" },
      source: "user",
      actorUserId: profile.id,
    });
  }

  const url = `${base}/t/${token}`;
  const text = `US Star Trucking — location link for order ${load.load_number}: ${url} Open it on this phone and tap Share location while hauling.`;

  // One recipient is still a send, and every send path goes through the paced
  // engine (docs/STATUS.md rule 4) — never sendSms directly.
  const run = await runSmsChunk([{ to, text }], {
    ready: isSmsConfigured(),
    send: sendSms,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  });

  const outcome = run.outcomes[0];
  if (!outcome) {
    return {
      error: run.providerError
        ? `RingCentral problem — the text was not sent: ${run.providerError}`
        : "RingCentral is rate-limited right now — try again in a minute.",
      fencesMissing: fencesMissing.length ? fencesMissing : undefined,
    };
  }

  // Same trail a bulk send leaves: the text lands on the order's message
  // timeline whatever happened to it. The link in the body is no wider an
  // exposure than the tracking_tokens row staff can already read.
  const { error: logError } = await supabase.from("messages").insert({
    customer_id: load.customer_id,
    load_id: loadId,
    channel: "sms",
    direction: "outbound",
    to_addr: to,
    body: text,
    provider_message_id: outcome.providerMessageId,
    status: outcome.status,
    sent_by: profile.id,
  });
  if (logError) console.error("Logging the driver-link SMS failed:", logError);

  if (outcome.status === "failed") {
    return {
      error: "Couldn't text the driver — check the number on the dispatch sheet.",
      fencesMissing: fencesMissing.length ? fencesMissing : undefined,
    };
  }

  revalidatePath(`/loads/${loadId}`);
  return {
    error: null,
    sentTo: to,
    fencesMissing: fencesMissing.length ? fencesMissing : undefined,
  };
}
