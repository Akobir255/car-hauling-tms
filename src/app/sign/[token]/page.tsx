import { Truck } from "lucide-react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { COMPANY, TERMS_SECTIONS, isContractLinkExpired } from "@/lib/esign-terms";
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
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Truck className="size-6" aria-hidden="true" />
        </span>
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

  const infoLine = (label: string, value: React.ReactNode) => (
    <p className="text-sm leading-relaxed">
      <span className="font-semibold">{label}: </span>
      {value || "—"}
    </p>
  );

  const partyBlock = (
    title: string,
    contact: string | null,
    company: string | null,
    phone: string | null,
    address: string | null,
    city: string | null,
    state: string | null,
    zip: string | null
  ) => (
    <div className="space-y-2">
      <h3 className="text-center text-base font-bold">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          {infoLine("Name", contact)}
          {infoLine("Company", company)}
          {infoLine("Phone", phone)}
        </div>
        <div>
          {infoLine("Address", address)}
          {infoLine("City", city)}
          {infoLine("State/Zip", [state, zip].filter(Boolean).join("/"))}
          {infoLine("Country", "United States")}
        </div>
      </div>
    </div>
  );

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
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{COMPANY.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{COMPANY.website}</p>
          </div>
          <div className="text-right text-sm leading-relaxed">
            <p className="text-xl font-semibold">Order Invoice</p>
            <p>Order Number - {load.load_number}</p>
            <p>Date Order Place - {formatDate(load.created_at)}</p>
            <p>M.C.# {COMPANY.mcNumber}</p>
          </div>
        </div>

        <div className="mt-6 border-t pt-4 text-sm leading-relaxed">
          <p>
            <span className="font-bold">Hello {firstName},</span>
          </p>
          <p>
            Here is your Shipping Order Form. Please review and sign. If you have any questions,
            don&apos;t hesitate to call or email us using the contact information below.
          </p>
        </div>

        <div className="mt-6 grid gap-6 border-t pt-4 sm:grid-cols-2">
          <div className="space-y-1 text-center text-sm">
            <h3 className="text-base font-bold">Shipper Information</h3>
            <p>{customer?.contact_name || "—"}</p>
            {phoneDigits && <p className="tabular-nums">{phoneDigits}</p>}
            {customer?.email && <p>{customer.email}</p>}
          </div>
          <div className="space-y-1 text-center text-sm">
            <h3 className="text-base font-bold">Shipping Information</h3>
            <p>1st Avail. Pickup Date: {formatDate(load.pickup_ready_date)}</p>
            <p>Estimated Load Date: {formatDate(load.pickup_ready_date)}</p>
            <p>Estimated Delivery Date: {formatDate(load.delivery_eta)}</p>
            <p className="capitalize">Ship Via: {load.transport_type}</p>
            <p>Vehicle(s) Run: {vehicles.length === 0 ? "—" : allRun ? "Yes" : "No"}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-8 border-t pt-4 sm:grid-cols-2">
          {partyBlock(
            "Origin",
            load.pickup_contact_name || customer?.contact_name || null,
            load.pickup_company,
            load.pickup_contact_phone || phoneDigits,
            load.pickup_address,
            load.pickup_city,
            load.pickup_state,
            load.pickup_zip
          )}
          {partyBlock(
            "Destination",
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
        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-900 text-left text-white dark:bg-neutral-100 dark:text-neutral-900">
              <th className="px-4 py-2.5 font-bold">Year Make Model</th>
              <th className="px-4 py-2.5 font-bold">Type</th>
              <th className="px-4 py-2.5 text-right font-bold">Tariff</th>
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

        <div className="grid grid-cols-2 border-b">
          <div className="px-4 py-4">
            <p className="text-center font-bold">Info for Shipper</p>
            {load.shipper_info && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {load.shipper_info}
              </p>
            )}
          </div>
          <div className="divide-y bg-neutral-100 text-sm dark:bg-neutral-900">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold">Total:</span>
              <span className="tabular-nums">{formatCurrency(total)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold">Reservation:</span>
              <span className="tabular-nums">{formatCurrency(reservation)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold">COD to Carrier:</span>
              <span className="tabular-nums">
                {codToCarrier != null ? formatCurrency(codToCarrier) : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* The agreement itself — prints in full. */}
        <div className="mt-10 space-y-5 text-sm leading-relaxed">
          {TERMS_SECTIONS.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-base font-bold">{section.heading}</h2>
              {section.intro && <p className="italic">{section.intro}</p>}
              {section.clauses.map((c) => (
                <p key={c.label} className={c.important ? "font-semibold" : undefined}>
                  <span className="font-bold">{c.label} -</span> {c.body}
                </p>
              ))}
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
      </div>
    </div>
  );
}
