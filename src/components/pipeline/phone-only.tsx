"use client";

import { useSyncExternalStore } from "react";

// The `md` breakpoint, as a query. Media-query `rem` resolves against the
// initial 16px, not the 15px root, so this is the same 768px the `md:`
// utilities use.
const PHONE = "(max-width: 47.99rem)";

const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

const isPhone = () => window.matchMedia(PHONE).matches;

/**
 * Mounts its children only on a phone.
 *
 * The list renders two layouts and lets CSS pick one. That is fine for markup,
 * but `display:none` does not stop a client component from hydrating: without
 * this gate the desk pays for a RowCheckbox, two RowMessageButtons, a
 * NotesQuickButton and a QuickView on every one of the 100 rows it will never
 * show — ~600 client instances on the screen this app lives on.
 *
 * The server snapshot is `false`, so the desk never renders these at all and
 * the phone mounts them right after hydration. Only the small controls are
 * gated, never the card's content: the phone still gets the whole list in the
 * server HTML, and the chips fill their already-reserved boxes a beat later
 * rather than the list arriving blank.
 *
 * What this does NOT remove is the cards' own static markup from the desktop
 * HTML — roughly 3KB per row before compression, and highly repetitive. Taking
 * that back too would mean rendering the cards only after hydration, which
 * trades an invisible desktop cost for a visibly empty list on the device this
 * work is for. Measure before re-litigating.
 */
export function PhoneOnly({ children }: { children: React.ReactNode }) {
  const phone = useSyncExternalStore(subscribe, isPhone, () => false);
  return phone ? <>{children}</> : null;
}
