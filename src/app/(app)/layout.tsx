import { requireProfile } from "@/lib/auth";
import { NavBar } from "@/components/nav-sidebar";
import { Button } from "@/components/ui/button";
import { titleCase } from "@/lib/format";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-stretch justify-between bg-blue-700 pl-4 shadow-sm">
        <div className="flex items-stretch gap-2">
          <div className="flex items-center pr-2 text-sm font-bold text-white">
            US Star TMS
          </div>
          <NavBar role={profile.role} />
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
      <main className="flex-1 overflow-x-auto p-6">{children}</main>
    </div>
  );
}
