import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/flags";
import { resolveTrackingToken } from "@/lib/tracking/tokens";
import { DriverTracker } from "./driver-tracker";

// The driver PWA (Phase 2). No login: the token in the URL is the credential,
// checked server-side, exactly like the contract page at /sign/[token].
//
// The page never receives anything about the order beyond its number. A carrier
// driver has no business seeing the tariff, the shipper's contact details or
// the margin, and the way to guarantee that is to not send it.

export const dynamic = "force-dynamic";

// The manifest is linked from THIS page only, not app-wide: Add to Home Screen
// here gives the driver a standalone screen that reopens on this same token
// URL — the manifest deliberately has no start_url, which per spec defaults to
// the page that linked it. CSP already allows it (manifest-src 'self', a file
// in public/). This is a bookmark with its own icon, not background tracking:
// no mobile browser tracks from a locked phone, and nothing here claims to.
export const metadata: Metadata = {
  title: "Location sharing",
  manifest: "/driver-tracking.webmanifest",
  // Token pages are reached from a text message, never from a search. If one
  // of these URLs is ever pasted somewhere a crawler can see it, the token
  // stops being unguessable — so tell crawlers not to keep it.
  robots: { index: false, follow: false, nocache: true },
};

export default async function DriverTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!(await isFeatureEnabled("gps_tracking"))) notFound();

  const { token } = await params;
  const resolved = await resolveTrackingToken(token, "driver");

  if (!resolved.ok) {
    const finished =
      resolved.reason === "load_closed" ||
      resolved.reason === "revoked_after_delivery";
    return (
      <div className="mx-auto max-w-md space-y-3 p-5">
        <h1 className="text-2xl font-bold">
          {finished ? "This delivery is complete" : "This link isn't active"}
        </h1>
        <p className="text-muted-foreground">
          {finished
            ? "Thanks — nothing more to send for this order."
            : "The link may have expired or been replaced. Ask dispatch to text you a new one."}
        </p>
      </div>
    );
  }

  return <DriverTracker token={token} loadNumber={resolved.load.load_number} />;
}
