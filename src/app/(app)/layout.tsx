import { requireProfile } from "@/lib/auth";
import { NavSidebar } from "@/components/nav-sidebar";
import { Button } from "@/components/ui/button";
import { titleCase } from "@/lib/format";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-background">
        <div className="border-b p-4">
          <p className="text-sm font-semibold">Broker TMS</p>
        </div>
        <div className="flex-1">
          <NavSidebar role={profile.role} />
        </div>
        <div className="space-y-2 border-t p-3">
          <div className="px-1 text-xs text-muted-foreground">
            <p className="truncate font-medium text-foreground">
              {profile.full_name || profile.email}
            </p>
            <p>{titleCase(profile.role)}</p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">{children}</main>
    </div>
  );
}
