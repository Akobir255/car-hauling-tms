import { MANAGER_LOADS_CONTACT_TABLE, SALES_LOADS_CONTACT_TABLE } from "@/lib/loads-table";
import Link from "next/link";
import { CalendarCheck2, Inbox, Phone, Plus, User, Users } from "lucide-react";
import { VehiclePhoto } from "@/components/vehicle-photo";
import { RowMessageButton } from "@/components/messaging/row-message-buttons";
import { NotesQuickButton } from "@/components/messaging/notes-quick";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { phoneDigits, suppressedAmong } from "@/lib/messaging/suppression";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatPhone, formatRelativeTime } from "@/lib/format";
import { daysAgoIso } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { SelectionProvider } from "@/components/pipeline/selection-context";
import { RepSelect } from "@/components/pipeline/rep-select";
import { QuickView, type QuickViewData } from "@/components/pipeline/quick-view";
import { FilterBar, type FilterValues } from "@/components/pipeline/filter-bar";
import { RowCheckbox, SelectAllCheckbox } from "@/components/pipeline/row-checkbox";
import { PhoneOnly } from "@/components/pipeline/phone-only";
import { statusStripe, statusTone } from "@/components/pipeline/status-tone";
import { BulkActionBar } from "@/components/pipeline/bulk-action-bar";
import { EmptyState } from "@/components/empty-state";
import {
  LEAD_STATUSES,
  LEAD_TABS,
  NOT_SIGNED_STATUSES,
  ORDER_STATUSES,
  ORDER_TABS,
  QUOTE_STATUSES,
  QUOTE_TABS,
  type OrderTab,
  type PipelineStage,
} from "@/lib/order-status";
import { VEHICLE_TYPE_LABELS } from "@/types/database";
import type { Load, LoadStatus, LoadVehicle, Profile } from "@/types/database";

// A load as the _contact views return it: the row, plus when this shipper was
// last reached. Not on `loads` itself — it belongs to the customer (0039).
type PipelineLoad = Load & {
  customer_last_sms_at: string | null;
  customer_last_email_at: string | null;
};

// msgplane money style: "Tariff:$500" — whole dollars, no separators.
const money0 = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v)}`);

// One money figure. msgplane sets these as plain "Tariff:$500" text at body
// size and body weight, which makes the price the least visible thing in a row
// that exists to price freight. Here each is a pill: label small and
// letter-spaced, figure a size up at weight 700 — 700 and not 600 because only
// the 400 and 700 Lato faces are loaded, so semibold would be synthesised.
function MoneyPill({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: number | null | undefined;
  tone: "tariff" | "deposit" | "carrier";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "flex w-full items-baseline justify-between gap-2 rounded-full px-2 py-0.5 leading-tight",
        tone === "tariff" && "bg-ord-tariff-bg text-ord-tariff",
        tone === "deposit" && "bg-ord-deposit-bg text-ord-deposit",
        tone === "carrier" && "bg-ord-carrier-bg text-ord-carrier"
      )}
    >
      <span className="text-[12px] uppercase tracking-wide">{label}</span>
      <span className="text-[15px] font-bold tabular-nums">{money0(value)}</span>
    </span>
  );
}

// The row's pricing summary, stacked: what the customer pays, what they have
// paid, and — managers only — what the carrier gets. Carrier pay is the one
// figure here that may not be a fact yet: until `carrier_pay_confirmed` it is
// still customer_rate − deposit, i.e. the offer posted to the boards (0038), so
// the pill says so on hover rather than presenting an offer as a settlement.
// Fixed width, because three pills of differing content should still line up
// down the column.
function PriceBlock({
  load,
  canSeeMargin,
  className,
}: {
  load: Load;
  canSeeMargin: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex w-[136px] flex-col gap-1", className)}>
      <MoneyPill label="Tariff" value={load.customer_rate} tone="tariff" />
      <MoneyPill label="Deposit" value={load.deposit_amount} tone="deposit" />
      {canSeeMargin && load.carrier_pay != null && (
        <MoneyPill
          label="Carrier"
          value={load.carrier_pay}
          tone="carrier"
          title={
            load.carrier_pay_confirmed
              ? "Confirmed carrier pay"
              : "Offer posted to the boards — not a confirmed settlement"
          }
        />
      )}
    </div>
  );
}

// The order's OTHER human. msgplane keeps the pickup and delivery contacts on
// the edit page only, and the lane tags that used to hold this row's second
// line are now the price block — so the second contact surfaces here instead:
// whoever is actually standing at the truck. Falls back to the account name,
// which is the company behind a personal contact and the one thing a rep needs
// when two shippers share a first name.
type SecondaryContact = { label: string; name: string | null; phone: string | null };

const secondaryContactFor = (
  load: Load,
  customer: { company_name: string | null }
): SecondaryContact | null => {
  const end = (kind: "pickup" | "delivery"): SecondaryContact | null => {
    const name = kind === "pickup" ? load.pickup_contact_name : load.delivery_contact_name;
    const phone =
      (kind === "pickup" ? load.pickup_contact_phone : load.delivery_contact_phone) ??
      (kind === "pickup" ? load.pickup_contact_cell : load.delivery_contact_cell);
    return name || phone ? { label: kind, name, phone } : null;
  };
  return (
    end("pickup") ??
    end("delivery") ??
    (customer.company_name ? { label: "account", name: customer.company_name, phone: null } : null)
  );
};

// Rendered under the primary contact, one type step down: this is context, not
// the person a rep is calling.
function SecondaryContactLine({ contact }: { contact: SecondaryContact }) {
  return (
    <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <Users className="size-3.5 shrink-0 text-ord-accent" aria-hidden="true" />
      <span className="shrink-0 rounded-full bg-ord-chip px-1.5 text-[12px] uppercase tracking-wide">
        {contact.label}
      </span>
      {contact.name && <span className="min-w-0 truncate">{contact.name}</span>}
      {contact.phone && (
        <span className="shrink-0 tabular-nums">{formatPhone(contact.phone)}</span>
      )}
    </p>
  );
}

// Shared list for Leads / Quotes / Orders — one query path, msgplane column
// layout. Orders get sub-status tabs; Leads and Quotes get the working-queue
// pair (All | Follow-up Today).
// Rows per page, matching the list this replaces.
const PAGE_SIZE = 100;

export async function PipelineList({
  stage,
  title,
  description: _description, // kept in the API; msgplane lists carry no blurb
  tab,
  rep,
  page: pageParam,
  filters = {},
}: {
  stage: PipelineStage;
  title: string;
  description: string;
  tab?: string;
  rep?: string;
  page?: string;
  filters?: FilterValues;
}) {
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const profile = await requireProfile();
  const supabase = await createClient();
  const canSeeMargin = profile.role === "admin" || profile.role === "dispatcher";
  // Both are views: base-table select("*") would hit the revoked margin
  // columns; loads_full carries them for managers, the safe view hides them.
  // The _contact pair: the same two views with the shipper's last-texted stamp
  // joined on (0039), so recency is a column here instead of an id list.
  const table = canSeeMargin ? MANAGER_LOADS_CONTACT_TABLE : SALES_LOADS_CONTACT_TABLE;

  const stageStatuses: LoadStatus[] =
    stage === "lead" ? LEAD_STATUSES : stage === "quote" ? QUOTE_STATUSES : ORDER_STATUSES;
  const tabs: OrderTab[] =
    stage === "order" ? ORDER_TABS : stage === "quote" ? QUOTE_TABS : LEAD_TABS;
  // Bar ORDER and DEFAULT selection are different things: Follow-up Today is
  // drawn first, but a bare /quotes opens the Quotes tab (msgplane behavior).
  const defaultTab = tabs.find((t) => t.default) ?? tabs[0];
  const activeTab = tabs.find((t) => t.key === tab) ?? defaultTab;

  // The 24-hour line that separates Quotes from Follow-up. Read once here — the
  // clock is impure, and a query builder runs during render, so each tab's
  // count would otherwise be measured against a slightly different "now".
  const dayAgoIso = daysAgoIso(1);

  // Age of the RECORD, not of the last touch: updated_at moves on any save, so
  // a quote somebody merely opened would drop out of the list they were
  // building. Read once here — the clock is impure, and a query builder runs
  // during render.
  const ageDays = Number(filters.age);
  const ageCutoffIso = Number.isFinite(ageDays) && ageDays > 0 ? daysAgoIso(ageDays) : null;

  const smsDays = Number(filters.sms);
  const smsCutoffIso = Number.isFinite(smsDays) && smsDays > 0 ? daysAgoIso(smsDays) : null;

  // Which orders have carrier offers logged — feeds msgplane's Requests tab
  // (filter, count badge, and the circled per-row offer count). Only the
  // order stage pays for this query; RLS scopes it.
  const { data: reqRows } =
    stage === "order"
      ? await supabase.from("load_requests").select("load_id")
      : { data: [] as { load_id: string }[] };
  const requestLoadIds = [...new Set((reqRows ?? []).map((r) => r.load_id))];
  const requestCountByLoad = new Map<string, number>();
  for (const r of reqRows ?? []) {
    requestCountByLoad.set(r.load_id, (requestCountByLoad.get(r.load_id) ?? 0) + 1);
  }

  // Filter support. Opt-out lives on the CUSTOMER and documents/vehicle
  // condition on child tables, so each is resolved to an id list first and
  // applied to the loads query. These sets are small in practice (opt-outs
  // and files are the exception, not the rule).
  const NONE = ["00000000-0000-0000-0000-000000000000"];
  let optOutCustomerIds: string[] | null = null;
  if (filters.optout) {
    let cq = supabase.from("customers").select("id");
    // Narrowed to the rep's own book, matching the loads query below: the
    // result is the same either way, but since 0037 an unscoped read would
    // drag every opted-out shipper in the company into a URL filter.
    if (profile.role === "sales") cq = cq.eq("sales_owner_id", profile.id);
    if (filters.optout === "sms") cq = cq.eq("sms_opt_out", true);
    else if (filters.optout === "email") cq = cq.eq("email_opt_out", true);
    else if (filters.optout === "blacklisted") cq = cq.eq("blacklisted", true);
    else cq = cq.or("sms_opt_out.eq.true,email_opt_out.eq.true,blacklisted.eq.true");
    const { data } = await cq.limit(20000);
    optOutCustomerIds = (data ?? []).map((c) => c.id);
  }

  let docLoadIds: string[] | null = null;
  if (filters.docs) {
    const { data } = await supabase
      .from("documents")
      .select("entity_id")
      .eq("entity_type", "load")
      .limit(20000);
    docLoadIds = [...new Set((data ?? []).map((d) => d.entity_id as string))];
  }

  let nonRunningLoadIds: string[] | null = null;
  if (filters.vehicles === "nonrunning") {
    const { data } = await supabase
      .from("load_vehicles")
      .select("load_id")
      .eq("condition", "non_running")
      .limit(20000);
    nonRunningLoadIds = [...new Set((data ?? []).map((v) => v.load_id as string))];
  }

  // One place that knows how a tab is filtered — used by the page query AND
  // by each tab's exact count, so the number on the tab and the rows in the
  // table can never disagree.
  type LoadQuery = ReturnType<ReturnType<typeof supabase.from>["select"]>;

  const applyUserFilters = (q: LoadQuery): LoadQuery => {
    let out = q;
    if (optOutCustomerIds) {
      out =
        filters.optout === "none"
          ? optOutCustomerIds.length
            ? out.not("customer_id", "in", `(${optOutCustomerIds.join(",")})`)
            : out
          : out.in("customer_id", optOutCustomerIds.length ? optOutCustomerIds : NONE);
    }
    // "Sent" is two facts stored two ways: contract_sent_at is stamped by sends
    // this system performed, contract_sent is the flag carried by imported
    // orders whose contract went out on a date the old system never recorded.
    // Either one counts, or 141 orders with a contract out sit in "Never sent".
    if (filters.signed === "yes") out = out.not("date_signed", "is", null);
    else if (filters.signed === "sent") {
      out = out.or("contract_sent_at.not.is.null,contract_sent.is.true").is("date_signed", null);
    } else if (filters.signed === "no") {
      out = out.is("contract_sent_at", null).eq("contract_sent", false);
    }

    if (docLoadIds) {
      out =
        filters.docs === "yes"
          ? out.in("id", docLoadIds.length ? docLoadIds : NONE)
          : docLoadIds.length
            ? out.not("id", "in", `(${docLoadIds.join(",")})`)
            : out;
    }
    if (filters.vehicles === "enclosed") out = out.eq("transport_type", "enclosed");
    else if (nonRunningLoadIds) {
      out = out.in("id", nonRunningLoadIds.length ? nonRunningLoadIds : NONE);
    }

    if (ageCutoffIso) out = out.lte("created_at", ageCutoffIso);

    // A shipper never texted counts as "not texted in 7 days" — they are the
    // most eligible of all, and leaving them out would hide the whole untouched
    // half of the book behind a filter whose name says they belong in it.
    if (filters.sms === "never") out = out.is("customer_last_sms_at", null);
    else if (smsCutoffIso) {
      out = out.or(
        `customer_last_sms_at.is.null,customer_last_sms_at.lte.${smsCutoffIso}`
      );
    }
    return out;
  };

  const applyTabFilter = (q: LoadQuery, t: OrderTab): LoadQuery => {
    let out = q;
    if (t.notSigned) {
      // Not Signed = a contract WAS SENT and is still unsigned, on a live
      // order. Not "every order without a signature" — that would sweep in
      // every archived record ever imported.
      out = out
        .in("status", NOT_SIGNED_STATUSES)
        .not("contract_sent_at", "is", null)
        .is("date_signed", null);
    } else {
      out = out.in("status", t.statuses ?? stageStatuses);
    }
    if (t.postedTo === "cd") out = out.not("posted_to_central_dispatch_at", "is", null);
    else if (t.postedTo === "sd") out = out.not("posted_to_super_dispatch_at", "is", null);
    if (t.hasRequests) {
      // .in() with an empty list matches everything — guard with an impossible id.
      out = out.in(
        "id",
        requestLoadIds.length ? requestLoadIds : ["00000000-0000-0000-0000-000000000000"]
      );
    }
    // Parked tabs (hold/archived/lost) are shared across stages. Which stage a
    // record was parked FROM is STORED on the row (loads.pipeline_stage,
    // migration 0030) — it is not derivable from price, because orders are
    // priced too. That inference is exactly how 365 archived ORDERS ended up
    // filed under Quotes > Archived beside 118 real archived quotes.
    if (t.stage) out = out.eq("pipeline_stage", t.stage);
    // Quotes vs Follow-up is a question about ARRIVAL, not about a reminder:
    // under 24 hours old is still to be quoted, older than that has to be
    // chased. Filtering Follow-up on follow_up_at put 18,278 of the same 18,505
    // records in both tabs.
    if (t.arrived === "within24h") out = out.gte("created_at", dayAgoIso);
    else if (t.arrived === "before24h") out = out.lt("created_at", dayAgoIso);
    if (canSeeMargin && rep) out = out.eq("sales_owner_id", rep);
    // A rep's pipeline is still THEIR pipeline. Until migration 0037 the row
    // policy made that true on its own; now that every record is readable, the
    // list has to ask for its own rows or a rep opens Leads to the whole
    // company's book. Search is the deliberate way to reach somebody else's.
    if (profile.role === "sales") out = out.eq("sales_owner_id", profile.id);
    return applyUserFilters(out);
  };

  // 100 rows a page, like the system this replaces.
  const from = page * PAGE_SIZE;
  let query = applyTabFilter(supabase.from(table).select("*"), activeTab).range(
    from,
    from + PAGE_SIZE - 1
  );
  // Newest arrival first, on every tab without exception. The record that came
  // in most recently is the top row, and the list runs back from there to 2022.
  query = query.order("created_at", { ascending: false });

  // Exact per-tab counts. head:true fetches no rows, so this stays correct
  // past PostgREST's 1000-row response cap.
  const countPromises = tabs.map((t) =>
    applyTabFilter(supabase.from(table).select("id", { count: "exact", head: true }), t)
  );

  const [{ data, error }, ...countResults] = await Promise.all([query, ...countPromises]);
  const loads = (data ?? []) as PipelineLoad[];
  const countByTab = new Map(
    tabs.map((t, i) => [t.key, (countResults[i] as { count: number | null }).count ?? 0])
  );
  const tabCount = (t: OrderTab) => countByTab.get(t.key) ?? 0;
  const totalRows = tabCount(activeTab);

  const loadIds = loads.map((l) => l.id);
  const customerIds = [...new Set(loads.map((l) => l.customer_id).filter(Boolean))];
  const carrierIds = activeTab.carrierCol
    ? [...new Set(loads.map((l) => l.carrier_id).filter(Boolean) as string[])]
    : [];

  const [
    { data: customers },
    { data: reps },
    { data: vehicles },
    { data: unreadRows },
    { data: noteRows },
    { data: carrierRows },
  ] = await Promise.all([
      customerIds.length
        ? supabase
            .from("customers")
            // company_name feeds the row's secondary contact line when the
            // order carries no pickup/delivery contact of its own.
            .select(
              "id, contact_name, company_name, phone, email, sms_opt_out, email_opt_out, blacklisted"
            )
            .in("id", customerIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              contact_name: string;
              company_name: string | null;
              phone: string | null;
              email: string | null;
              sms_opt_out: boolean;
              email_opt_out: boolean;
              blacklisted: boolean;
            }[],
          }),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      loadIds.length
        ? supabase.from("load_vehicles").select("*").in("load_id", loadIds)
        : Promise.resolve({ data: [] as LoadVehicle[] }),
      // Unread inbound per customer — msgplane's per-row message badge. Only
      // unread rows are fetched, so this stays tiny.
      customerIds.length
        ? supabase
            .from("messages")
            .select("customer_id")
            .eq("direction", "inbound")
            .is("read_at", null)
            .in("customer_id", customerIds)
        : Promise.resolve({ data: [] as { customer_id: string | null }[] }),
      loadIds.length
        ? supabase.from("load_notes").select("load_id").in("load_id", loadIds)
        : Promise.resolve({ data: [] as { load_id: string }[] }),
      // The Carrier column (Not Signed / Dispatched / Picked-Up / Hold /
      // Archived tabs): assigned carrier's name + phone, msgplane-style.
      carrierIds.length
        ? supabase.from("carriers").select("id, company_name, phone").in("id", carrierIds)
        : Promise.resolve({
            data: [] as { id: string; company_name: string; phone: string | null }[],
          }),
    ]);

  // The do-not-text list is keyed by phone number, so it flags the same human
  // arriving as a brand-new row from a lead generator — which the per-row
  // sms_opt_out flag cannot. Merged in here so the row shows "opted out"
  // BEFORE a rep drafts a text that the send guard would refuse anyway.
  const suppressedPhones = await suppressedAmong((customers ?? []).map((c) => c.phone));
  const customerById = new Map(
    (customers ?? []).map((c) => [
      c.id,
      { ...c, sms_opt_out: c.sms_opt_out || suppressedPhones.has(phoneDigits(c.phone)) },
    ])
  );
  const carrierById = new Map(
    ((carrierRows ?? []) as { id: string; company_name: string; phone: string | null }[]).map(
      (c) => [c.id, c]
    )
  );
  const repById = new Map(
    ((reps ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((r) => [r.id, r])
  );
  const vehiclesByLoad = new Map<string, LoadVehicle[]>();
  for (const v of (vehicles ?? []) as LoadVehicle[]) {
    const list = vehiclesByLoad.get(v.load_id) ?? [];
    list.push(v);
    vehiclesByLoad.set(v.load_id, list);
  }
  const unreadByCustomer = new Map<string, number>();
  for (const row of unreadRows ?? []) {
    if (!row.customer_id) continue;
    unreadByCustomer.set(row.customer_id, (unreadByCustomer.get(row.customer_id) ?? 0) + 1);
  }
  const notesByLoad = new Map<string, number>();
  for (const row of noteRows ?? []) {
    notesByLoad.set(row.load_id, (notesByLoad.get(row.load_id) ?? 0) + 1);
  }

  const basePath = stage === "lead" ? "/leads" : stage === "quote" ? "/quotes" : "/orders";
  const tabHref = (tabKey: string, toPage = 0) => {
    const params = new URLSearchParams();
    if (tabKey !== defaultTab.key) params.set("tab", tabKey);
    if (rep) params.set("rep", rep);
    // Carry the filters. This built the URL from scratch, and it is what the
    // tab strip AND both pager arrows link to — so narrowing a list and then
    // turning the page silently handed back the unfiltered one. Every filter
    // on the bar looked broken the moment you moved off page one.
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    if (toPage > 0) params.set("page", String(toPage));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // Rendered in the BUSINESS timezone (like msgplane shows ET), not the
  // viewer's — the team is remote, the freight is not.
  const businessTz = (process.env.BUSINESS_TIMEZONE || "America/New_York").trim();
  const dateTime = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        timeZone: businessTz,
      }),
      // Leading-zero hour, exactly like the system this replaces ("04:56 PM").
      time: d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: businessTz,
      }),
    };
  };

  // Date-only columns are calendar dates — parse locally so "2026-08-03"
  // never renders as Aug 2 in US timezones.
  const usDateOnly = (v: string | null) => {
    const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : "—";
  };
  // msgplane status text under the ID: lowercase and hyphenated; statusTone
  // decides its colour.
  // Imported records show the OLD system's exact word (completed / lost /
  // incomplete / on-hold-order); anything created here shows our own status.
  const statusText = (load: Load) => {
    if (load.msgplane_status) return load.msgplane_status;
    // The RECORD's stage, not the list's: `stage` is the page you are on, so a
    // held quote read "on-hold-order" whenever it surfaced in an order list.
    if (load.status === "hold" && load.pipeline_stage === "order") return "on-hold-order";
    return load.status.replace(/_/g, "-");
  };

  // The tab's renamed date column value: timestamps get the 2-line
  // date + time treatment, date-only fields a single line.
  const tabDate = (load: Load): { date: string; time: string | null } | null => {
    const field = stage === "order" ? (activeTab.dateCol?.field ?? "created_at") : "created_at";
    const raw =
      field === "posted"
        ? (load.posted_to_central_dispatch_at ?? load.posted_to_super_dispatch_at)
        : ((load as unknown as Record<string, string | null>)[field] ?? null);
    if (!raw) return null;
    if (raw.includes("T")) {
      const dt = dateTime(raw);
      return { date: dt.date, time: dt.time };
    }
    return { date: usDateOnly(raw), time: null };
  };

  // Built in one place because two layouts now render the same load: the
  // desktop table row and the mobile card. Drift here would show a rep
  // different facts depending on which device they opened.
  const quickViewFor = (
    load: Load,
    customer: NonNullable<ReturnType<typeof customerById.get>>,
    rp: ReturnType<typeof repById.get>,
    loadVehicles: LoadVehicle[]
  ): QuickViewData => ({
    loadId: load.id,
    loadNumber: load.load_number,
    status: statusText(load),
    customerName: customer.contact_name,
    phone: customer.phone,
    email: customer.email,
    origin: [load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).join(" "),
    destination: [load.delivery_city, load.delivery_state, load.delivery_zip]
      .filter(Boolean)
      .join(" "),
    vehicles:
      loadVehicles
        .map((v) => [v.year, v.make, v.model].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(", ") || "—",
    tariff: load.customer_rate,
    deposit: load.deposit_amount,
    carrierPay: canSeeMargin ? load.carrier_pay : null,
    firstAvail: load.pickup_ready_date,
    shipperInfo: load.shipper_info,
    notes: load.notes,
    assignedTo: rp ? rp.full_name || rp.email : null,
  });

  // Eight columns every stage draws — select, ID, date, notes, assigned,
  // shipper, vehicles, pricing — then the tail: orders add 1st Avail and, on
  // the parked/dispatched tabs, Carrier; quotes and leads add Est. Ship and
  // Status.
  const colCount = 8 + (stage === "order" ? (activeTab.carrierCol ? 2 : 1) : 2);

  // Shared by the table's empty row and the card list's.
  const emptyState = activeTab.arrived === "before24h" ? (
    <EmptyState
      icon={CalendarCheck2}
      title="Queue clear"
      hint={`Nothing older than a day is waiting. New ${stage}s move here 24 hours after they arrive.`}
    />
  ) : (
    <EmptyState
      icon={Inbox}
      title="Nothing here yet"
      hint={`New ${stage}s will show up in this list.`}
      action={
        <Button size="sm" className="h-12 md:h-7" render={<Link href="/loads/new" />}>
          New {stage}
        </Button>
      }
    />
  );

  const repsForBar = ((reps ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((r) => ({
    id: r.id,
    name: r.full_name || r.email,
  }));

  return (
    <SelectionProvider>
    <div className="space-y-4">
      {/* No page title block — msgplane's lists open straight into the tab
          bar; the floating "+" covers quick-create. */}
      <h1 className="sr-only">{title}</h1>

      {/* msgplane tab bar: plain labels, coral active chip, a count badge
          ONLY where attention is needed (their Issues-style badge). */}
      {tabs.length > 1 && (
        // Below md the controls drop to their own line rather than starving
        // the tab strip, which carries overflow-x-auto and so has no automatic
        // minimum size of its own to defend with.
        <div className="flex flex-wrap items-center justify-between gap-3 pb-1 md:flex-nowrap">
          <div className="flex items-center gap-2 overflow-x-auto">
            {tabs.map((t) => {
              const active = activeTab.key === t.key;
              const count = tabCount(t);
              // No badge on the follow-up queue. Nearly every open quote is due
              // or overdue, so the number reads in the thousands — it tells a
              // rep nothing they can act on and the old system never showed it.
              const showBadge = t.badge && t.arrived !== "before24h" && count > 0;
              return (
                <Link
                  key={t.key}
                  href={tabHref(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // The measured tab is a white chip, 14px, padding 1px 3px.
                    // That leaves a 22px pointer target, so a 24px floor is
                    // added — it moves the chip's edge, never its ink. On a
                    // phone the same chip is the list's primary navigation, so
                    // it takes a 45px thumb target until md hands the mouse
                    // geometry back. (The root is 15px: min-h-11 is 41px.)
                    "focus-ring flex min-h-12 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-px text-sm transition-colors md:min-h-6 md:px-[3px]",
                    active
                      ? "bg-msg-selected text-msg-selected-foreground"
                      : "text-foreground hover:bg-msg-hover"
                  )}
                >
                  {t.label}
                  {showBadge && (
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[12px] leading-none tabular-nums",
                        // On the coral the badge darkens rather than picking up
                        // a second hue — msgplane's own active-state idiom.
                        active
                          ? "bg-black/10 text-msg-selected-foreground"
                          : "bg-destructive/10 text-destructive-ink"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          {/* msgplane's top-right list controls: rep filter + "0-100 ‹ ›". */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground md:shrink-0">
            {canSeeMargin && (
              <RepSelect reps={repsForBar} current={rep} profileId={profile.id} />
            )}
            <span className="tabular-nums">
              {totalRows === 0 ? "0-0" : `${from + 1}-${Math.min(from + PAGE_SIZE, totalRows)}`}
              {/* Was muted/70, which composites to msgplane's own 2.7:1 gray. */}
              <span className="ml-1">of {totalRows}</span>
            </span>
            {/* Two single-glyph targets 8px apart, and a mis-tap silently
                loads a different 100 records — so below md each takes a 45px
                box. md:inline + md:size-auto + md:px-1 is the current glyph. */}
            {page > 0 ? (
              <Link
                href={tabHref(activeTab.key, page - 1)}
                aria-label="Previous page"
                className="inline-flex size-12 items-center justify-center text-[15px] hover:text-foreground md:inline md:size-auto md:px-1"
              >
                ‹
              </Link>
            ) : (
              <span
                className="inline-flex size-12 items-center justify-center text-[15px] opacity-30 md:inline md:size-auto md:px-1"
                aria-hidden="true"
              >
                ‹
              </span>
            )}
            {from + PAGE_SIZE < totalRows ? (
              <Link
                href={tabHref(activeTab.key, page + 1)}
                aria-label="Next page"
                className="inline-flex size-12 items-center justify-center text-[15px] hover:text-foreground md:inline md:size-auto md:px-1"
              >
                ›
              </Link>
            ) : (
              <span
                className="inline-flex size-12 items-center justify-center text-[15px] opacity-30 md:inline md:size-auto md:px-1"
                aria-hidden="true"
              >
                ›
              </span>
            )}
          </div>
        </div>
      )}

      <FilterBar values={filters} matched={totalRows} />

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* The region itself is now unframed: each ROW is the card, so a box
          around the whole list would put a border immediately outside another
          border. (msgplane frames the list and rules the rows — this is the one
          structural place the two systems disagree on purpose.)
          Ten columns have a min-content width well past a phone's, so below md
          this whole region is replaced by the card list under it. */}
      <div className="hidden overflow-x-auto pb-1 md:block">
        {/* border-separate, not collapse: the 8px of vertical border-spacing is
            what turns rows into free-standing cards, and a collapsed table
            cannot hold a gap between them.
            Cells are pinned in px: the file also carries 12px sub-lines, and a
            rem step would drift away from them if the root size ever moves. */}
        <table className="w-full border-separate border-spacing-x-0 border-spacing-y-2 text-[14px]">
          <thead>
            {/* Same labels and same per-tab renaming as msgplane (the date
                column becomes Converted/Posted/Sent/Signed/Delivered…, and the
                parked/dispatched tabs add a Carrier column), set differently:
                brown Title-case is that system's most recognisable tell, so
                these are blue-grey, 12px, uppercase and letter-spaced. Pricing
                now occupies the slot the Orig/Dest tags held, on both column
                layouts, so there is no second money column at the end.
                The th override stays: the UA sheet bolds th and preflight never
                resets it, so this is not the global weight it undoes. */}
            <tr className="text-left [&>th:first-child]:px-2 [&>th]:border-b [&>th]:px-3 [&>th]:pb-2 [&>th]:text-[12px] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-ord-head">
              <th className="w-8">
                <SelectAllCheckbox ids={loadIds} />
              </th>
              <th>ID</th>
              <th>{stage === "order" ? (activeTab.dateCol?.label ?? "Converted") : "Quoted"}</th>
              <th>Notes</th>
              <th>Assigned to</th>
              <th>Shipper</th>
              <th>Vehicles</th>
              <th>Pricing</th>
              {stage === "order" ? (
                <>
                  <th>1st. Avail</th>
                  {activeTab.carrierCol && <th>Carrier</th>}
                </>
              ) : (
                <>
                  <th>Est. Ship</th>
                  <th>Status</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {loads.map((load) => {
              const customer = customerById.get(load.customer_id);
              const rp = load.sales_owner_id ? repById.get(load.sales_owner_id) : undefined;
              const loadVehicles = vehiclesByLoad.get(load.id) ?? [];
              const colDate = tabDate(load);
              const rowCarrier = load.carrier_id ? carrierById.get(load.carrier_id) : undefined;
              const rowSecondary = customer ? secondaryContactFor(load, customer) : null;
              return (
                // A card, not a striped row: the border, the 2px lift and the
                // status stripe are drawn on the CELLS, because the geometry has
                // to stay a table (ten columns aligned down 100 rows is what
                // makes the list scannable) while reading as a stack of cards.
                // Only the left edge takes a colour — the stage of the row, from
                // the same table that colours the word beside it.
                // The 92px is a minimum on a table row, so tall rows still grow.
                <tr
                  key={load.id}
                  className={cn(
                    "group h-[92px] align-top",
                    "[&>td]:border-y [&>td]:bg-card [&>td]:px-3 [&>td]:py-4 [&>td]:align-top [&>td]:transition-colors",
                    // Negative spread, and it matters: the shadow is drawn per
                    // CELL (a <tr> is not a reliable box-shadow host outside
                    // Chrome), so a blur that reaches sideways paints a seam at
                    // every cell edge and the card reads as nine boxes. Pulling
                    // the spread back by the blur radius keeps the drop under
                    // the row and nothing at its internal joins.
                    "[&>td]:shadow-[0_2px_2px_-2px_var(--ord-shadow)]",
                    "[&>td:first-child]:rounded-l-md [&>td:first-child]:border-l-4 [&>td:first-child]:px-2",
                    "[&>td:last-child]:rounded-r-md [&>td:last-child]:border-r",
                    "hover:[&>td]:bg-ord-hover"
                  )}
                >
                  <td className={statusStripe(statusText(load))}>
                    <RowCheckbox id={load.id} label={`Select ${load.load_number}`} />
                  </td>
                  <td>
                    {/* Order ID in the brand navy, no underline. msgplane never
                        underlines it either — but this is US Star's blue, not
                        the old system's link colour. */}
                    <Link
                      href={`/loads/${load.id}`}
                      className="focus-ring tabular-nums text-ord-accent"
                    >
                      {load.load_number}
                    </Link>
                    {/* The status word keeps its position and its hue, in a chip
                        rather than bare text — the fill is neutral so the hue
                        stays the only thing carrying meaning. */}
                    <p
                      className={cn(
                        "mt-1 inline-flex rounded-full border border-current/25 bg-ord-chip px-2 text-[12px] lowercase",
                        statusTone(statusText(load))
                      )}
                    >
                      {statusText(load)}
                    </p>
                    {/* Right under the ID, where the eye already is: this
                        customer asked us to stop contacting them. */}
                    {customer && (customer.sms_opt_out || customer.email_opt_out) && (
                      <p
                        title={
                          customer.sms_opt_out && customer.email_opt_out
                            ? "Opted out of SMS and email"
                            : customer.sms_opt_out
                              ? "Replied STOP — do not text"
                              : "Unsubscribed from email"
                        }
                        // The one place besides "Notes from Shipper" that the
                        // app leaves weight 400, and it is spelled font-bold
                        // rather than font-semibold because only 400 and 700
                        // faces are loaded: this is the marker that stops a rep
                        // texting someone who replied STOP.
                        className="mt-0.5 text-[12px] font-bold lowercase text-destructive"
                      >
                        opted out
                        {customer.sms_opt_out && customer.email_opt_out
                          ? ""
                          : customer.sms_opt_out
                            ? " (sms)"
                            : " (email)"}
                      </p>
                    )}
                    {/* No follow-up badge here. The old system does not carry
                        one, and after the import nearly every quote has a date
                        years in the past — a column of red "overdue" chips a
                        rep can neither act on nor clear. The Follow-up Today
                        tab is where that queue is worked. */}
                  </td>
                  <td className="whitespace-nowrap">
                    {colDate ? (
                      <>
                        <p className="tabular-nums text-foreground">{colDate.date}</p>
                        {colDate.time && (
                          <p className="text-[12px] tabular-nums text-muted-foreground">
                            {colDate.time}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                    {/* Requests tab: msgplane's boxed offer count under the date. */}
                    {activeTab.requestCount && (requestCountByLoad.get(load.id) ?? 0) > 0 && (
                      <span className="mt-1 inline-flex min-w-5 items-center justify-center rounded-md border px-1 text-[12px] tabular-nums">
                        {requestCountByLoad.get(load.id)}
                      </span>
                    )}
                  </td>
                  <td>
                    {/* Stacked counters, msgplane-style: notes (click to read
                        or add without opening the order), then unread inbound
                        messages (red when attention is needed). */}
                    <div className="flex flex-col items-start gap-1">
                      <NotesQuickButton
                        loadId={load.id}
                        loadNumber={load.load_number}
                        count={notesByLoad.get(load.id) ?? 0}
                      />
                      <span
                        title="Unread messages from this customer"
                        className={cn(
                          "inline-flex min-w-6 justify-center rounded-md border px-1.5 py-0.5 text-[12px] tabular-nums",
                          (unreadByCustomer.get(load.customer_id) ?? 0) > 0
                            ? "border-destructive/40 bg-destructive/10 text-destructive-ink"
                            : "text-muted-foreground"
                        )}
                      >
                        {unreadByCustomer.get(load.customer_id) ?? 0}
                      </span>
                    </div>
                  </td>
                  <td>
                    {/* msgplane stacks the badge over the name. */}
                    <div className="flex flex-col items-center gap-0.5 text-center">
                      {/* account_box in msgplane; here it follows the header
                          blue-grey rather than msgplane's brown. */}
                      <User className="size-4 text-ord-head" aria-hidden="true" />
                      <span className="text-foreground">{rp ? rp.full_name || rp.email : "—"}</span>
                    </div>
                  </td>
                  <td>
                    {customer ? (
                      <div className="space-y-0.5">
                        {/* Nothing in the list underlines; the link colour on
                            hover is the affordance instead — the brand navy
                            here, like every other link on the card. */}
                        <Link
                          href={`/customers/${customer.id}`}
                          className="focus-ring flex items-center gap-1.5 text-foreground hover:text-ord-accent"
                        >
                          <User className="size-4 shrink-0 text-ord-accent" aria-hidden="true" />
                          {customer.contact_name}
                          {/* Anyone who asked us to stop, marked right on the
                              row so nobody texts them by accident. */}
                          {customer.blacklisted && (
                            <span className="rounded-md bg-destructive px-1.5 py-0.5 text-[12px] uppercase leading-none text-background">
                              blacklisted
                            </span>
                          )}
                        </Link>
                        {customer.phone && (
                          <p className="flex items-center gap-1.5 tabular-nums text-foreground">
                            {/* msgplane's phone glyph is plain black. */}
                            <Phone className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                            <span className={customer.sms_opt_out ? "line-through opacity-60" : undefined}>
                              {formatPhone(customer.phone)}
                            </span>
                            {customer.sms_opt_out ? (
                              <span
                                title="Replied STOP — texting this number is not allowed"
                                // Solid fill, like the blacklisted badge above:
                                // on the /10 tint the red is 4.3:1, and this is
                                // the loudest thing a rep needs to not miss.
                                className="rounded-md bg-destructive px-1.5 py-0.5 text-[12px] uppercase leading-none text-background"
                              >
                                STOP
                              </span>
                            ) : (
                              <RowMessageButton
                                channel="sms"
                                loadId={load.id}
                                customerId={customer.id}
                                customerName={customer.contact_name}
                              />
                            )}
                            {/* When this shipper was last texted — the thing a
                                rep working a 30k follow-up list needs before
                                they send, not after. "never" is not an em dash:
                                it is the most useful state on the row. */}
                            <span
                              className="text-muted-foreground"
                              title={
                                load.customer_last_sms_at
                                  ? `Last SMS ${formatDateTime(load.customer_last_sms_at)}`
                                  : "Never texted"
                              }
                            >
                              {load.customer_last_sms_at
                                ? formatRelativeTime(load.customer_last_sms_at)
                                : "never"}
                            </span>
                          </p>
                        )}
                        {customer.email && (
                          <p className="flex items-center gap-1.5 text-foreground">
                            {customer.email_opt_out ? (
                              <span
                                title="Unsubscribed from email"
                                className="rounded-md bg-destructive px-1.5 py-0.5 text-[12px] uppercase leading-none text-background"
                              >
                                UNSUB
                              </span>
                            ) : (
                              <RowMessageButton
                                channel="email"
                                loadId={load.id}
                                customerId={customer.id}
                                customerName={customer.contact_name}
                              />
                            )}
                            <span
                              className={cn(
                                "max-w-44 truncate",
                                customer.email_opt_out && "line-through opacity-60"
                              )}
                            >
                              {customer.email}
                            </span>
                          </p>
                        )}
                        {/* The second human on the order, under the first. */}
                        {rowSecondary && <SecondaryContactLine contact={rowSecondary} />}
                        {/* The old system's per-row "quick view": a popup of
                            the record's key facts, without leaving the list.
                            It also still carries the lane, which is where
                            origin/destination moved when this row's tags became
                            the price block. */}
                        <QuickView
                          canSeeMargin={canSeeMargin}
                          data={quickViewFor(load, customer, rp, loadVehicles)}
                        />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td>
                    <div className="space-y-2">
                      {loadVehicles.length === 0 && <span className="text-muted-foreground">—</span>}
                      {loadVehicles.map((v) => (
                        <div key={v.id} className="flex items-center gap-2.5">
                          {/* generic: the list shows the body type's stock
                              photo, the way the old system does. The actual
                              model is on the order page.
                              48x80 rather than the component's 36x56 — the
                              cutouts hold up at that size and the shape of the
                              vehicle is half of what a rep scans a row for. */}
                          <VehiclePhoto
                            year={v.year}
                            make={v.make}
                            model={v.model}
                            type={v.vehicle_type}
                            generic
                            className="h-12 w-20"
                          />
                          <div className="leading-tight">
                            {/* Title in ink and the body type under it in the
                                accent — msgplane greys the title and blacks the
                                type, which buries the year/make/model. */}
                            <p className="text-foreground">
                              {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                            </p>
                            <p className="text-[12px] uppercase tracking-wide text-ord-head">
                              {VEHICLE_TYPE_LABELS[v.vehicle_type] ?? v.vehicle_type}
                            </p>
                            {load.transport_type === "enclosed" && (
                              <p className="text-[12px] text-destructive">enclosed</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  {/* Where the Orig/Dest pins used to be: the money, as pills.
                      Both column layouts read it here, so neither carries a
                      second money column at the end of the row. */}
                  <td className="whitespace-nowrap">
                    <PriceBlock load={load} canSeeMargin={canSeeMargin} />
                  </td>
                  {stage === "order" ? (
                    <>
                      <td className="whitespace-nowrap tabular-nums text-foreground">
                        {usDateOnly(load.pickup_ready_date)}
                      </td>
                      {activeTab.carrierCol && (
                        <td>
                          {rowCarrier ? (
                            <>
                              <Link
                                href={`/carriers/${rowCarrier.id}`}
                                className="focus-ring text-ord-accent"
                              >
                                {rowCarrier.company_name}
                              </Link>
                              {rowCarrier.phone && (
                                <p className="text-[12px] tabular-nums text-muted-foreground">
                                  {formatPhone(rowCarrier.phone)}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap tabular-nums text-foreground">
                        {usDateOnly(load.pickup_ready_date)}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex rounded-full border border-current/25 bg-ord-chip px-2 text-[12px] lowercase",
                            statusTone(statusText(load))
                          )}
                        >
                          {statusText(load)}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {loads.length === 0 && (
              <tr>
                {/* The empty state is the one row that has to be told how wide
                    the table is, so the count is derived rather than typed:
                    eight shared columns plus the per-stage tail. */}
                <td colSpan={colCount} className="rounded-md border bg-card">
                  {emptyState}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The phone layout of the same rows, fed by the same already-fetched
          data. Order follows what a rep checks between sessions: ID + status,
          shipper, price, date — then the secondary block. Sub-lines use the
          sanctioned 13px rather than the table's 12px, which is only legible at
          a desk.
          Separate cards here too, with the same left stripe and the same lift:
          the desktop row and this one must show a rep the same facts in the
          same shape, or the layout that drifts is the one they stop trusting. */}
      <ul className="space-y-2 text-sm max-md:mb-28 md:hidden">
        {loads.map((load) => {
          const customer = customerById.get(load.customer_id);
          const rp = load.sales_owner_id ? repById.get(load.sales_owner_id) : undefined;
          const loadVehicles = vehiclesByLoad.get(load.id) ?? [];
          const colDate = tabDate(load);
          const rowCarrier = load.carrier_id ? carrierById.get(load.carrier_id) : undefined;
          const unread = unreadByCustomer.get(load.customer_id) ?? 0;
          const offers = requestCountByLoad.get(load.id) ?? 0;
          const cardSecondary = customer ? secondaryContactFor(load, customer) : null;
          return (
            <li
              key={load.id}
              className={cn(
                "relative rounded-md border border-l-4 bg-card p-3 shadow-[0_1px_2px_var(--ord-shadow)]",
                statusStripe(statusText(load))
              )}
            >
              {/* The card is one tap target. Controls that do something OTHER
                  than open the record take z-10 to sit above this overlay. */}
              <Link
                href={`/loads/${load.id}`}
                aria-label={`Open ${load.load_number}`}
                className="focus-ring absolute inset-0"
              />

              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="tabular-nums text-ord-accent">{load.load_number}</span>
                    <span
                      className={cn(
                        "inline-flex rounded-full border border-current/25 bg-ord-chip px-2 text-xs lowercase",
                        statusTone(statusText(load))
                      )}
                    >
                      {statusText(load)}
                    </span>
                  </div>
                  {customer && (customer.sms_opt_out || customer.email_opt_out) && (
                    <p className="text-xs font-bold lowercase text-destructive">
                      opted out
                      {customer.sms_opt_out && customer.email_opt_out
                        ? ""
                        : customer.sms_opt_out
                          ? " (sms)"
                          : " (email)"}
                    </p>
                  )}
                </div>
                {/* The label, not the 15px box, is what gets tapped — and it
                    is server-rendered, so the box holds its size while the
                    checkbox inside it waits for hydration. */}
                <label className="relative z-10 -my-1 -mr-1 flex size-12 shrink-0 cursor-pointer items-center justify-center">
                  <PhoneOnly>
                    <RowCheckbox id={load.id} label={`Select ${load.load_number}`} />
                  </PhoneOnly>
                </label>
              </div>

              {customer ? (
                <div className="mt-2 space-y-1">
                  <p className="flex items-center gap-1.5">
                    <User className="size-4 shrink-0 text-ord-accent" aria-hidden="true" />
                    <span className="min-w-0 break-words text-foreground">
                      {customer.contact_name}
                    </span>
                    {customer.blacklisted && (
                      <span className="shrink-0 rounded-md bg-destructive px-1.5 py-0.5 text-xs uppercase leading-none text-background">
                        blacklisted
                      </span>
                    )}
                  </p>
                  {customer.phone && (
                    <p className="flex items-center gap-1.5 tabular-nums">
                      <Phone className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                      <span
                        className={customer.sms_opt_out ? "line-through opacity-60" : undefined}
                      >
                        {formatPhone(customer.phone)}
                      </span>
                      {customer.sms_opt_out ? (
                        <span
                          title="Replied STOP — texting this number is not allowed"
                          className="shrink-0 rounded-md bg-destructive px-1.5 py-0.5 text-xs uppercase leading-none text-background"
                        >
                          STOP
                        </span>
                      ) : (
                        // The chip is 15px tall and sits beside a phone number
                        // iOS already treats as a call target, so on the card
                        // it grows to a real 45px button. Sized from here
                        // rather than by wrapping it: a wrapper span would be
                        // padding, not hit area.
                        <span className="relative z-10 flex size-12 shrink-0 items-center [&>button]:h-12 [&>button]:w-12 [&>button]:justify-center [&>button]:rounded-md">
                          <PhoneOnly>
                            <RowMessageButton
                              channel="sms"
                              loadId={load.id}
                              customerId={customer.id}
                              customerName={customer.contact_name}
                            />
                          </PhoneOnly>
                        </span>
                      )}
                    </p>
                  )}
                  {customer.email && (
                    <p className="flex items-center gap-1.5">
                      {customer.email_opt_out ? (
                        <span
                          title="Unsubscribed from email"
                          className="shrink-0 rounded-md bg-destructive px-1.5 py-0.5 text-xs uppercase leading-none text-background"
                        >
                          UNSUB
                        </span>
                      ) : (
                        <span className="relative z-10 flex size-12 shrink-0 items-center [&>button]:size-12 [&>button]:justify-center">
                          <PhoneOnly>
                            <RowMessageButton
                              channel="email"
                              loadId={load.id}
                              customerId={customer.id}
                              customerName={customer.contact_name}
                            />
                          </PhoneOnly>
                        </span>
                      )}
                      {/* No 165px cap here — that is a table-column constraint,
                          and half an address identifies nobody. */}
                      <span
                        className={cn(
                          "min-w-0 break-all",
                          customer.email_opt_out && "line-through opacity-60"
                        )}
                      >
                        {customer.email}
                      </span>
                    </p>
                  )}
                  {/* Same second line as the table row. */}
                  {cardSecondary && <SecondaryContactLine contact={cardSecondary} />}
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">—</p>
              )}

              {/* The lane tags are gone from the card as they are from the row —
                  the price block stands where they were, and the quick view at
                  the foot of the card still carries origin and destination. */}
              <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 tabular-nums">
                <PriceBlock load={load} canSeeMargin={canSeeMargin} />
                <div className="text-right text-xs">
                  <p>
                    <span className="text-muted-foreground">
                      {stage === "order" ? (activeTab.dateCol?.label ?? "Converted") : "Quoted"}
                    </span>{" "}
                    {colDate ? colDate.date : "—"}
                    {colDate?.time ? ` ${colDate.time}` : ""}
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      {stage === "order" ? "1st avail" : "Est. ship"}
                    </span>{" "}
                    {usDateOnly(load.pickup_ready_date)}
                  </p>
                </div>
              </div>

              {/* Secondary: still here, just smaller and below the glance. */}
              <div className="mt-2 space-y-2 border-t pt-2 text-xs">
                {loadVehicles.length > 0 && (
                  <div className="space-y-1">
                    {loadVehicles.map((v) => (
                      <div key={v.id} className="flex items-center gap-2">
                        {/* 40x64: a step up like the table's, but held under it —
                            the phone card puts the price and the shipper first. */}
                        <VehiclePhoto
                          year={v.year}
                          make={v.make}
                          model={v.model}
                          type={v.vehicle_type}
                          generic
                          className="h-10 w-16"
                        />
                        <div className="min-w-0 leading-tight">
                          <p className="text-foreground">
                            {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                          </p>
                          <p className="uppercase tracking-wide text-ord-head">
                            {VEHICLE_TYPE_LABELS[v.vehicle_type] ?? v.vehicle_type}
                            {load.transport_type === "enclosed" && (
                              <span className="text-destructive"> · enclosed</span>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab.carrierCol && rowCarrier && (
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="text-muted-foreground">Carrier</span>
                    <span className="relative z-10">
                      <Link
                        href={`/carriers/${rowCarrier.id}`}
                        className="focus-ring inline-flex min-h-12 items-center text-ord-accent"
                      >
                        {rowCarrier.company_name}
                      </Link>
                    </span>
                    {rowCarrier.phone && (
                      <span className="tabular-nums text-muted-foreground">
                        {formatPhone(rowCarrier.phone)}
                      </span>
                    )}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <User className="size-3.5 shrink-0 text-ord-head" aria-hidden="true" />
                    <span className="text-foreground">{rp ? rp.full_name || rp.email : "—"}</span>
                  </span>

                  {activeTab.requestCount && offers > 0 && (
                    <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 tabular-nums">
                      {offers} offer{offers === 1 ? "" : "s"}
                    </span>
                  )}

                  <span
                    title="Unread messages from this customer"
                    className={cn(
                      "inline-flex min-w-6 justify-center rounded-md border px-1.5 py-0.5 tabular-nums",
                      unread > 0
                        ? "border-destructive/40 bg-destructive/10 text-destructive-ink"
                        : "text-muted-foreground"
                    )}
                  >
                    {unread}
                  </span>

                  {/* gap-4, not the table's gap-1: two small chips 4px apart on
                      a touch screen is a mis-tap. The counter chip is 22px in
                      both directions, so it is sized from here — see the SMS
                      chip above for why a wrapper would not do it. */}
                  <span className="relative z-10 flex min-h-12 items-center gap-4 [&>button]:h-12 [&>button]:min-w-12">
                    <PhoneOnly>
                      <NotesQuickButton
                        loadId={load.id}
                        loadNumber={load.load_number}
                        count={notesByLoad.get(load.id) ?? 0}
                      />
                      {customer && (
                        <QuickView
                          canSeeMargin={canSeeMargin}
                          data={quickViewFor(load, customer, rp, loadVehicles)}
                        />
                      )}
                    </PhoneOnly>
                  </span>
                </div>
              </div>
            </li>
          );
        })}
        {loads.length === 0 && <li className="p-3">{emptyState}</li>}
      </ul>

      <BulkActionBar reps={repsForBar} canReassign={canSeeMargin} />

      {/* msgplane's floating quick-create — always reachable, even mid-scroll.
          z-30 keeps it under the bulk bar (z-40) when a selection is active.
          On desktop the bar is a centred 720px card and the two never meet; on
          a phone it is edge to edge, so the button lifts clear of it (and of
          Safari's bottom toolbar) until md puts it back at bottom-6.
          bottom-32 is measured against the phone bulk bar: 15px offset + a
          ~90px two-row bar puts its top edge at ~105px, and the list above
          carries the matching max-md:mb-28. */}
      <Link
        href="/loads/new"
        aria-label={`New ${stage}`}
        title={`New ${stage}`}
        className="focus-ring fixed bottom-32 right-6 z-30 flex size-12 items-center justify-center rounded-md bg-primary text-primary-foreground transition-transform hover:scale-105 md:bottom-6"
      >
        <Plus className="size-6" aria-hidden="true" />
      </Link>
    </div>
    </SelectionProvider>
  );
}
