import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-sidebar";
import { Button } from "@/components/ui/button";
import { titleCase } from "@/lib/format";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  // Unread-inbound badge on the Messages tab (cheap: hits a partial index).
  const supabase = await createClient();
  const { count: unreadMessages } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .is("read_at", null);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-stretch justify-between bg-blue-700 pl-4 shadow-sm">
        <div className="flex items-stretch gap-2">
          <div className="flex items-center pr-2 text-sm font-bold text-white">
            US Star TMS
          </div>
          <NavBar role={profile.role} unreadMessages={unreadMessages ?? 0} />
        </div>
        <div className="flex items-center gap-3 pr-4">
          <span className="hidden text-xs text-blue-100 sm:block">
            {profile.full_name || profile.email} · {titleCase(profile.role)}
          </span>
          <form action={signOut}>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="text-white hover:bg-blue-800/50 hover:text-white"
            >
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {/* No overflow on main: tables scroll in their own wrappers, and a
          scroll container here would break position:sticky on form pages. */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
