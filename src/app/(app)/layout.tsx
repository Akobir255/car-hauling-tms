import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppTopBar } from "@/components/app-topbar";
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
    </div>
  );
}
