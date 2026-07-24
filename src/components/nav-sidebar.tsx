"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";

const NAV_ITEMS: { href: string; label: string; roles?: UserRole[] }[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/loads", label: "Loads" },
  { href: "/carriers", label: "Carriers" },
  { href: "/customers", label: "Customers" },
  { href: "/messages", label: "Messages" },
  { href: "/admin/users", label: "Users", roles: ["admin"] },
];

// msgplane-style horizontal top nav: blue bar, white links, darker active tab.
export function NavBar({ role, unreadMessages = 0 }: { role: UserRole; unreadMessages?: number }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-stretch">
      {NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-1.5 px-4 text-sm font-medium text-white transition-colors",
              active ? "bg-blue-900/60" : "hover:bg-blue-800/50"
            )}
          >
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
      })}
    </nav>
  );
}
