import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import Link from "next/link";
import { CalendarCheck2, Inbox, MapPin, Phone, Plus, SquareArrowOutUpRight, User } from "lucide-react";
import { VehiclePhoto } from "@/components/vehicle-photo";
import { RowMessageButton } from "@/components/messaging/row-message-buttons";
import { NotesQuickButton } from "@/components/messaging/notes-quick";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { formatDate, formatPhone } from "@/lib/format";
import { endOfBusinessDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { SelectionProvider } from "@/components/pipeline/selection-context";
import { RepSelect } from "@/components/pipeline/rep-select";
import { RowCheckbox, SelectAllCheckbox } from "@/components/pipeline/row-checkbox";
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
}: {
  stage: PipelineStage;
  title: string;
  description: string;
  tab?: string;
  rep?: string;
  page?: string;
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

  // One place that knows how a tab is filtered — used by the page query AND
  // by each tab's exact count, so the number on the tab and the rows in the
  // table can never disagree.
  type LoadQuery = ReturnType<ReturnType<typeof supabase.from>["select"]>;
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
    return out;
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
        ? supabase.from("customers").select("id, contact_name, phone, email").in("id", customerIds)
        : Promise.resolve({
            data: [] as { id: string; contact_name: string; phone: string | null; email: string | null }[],
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

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
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
  // msgplane status text under the ID: lowercase, hyphenated, plain gray.
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

      {/* msgplane tab bar: plain labels, coral active pill, a count badge
          ONLY where attention is needed (their Issues-style badge). */}
      {tabs.length > 1 && (
        <div className="flex items-center justify-between gap-3 border-b pb-1">
          <div className="flex items-center gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const active = activeTab.key === t.key;
              const count = tabCount(t);
              const showBadge = (t.badge || t.followUpDue) && count > 0;
              return (
                <Link
                  key={t.key}
                  href={tabHref(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-red-400 font-medium text-white"
                      : "text-foreground/80 hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t.label}
                  {showBadge && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
                        active ? "bg-white/25 text-white" : "bg-red-100 text-red-700"
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
              <span className="ml-1 text-muted-foreground/70">of {totalRows}</span>
            </span>
            {page > 0 ? (
              <Link
                href={tabHref(activeTab.key, page - 1)}
                aria-label="Previous page"
                className="px-1 text-base hover:text-foreground"
              >
                ‹
              </Link>
            ) : (
              <span className="px-1 text-base opacity-30" aria-hidden="true">‹</span>
            )}
            {from + PAGE_SIZE < totalRows ? (
              <Link
                href={tabHref(activeTab.key, page + 1)}
                aria-label="Next page"
                className="px-1 text-base hover:text-foreground"
              >
                ›
              </Link>
            ) : (
              <span className="px-1 text-base opacity-30" aria-hidden="true">›</span>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            {/* msgplane header row: quiet Title-case labels; the date column
                is renamed per tab (Converted/Posted/Sent/Signed/Delivered…),
                and the parked/dispatched tabs add a Carrier column. Quotes
                order theirs: Quote money, then Est. Ship, then Status. */}
            <tr className="border-b text-left text-sm font-normal text-muted-foreground [&>th]:font-normal">
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
                // Plain white rows with a thin rule — the msgplane look.
                <tr
                  key={load.id}
                  className="border-b border-border align-top transition-colors last:border-b-0 hover:bg-accent/40"
                >
                  <td className="px-2 py-4">
                    <RowCheckbox id={load.id} label={`Select ${load.load_number}`} />
                  </td>
                  <td className="px-3 py-4">
                    <Link
                      href={`/loads/${load.id}`}
                      className="font-medium tabular-nums text-primary hover:underline"
                    >
                      {load.load_number}
                    </Link>
                    <p className="mt-1 text-[13px] lowercase text-muted-foreground">
                      {statusText(load)}
                    </p>
                    {load.follow_up_at && (
                      <span
                        title={load.follow_up_note ?? undefined}
                        className={cn(
                          "mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                          new Date(load.follow_up_at) < new Date()
                            ? "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-400/15 dark:text-red-300"
                            : "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-400/15 dark:text-amber-300"
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
                          <p className="text-[13px] tabular-nums text-muted-foreground">
                            {colDate.time}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                    {/* Requests tab: msgplane's circled offer count under the date. */}
                    {activeTab.requestCount && (requestCountByLoad.get(load.id) ?? 0) > 0 && (
                      <span className="mt-1 inline-flex size-5 items-center justify-center rounded-full border border-foreground text-[12px] font-semibold tabular-nums">
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
                          "inline-flex min-w-6 justify-center rounded border px-1.5 py-0.5 text-[13px] tabular-nums",
                          (unreadByCustomer.get(load.customer_id) ?? 0) > 0
                            ? "border-red-300 bg-red-50 font-semibold text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
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
                      <User className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span className="text-foreground">{rp ? rp.full_name || rp.email : "—"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    {customer ? (
                      <div className="space-y-0.5">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="flex items-center gap-1.5 text-foreground hover:underline"
                        >
                          <User className="size-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                          {customer.contact_name}
                        </Link>
                        {customer.phone && (
                          <p className="flex items-center gap-1.5 tabular-nums text-foreground">
                            <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            {formatPhone(customer.phone)}
                            <RowMessageButton
                              channel="sms"
                              loadId={load.id}
                              customerId={customer.id}
                              customerName={customer.contact_name}
                            />
                          </p>
                        )}
                        {customer.email && (
                          <p className="flex items-center gap-1.5 text-foreground">
                            <RowMessageButton
                              channel="email"
                              loadId={load.id}
                              customerId={customer.id}
                              customerName={customer.contact_name}
                            />
                            <span className="max-w-44 truncate">{customer.email}</span>
                          </p>
                        )}
                        {/* msgplane's per-row "quick view" link. */}
                        <Link
                          href={`/loads/${load.id}`}
                          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                          quick view
                        </Link>
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
                            <p className="text-[13px] text-foreground">
                              {VEHICLE_TYPE_LABELS[v.vehicle_type] ?? v.vehicle_type}
                            </p>
                            {load.transport_type === "enclosed" && (
                              <p className="text-[13px] text-red-600 dark:text-red-400">enclosed</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4">
                    {/* msgplane pins: blue origin, red destination. */}
                    <p className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                      {load.pickup_city || "—"} {load.pickup_state || ""} {load.pickup_zip || ""}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-red-600 dark:text-red-500" aria-hidden="true" />
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
                                className="text-primary hover:underline"
                              >
                                {rowCarrier.company_name}
                              </Link>
                              {rowCarrier.phone && (
                                <p className="text-[13px] tabular-nums text-muted-foreground">
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
                      <td className="px-3 py-4 lowercase text-muted-foreground">
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
        className="fixed bottom-6 right-6 z-30 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <Plus className="size-6" aria-hidden="true" />
      </Link>
    </div>
    </SelectionProvider>
  );
}
