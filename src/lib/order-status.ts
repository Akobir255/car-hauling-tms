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
export type OrderTab = {
  key: string;
  label: string;
  statuses?: LoadStatus[];
  notSigned?: boolean;
  followUpDue?: boolean;
};

// The reps' working queue on Leads and Quotes — msgplane's "Follow-up Today".
export const LEAD_TABS: OrderTab[] = [
  { key: "leads", label: "Leads", statuses: ["lead"] },
  { key: "followup", label: "Follow-up Today", statuses: ["lead"], followUpDue: true },
];

export const QUOTE_TABS: OrderTab[] = [
  { key: "quotes", label: "Quotes", statuses: ["quote"] },
  { key: "followup", label: "Follow-up Today", statuses: ["quote"], followUpDue: true },
];

export const ORDER_TABS: OrderTab[] = [
  { key: "orders", label: "Orders", statuses: ["ready", "booked"] },
  { key: "posted_cd", label: "Posted CD", statuses: ["posted_cd"] },
  { key: "posted_sd", label: "Posted SD", statuses: ["posted_sd"] },
  { key: "not_signed", label: "Not Signed", notSigned: true },
  { key: "dispatched", label: "Dispatched", statuses: ["dispatched", "in_transit"] },
  { key: "picked_up", label: "Picked-Up", statuses: ["picked_up"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered", "invoiced", "paid"] },
  { key: "hold", label: "Hold", statuses: ["hold"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
  { key: "lost", label: "Lost", statuses: ["lost", "cancelled"] },
];

// Lifecycle actions available from each status. The detail page renders these
// as the header action bar; every transition is re-validated server-side.
export type OrderAction =
  | "convert_to_quote"
  | "convert_to_order"
  | "post"
  | "unpost"
  | "resend"
  | "dispatch"
  | "mark_picked_up"
  | "mark_delivered"
  | "mark_lost"
  | "record_payment"
  | "hold"
  | "archive"
  | "reactivate";

export const ACTIONS_BY_STATUS: Record<LoadStatus, OrderAction[]> = {
  lead: ["convert_to_quote", "mark_lost"],
  quote: ["convert_to_order", "record_payment", "mark_lost"],
  ready: ["post", "record_payment", "mark_lost", "hold"],
  posted_cd: ["dispatch", "record_payment", "resend", "unpost"],
  posted_sd: ["dispatch", "record_payment", "resend", "unpost"],
  booked: ["post", "dispatch", "record_payment", "mark_lost"],
  dispatched: ["mark_picked_up", "record_payment", "unpost"],
  picked_up: ["mark_delivered", "record_payment"],
  in_transit: ["mark_delivered", "record_payment"],
  delivered: ["record_payment", "archive"],
  hold: ["reactivate", "mark_lost"],
  archived: ["reactivate"],
  lost: ["reactivate"],
  invoiced: ["record_payment", "archive"],
  paid: ["archive"],
  cancelled: ["reactivate"],
};

// Dispatch / picked-up / delivered mirror what the carrier reports, so they
// belong to the dispatch desk — sales never sees those buttons (and the
// server actions enforce the same rule independently). Un-dispatching is
// likewise desk-only; unposting a merely-posted order is fine for sales.
export const DISPATCH_DESK_ACTIONS: OrderAction[] = [
  "dispatch",
  "mark_picked_up",
  "mark_delivered",
];

export function actionsFor(status: LoadStatus, role: string): OrderAction[] {
  const base = ACTIONS_BY_STATUS[status] ?? [];
  if (role !== "sales") return base;
  return base.filter(
    (a) => !DISPATCH_DESK_ACTIONS.includes(a) && !(a === "unpost" && status === "dispatched")
  );
}
