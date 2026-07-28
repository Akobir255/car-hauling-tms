import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import Link from "next/link";
import { CalendarCheck2, Inbox, MapPin, Phone, Plus, User } from "lucide-react";
import { VehiclePhoto } from "@/components/vehicle-photo";
import { RowMessageButton } from "@/components/messaging/row-message-buttons";
import { NotesQuickButton } from "@/components/messaging/notes-quick";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { phoneDigits, suppressedAmong } from "@/lib/messaging/suppression";
import { Button } from "@/components/ui/button";
import { formatDate, formatPhone } from "@/lib/format";
import { endOfBusinessDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { SelectionProvider } from "@/components/pipeline/selection-context";
import { RepSelect } from "@/components/pipeline/rep-select";
import { QuickView } from "@/components/pipeline/quick-view";
import { FilterBar, type FilterValues } from "@/components/pipeline/filter-bar";
import { RowCheckbox, SelectAllCheckbox } from "@/components/pipeline/row-checkbox";
import { statusTone } from "@/components/pipeline/status-tone";
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

// msgplane money style: "Tariff:$500" — whole dollars, no separators.
const money0 = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v)}`);

// The Quote cell, shared by both column layouts. Carrier pay renders only
// for managers — the sales view never carries the column.
function QuoteCell({ load, canSeeMargin }: { load: Load; canSeeMargin: boolean }) {
  return (
    <>
      <p>
        <span className="text-muted-foreground">Tariff:</span>
        <span className="text-foreground">{money0(load.customer_rate)}</span>
      </p>
      <p>
        <span className="text-muted-foreground">Deposit:</span>
        <span className="text-foreground">{money0(load.deposit_amount)}</span>
      </p>
      {canSeeMargin && load.carrier_pay != null && (
        <p>
          <span className="text-muted-foreground">Carrier:</span>
          <span className="text-foreground">{money0(load.carrier_pay)}</span>
        </p>
      )}
    </>
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
  const table = canSeeMargin ? MANAGER_LOADS_TABLE : "loads_sales_safe";

  const stageStatuses: LoadStatus[] =
    stage === "lead" ? LEAD_STATUSES : stage === "quote" ? QUOTE_STATUSES : ORDER_STATUSES;
  const tabs: OrderTab[] =
    stage === "order" ? ORDER_TABS : stage === "quote" ? QUOTE_TABS : LEAD_TABS;
  // Bar ORDER and DEFAULT selection are different things: Follow-up Today is
  // drawn first, but a bare /quotes opens the Quotes tab (msgplane behavior).
  const defaultTab = tabs.find((t) => t.default) ?? tabs[0];
  const activeTab = tabs.find((t) => t.key === tab) ?? defaultTab;

  // "Due" = follow-up scheduled for any time up to the end of today in the
  // business timezone (includes everything overdue). Shared with the
  // dashboard's due-today card so the two counts can never disagree.
  const endOfToday = endOfBusinessDay();
  const endOfTodayIso = endOfToday.toISOString();

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
    if (filters.signed === "yes") out = out.not("date_signed", "is", null);
    else if (filters.signed === "sent") {
      out = out.not("contract_sent_at", "is", null).is("date_signed", null);
    } else if (filters.signed === "no") out = out.is("contract_sent_at", null);

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
    // Parked tabs (hold/archived) are shared across stages: a priced record
    // was a quote, an unpriced one was still a lead.
    if (t.stage === "quote") out = out.not("customer_rate", "is", null);
    else if (t.stage === "lead") out = out.is("customer_rate", null);
    if (t.followUpDue) {
      out = out.not("follow_up_at", "is", null).lte("follow_up_at", endOfTodayIso);
    }
    if (canSeeMargin && rep) out = out.eq("sales_owner_id", rep);
    return applyUserFilters(out);
  };

  // 100 rows a page, like the system this replaces.
  const from = page * PAGE_SIZE;
  let query = applyTabFilter(supabase.from(table).select("*"), activeTab).range(
    from,
    from + PAGE_SIZE - 1
  );
  query = activeTab.followUpDue
    ? // Oldest follow-up first — that's the order reps work the queue in.
      query.order("follow_up_at", { ascending: true })
    : query.order("created_at", { ascending: false });

  // Exact per-tab counts. head:true fetches no rows, so this stays correct
  // past PostgREST's 1000-row response cap.
  const countPromises = tabs.map((t) =>
    applyTabFilter(supabase.from(table).select("id", { count: "exact", head: true }), t)
  );

  const [{ data, error }, ...countResults] = await Promise.all([query, ...countPromises]);
  const loads = (data ?? []) as Load[];
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
            .select("id, contact_name, phone, email, sms_opt_out, email_opt_out, blacklisted")
            .in("id", customerIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              contact_name: string;
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
    if (load.status === "hold" && stage === "order") return "on-hold-order";
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
        <div className="flex items-center justify-between gap-3 pb-1">
          <div className="flex items-center gap-2 overflow-x-auto">
            {tabs.map((t) => {
              const active = activeTab.key === t.key;
              const count = tabCount(t);
              // No badge on the follow-up queue. Nearly every open quote is due
              // or overdue, so the number reads in the thousands — it tells a
              // rep nothing they can act on and the old system never showed it.
              const showBadge = t.badge && !t.followUpDue && count > 0;
              return (
                <Link
                  key={t.key}
                  href={tabHref(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // The measured tab is a white chip, 14px, padding 1px 3px.
                    // That leaves a 22px pointer target, so a 24px floor is
                    // added — it moves the chip's edge, never its ink.
                    "focus-ring flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-[3px] py-px text-sm transition-colors",
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
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            {canSeeMargin && (
              <RepSelect reps={repsForBar} current={rep} profileId={profile.id} />
            )}
            <span className="tabular-nums">
              {totalRows === 0 ? "0-0" : `${from + 1}-${Math.min(from + PAGE_SIZE, totalRows)}`}
              {/* Was muted/70, which composites to msgplane's own 2.7:1 gray. */}
              <span className="ml-1">of {totalRows}</span>
            </span>
            {page > 0 ? (
              <Link
                href={tabHref(activeTab.key, page - 1)}
                aria-label="Previous page"
                className="px-1 text-[15px] hover:text-foreground"
              >
                ‹
              </Link>
            ) : (
              <span className="px-1 text-[15px] opacity-30" aria-hidden="true">‹</span>
            )}
            {from + PAGE_SIZE < totalRows ? (
              <Link
                href={tabHref(activeTab.key, page + 1)}
                aria-label="Next page"
                className="px-1 text-[15px] hover:text-foreground"
              >
                ›
              </Link>
            ) : (
              <span className="px-1 text-[15px] opacity-30" aria-hidden="true">›</span>
            )}
          </div>
        </div>
      )}

      <FilterBar values={filters} matched={totalRows} />

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* No shadow — the nav bar is the only thing in msgplane that carries
          one, so the border gray is what makes the list read as a region. */}
      <div className="overflow-x-auto rounded-md border bg-card">
        {/* Cells are pinned in px: the file also carries 12px sub-lines, and a
            rem step would drift away from them if the root size ever moves. */}
        <table className="w-full border-collapse text-[14px]">
          <thead>
            {/* msgplane header row: quiet Title-case labels; the date column
                is renamed per tab (Converted/Posted/Sent/Signed/Delivered…),
                and the parked/dispatched tabs add a Carrier column. Quotes
                order theirs: Quote money, then Est. Ship, then Status. */}
            {/* Brown headers are msgplane's most recognisable tell. The th
                override stays: the UA sheet bolds th and preflight never
                resets it, so this is not the global weight it undoes. */}
            <tr className="border-b border-msg-rule text-left text-msg-header [&>th]:font-normal">
              <th className="w-8 px-2 py-3">
                <SelectAllCheckbox ids={loadIds} />
              </th>
              <th className="px-3 py-3">ID</th>
              <th className="px-3 py-3">
                {stage === "order" ? (activeTab.dateCol?.label ?? "Converted") : "Quoted"}
              </th>
              <th className="px-3 py-3">Notes</th>
              <th className="px-3 py-3">Assigned to</th>
              <th className="px-3 py-3">Shipper</th>
              <th className="px-3 py-3">Vehicles</th>
              <th className="px-3 py-3">Orig/Dest</th>
              {stage === "order" ? (
                <>
                  <th className="px-3 py-3">1st. Avail</th>
                  {activeTab.carrierCol && <th className="px-3 py-3">Carrier</th>}
                  <th className="px-3 py-3">Quote</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-3">Quote</th>
                  <th className="px-3 py-3">Est. Ship</th>
                  <th className="px-3 py-3">Status</th>
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
              return (
                // Plain white rows with a thin rule — the msgplane look. The
                // 88px is a minimum on a table row, so tall rows still grow.
                <tr
                  key={load.id}
                  className="h-[88px] border-b border-msg-rule align-top transition-colors last:border-b-0 hover:bg-msg-hover"
                >
                  <td className="px-2 py-4">
                    <RowCheckbox id={load.id} label={`Select ${load.load_number}`} />
                  </td>
                  <td className="px-3 py-4">
                    {/* Order ID: light blue, no underline — msgplane never
                        underlines it, even on hover. */}
                    <Link
                      href={`/loads/${load.id}`}
                      className="focus-ring tabular-nums text-msg-link"
                    >
                      {load.load_number}
                    </Link>
                    <p className={cn("mt-1 text-[12px] lowercase", statusTone(statusText(load)))}>
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
                    {load.follow_up_at && (
                      <span
                        title={load.follow_up_note ?? undefined}
                        className={cn(
                          "mt-1.5 inline-block rounded-md px-2 py-0.5 text-[12px] ring-1 ring-inset",
                          new Date(load.follow_up_at) < new Date()
                            ? "bg-destructive/10 text-destructive-ink ring-destructive/25"
                            // The spec's warning orange is 2.1:1 as text, so
                            // the hue moves to the fill and the label takes ink.
                            : "bg-chart-2/15 text-foreground ring-chart-2/40"
                        )}
                      >
                        FU {formatDate(load.follow_up_at)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4">
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
                  <td className="px-3 py-4">
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
                  <td className="px-3 py-4">
                    {/* msgplane stacks the badge over the name. */}
                    <div className="flex flex-col items-center gap-0.5 text-center">
                      {/* account_box in msgplane, brown like the headers. */}
                      <User className="size-4 text-msg-header" aria-hidden="true" />
                      <span className="text-foreground">{rp ? rp.full_name || rp.email : "—"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    {customer ? (
                      <div className="space-y-0.5">
                        {/* Nothing in the list underlines; the link colour on
                            hover is the affordance instead. */}
                        <Link
                          href={`/customers/${customer.id}`}
                          className="focus-ring flex items-center gap-1.5 text-foreground hover:text-msg-link"
                        >
                          <User className="size-4 shrink-0 text-msg-shipper" aria-hidden="true" />
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
                        {/* The old system's per-row "quick view": a popup of
                            the record's key facts, without leaving the list. */}
                        <QuickView
                          canSeeMargin={canSeeMargin}
                          data={{
                            loadId: load.id,
                            loadNumber: load.load_number,
                            status: statusText(load),
                            customerName: customer.contact_name,
                            phone: customer.phone,
                            email: customer.email,
                            origin: [load.pickup_city, load.pickup_state, load.pickup_zip]
                              .filter(Boolean)
                              .join(" "),
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
                          }}
                        />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-4">
                    <div className="space-y-2">
                      {loadVehicles.length === 0 && <span className="text-muted-foreground">—</span>}
                      {loadVehicles.map((v) => (
                        <div key={v.id} className="flex items-center gap-2.5">
                          <VehiclePhoto
                            year={v.year}
                            make={v.make}
                            model={v.model}
                            type={v.vehicle_type}
                          />
                          <div className="leading-tight">
                            {/* msgplane: gray vehicle title, type under, red
                                "enclosed" flag on its own line. */}
                            <p className="text-muted-foreground">
                              {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                            </p>
                            <p className="text-[12px] text-foreground">
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
                  <td className="whitespace-nowrap px-3 py-4">
                    {/* msgplane pins: blue origin, red destination. */}
                    <p className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-msg-shipper" aria-hidden="true" />
                      {load.pickup_city || "—"} {load.pickup_state || ""} {load.pickup_zip || ""}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                      {load.delivery_city || "—"} {load.delivery_state || ""} {load.delivery_zip || ""}
                    </p>
                  </td>
                  {stage === "order" ? (
                    <>
                      <td className="whitespace-nowrap px-3 py-4 tabular-nums text-foreground">
                        {usDateOnly(load.pickup_ready_date)}
                      </td>
                      {activeTab.carrierCol && (
                        <td className="px-3 py-4">
                          {rowCarrier ? (
                            <>
                              <Link
                                href={`/carriers/${rowCarrier.id}`}
                                className="text-msg-link"
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
                      <td className="whitespace-nowrap px-3 py-4 tabular-nums">
                        <QuoteCell load={load} canSeeMargin={canSeeMargin} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-3 py-4 tabular-nums">
                        <QuoteCell load={load} canSeeMargin={canSeeMargin} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 tabular-nums text-foreground">
                        {usDateOnly(load.pickup_ready_date)}
                      </td>
                      <td className={cn("px-3 py-4 lowercase", statusTone(statusText(load)))}>
                        {statusText(load)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {loads.length === 0 && (
              <tr>
                <td colSpan={11}>
                  {activeTab.followUpDue ? (
                    <EmptyState
                      icon={CalendarCheck2}
                      title="Queue clear"
                      hint="No follow-ups due today. Anything you schedule lands here on its day."
                    />
                  ) : (
                    <EmptyState
                      icon={Inbox}
                      title="Nothing here yet"
                      hint={`New ${stage}s will show up in this list.`}
                      action={
                        <Button size="sm" render={<Link href="/loads/new" />}>
                          New {stage}
                        </Button>
                      }
                    />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BulkActionBar reps={repsForBar} canReassign={canSeeMargin} />

      {/* msgplane's floating quick-create — always reachable, even mid-scroll.
          z-30 keeps it under the bulk bar (z-40) when a selection is active. */}
      <Link
        href="/loads/new"
        aria-label={`New ${stage}`}
        title={`New ${stage}`}
        className="focus-ring fixed bottom-6 right-6 z-30 flex size-12 items-center justify-center rounded-md bg-primary text-primary-foreground transition-transform hover:scale-105"
      >
        <Plus className="size-6" aria-hidden="true" />
      </Link>
    </div>
    </SelectionProvider>
  );
}
