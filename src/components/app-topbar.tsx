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

// Shared by the three ghost buttons that sit on the band. Every line here is
// beating a default that assumes a light page: the ghost variant's muted
// hover/aria-expanded fills, and --ring, which is the band's own blue and so
// leaves the focus ring invisible. The dark: hover is restated because the
// variant carries its own dark hover that a bare hover: class cannot merge.
const NAV_BUTTON =
  "text-white hover:bg-black/10 hover:text-white dark:hover:bg-black/10 " +
  "aria-expanded:bg-black/10 aria-expanded:text-white " +
  "focus-visible:border-white/70 focus-visible:ring-white/70";

// The 44px touch floor for the band's controls, which are size="sm" (h-7) —
// 26px, unreachable with a thumb. Pinned in px like the band's own h-[64px]:
// the root is 15px, so min-h-11 would be 41.25px and still miss. max-md rather
// than a min-h-0 reset at md, so nothing at all is emitted above 767.98px and
// the measured desktop band keeps its computed styles exactly, not just its
// geometry — min-height:auto on a flex item is not the same as 0.
const TOUCH_TARGET = "max-md:min-h-[44px] max-md:min-w-[44px]";

function Brand() {
  return (
    <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
      {/* Every overlay on the band darkens rather than lightens, the way the
          active nav item does — otherwise the bar reads as two blues. */}
      <span className="flex size-8 items-center justify-center rounded-lg bg-black/10">
        <Truck className="size-4.5 text-white" aria-hidden="true" />
      </span>
      {/* Shown at every width: once the search field leaves the band below md
          the row has the room, and without it a phone shows an unlabelled blue
          bar with a bare truck square. >=640 already had it. */}
      <span className="block leading-tight">
        <span className="block text-[15px] text-white">US Star</span>
        {/* Both lines are solid #ffffff: dimming the second one to white/80
            lands at 4.3:1 on the band, under the floor. Size and tracking
            carry the hierarchy instead. */}
        <span className="block text-[12px] uppercase tracking-widest text-white">TMS</span>
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
        // 15px / weight 400 / solid white, and the item fills the band's full
        // height so its overlay reads as a segment of the bar, not a chip.
        // White outline, inset: --ring is the band's own blue, so the shared
        // focus-ring utility would draw invisibly here (same reason NAV_BUTTON
        // overrides its ring below).
        "relative flex items-center gap-2 whitespace-nowrap text-[15px] text-white transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white",
        // Drawer rows are 38px (py-2 on a 23px line box) — under the touch
        // floor. min-height only grows the box, so the label sits where it
        // does now, and the 768-1279 drawer emits no rule at all.
        stacked ? "rounded-md px-[15px] py-2 max-md:min-h-[44px]" : "h-[64px] px-[15px]",
        // The active module is marked by darkening the blue underneath it, as
        // measured — but rgba(0,0,0,0.1) on that blue is 1.17:1, so a sighted
        // user cannot actually see which module they are in. The 3px white
        // underline is Materialize's own active-tab idiom, so the second signal
        // stays in period while clearing the 3:1 non-text floor. Hover is /15
        // for the same reason: /5 was 1.08:1, i.e. nothing.
        isActive(item.href)
          ? "bg-black/10 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-white"
          : "hover:bg-black/15"
      )}
    >
      {/* Icons only in the drawer: the horizontal band is text-only, and eight
          items at 15px with 15px side padding already fill the bar. */}
      {stacked && <item.icon className="size-4 shrink-0" aria-hidden="true" />}
      {item.label}
      {item.href === "/messages" && unreadMessages > 0 && (
        <span
          aria-label={`${unreadMessages} unread messages`}
          // Pinned to the light-theme --destructive: the band keeps its light
          // colors under .dark, and the dark token (#ef5350) would put this
          // number at 3.5:1.
          className="rounded-md bg-[#d32f2f] px-1.5 py-0.5 text-[12px] leading-none text-white"
        >
          {unreadMessages > 99 ? "99+" : unreadMessages}
        </span>
      )}
    </Link>
  );

  return (
    // The band: Material blue darken-3 via --primary, 64px, and the one
    // element that carries a shadow. Under .dark it goes to darken-4 rather
    // than following --primary, which lifts to blue 300 there — a 64px field
    // of that tone cannot hold white text (2.2:1). Because the band stays a
    // deep blue in both themes, everything ON it is theme-invariant and needs
    // no dark: variant of its own.
    <header className="sticky top-0 z-40 bg-primary shadow-md dark:bg-[#0d47a1]">
      {/* 64px is measured, so it is pinned in px — h-16 is 4rem, which moved
          to 60px once the root went to the spec's 15px. */}
      <div className="flex h-[64px] items-center gap-2 px-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          className={cn(NAV_BUTTON, TOUCH_TARGET, "xl:hidden")}
          onClick={() => setMenuOpen(true)}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>

        <span className="hidden xl:block">
          <Grid3x3 className="size-5 text-white/70" aria-hidden="true" />
        </span>
        <Brand />

        <nav className="ml-1 hidden items-center xl:flex">
          {items.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        {/* Search sits at the top RIGHT, as in the old system. */}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Below md the field cannot shrink far enough to fit — an input's
              automatic minimum size is its intrinsic width, so it holds ~203px
              of a 345px row and pushes the band off-screen. It moves into the
              drawer there instead. sm:w-64 already governs at md, so 768+ is
              the same 240px/320px it is today. */}
          <div className="w-48 sm:w-64 max-md:hidden lg:w-80">
            <GlobalSearch />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Refresh"
            title="Refresh"
            className={cn(NAV_BUTTON, TOUCH_TARGET)}
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
              className={cn(NAV_BUTTON, TOUCH_TARGET)}
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
                {/* No shadow: the band is the only raised surface, so the menu
                    is separated by its --border alone. */}
                <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border bg-card">
                  <div className="border-b px-3 py-2">
                    <p className="truncate text-sm">{userName}</p>
                    <p className="text-xs text-muted-foreground">{titleCase(role)}</p>
                  </div>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="focus-ring block w-full px-3 py-2 text-left text-sm hover:bg-msg-hover max-md:flex max-md:min-h-[44px] max-md:items-center"
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
          {/* The drawer is the band folded vertically — same blue, same
              darkening overlays — rather than the near-black panel it was. */}
          {/* Scrolls because eight 44px rows plus the search overrun a phone in
              landscape; inert whenever the content fits. overscroll-contain
              keeps the page behind the scrim from taking over at the ends. */}
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-1 bg-primary p-3 max-md:overflow-y-auto max-md:overscroll-contain dark:bg-[#0d47a1]">
            <div className="flex items-center justify-between pb-2">
              <Brand />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Close navigation"
                className={cn(NAV_BUTTON, TOUCH_TARGET)}
                onClick={() => setMenuOpen(false)}
              >
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>
            {/* The band drops the field below md, so the drawer carries it —
                which is what onNavigate was written for. Hidden at md and up,
                where the band still has it and this drawer must not change. */}
            <div className="pb-1 md:hidden">
              <GlobalSearch onNavigate={() => setMenuOpen(false)} />
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
