import type { Metadata } from "next";
import { loadNumber } from "@/lib/page-title";
import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canEdit } from "@/lib/record-access";
import { EventTimeline } from "@/components/loads/event-timeline";
import type { LoadEventRow } from "@/lib/events/types";
import { DeleteButton } from "@/components/delete-button";
import { SectionBand, BandRow, Field } from "@/components/section-band";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatDateTime, formatPhone } from "@/lib/format";
import { actionsFor } from "@/lib/order-status";
import { Mail } from "lucide-react";
import type {
  ContractCard,
  ContractVersion,
  Customer,
  Load,
  LoadRequest,
  LoadVehicle,
  Message,
  Profile,
} from "@/types/database";
import { OrderActionBar } from "./order-action-bar";
import { EsignPanel } from "./esign-panel";
import { TrackingPanel, type TrackingTokenSummary } from "./tracking-panel";
import { LiveTrackingMap } from "@/components/tracking/live-tracking-map";
import type { TrackFence, TrackFix } from "@/components/tracking/tracking-map";
import { QuoteOutcomeForm } from "./quote-outcome-form";
import { isFeatureEnabled } from "@/lib/flags";
import { OrderMoreMenu } from "./order-more-menu";
import { NotesThread } from "./notes-thread";
import { VehiclePhotoEditor } from "./vehicle-photo-editor";
import { LoadRequestsBand } from "./load-requests";
import { deleteLoad } from "../actions";

const BACK_PATH = { lead: "/leads", quote: "/quotes", order: "/orders" } as const;

type TrackingTokenRow = {
  kind: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};

// Unrevoked tokens whose 45-day backstop TTL hasn't lapsed, one per kind.
// Module scope, not inline in the component: the render itself must stay pure
// (react-hooks/purity is a build error on an inline Date.now()).
function liveTokenSummaries(rows: TrackingTokenRow[]): {
  driver: TrackingTokenSummary | null;
  customer: TrackingTokenSummary | null;
} {
  const nowMs = Date.now();
  let driver: TrackingTokenSummary | null = null;
  let customer: TrackingTokenSummary | null = null;
  for (const t of rows) {
    if (new Date(t.expires_at).getTime() <= nowMs) continue;
    const summary: TrackingTokenSummary = { issuedAt: t.created_at, lastPingAt: t.last_used_at };
    if (t.kind === "driver") driver = summary;
    else if (t.kind === "customer") customer = summary;
  }
  return { driver, customer };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const n = await loadNumber(id);
  return { title: n ?? "Order" };
}

export default async function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const canManageCarrier = profile.role === "admin" || profile.role === "dispatcher";
  const supabase = await createClient();

  const { data: loadData } = await supabase
    .from(canManageCarrier ? MANAGER_LOADS_TABLE : "loads_sales_safe")
    .select("*")
    .eq("id", id)
    .single();
  if (!loadData) notFound();
  const load = loadData as Load;

  const [
    { data: customerData },
    { data: vehiclesData },
    { data: history },
    { data: contractEvents },
    { data: messagesData },
    { data: noteRows },
    { data: noteDocs },
    { data: requestRows },
    { data: versionRows },
    { data: cardRows },
    { data: carrierRow },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", load.customer_id).single(),
    supabase.from("load_vehicles").select("*").eq("load_id", id).order("created_at"),
    // The event spine (0049), not the status table it replaced: this band is
    // now the ONE timeline every later phase writes onto. 50 rather than the
    // old 12 because it carries more than status changes now.
    supabase
      .from("load_events")
      .select("*")
      .eq("load_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("contract_events")
      .select("event, ip, created_at")
      .eq("load_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Customer-scoped, not load-scoped: inbound SMS has no load_id, and the
    // dispatcher wants the whole conversation context msgplane shows on a
    // record — messages tied to THIS order get a chip below.
    supabase
      .from("messages")
      .select("*")
      .eq("customer_id", load.customer_id)
      .in("channel", ["sms", "email"])
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("load_notes")
      .select("id, body, author_id, imported_author, created_at, updated_at")
      .eq("load_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("documents")
      .select("id, note_id, file_name, storage_path")
      .eq("entity_id", id)
      .not("note_id", "is", null),
    supabase
      .from("load_requests")
      .select("*")
      .eq("load_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("contract_versions")
      .select("*")
      .eq("load_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("contract_cards")
      .select("*")
      .eq("load_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    load.carrier_id
      ? supabase
          .from("carriers")
          .select("id, company_name, phone, source")
          .eq("id", load.carrier_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const customer = customerData as Customer | null;
  const vehicles = (vehiclesData ?? []) as LoadVehicle[];
  const eventRows = (history ?? []) as LoadEventRow[];
  const messages = (messagesData ?? []) as Message[];

  type NoteRow = {
    id: string;
    body: string;
    author_id: string | null;
    /** Set only on rows imported from msgplane, where author_id is null. */
    imported_author: string | null;
    created_at: string;
    updated_at: string;
  };
  const notesData = (noteRows ?? []) as NoteRow[];

  const profileIds = [
    ...new Set(
      [
        load.sales_owner_id,
        ...eventRows.map((e) => e.actor_user_id),
        ...messages.map((m) => m.sent_by),
        ...notesData.map((n) => n.author_id),
      ].filter(Boolean) as string[]
    ),
  ];
  const { data: profs } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
    : { data: [] as Pick<Profile, "id" | "full_name" | "email">[] };
  const profById = new Map((profs ?? []).map((p) => [p.id, p]));
  const assignedTo = load.sales_owner_id ? profById.get(load.sales_owner_id) : null;

  // Anyone on staff can open this record (migration 0037) — by order number,
  // by the shipper's name or phone, by the carrier hauling it. Only its owner
  // and the managers can change it, so for everybody else the page renders
  // without the controls rather than with controls that quietly do nothing.
  const readOnly = !canEdit(load, profile);
  const ownerName = assignedTo?.full_name || assignedTo?.email || null;

  // One boolean read each; the bands below do not exist when they are false.
  const gpsEnabled = await isFeatureEnabled("gps_tracking");
  const lanePricingEnabled = await isFeatureEnabled("lane_pricing");

  // The header shows the order's Loadboard SETTING when one is chosen (the
  // old system's header select); otherwise it falls back to where the order
  // actually went.
  const loadboard =
    load.loadboard === "all"
      ? "All"
      : load.loadboard === "cd"
        ? "CD"
        : load.loadboard === "sd"
          ? "SD"
          : load.posted_to_central_dispatch_at && load.posted_to_super_dispatch_at
            ? "All"
            : load.posted_to_central_dispatch_at
              ? "CD"
              : load.posted_to_super_dispatch_at
                ? "SD"
                // Blank, not an em dash — same rule as Campaign above.
                : " ";

  const boundDelete = deleteLoad.bind(null, load.id);
  // The record's STORED stage, not one inferred from its status. stageOf()
  // returns "order" for every parked status, so a cancelled QUOTE used to get
  // the full order treatment: "Back to list" and the header ID pointed at
  // /orders, isPreOrder was false, and the E-Sign, Load Requests and Dispatch
  // bands all rendered on a record that never became an order.
  const stage = load.pipeline_stage;
  // Leads and quotes are pre-agreement: no contract, no payment, no dispatch.
  // The old system only offers Convert to Order at this point.
  const isPreOrder = stage === "lead" || stage === "quote";
  const backPath = BACK_PATH[stage];
  const requests = (requestRows ?? []) as LoadRequest[];
  const versions = (versionRows ?? []) as ContractVersion[];
  const cardOnFile = ((cardRows ?? [])[0] ?? null) as ContractCard | null;

  // Phase 2 read side, fetched only when the Tracking band renders — and
  // THROUGH THE CALLER'S CLIENT: staff select on shipment_locations,
  // load_geofences, geofence_events and tracking_tokens is exactly what 0050
  // grants (is_active_staff), so RLS is the authority here, not this page.
  const showTracking = !isPreOrder && gpsEnabled;
  let trackFixes: TrackFix[] = [];
  let trackFences: TrackFence[] = [];
  let fenceEvents: { fence: string; transition: string; occurred_at: string }[] = [];
  let driverTokenInfo: TrackingTokenSummary | null = null;
  let customerTokenInfo: TrackingTokenSummary | null = null;
  if (showTracking) {
    const [{ data: fixRows }, { data: fenceRows }, { data: fenceEventRows }, { data: tokenRows }] =
      await Promise.all([
        // Newest 200 stored fixes; reversed below so the trail draws oldest→newest.
        supabase
          .from("shipment_locations")
          .select("id, lat, lng, recorded_at")
          .eq("load_id", id)
          .order("recorded_at", { ascending: false })
          .limit(200),
        supabase.from("load_geofences").select("kind, lat, lng, radius_m").eq("load_id", id),
        supabase
          .from("geofence_events")
          .select("fence, transition, occurred_at")
          .eq("load_id", id)
          .order("occurred_at", { ascending: true }),
        supabase
          .from("tracking_tokens")
          .select("kind, created_at, expires_at, last_used_at")
          .eq("load_id", id)
          .is("revoked_at", null),
      ]);
    trackFixes = ((fixRows ?? []) as TrackFix[]).slice().reverse();
    trackFences = (fenceRows ?? []) as TrackFence[];
    fenceEvents = (fenceEventRows ?? []) as typeof fenceEvents;
    const live = liveTokenSummaries((tokenRows ?? []) as TrackingTokenRow[]);
    driverTokenInfo = live.driver;
    customerTokenInfo = live.customer;
  }
  // Fences are made when a driver link is issued, so their absence AFTER that
  // means the address would not geocode — which used to be a server-side
  // console.warn and nothing else.
  const fenceKinds = new Set(trackFences.map((f) => f.kind));
  const fenceGaps = driverTokenInfo
    ? (["pickup", "delivery"] as const).filter((k) => !fenceKinds.has(k))
    : [];

  // msgplane's orange NEXT: walk the list this record lives in (newest-first,
  // same stage) without going back to it. Walking by STATUS sent every parked
  // record off through the order list, however it got there.
  const { data: nextRow } = await supabase
    .from(canManageCarrier ? MANAGER_LOADS_TABLE : "loads_sales_safe")
    .select("id")
    .eq("pipeline_stage", stage)
    .lt("created_at", load.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Notes + their attachments, ready for the thread. A rep may edit their own
  // note; managers may edit anyone's (same rule the RLS policy enforces).
  const attachmentsByNote = new Map<string, { id: string; file_name: string | null; storage_path: string }[]>();
  for (const d of (noteDocs ?? []) as {
    id: string;
    note_id: string | null;
    file_name: string | null;
    storage_path: string;
  }[]) {
    if (!d.note_id) continue;
    const list = attachmentsByNote.get(d.note_id) ?? [];
    list.push({ id: d.id, file_name: d.file_name, storage_path: d.storage_path });
    attachmentsByNote.set(d.note_id, list);
  }
  const threadNotes = notesData.map((n) => {
    const author = n.author_id ? profById.get(n.author_id) : null;
    return {
      id: n.id,
      body: n.body,
      created_at: n.created_at,
      updated_at: n.updated_at,
      // Notes carried over from msgplane have no local author — the person who
      // wrote them has no account here. Their name rides along on the row, so
      // an imported note reads as theirs rather than as "Unknown".
      authorName:
        author?.full_name || author?.email || n.imported_author || "Unknown",
      canEdit: canManageCarrier || n.author_id === profile.id,
      attachments: attachmentsByNote.get(n.id) ?? [],
    };
  });

  const origin = [load.pickup_city, load.pickup_state].filter(Boolean).join(", ") || "—";
  const destination = [load.delivery_city, load.delivery_state].filter(Boolean).join(", ") || "—";
  const vehicleSummary =
    vehicles.map((v) => [v.year, v.make, v.model].filter(Boolean).join(" ")).filter(Boolean).join(", ") ||
    "No vehicles";

  return (
    // Full width, no centered column: msgplane's bands run edge to edge, and
    // on a 1920px monitor a max-w-7xl page left ~320px of white on each side
    // while the record itself sat in the middle. The top bar's own p-4/p-6
    // gutter is the only inset.
    <div className="space-y-5">
      {/* msgplane puts the Load Requests notebook ABOVE the record header on
          every order — carrier offers are the first thing a dispatcher sees. */}
      {stage === "order" && (
        <LoadRequestsBand
          loadId={load.id}
          requests={requests}
          canDispatch={
            canManageCarrier &&
            ["posted_cd", "posted_sd", "booked"].includes(load.status)
          }
          readOnly={readOnly}
        />
      )}

      {/* Says plainly whose record this is and why nothing here is clickable.
          A page that simply has no buttons reads as broken. */}
      {readOnly && (
        <p className="rounded-lg border border-chart-2 bg-chart-2/15 px-4 py-2.5 text-sm">
          Read-only —{" "}
          {ownerName ? <>this record belongs to {ownerName}.</> : <>this record has no owner yet.</>}{" "}
          {/* Named as the roles staff actually pick in /admin/users. "Manager"
              is our word for admin+dispatcher and appears nowhere they can see
              it, so it would send someone looking for a role that isn't there. */}
          <span className="text-muted-foreground">
            You can see everything on it; only{" "}
            {ownerName ? "they, a dispatcher or an admin" : "a dispatcher or an admin"} can change
            it.
          </span>
        </p>
      )}

      {/* Record header, laid out like the system this replaces: the ID/Status/
          Campaign/Loadboard facts on the left, the lifecycle actions as a row
          of buttons on the right. */}
      <div className="rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <Field label="ID">
              <Link
                href={backPath}
                className="text-[15px] tabular-nums text-msg-link hover:underline"
              >
                {load.load_number}
              </Link>
            </Field>
            {/* The status reads as the old system writes it — plain text, its
                own stored word: "posted-cd", not a "Posted CD" pill. Every rep
                on this team has been reading that vocabulary for years, and
                the lists still carry the colored badge. */}
            <Field label="Status">
              <span className="flex items-center gap-2">
                <span className="text-[15px]">{load.status.replace(/_/g, "-")}</span>
                {/* Safety affordance — a solid destructive fill so it stays
                    loud after the pills flattened to the 3px radius. */}
                {customer?.blacklisted && (
                  <span className="rounded-md bg-destructive px-1.5 py-0.5 text-xs text-background">
                    Blacklisted
                  </span>
                )}
              </span>
            </Field>
            {/* An empty Campaign is blank there, not an em dash — and there is
                no Tariff in this strip at all; it already has a row of its own
                in Payments & Dates below. */}
            <Field label="Campaign">{load.campaign || " "}</Field>
            <Field label="Loadboard">{loadboard}</Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Dropped whole rather than handed an empty list — the bar would
                answer "No actions for this status", and the status is not the
                reason. The banner above already gives the real one. */}
            {!readOnly && (
              <OrderActionBar
                loadId={load.id}
                actions={actionsFor(load.status, profile.role)}
                loadboard={load.loadboard}
              />
            )}
            {/* The one colored box in the bar: green EDIT, light-green 500 with
                a white label, same as the gray boxes beside it. */}
            {!readOnly && (
              <Button
                size="sm"
                className="h-8 bg-msg-btn-edit text-xs font-medium uppercase tracking-wide text-msg-btn-foreground hover:bg-msg-btn-edit-hover max-md:min-h-12"
                render={<Link href={`/loads/${load.id}/edit`} />}
              >
                Edit
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">
          {origin} <span className="mx-1">→</span> {destination} · {vehicleSummary}
          {customer?.contact_name ? ` · ${customer.contact_name}` : ""}
        </p>
      </div>

      {/* Single full-width column, msgplane-style: E-Sign directly under the
          header, then the banded sections stacked. */}
      <div className="space-y-5">
          {/* A contract belongs to an ORDER. In the old system a lead or quote
              offers Convert to Order and nothing else — you cannot send an
              agreement for work the customer has not agreed to yet. Showing the
              band here invited a rep to send a contract on a live quote. */}
          {!isPreOrder && (
          <SectionBand title="E-Sign">
            <EsignPanel
              loadId={load.id}
              token={load.contract_token}
              signedAt={load.date_signed}
              sentAt={load.contract_sent_at}
              sentUndated={load.contract_sent}
              canManage={canManageCarrier}
              readOnly={readOnly}
              signedName={load.contract_signed_name}
              signedIp={load.contract_signed_ip}
              signedEmail={load.contract_signed_email}
              requiresCard={load.contract_requires_card}
              card={cardOnFile}
              versions={versions}
              events={contractEvents ?? []}
            />
          </SectionBand>
          )}

          {/* Phase 6a. The mirror image of E-Sign above: that band is for work
              that came off, this one is for work that did not. It shows on a
              quote, where the outcome is still open, and on anything already
              closed so a wrong call can be corrected. 6,612 quotes in this book
              died with no reason recorded — this is the only thing that stops
              that number growing. */}
          {lanePricingEnabled && (
            <SectionBand title="Quote outcome">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {isPreOrder
                    ? "When this is decided either way, say why. Win/loss at a given price is the most valuable pricing data we have, and it only exists if somebody records it."
                    : "Already an order — recording the outcome here corrects the pricing record without touching the load."}
                </p>
                <QuoteOutcomeForm loadId={load.id} open={isPreOrder} />
              </div>
            </SectionBand>
          )}

          {/* Phase 2, and it renders only where it means something: an order
              (a quote has nobody hauling it) with the flag on. When the flag is
              off this band does not exist, which is what "shipped dark" means. */}
          {showTracking && (
            <SectionBand title="Tracking">
              <div className="space-y-4">
                <TrackingPanel
                  loadId={load.id}
                  readOnly={readOnly}
                  driverToken={driverTokenInfo}
                  customerToken={customerTokenInfo}
                  driverPhone={load.driver_phone}
                />
                <LiveTrackingMap
                  loadId={load.id}
                  initialFixes={trackFixes}
                  fences={trackFences}
                />
                {fenceGaps.length > 0 && (
                  <p className="rounded-md border border-chart-2 bg-chart-2/15 px-3 py-2 text-sm">
                    {fenceGaps
                      .map((k) => `The ${k} address could not be geocoded — no arrival detection at ${k}.`)
                      .join(" ")}{" "}
                    Positions still record; only automatic arrival detection is lost.
                  </p>
                )}
                {fenceEvents.length > 0 && (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {fenceEvents.map((e) => (
                      <li key={`${e.fence}-${e.transition}`}>
                        {e.transition === "arrived" ? "Arrived at" : "Departed"} {e.fence} —{" "}
                        {formatDateTime(e.occurred_at)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SectionBand>
          )}

          <SectionBand title="Order Information">
            <div className="grid gap-8 sm:grid-cols-2">
              <div className="space-y-4">
                <Field label="Assigned To">
                  {assignedTo ? assignedTo.full_name || assignedTo.email : "—"}
                </Field>
                <Field label="Shipper">
                  {customer ? (
                    <div className="space-y-1">
                      <Link
                        href={`/customers/${customer.id}`}
                        className="text-msg-link hover:underline"
                      >
                        {customer.contact_name}
                      </Link>
                      {customer.phone && (
                        <p className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                          {formatPhone(customer.phone)}
                          <span className="rounded-md bg-muted px-1 py-0.5 text-xs uppercase">
                            sms
                          </span>
                        </p>
                      )}
                      {customer.email && (
                        // Truncation is a desktop affordance — in the one-column
                        // phone layout a half-shown address identifies nobody.
                        <p className="truncate text-sm text-muted-foreground max-md:whitespace-normal max-md:break-all">
                          {customer.email}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Field>
              </div>
              <div className="space-y-3">
                {/* Column-header brown, matching the list headers. */}
                <p className="text-sm text-msg-header">Vehicles</p>
                {vehicles.length === 0 && <p className="text-sm text-muted-foreground">No vehicles.</p>}
                {vehicles.map((v) => (
                  <div key={v.id} className="flex items-start gap-3">
                    <VehiclePhotoEditor
                      loadId={load.id}
                      vehicleId={v.id}
                      year={v.year}
                      make={v.make}
                      model={v.model}
                      type={v.vehicle_type}
                      hasOverride={Boolean(v.photo_path)}
                      readOnly={readOnly}
                    />
                    <div>
                      <p className="text-sm">
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                        <span className="ml-1 text-sm text-muted-foreground">({v.vehicle_type})</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {v.condition === "non_running" ? "Non-running" : "Running"}
                        {v.tariff != null ? ` · ${formatCurrency(v.tariff)}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionBand>

          <SectionBand title="Payments & Dates">
            <div className="grid gap-x-12 gap-y-1 sm:grid-cols-2">
              <div>
                <BandRow label="Tariff" value={formatCurrency(load.customer_rate)} />
                <BandRow label="Required Deposit" value={formatCurrency(load.deposit_amount)} />
                <BandRow label="Received" value={formatCurrency(load.received_amount)} />
                {canManageCarrier && (
                  <>
                    {/* Says which number this is. Until a carrier agrees one,
                        it is total − reservation fee — what goes on the board,
                        not what anybody is owed. */}
                    <BandRow
                      label="Carrier Pay"
                      value={
                        load.carrier_pay != null && !load.carrier_pay_confirmed
                          ? `${formatCurrency(load.carrier_pay)} (offer)`
                          : formatCurrency(load.carrier_pay)
                      }
                    />
                    <BandRow label="Carrier received" value={formatCurrency(load.carrier_received)} />
                    <BandRow label="COD to Carrier" value={formatCurrency(load.cod_to_carrier)} />
                  </>
                )}
              </div>
              <div>
                <BandRow label="1st Avail Pickup" value={formatDate(load.pickup_ready_date)} />
                <BandRow label="Date Signed" value={formatDate(load.date_signed)} />
                <BandRow label="Dispatched" value={formatDate(load.dispatched_at)} />
                <BandRow label="Delivery" value={formatDate(load.delivery_eta)} />
                <BandRow label="Picked-up" value={formatDate(load.picked_up_at)} />
                <BandRow label="Delivered" value={formatDate(load.delivered_at)} />
              </div>
            </div>
            {(load.cd_external_id || load.sd_external_id) && (
              <p className="mt-4 border-t pt-3 text-sm">
                <span className="text-muted-foreground">Posted order ID: </span>
                {load.cd_external_id && <span>CD {load.cd_external_id}</span>}
                {load.cd_external_id && load.sd_external_id && " · "}
                {load.sd_external_id && <span>SD {load.sd_external_id}</span>}
              </p>
            )}
          </SectionBand>

          <SectionBand title="Shipping Information">
            <div className="grid gap-8 sm:grid-cols-2">
              {/* pre-wrap only breaks at spaces: a pasted URL or an unspaced
                  auction reference overflows the narrow phone column, and the
                  band's overflow-hidden clips it rather than scrolling. */}
              <Field label="Information for shipper">
                <span className="whitespace-pre-wrap max-md:break-words">{load.shipper_info || "—"}</span>
              </Field>
              <Field label="Notes from Shipper">
                <span className="whitespace-pre-wrap max-md:break-words">{load.notes || "—"}</span>
              </Field>
            </div>
          </SectionBand>

          <SectionBand title="Internal Notes">
            <NotesThread loadId={load.id} notes={threadNotes} readOnly={readOnly} />
          </SectionBand>

          {/* msgplane's Dispatch Information band: the carrier, how they get
              paid, and who's driving — visible on every order record. */}
          {stage === "order" && (
            <SectionBand
              title="Dispatch Information"
              action={
                canManageCarrier ? (
                  <span className="flex items-center gap-3 max-md:flex-wrap">
                    <Link
                      href={`/loads/${load.id}/dispatch/print`}
                      className="text-xs uppercase text-primary-foreground hover:underline max-md:inline-flex max-md:min-h-12 max-md:items-center"
                    >
                      Print sheet
                    </Link>
                    <Link
                      href={`/loads/${load.id}/dispatch`}
                      className="text-xs uppercase text-primary-foreground hover:underline max-md:inline-flex max-md:min-h-12 max-md:items-center"
                    >
                      Edit dispatch sheet
                    </Link>
                  </span>
                ) : undefined
              }
            >
              <div className="grid gap-8 sm:grid-cols-2">
                <div className="space-y-3">
                  <Field label="Carrier">
                    {carrierRow ? (
                      <span>
                        <Link
                          href={`/carriers/${(carrierRow as { id: string }).id}`}
                          className="text-msg-link hover:underline"
                        >
                          {(carrierRow as { company_name: string }).company_name}
                        </Link>
                        {(carrierRow as { phone: string | null }).phone && (
                          <span className="ml-2 tabular-nums text-muted-foreground">
                            {formatPhone((carrierRow as { phone: string | null }).phone)}
                          </span>
                        )}
                        {(carrierRow as { source: string | null }).source && (
                          <span className="ml-2 text-sm text-muted-foreground">
                            ({(carrierRow as { source: string | null }).source === "cd"
                              ? "CentralDispatch"
                              : "SuperDispatch"})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">— (CentralDispatch)</span>
                    )}
                  </Field>
                  <Field label="Driver">
                    {[load.driver_first_name, load.driver_last_name].filter(Boolean).join(" ") ||
                    load.driver_phone ? (
                      <span>
                        {[load.driver_first_name, load.driver_last_name].filter(Boolean).join(" ") || "—"}
                        {load.driver_phone && (
                          <span className="ml-2 tabular-nums text-muted-foreground">
                            {formatPhone(load.driver_phone)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Field>
                  {load.dispatch_instructions && (
                    <Field label="Dispatch instructions">
                      <span className="whitespace-pre-wrap max-md:break-words">
                        {load.dispatch_instructions}
                      </span>
                    </Field>
                  )}
                </div>
                <div>
                  <BandRow label="Balance Paid By" value={load.balance_paid_by ?? "COD to Carrier"} />
                  <BandRow label="COD/COP Method" value={load.cod_method ?? "Cash/Certified Funds"} />
                  <BandRow label="Payment Terms" value={load.payment_terms ?? "immediately"} />
                  <BandRow label="Terms Begin" value={load.terms_begin ?? "delivery"} />
                  <BandRow label="Payment Method" value={load.payment_method ?? "Cash"} />
                </div>
              </div>
            </SectionBand>
          )}

          {/* The old system's Messages table under the record: Type / From /
              Subject / Created By / Created, newest first. */}
          <SectionBand title="Messages" bodyClassName="p-0">
            <div className="overflow-x-auto">
              {/* Squeezed to min-content on a phone the Subject column drops to
                  a word per line, so below md the table pans in the scroller it
                  already has instead of compressing. */}
              <table className="w-full border-collapse text-sm max-md:min-w-[42rem]">
                <thead>
                  <tr className="border-b text-left text-msg-header [&>th]:px-4 [&>th]:py-2 [&>th]:font-normal">
                    <th className="w-14">Type</th>
                    <th className="w-48">From</th>
                    <th>Subject</th>
                    <th className="w-32">Created By</th>
                    <th className="w-24">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => {
                    const from =
                      m.direction === "inbound"
                        ? formatPhone(customer?.phone ?? null) || customer?.contact_name || "Customer"
                        : m.channel === "email"
                          ? (process.env.EMAIL_FROM_ADDRESS ?? "dispatch@mail.carshiphelp.com")
                          : "+18657227114";
                    const by =
                      m.sent_by &&
                      (profById.get(m.sent_by)?.full_name || profById.get(m.sent_by)?.email);
                    return (
                      <tr key={m.id} className="border-b last:border-b-0 align-top">
                        <td className="px-4 py-2.5">
                          {m.channel === "email" ? (
                            <Mail className="size-4 text-destructive" aria-label="Email" />
                          ) : (
                            /* Spec's phone icon is ink; bg-foreground/text-background
                               keeps that reading in both themes. */
                            <span
                              className="inline-flex h-4 items-center rounded-sm bg-foreground px-1.5 text-xs leading-none text-background"
                              aria-label="SMS"
                            >
                              •••
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{from}</td>
                        <td className="px-4 py-2.5">
                          {/* Subjects are body ink in msgplane — the amber was
                              never part of the palette. */}
                          <span>{m.subject || m.body}</span>
                          {m.direction === "inbound" && !m.read_at && (
                            <span className="ml-2 rounded-md bg-primary/10 px-1.5 text-xs text-primary">
                              unread
                            </span>
                          )}
                          {m.status === "failed" && (
                            <span className="ml-2 rounded-md bg-destructive/10 px-1.5 text-xs text-destructive">
                              failed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {by ? (
                            <span>{by}</span>
                          ) : (
                            <span className="text-muted-foreground" />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                          {formatDate(m.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                  {messages.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-muted-foreground">
                        {/* The conversation itself stays with the rep who owns
                            the shipper — a shared record is not a shared inbox.
                            Saying "no messages" to everyone else would be
                            stating something this page cannot know. */}
                        {readOnly
                          ? `The conversation with this shipper is visible to ${ownerName ?? "its owner"}.`
                          : "No messages with this customer yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t px-5 py-3">
              <Link
                href={`/customers/${load.customer_id}`}
                className="text-sm text-msg-link hover:underline"
              >
                Open conversation →
              </Link>
            </div>
          </SectionBand>

          <SectionBand title="History" bodyClassName="p-0" className="scroll-mt-4" id="history">
            <EventTimeline events={eventRows} profById={profById} />
          </SectionBand>
      </div>

      {/* Record footer, as in the old system: more options on the left, back to
          the list on the right. More is w-full (see order-more-menu), so below
          md the row has to wrap or the rest lays out past the right edge. */}
      <div className="flex items-center gap-2 border-t pt-3 max-md:flex-wrap max-md:gap-3 max-md:[&_button]:min-h-12">
        <OrderMoreMenu
          loadId={load.id}
          customerId={load.customer_id}
          blacklisted={customer?.blacklisted ?? false}
          canManage={canManageCarrier}
          readOnly={readOnly}
        />
        {profile.role === "admin" && (
          <DeleteButton
            onDelete={boundDelete}
            confirmMessage={`Delete ${load.load_number}? This cannot be undone.`}
          />
        )}
        <span className="ml-auto" />
        <Button
          variant="secondary"
          size="sm"
          className="max-md:min-h-12"
          render={<Link href={backPath} />}
        >
          Back to list
        </Button>
        {/* msgplane's orange NEXT — straight to the next record in this list. */}
        {nextRow?.id && (
          <Button
            size="sm"
            className="bg-chart-2 uppercase text-msg-selected-foreground hover:bg-chart-2/85 max-md:min-h-12"
            render={<Link href={`/loads/${nextRow.id}`} />}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
