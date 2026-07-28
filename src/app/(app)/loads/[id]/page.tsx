import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { DeleteButton } from "@/components/delete-button";
import { SectionBand, BandRow, Field } from "@/components/section-band";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";
import {
  actionsFor,
  stageOf,
  LEAD_STATUSES,
  QUOTE_STATUSES,
  ORDER_STATUSES,
} from "@/lib/order-status";
import { Mail } from "lucide-react";
import type {
  ContractCard,
  ContractVersion,
  Customer,
  Load,
  LoadRequest,
  LoadStatusHistoryEntry,
  LoadVehicle,
  Message,
  Profile,
} from "@/types/database";
import { OrderActionBar } from "./order-action-bar";
import { EsignPanel } from "./esign-panel";
import { OrderMoreMenu } from "./order-more-menu";
import { NotesThread } from "./notes-thread";
import { VehiclePhotoEditor } from "./vehicle-photo-editor";
import { LoadRequestsBand } from "./load-requests";
import { deleteLoad } from "../actions";

const BACK_PATH = { lead: "/leads", quote: "/quotes", order: "/orders" } as const;

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
    supabase
      .from("load_status_history")
      .select("*")
      .eq("load_id", id)
      .order("created_at", { ascending: false })
      .limit(12),
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
      .select("id, body, author_id, created_at, updated_at")
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
  const historyRows = (history ?? []) as LoadStatusHistoryEntry[];
  const messages = (messagesData ?? []) as Message[];

  type NoteRow = {
    id: string;
    body: string;
    author_id: string | null;
    created_at: string;
    updated_at: string;
  };
  const notesData = (noteRows ?? []) as NoteRow[];

  const profileIds = [
    ...new Set(
      [
        load.sales_owner_id,
        ...historyRows.map((h) => h.changed_by),
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
                : "—";

  const boundDelete = deleteLoad.bind(null, load.id);
  const stage = stageOf(load.status);
  const backPath = BACK_PATH[stage];
  const requests = (requestRows ?? []) as LoadRequest[];
  const versions = (versionRows ?? []) as ContractVersion[];
  const cardOnFile = ((cardRows ?? [])[0] ?? null) as ContractCard | null;

  // msgplane's orange NEXT: walk the list this record lives in (newest-first,
  // same stage) without going back to it.
  const stageStatuses =
    stage === "lead" ? LEAD_STATUSES : stage === "quote" ? QUOTE_STATUSES : ORDER_STATUSES;
  const { data: nextRow } = await supabase
    .from(canManageCarrier ? MANAGER_LOADS_TABLE : "loads_sales_safe")
    .select("id")
    .in("status", stageStatuses)
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
      authorName: author?.full_name || author?.email || "Unknown",
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
    <div className="mx-auto max-w-7xl space-y-5">
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
        />
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
            <Field label="Status">
              <span className="flex items-center gap-2">
                <StatusBadge status={load.status} />
                {/* Safety affordance — a solid destructive fill so it stays
                    loud after the pills flattened to the 3px radius. */}
                {customer?.blacklisted && (
                  <span className="rounded-md bg-destructive px-1.5 py-0.5 text-xs text-background">
                    Blacklisted
                  </span>
                )}
              </span>
            </Field>
            <Field label="Campaign">{load.campaign || "—"}</Field>
            <Field label="Loadboard">{loadboard}</Field>
            <Field label="Tariff">
              <span className="tabular-nums">{formatCurrency(load.customer_rate)}</span>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrderActionBar
              loadId={load.id}
              actions={actionsFor(load.status, profile.role)}
              loadboard={load.loadboard}
            />
            {/* msgplane's one colored header button: green EDIT. The green is
                the spec's accent (--chart-5); it takes the dark accent ink
                rather than white, which is only 3.2:1 on that fill. */}
            <Button
              size="sm"
              className="h-8 bg-chart-5 text-xs uppercase text-msg-selected-foreground hover:bg-chart-5/85"
              render={<Link href={`/loads/${load.id}/edit`} />}
            >
              Edit
            </Button>
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
          <SectionBand title="E-Sign">
            <EsignPanel
              loadId={load.id}
              token={load.contract_token}
              signedAt={load.date_signed}
              sentAt={load.contract_sent_at}
              canManage={canManageCarrier}
              signedName={load.contract_signed_name}
              signedIp={load.contract_signed_ip}
              signedEmail={load.contract_signed_email}
              requiresCard={load.contract_requires_card}
              card={cardOnFile}
              versions={versions}
              events={contractEvents ?? []}
            />
          </SectionBand>

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
                        <p className="truncate text-sm text-muted-foreground">{customer.email}</p>
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
                    <BandRow label="Carrier Pay" value={formatCurrency(load.carrier_pay)} />
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
              <Field label="Information for shipper">
                <span className="whitespace-pre-wrap">{load.shipper_info || "—"}</span>
              </Field>
              <Field label="Notes from Shipper">
                <span className="whitespace-pre-wrap">{load.notes || "—"}</span>
              </Field>
            </div>
          </SectionBand>

          <SectionBand title="Internal Notes">
            <NotesThread loadId={load.id} notes={threadNotes} />
          </SectionBand>

          {/* msgplane's Dispatch Information band: the carrier, how they get
              paid, and who's driving — visible on every order record. */}
          {stage === "order" && (
            <SectionBand
              title="Dispatch Information"
              action={
                canManageCarrier ? (
                  <span className="flex items-center gap-3">
                    <Link
                      href={`/loads/${load.id}/dispatch/print`}
                      className="text-xs uppercase text-primary-foreground hover:underline"
                    >
                      Print sheet
                    </Link>
                    <Link
                      href={`/loads/${load.id}/dispatch`}
                      className="text-xs uppercase text-primary-foreground hover:underline"
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
                      <span className="whitespace-pre-wrap">{load.dispatch_instructions}</span>
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
              <table className="w-full border-collapse text-sm">
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
                        No messages with this customer yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t px-5 py-3">
              <Link
                href={`/messages/thread/${load.customer_id}`}
                className="text-sm text-msg-link hover:underline"
              >
                Open conversation →
              </Link>
            </div>
          </SectionBand>

          <SectionBand title="History" bodyClassName="p-0" className="scroll-mt-4" id="history">
            <div className="divide-y">
              {historyRows.map((h) => {
                const who = h.changed_by ? profById.get(h.changed_by) : null;
                return (
                  <div
                    key={h.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm"
                  >
                    <StatusBadge status={h.status} />
                    <span className="text-muted-foreground">
                      {who?.full_name || who?.email || "System"}
                      {h.note ? ` — ${h.note}` : ""}
                    </span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {formatDate(h.created_at)}
                    </span>
                  </div>
                );
              })}
              {historyRows.length === 0 && (
                <p className="px-5 py-4 text-sm text-muted-foreground">No history yet.</p>
              )}
            </div>
          </SectionBand>
      </div>

      {/* Record footer, as in the old system: more options on the left,
          back to the list on the right. */}
      <div className="flex items-center gap-2 border-t pt-3">
        <OrderMoreMenu
          loadId={load.id}
          customerId={load.customer_id}
          blacklisted={customer?.blacklisted ?? false}
          canManage={canManageCarrier}
        />
        {profile.role === "admin" && (
          <DeleteButton
            onDelete={boundDelete}
            confirmMessage={`Delete ${load.load_number}? This cannot be undone.`}
          />
        )}
        <span className="ml-auto" />
        <Button variant="secondary" size="sm" render={<Link href={backPath} />}>
          Back to list
        </Button>
        {/* msgplane's orange NEXT — straight to the next record in this list. */}
        {nextRow?.id && (
          <Button
            size="sm"
            className="bg-chart-2 uppercase text-msg-selected-foreground hover:bg-chart-2/85"
            render={<Link href={`/loads/${nextRow.id}`} />}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
