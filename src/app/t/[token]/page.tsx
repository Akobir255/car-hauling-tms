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

export default async function DriverTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!(await isFeatureEnabled("gps_tracking"))) notFound();

  const { token } = await params;
  const resolved = await resolveTrackingToken(token, "driver");

  if (!resolved.ok) {
    const finished = resolved.reason === "load_closed";
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
