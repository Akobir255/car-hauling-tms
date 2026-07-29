import { CircleDollarSign, Fuel, House, Receipt, Route, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  COMPANY,
  CONTRACT_LINK_EXPIRY_DAYS,
  TERMS_SECTIONS,
  isContractLinkExpired,
} from "@/lib/esign-terms";
import { VehiclePhoto } from "@/components/vehicle-photo";
import type { Load, LoadVehicle } from "@/types/database";
import { SignatureForm } from "./sign-button";

// Public, no-login contract page reached from the SMS/email link — styled as
// the Order Invoice sheet msgplane sends (letterhead, shipper/shipping info,
// origin/destination, vehicle table, totals, terms, then the signature area,
// with card fields when this contract version requires them). Loads by the
// unguessable token via the service-role client (like the webhooks). Shows
// only what the customer needs to see — never carrier pay or internal fields.
export const dynamic = "force-dynamic";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: loadData } = await supabase
    .from("loads")
    .select("*")
    .eq("contract_token", token)
    .maybeSingle();

  if (!loadData) notFound();
  const load = loadData as Load;

  // Audit: log every open of the link (IP + user agent). Bots that scan SMS
  // links get logged too — the user agent tells them apart.
  const hdrs = await headers();
  const viewIp = (hdrs.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const viewUa = (hdrs.get("user-agent") || "").slice(0, 300) || null;
  await supabase
    .from("contract_events")
    .insert({ load_id: load.id, event: "viewed", ip: viewIp, user_agent: viewUa });

  // Expired link: keep the audit log entry above, show nothing signable.
  if (isContractLinkExpired(load.contract_sent_at, load.date_signed)) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-16 text-center">
        <BrandMark className="mx-auto size-14" />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">This signing link has expired</h1>
          <p className="text-muted-foreground">
            For your security, contract links stop working after a while. Please contact your
            agent at US Star Trucking and they&apos;ll send you a fresh one.
          </p>
        </div>
      </div>
    );
  }

  const [{ data: customer }, { data: vehiclesData }] = await Promise.all([
    supabase
      .from("customers")
      .select("contact_name, company_name, phone, email")
      .eq("id", load.customer_id)
      .single(),
    supabase.from("load_vehicles").select("*").eq("load_id", load.id).order("created_at"),
  ]);
  const vehicles = (vehiclesData ?? []) as LoadVehicle[];

  const firstName = (customer?.contact_name || "there").split(/\s+/)[0];
  const phoneDigits = (customer?.phone || "").replace(/\D/g, "") || null;
  const total = load.customer_rate;
  const reservation = load.deposit_amount;
  const codToCarrier =
    total != null ? Math.max(0, total - (reservation ?? 0)) : null;
  const allRun = vehicles.length > 0 && vehicles.every((v) => v.condition !== "non_running");
  const signable = Boolean(load.contract_sent_at || load.date_signed);

  // An address a person reads, not a form they fill in. The old block printed
  // "State/Zip: TX/77642" — correct, and nothing anybody says out loud.
  const addressCard = (
    title: string,
    contact: string | null,
    company: string | null,
    phone: string | null,
    address: string | null,
    city: string | null,
    state: string | null,
    zip: string | null
  ) => (
    <div className="rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 font-semibold">{contact || "—"}</p>
      {company && <p className="text-sm text-muted-foreground">{company}</p>}
      {address && <p className="mt-1 text-sm">{address}</p>}
      <p className="text-sm">{[city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
      {phone && <p className="mt-2 text-sm tabular-nums text-muted-foreground">{phone}</p>}
    </div>
  );

  const summaryRow = (label: string, value: React.ReactNode) => (
    <tr className="border-b last:border-b-0">
      <th scope="row" className="w-2/5 px-4 py-3 text-left font-medium text-muted-foreground">
        {label}
      </th>
      <td className="px-4 py-3">{value || "—"}</td>
    </tr>
  );

  // The headline names the thing being moved and where it is going, because
  // that — not the word "invoice" — is what tells somebody the document in
  // front of them is theirs.
  const firstVehicle = vehicles[0];
  const vehicleName =
    [firstVehicle?.year, firstVehicle?.make, firstVehicle?.model].filter(Boolean).join(" ") ||
    "your vehicle";
  const destination = [load.delivery_city, load.delivery_state].filter(Boolean).join(", ");
  const origin = [load.pickup_city, load.pickup_state].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-neutral-200 pb-16 dark:bg-neutral-900">
      {/* msgplane's sticky "Please review and sign / GET STARTED" bar. */}
      {signable && !load.date_signed && (
        <div className="sticky top-0 z-20 flex items-center justify-center gap-4 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-950">
          <span className="text-sm font-medium text-muted-foreground">Please review and sign</span>
          <a
            href="#signature"
            className="rounded bg-green-600 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow hover:bg-green-700"
          >
            Get started
          </a>
        </div>
      )}

      {/* The invoice sheet. */}
      <div className="mx-auto mt-8 max-w-3xl bg-white px-8 py-10 text-neutral-900 shadow-lg sm:px-12 dark:bg-neutral-950 dark:text-neutral-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark className="size-11 shrink-0" />
            <div>
              <p className="text-base font-semibold leading-tight">{COMPANY.name}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                Licensed transport broker · M.C. #{COMPANY.mcNumber}
              </p>
            </div>
          </div>
          <div className="text-right text-sm leading-relaxed">
            <p className="font-semibold">Transport Agreement</p>
            <p className="tabular-nums text-muted-foreground">{load.load_number}</p>
            <p className="tabular-nums text-muted-foreground">{formatDate(load.created_at)}</p>
          </div>
        </div>

        {/* Lead with what is being moved and what it costs. "Order Invoice"
            described the document; this describes the customer's shipment. */}
        <div className="mt-7">
          <p className="text-sm text-muted-foreground">Hello {firstName},</p>
          <h1 className="mt-1.5 text-pretty text-2xl font-bold leading-snug tracking-tight sm:text-3xl">
            Ship your {vehicleName}
            {destination ? ` to ${destination}` : ""}
            {total != null ? ` for ${formatCurrency(total)}` : ""}
          </h1>
          {(origin || destination) && (
            <p className="mt-2 text-sm text-muted-foreground">
              {origin || "—"} to {destination || "—"} · {load.transport_type} carrier · collected
              from {formatDate(load.pickup_ready_date)}
            </p>
          )}
        </div>

        {/* The money, before the paperwork. Three numbers, said once. */}
        <div className="mt-6 rounded-lg border bg-muted/40 px-5 py-5">
          <p className="text-4xl font-bold tabular-nums tracking-tight">{formatCurrency(total)}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Total for the move, as agreed with your agent.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3 border-t pt-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Reservation, on signing
              </p>
              <p className="text-lg font-semibold tabular-nums">{formatCurrency(reservation)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                To the carrier on delivery
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {codToCarrier != null ? formatCurrency(codToCarrier) : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* What happens next, taken from clause 9 of the agreement below rather
            than invented — the contract already promises this sequence. */}
        <ol className="mt-5 grid gap-px overflow-hidden rounded-lg border bg-border text-sm sm:grid-cols-3">
          {[
            ["You sign", "We start finding a carrier for your vehicle."],
            ["We assign a carrier", "We call or email you to confirm the schedule."],
            ["You get the driver", "Their contact details are emailed to you."],
          ].map(([step, detail], i) => (
            <li key={step} className="bg-card px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Step {i + 1}
              </p>
              <p className="mt-0.5 font-medium">{step}</p>
              <p className="mt-0.5 text-muted-foreground">{detail}</p>
            </li>
          ))}
        </ol>

        {/* Your Transport Summary — one table, the way the competitor's quote
            does it, instead of two centred lists the reader has to reconcile. */}
        <h2 className="mt-9 text-center text-lg font-bold tracking-tight">
          Your Transport Summary
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {summaryRow(
                "Vehicle(s)",
                vehicles.length === 0
                  ? "—"
                  : vehicles
                      .map((v) => [v.year, v.make, v.model].filter(Boolean).join(" "))
                      .filter(Boolean)
                      .join(", ")
              )}
              {summaryRow("Condition (vehicles run)", vehicles.length === 0 ? "—" : allRun ? "Yes" : "No")}
              {summaryRow("Origin", origin || "—")}
              {summaryRow("Destination", destination || "—")}
              {summaryRow("First pickup date", formatDate(load.pickup_ready_date))}
              {summaryRow("Estimated delivery", formatDate(load.delivery_eta))}
              {summaryRow("Transport type", <span className="capitalize">{load.transport_type} carrier</span>)}
              {summaryRow(
                "Total, inclusive of taxes",
                <span className="font-semibold tabular-nums">{formatCurrency(total)}</span>
              )}
            </tbody>
          </table>
        </div>

        {/* Included — the competitor's strongest section: it answers "what am I
            actually paying for" at the moment the reader is deciding. */}
        <div className="mt-6 overflow-hidden rounded-lg bg-neutral-900 px-6 py-6 text-white dark:bg-neutral-800">
          <p className="text-center text-sm font-semibold uppercase tracking-widest text-neutral-300">
            Included in your price
          </p>
          <ul className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3">
            {[
              [Receipt, "Taxes"],
              [Route, "Tolls"],
              [Fuel, "Fuel"],
              [House, "Door to door"],
              [ShieldCheck, "Carrier insurance"],
              [CircleDollarSign, "No hidden fees"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Receipt;
              return (
                <li key={label as string} className="flex flex-col items-center gap-2 text-center">
                  <span className="flex size-11 items-center justify-center rounded-lg bg-red-600">
                    <I className="size-5" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-medium leading-tight">{label as string}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {addressCard(
            "Collection",
            load.pickup_contact_name || customer?.contact_name || null,
            load.pickup_company,
            load.pickup_contact_phone || phoneDigits,
            load.pickup_address,
            load.pickup_city,
            load.pickup_state,
            load.pickup_zip
          )}
          {addressCard(
            "Delivery",
            load.delivery_contact_name || customer?.contact_name || null,
            load.delivery_company,
            load.delivery_contact_phone || phoneDigits,
            load.delivery_address,
            load.delivery_city,
            load.delivery_state,
            load.delivery_zip
          )}
        </div>

        {/* Vehicle table, black header like the original. */}
        <table className="mt-6 w-full border-collapse overflow-hidden rounded-lg text-sm ring-1 ring-border">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Vehicle
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Type
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tariff
              </th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-b">
                <td className="px-4 py-3">
                  <VehiclePhoto
                    year={v.year}
                    make={v.make}
                    model={v.model}
                    type={v.vehicle_type}
                    className="h-16 w-24 rounded"
                  />
                  <p className="mt-1 font-medium">
                    {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                  </p>
                </td>
                <td className="px-4 py-3 capitalize">{v.vehicle_type}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {v.tariff != null
                    ? formatCurrency(v.tariff)
                    : vehicles.length === 1
                      ? formatCurrency(total)
                      : "—"}
                </td>
              </tr>
            ))}
            {vehicles.length === 0 && (
              <tr className="border-b">
                <td className="px-4 py-3 text-muted-foreground" colSpan={3}>
                  No vehicles listed.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* The totals panel that used to sit here is gone: the same three
            numbers are stated at the top of the page now, and a contract that
            prints its price twice invites the reader to check whether the two
            agree. */}
        {load.shipper_info && (
          <div className="border-b px-4 py-4">
            <p className="font-bold">Info for Shipper</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {load.shipper_info}
            </p>
          </div>
        )}

        {/* The agreement itself — prints in full. Given a hanging indent and
            room to breathe: it is the part with legal weight, and a wall of
            unbroken clauses is what makes people sign without reading. */}
        <div className="mt-10 space-y-7">
          {TERMS_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="border-b pb-2 text-base font-bold tracking-tight">{section.heading}</h2>
              {section.intro && (
                <p className="mt-3 text-sm font-medium italic text-muted-foreground">{section.intro}</p>
              )}
              <dl className="mt-3 space-y-2.5 text-sm leading-relaxed">
                {section.clauses.map((c) => (
                  <div key={c.label} className="flex gap-3">
                    <dt className="w-5 shrink-0 font-bold tabular-nums text-muted-foreground">
                      {c.label}
                    </dt>
                    <dd className={c.important ? "font-semibold" : "text-muted-foreground"}>
                      {c.body}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div id="signature" className="mt-10 scroll-mt-16 border-t pt-8">
          {signable ? (
            <SignatureForm
              token={token}
              alreadySigned={Boolean(load.date_signed)}
              signedName={load.contract_signed_name}
              requiresCard={load.contract_requires_card}
            />
          ) : (
            // Not formally sent yet (e.g. a staff preview): show the
            // agreement, but signing stays locked until it's sent.
            <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
              This contract hasn&apos;t been sent for signature yet. Your agent will send you an
              active signing link.
            </div>
          )}

          {load.date_signed && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Signed {formatDate(load.date_signed)}
              {load.contract_signed_name ? ` by ${load.contract_signed_name}` : ""}
            </p>
          )}
        </div>

        {/* The close. A licensed broker's numbers are the most reassuring thing
            on this page, so they get a footer of their own rather than a line
            in the letterhead. */}
        <div className="mt-12 border-t pt-8 text-center">
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            Thank you for choosing {COMPANY.name}. We look forward to moving your{" "}
            <span className="font-medium text-foreground">{vehicleName}</span>
            {destination ? ` to ${destination}` : ""} with care.
          </p>
          <div className="mt-5 inline-flex items-center gap-3">
            <BrandMark className="size-12 shrink-0" />
            <span className="text-left">
              <span className="block font-semibold leading-tight">{COMPANY.name}</span>
              <a
                href={COMPANY.website}
                className="text-sm text-muted-foreground underline underline-offset-2"
              >
                {COMPANY.website.replace(/^https?:\/\//, "")}
              </a>
            </span>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 font-medium tabular-nums">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              FMCSA licensed
            </span>
            <span className="rounded-md bg-muted px-2.5 py-1 font-medium tabular-nums">
              M.C. #{COMPANY.mcNumber}
            </span>
            <span className="rounded-md bg-muted px-2.5 py-1 font-medium">$75,000 surety bond</span>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            Verify our authority at fmcsa.dot.gov · Signing links expire{" "}
            {CONTRACT_LINK_EXPIRY_DAYS} days after they are sent.
          </p>
        </div>
      </div>
    </div>
  );
}
