import type { LoadStatus } from "@/types/database";

// Single source of truth for the Leads → Quotes → Orders pipeline: how each
// status is labeled, colored, grouped, and which lifecycle actions it offers.

export const STATUS_LABEL: Record<LoadStatus, string> = {
  lead: "Lead",
  quote: "Quote",
  ready: "Ready",
  posted_cd: "Posted CD",
  posted_sd: "Posted SD",
  booked: "Booked",
  dispatched: "Dispatched",
  picked_up: "Picked-Up",
  in_transit: "In Transit",
  delivered: "Delivered",
  hold: "Hold",
  archived: "Archived",
  lost: "Lost",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
};

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const STATUS_VARIANT: Record<LoadStatus, BadgeVariant> = {
  lead: "outline",
  quote: "outline",
  ready: "secondary",
  posted_cd: "default",
  posted_sd: "default",
  booked: "secondary",
  dispatched: "default",
  picked_up: "default",
  in_transit: "default",
  delivered: "default",
  hold: "secondary",
  archived: "outline",
  lost: "destructive",
  invoiced: "outline",
  paid: "outline",
  cancelled: "destructive",
};

// Which pipeline stage a status belongs to (drives the three nav sections).
// A lead or quote that is put on hold, cancelled, lost or archived stays in
// ITS stage rather than jumping to Orders — otherwise a cancelled quote
// vanishes from the quote screens entirely, which is where a rep looks for
// it. The order list keeps its own hold/archived/lost tabs for orders.
export const LEAD_STATUSES: LoadStatus[] = ["lead"];
export const QUOTE_STATUSES: LoadStatus[] = ["quote"];
export const ORDER_STATUSES: LoadStatus[] = [
  "ready",
  "posted_cd",
  "posted_sd",
  "booked",
  "dispatched",
  "picked_up",
  "in_transit",
  "delivered",
  "hold",
  "archived",
  "lost",
  "invoiced",
  "paid",
  "cancelled",
];

export type PipelineStage = "lead" | "quote" | "order";

export function stageOf(status: LoadStatus): PipelineStage {
  if (LEAD_STATUSES.includes(status)) return "lead";
  if (QUOTE_STATUSES.includes(status)) return "quote";
  return "order";
}

// msgplane-style Orders sub-status tabs. `statuses: null` = the default
// "Orders" tab (active, unposted work queue). `notSigned` is derived;
// `followUpDue` filters to rows whose follow-up is due today or overdue.
// Which date the second column shows for a tab, msgplane-exact: every tab
// renames it ("Converted", "Posted", "Sent", "Signed", "Delivered"…) and pulls
// a different field. "posted" = whichever board date the load carries.
export type TabDateCol = {
  label: string;
  field:
    | "created_at"
    | "posted"
    | "contract_sent_at"
    | "date_signed"
    | "delivered_at"
    | "picked_up_at"
    | "dispatched_at"
    | "updated_at";
};

export type OrderTab = {
  key: string;
  label: string;
  statuses?: LoadStatus[];
  notSigned?: boolean;
  followUpDue?: boolean;
  // msgplane's Requests tab: posted orders that have carrier offers logged
  // in load_requests — the dispatcher's "review the offers" queue.
  hasRequests?: boolean;
  // Per-tab column variants (msgplane): the renamed date column, the Carrier
  // (assigned carrier name/phone) column, and Requests' circled offer count.
  dateCol?: TabDateCol;
  carrierCol?: boolean;
  requestCount?: boolean;
  // The tab the bare URL lands on. msgplane shows Follow-up Today FIRST in
  // the bar, but its Quotes nav link opens the Quotes tab — order in the bar
  // and default selection are different things.
  default?: boolean;
  // Restrict a shared status (hold/cancelled/archived) to records that belong
  // to this stage. Which stage a parked record came from is derived from its
  // price rather than stored: pricing is exactly what promotes a lead to a
  // quote, so "has a price" IS "was a quote". No extra column to keep in sync.
  stage?: PipelineStage;
};

// The reps' working queue on Leads and Quotes — msgplane's "Follow-up Today",
// plus the parking tabs a rep needs when a deal stalls: Hold, Cancelled
// (cancelled/lost) and Archived. `stage` scopes a tab to leads or quotes so
// a cancelled quote shows up under Quotes, not Leads.
// msgplane's Quotes/Leads modules: Follow-up Today is the FIRST (default)
// tab, there is no Cancelled tab — cancelled/lost park under Archived.
export const LEAD_TABS: OrderTab[] = [
  { key: "followup", label: "Follow-up Today", statuses: ["lead"], followUpDue: true },
  { key: "leads", label: "Leads", statuses: ["lead"], default: true },
  { key: "hold", label: "Hold", statuses: ["hold"], stage: "lead" },
  { key: "archived", label: "Archived", statuses: ["archived", "cancelled", "lost"], stage: "lead" },
];

export const QUOTE_TABS: OrderTab[] = [
  { key: "followup", label: "Follow-up Today", statuses: ["quote"], followUpDue: true },
  { key: "quotes", label: "Quotes", statuses: ["quote"], default: true },
  { key: "hold", label: "Hold", statuses: ["hold"], stage: "quote" },
  {
    key: "archived",
    label: "Archived",
    statuses: ["archived", "cancelled", "lost"],
    stage: "quote",
  },
];

// Orders tabs with msgplane's per-tab column set (audited live 2026-07-27).
export const ORDER_TABS: OrderTab[] = [
  {
    key: "orders",
    label: "Orders",
    statuses: ["ready", "booked"],
    dateCol: { label: "Converted", field: "created_at" },
  },
  {
    key: "posted_cd",
    label: "Posted CD",
    statuses: ["posted_cd"],
    dateCol: { label: "Posted", field: "posted" },
  },
  {
    key: "posted_sd",
    label: "Posted SD",
    statuses: ["posted_sd"],
    dateCol: { label: "Received", field: "created_at" },
  },
  {
    key: "requests",
    label: "Requests",
    statuses: ["posted_cd", "posted_sd", "booked"],
    hasRequests: true,
    dateCol: { label: "Posted", field: "posted" },
    requestCount: true,
  },
  {
    key: "not_signed",
    label: "Not Signed",
    notSigned: true,
    dateCol: { label: "Sent", field: "contract_sent_at" },
    carrierCol: true,
  },
  {
    key: "dispatched",
    label: "Dispatched",
    statuses: ["dispatched", "in_transit"],
    dateCol: { label: "Signed", field: "date_signed" },
    carrierCol: true,
  },
  {
    key: "picked_up",
    label: "Picked-Up",
    statuses: ["picked_up"],
    dateCol: { label: "Picked UP", field: "picked_up_at" },
    carrierCol: true,
  },
  {
    key: "delivered",
    label: "Delivered",
    statuses: ["delivered", "invoiced", "paid"],
    dateCol: { label: "Delivered", field: "delivered_at" },
    carrierCol: true,
  },
  {
    key: "hold",
    label: "Hold",
    statuses: ["hold"],
    dateCol: { label: "Signed", field: "date_signed" },
    carrierCol: true,
  },
  {
    key: "archived",
    label: "Archived",
    statuses: ["archived"],
    dateCol: { label: "Archived", field: "updated_at" },
    carrierCol: true,
  },
  {
    key: "lost",
    label: "Lost",
    statuses: ["lost", "cancelled"],
    dateCol: { label: "Converted", field: "created_at" },
    carrierCol: true,
  },
];

// Lifecycle actions available from each status. The detail page renders these
// as the header action bar; every transition is re-validated server-side.
export type OrderAction =
  | "convert_to_quote"
  | "convert_to_order"
  | "post"
  | "unpost"
  | "dispatch"
  | "resend"
  | "mark_lost"
  | "record_payment"
  | "hold"
  | "archive"
  | "reactivate";

// There is deliberately NO status-flip dispatch / picked-up / delivered
// button for ANY role, admin included. The DISPATCH button on a posted order
// opens carrier assignment — assigning the carrier is what dispatches (same
// rule as the edit form) — and picked-up / delivered / cancelled-after-
// dispatch mirror what the CARRIER reports; they'll be driven by the CD/SD
// integration when it lands. Until then, orders rest at Dispatched; that's
// the msgplane behavior the team already lives with. Button ORDER matches
// msgplane's header bar.
export const ACTIONS_BY_STATUS: Record<LoadStatus, OrderAction[]> = {
  lead: ["convert_to_quote", "mark_lost"],
  quote: ["convert_to_order", "record_payment", "mark_lost"],
  ready: ["record_payment", "post", "mark_lost", "hold"],
  posted_cd: ["dispatch", "record_payment", "resend", "unpost"],
  posted_sd: ["dispatch", "record_payment", "resend", "unpost"],
  booked: ["dispatch", "record_payment", "post", "mark_lost"],
  dispatched: ["record_payment", "unpost"],
  picked_up: ["record_payment"],
  in_transit: ["record_payment"],
  delivered: ["record_payment", "archive"],
  hold: ["reactivate", "mark_lost"],
  archived: ["reactivate"],
  lost: ["reactivate"],
  invoiced: ["record_payment", "archive"],
  paid: ["archive"],
  cancelled: ["reactivate"],
};

export function actionsFor(status: LoadStatus, role: string): OrderAction[] {
  const base = ACTIONS_BY_STATUS[status] ?? [];
  if (role !== "sales") return base;
  // Carrier assignment (dispatch) and un-dispatching are dispatch-desk work.
  return base.filter(
    (a) => a !== "dispatch" && !(a === "unpost" && status === "dispatched")
  );
}
