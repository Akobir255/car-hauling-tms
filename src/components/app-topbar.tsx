"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  ClipboardList,
  FileText,
  Grid3x3,
  LayoutDashboard,
  Menu,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Ticket,
  Truck,
  UserCircle2,
  UserCog,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/global-search";
import { titleCase } from "@/lib/format";
import type { UserRole } from "@/types/database";

// Horizontal top bar in the style of the system this replaces: one blue band
// with the modules on the left, global search on the RIGHT, then refresh and
// the account menu. Customers is deliberately absent — shippers are reached
// from their record or the search.
const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; roles?: UserRole[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Sparkles },
  { href: "/quotes", label: "Quotes", icon: FileText },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/carriers", label: "Carriers", icon: Building2 },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/admin/users", label: "Users", icon: UserCog, roles: ["admin"] },
];

function Brand() {
  return (
    <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
        <Truck className="size-4.5 text-white" aria-hidden="true" />
      </span>
      <span className="hidden leading-tight sm:block">
        <span className="block text-sm font-bold text-white">US Star</span>
        <span className="block text-[10px] font-semibold uppercase tracking-widest text-blue-200">
          TMS
        </span>
      </span>
    </Link>
  );
}

export function AppTopBar({
  role,
  unreadMessages,
  userName,
  signOut,
}: {
  role: UserRole;
  unreadMessages: number;
  userName: string;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen && !accountOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      setAccountOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, accountOpen]);

  const items = NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(role));
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const NavLink = ({
    item,
    onClick,
    stacked = false,
  }: {
    item: (typeof NAV_ITEMS)[number];
    onClick?: () => void;
    stacked?: boolean;
  }) => (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors",
        stacked ? "rounded-md px-3 py-2" : "h-12 border-b-2 px-3",
        isActive(item.href)
          ? stacked
            ? "bg-blue-600 text-white"
            : "border-white text-white"
          : stacked
            ? "text-zinc-200 hover:bg-white/10"
            : "border-transparent text-blue-100 hover:border-blue-300 hover:text-white"
      )}
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
      {item.href === "/messages" && unreadMessages > 0 && (
        <span
          aria-label={`${unreadMessages} unread messages`}
          className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
        >
          {unreadMessages > 99 ? "99+" : unreadMessages}
        </span>
      )}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 bg-blue-700">
      <div className="flex h-12 items-center gap-2 px-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          className="text-white hover:bg-white/10 hover:text-white xl:hidden"
          onClick={() => setMenuOpen(true)}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>

        <span className="hidden xl:block">
          <Grid3x3 className="size-5 text-blue-200" aria-hidden="true" />
        </span>
        <Brand />

        <nav className="ml-2 hidden items-center xl:flex">
          {items.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        {/* Search sits at the top RIGHT, as in the old system. */}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-48 sm:w-64 lg:w-80">
            <GlobalSearch />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Refresh"
            title="Refresh"
            className="text-blue-100 hover:bg-white/10 hover:text-white"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Account"
              aria-expanded={accountOpen}
              className="text-blue-100 hover:bg-white/10 hover:text-white"
              onClick={() => setAccountOpen((v) => !v)}
            >
              <UserCircle2 className="size-5" aria-hidden="true" />
            </Button>
            {accountOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close account menu"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setAccountOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border bg-card shadow-xl">
                  <div className="border-b px-3 py-2">
                    <p className="truncate text-sm font-semibold">{userName}</p>
                    <p className="text-xs text-muted-foreground">{titleCase(role)}</p>
                  </div>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile / narrow drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-1 bg-zinc-950 p-3">
            <div className="flex items-center justify-between pb-2">
              <Brand />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Close navigation"
                className="text-zinc-300 hover:bg-zinc-800 hover:text-white"
                onClick={() => setMenuOpen(false)}
              >
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>
            {items.map((item) => (
              <NavLink key={item.href} item={item} stacked onClick={() => setMenuOpen(false)} />
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
