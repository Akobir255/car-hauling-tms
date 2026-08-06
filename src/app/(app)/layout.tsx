import { headers } from "next/headers";
import { requireProfile } from "@/lib/auth";
import { currentSessionId } from "@/lib/login-verification";
import { businessDay } from "@/lib/dates";
import { buildWatermarkLabel, clientIpFromHeader } from "@/lib/watermark";
import { createClient } from "@/lib/supabase/server";
import { AppTopBar } from "@/components/app-topbar";
import { SessionWatermark } from "@/components/session-watermark";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  // Unread-inbound badge on the Messages item (cheap: hits a partial index).
  const supabase = await createClient();
  const { count: unreadMessages } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .is("read_at", null);

  // Attribution watermark. Everything it needs is already on this request —
  // the profile above, the session id the emailed second factor keys on, and
  // the client address read the way the RingCentral webhook and the e-sign
  // audit read it — so this costs no query. Building it HERE rather than
  // inside the component keeps the component pure markup and keeps the one
  // impure step (reading the clock) at the top of a render, which is the
  // pattern endOfBusinessDay() already set.
  const [sessionId, hdrs] = await Promise.all([currentSessionId(), headers()]);
  const watermarkLabel = buildWatermarkLabel({
    name: profile.full_name,
    email: profile.email,
    sessionId,
    day: businessDay(),
    ip: clientIpFromHeader(hdrs.get("x-forwarded-for")),
  });

  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar
        role={profile.role}
        unreadMessages={unreadMessages ?? 0}
        userName={profile.full_name || profile.email}
        signOut={signOut}
      />
      {/* No overflow on main: tables scroll in their own wrappers, and a
          scroll container here would break position:sticky on form pages.
          The 22.5px gutter costs a phone 12% of its width, so it halves below
          md. Anything that bleeds to this edge with -mx-6 has to match it —
          today that is the new-load sticky bar, which pairs max-md:-mx-4. */}
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      {/* Last child, so it paints over everything the shell drew. It is
          position: fixed, so where it sits in the DOM costs the layout
          nothing. Every signed-in screen is inside this layout, including the
          printable dispatch sheet — which is why that page needs no copy of
          its own, only the data-paper-sheet marker that keeps the ink dark. */}
      <SessionWatermark label={watermarkLabel} />
    </div>
  );
}
