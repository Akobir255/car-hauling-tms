import type { LoadStatus } from "@/types/database";

// msgplane paints every status word the same #cccccc, so "cancelled" and
// "picked up" look identical and the gray sits at 1.6:1 on white. The spec's
// first deliberate departure is to keep that word's position and weight but let
// it carry a hue — one hue per status, which means this table has to be the
// only place a status colour is decided. StatusBadge renders the same statuses
// on /loads and /search; when it kept its own copy, a load on hold read brown
// in the pipeline and deep orange in the loads table.
//
// These are literal Material hexes rather than tokens: the theme carries the
// seven colors msgplane hardcoded, not a sixteen-step status ramp. Light values
// are Material 700/800 (every one clears 4.5:1 on white — the measured 500s do
// not); dark values are the 200/300 lift of the same hue. Where a spec token
// already means exactly this status, the token wins over a hex.
export const STATUS_COLORS: Record<LoadStatus, string> = {
  lead: "text-[#616161] dark:text-[#bdbdbd]",
  // Warm hues are the one place Material can't reach 4.5:1 on white — amber and
  // orange 500-900 all fail — so the two warm statuses take the darkest members
  // of their families.
  quote: "text-[#5d4037] dark:text-[#bcaaa4]",
  ready: "text-primary",
  posted_cd: "text-[#283593] dark:text-[#9fa8da]",
  posted_sd: "text-[#4527a0] dark:text-[#b39ddb]",
  booked: "text-msg-link",
  // Was byte-identical to posted_cd, which made two distinct pipeline stages
  // indistinguishable.
  dispatched: "text-[#455a64] dark:text-[#b0bec5]",
  picked_up: "text-[#00695c] dark:text-[#80cbc4]",
  in_transit: "text-[#00838f] dark:text-[#80deea]",
  delivered: "text-[#2e7d32] dark:text-[#81c784]",
  hold: "text-[#bf360c] dark:text-[#ffb74d]",
  archived: "text-muted-foreground",
  lost: "text-[#c62828] dark:text-[#ef9a9a]",
  invoiced: "text-[#6a1b9a] dark:text-[#ce93d8]",
  paid: "text-[#2e7d32] dark:text-[#81c784]",
  cancelled: "text-destructive",
};

// The same hues as a 4px stripe down the left edge of a pipeline card, so the
// stage of a row is readable before any of its words are. It lives here and not
// in the list for the reason above: a status colour is decided in one file.
//
// Where STATUS_COLORS reaches for a token, so does this — the stripe and the
// word must not drift apart. Two deliberate differences: the stripe is
// decorative and redundant (the word is right beside it), so it is not held to
// a text contrast floor; and `archived` takes a real grey instead of
// --muted-foreground, which is near-black ink and would paint a mourning bar
// down the busiest tab in the app.
export const STATUS_STRIPES: Record<LoadStatus, string> = {
  lead: "border-l-[#9e9e9e] dark:border-l-[#757575]",
  quote: "border-l-[#5d4037] dark:border-l-[#bcaaa4]",
  ready: "border-l-primary",
  posted_cd: "border-l-[#283593] dark:border-l-[#9fa8da]",
  posted_sd: "border-l-[#4527a0] dark:border-l-[#b39ddb]",
  booked: "border-l-msg-link",
  dispatched: "border-l-[#455a64] dark:border-l-[#b0bec5]",
  picked_up: "border-l-[#00695c] dark:border-l-[#80cbc4]",
  in_transit: "border-l-[#00838f] dark:border-l-[#80deea]",
  delivered: "border-l-[#2e7d32] dark:border-l-[#81c784]",
  hold: "border-l-[#bf360c] dark:border-l-[#ffb74d]",
  archived: "border-l-[#bdbdbd] dark:border-l-[#616161]",
  lost: "border-l-[#c62828] dark:border-l-[#ef9a9a]",
  invoiced: "border-l-[#6a1b9a] dark:border-l-[#ce93d8]",
  paid: "border-l-[#2e7d32] dark:border-l-[#81c784]",
  cancelled: "border-l-destructive",
};

// Records imported from msgplane carry its own vocabulary in `msgplane_status`,
// which the list renders verbatim. These are the words that mean one of ours.
const ALIASES: Record<string, LoadStatus> = {
  "on-hold-order": "hold",
  completed: "delivered",
  incomplete: "archived",
};

// Keyed on the RENDERED word, because that is all the list has: either a
// msgplane string or a LoadStatus with its underscores swapped for hyphens.
export function statusTone(word: string): string {
  const key = ALIASES[word] ?? (word.replace(/-/g, "_") as LoadStatus);
  // An unrecognised imported word is still a word being worked, so it keeps
  // msgplane's gray position at a legible weight.
  return STATUS_COLORS[key] ?? "text-muted-foreground";
}

/** The card's left stripe for a rendered status word. Keyed exactly like statusTone. */
export function statusStripe(word: string): string {
  const key = ALIASES[word] ?? (word.replace(/-/g, "_") as LoadStatus);
  // An imported word nobody has mapped yet gets the neutral border rather than
  // a hue that would claim a stage it may not be in.
  return STATUS_STRIPES[key] ?? "border-l-border";
}
