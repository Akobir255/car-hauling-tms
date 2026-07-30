"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { mintTrackingToken, type TrackingTokenKind } from "@/lib/tracking/tokens";
import { ensureLoadGeofences } from "@/lib/tracking/setup-geofences";
import { recordEvent } from "@/lib/events/record-event";
import { isFeatureEnabled } from "@/lib/flags";

// Issuing a tracking link is a WRITE on the order, so it goes through the same
// role gate as any other write and mintTrackingToken runs as the caller — the
// insert policy in 0050 decides whether this person may touch this load.

export type TrackingLinkState = { url: string | null; error: string | null };

export async function issueTrackingLink(
  loadId: string,
  kind: TrackingTokenKind
): Promise<TrackingLinkState> {
  const profile = await requireRole("admin", "dispatcher", "sales");

  if (!(await isFeatureEnabled("gps_tracking"))) {
    return { url: null, error: "GPS tracking is switched off for this account." };
  }

  // Geocode the stops HERE rather than on the ingest route: this is a click by
  // a person at a desk, where a second of latency is free, and that route is
  // answering a phone in a moving truck.
  if (kind === "driver") {
    const fences = await ensureLoadGeofences(loadId);
    if (fences.missing.length) {
      // Not an error: the link still works and positions still record. Arrival
      // detection is what is lost, and the dispatcher should know that now
      // rather than wonder later why no arrival fired.
      console.warn(
        `Tracking link for ${loadId}: no geofence for ${fences.missing.join(" and ")} — address would not geocode.`
      );
    }
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

  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const path = kind === "driver" ? `/t/${token}` : `/track/${token}`;

  revalidatePath(`/loads/${loadId}`);
  return { url: `${base}${path}`, error: null };
}
