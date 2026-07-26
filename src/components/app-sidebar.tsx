"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Sparkles,
  Ticket,
  Truck,
  UserCog,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/global-search";
import { titleCase } from "@/lib/format";
import type { UserRole } from "@/types/database";

// Customers is deliberately NOT in the nav: shippers are reached through
// their lead/quote/order or the global search, never browsed as a list.
// (The /customers pages still exist and are linked from records.)
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

function NavLinks({
  role,
  unreadMessages,
  onNavigate,
}: {
  role: UserRole;
  unreadMessages: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-blue-600 text-white"
                : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden="true" />
            {item.label}
            {item.href === "/messages" && unreadMessages > 0 && (
              <span
                aria-label={`${unreadMessages} unread messages`}
                className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
              >
                {unreadMessages > 99 ? "99+" : unreadMessages}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function UserBlock({
  name,
  role,
  signOut,
}: {
  name: string;
  role: UserRole;
  signOut: () => Promise<void>;
}) {
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{name}</p>
        <p className="text-xs text-zinc-500">{titleCase(role)}</p>
      </div>
      <form action={signOut}>
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Out
        </Button>
      </form>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600">
        <Truck className="size-4.5 text-white" aria-hidden="true" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold text-white">US Star</p>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">TMS</p>
      </div>
    </div>
  );
}

// ShipPilot-style dark sidebar: always dark, in both app themes.
export function AppSidebar({
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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-zinc-950 lg:flex">
        <Brand />
        <div className="px-3 pb-3">
          <GlobalSearch />
        </div>
        <NavLinks role={role} unreadMessages={unreadMessages} />
        <UserBlock name={userName} role={role} signOut={signOut} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-zinc-950 pr-2 lg:hidden">
        <Brand />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-label="Open navigation"
          className="text-zinc-300 hover:bg-zinc-800 hover:text-white"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-zinc-950 shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Close navigation"
                className="text-zinc-300 hover:bg-zinc-800 hover:text-white"
                onClick={() => setOpen(false)}
              >
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>
            <div className="px-3 pb-3">
              <GlobalSearch onNavigate={() => setOpen(false)} />
            </div>
            <NavLinks role={role} unreadMessages={unreadMessages} onNavigate={() => setOpen(false)} />
            <UserBlock name={userName} role={role} signOut={signOut} />
          </div>
        </div>
      )}
    </>
  );
}
