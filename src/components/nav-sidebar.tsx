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
export function NavBar({ role }: { role: UserRole }) {
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
              "flex items-center px-4 text-sm font-medium text-white transition-colors",
              active ? "bg-blue-900/60" : "hover:bg-blue-800/50"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
