import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { VehiclePhoto } from "@/components/vehicle-photo";
import { requireProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { DeleteButton } from "@/components/delete-button";
import { SectionBand, BandRow, Field } from "@/components/section-band";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";
import { actionsFor, stageOf } from "@/lib/order-status";
import { ArrowDownLeft, ArrowUpRight, Mail, MessageSquareText } from "lucide-react";
import type {
  Customer,
  Load,
  LoadStatusHistoryEntry,
  LoadVehicle,
  Message,
  Profile,
} from "@/types/database";
import { OrderActionBar } from "./order-action-bar";
import { EsignPanel } from "./esign-panel";
import { OrderMoreMenu } from "./order-more-menu";
import { NotesThread } from "./notes-thread";
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

  const loadboard =
    load.posted_to_central_dispatch_at && load.posted_to_super_dispatch_at
      ? "All"
      : load.posted_to_central_dispatch_at
        ? "CD"
        : load.posted_to_super_dispatch_at
          ? "SD"
          : "—";

  const boundDelete = deleteLoad.bind(null, load.id);
  const backPath = BACK_PATH[stageOf(load.status)];

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
      {/* Record header, laid out like the system this replaces: the ID/Status/
          Campaign/Loadboard facts on the left, the lifecycle actions as a row
          of buttons on the right. */}
      <div className="rounded-lg border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <Field label="ID">
              <Link
                href={backPath}
                className="text-base font-bold tabular-nums text-primary hover:underline"
              >
                {load.load_number}
              </Link>
            </Field>
            <Field label="Status">
              <span className="flex items-center gap-2">
                <StatusBadge status={load.status} />
                {customer?.blacklisted && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 ring-1 ring-inset ring-red-600/20 dark:bg-red-400/15 dark:text-red-300">
                    Blacklisted
                  </span>
                )}
              </span>
            </Field>
            <Field label="Campaign">{load.campaign || "—"}</Field>
            <Field label="Loadboard">{loadboard}</Field>
            <Field label="Tariff">
              <span className="font-bold tabular-nums">{formatCurrency(load.customer_rate)}</span>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrderActionBar loadId={load.id} actions={actionsFor(load.status, profile.role)} />
            <Button size="sm" variant="secondary" render={<Link href={`/loads/${load.id}/edit`} />}>
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
                        className="font-semibold text-primary hover:underline"
                      >
                        {customer.contact_name}
                      </Link>
                      {customer.phone && (
                        <p className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                          {formatPhone(customer.phone)}
                          <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase">
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
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Vehicles
                </p>
                {vehicles.length === 0 && <p className="text-sm text-muted-foreground">No vehicles.</p>}
                {vehicles.map((v) => (
                  <div key={v.id} className="flex items-center gap-3">
                    <VehiclePhoto
                      year={v.year}
                      make={v.make}
                      model={v.model}
                      type={v.vehicle_type}
                      className="h-12 w-[4.5rem] rounded-md"
                    />
                    <div>
                      <p className="text-[15px] font-medium">
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
                <span className="font-semibold">Posted order ID: </span>
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
              <Field label="Notes from shipper">
                <span className="whitespace-pre-wrap">{load.notes || "—"}</span>
              </Field>
            </div>
          </SectionBand>

          <SectionBand title="Internal Notes">
            <NotesThread loadId={load.id} notes={threadNotes} />
          </SectionBand>

          <SectionBand title="Messages" bodyClassName="p-0">
            <div className="divide-y">
              {messages.map((m) => {
                const sender =
                  m.direction === "inbound"
                    ? customer?.contact_name || "Customer"
                    : (m.sent_by && (profById.get(m.sent_by)?.full_name || profById.get(m.sent_by)?.email)) ||
                      "System";
                return (
                  <div key={m.id} className="flex gap-3 px-5 py-3 text-sm">
                    <span
                      className={
                        m.direction === "inbound"
                          ? "mt-0.5 text-emerald-600 dark:text-emerald-400"
                          : "mt-0.5 text-muted-foreground"
                      }
                    >
                      {m.direction === "inbound" ? (
                        <ArrowDownLeft className="size-4" aria-label="Inbound" />
                      ) : (
                        <ArrowUpRight className="size-4" aria-label="Outbound" />
                      )}
                    </span>
                    <span className="mt-0.5 text-muted-foreground">
                      {m.channel === "email" ? (
                        <Mail className="size-4" aria-label="Email" />
                      ) : (
                        <MessageSquareText className="size-4" aria-label="SMS" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-medium">{sender}</span>
                        {m.direction === "inbound" && !m.read_at && (
                          <span className="rounded bg-blue-100 px-1.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                            unread
                          </span>
                        )}
                        {m.load_id === load.id && (
                          <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">
                            this order
                          </span>
                        )}
                        {m.status === "failed" && (
                          <span className="rounded bg-red-100 px-1.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                            failed
                          </span>
                        )}
                        {m.status === "queued" && (
                          <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            queued
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatDate(m.created_at)}
                        </span>
                      </div>
                      {m.subject && <p className="truncate font-medium">{m.subject}</p>}
                      <p className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
                        {m.body}
                      </p>
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  No messages with this customer yet.
                </p>
              )}
            </div>
            <div className="border-t px-5 py-3">
              <Link
                href={`/messages/thread/${load.customer_id}`}
                className="text-sm font-medium text-primary hover:underline"
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
      </div>
    </div>
  );
}
