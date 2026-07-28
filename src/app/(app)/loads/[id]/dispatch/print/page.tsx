import { notFound, redirect } from "next/navigation";
import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";
import { COMPANY } from "@/lib/esign-terms";
import { DISPATCH_TERM_DEFAULTS } from "@/lib/dispatch-terms";
import type { Customer, Load, LoadVehicle } from "@/types/database";
import { PrintButton } from "./print-button";

// The dispatch sheet the carrier receives — the document a dispatcher prints
// or PDFs and sends with the load. Deliberately plain: black on white, no app
// chrome, so it prints identically everywhere.
export default async function DispatchSheetPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "dispatcher") redirect(`/loads/${id}`);

  const supabase = await createClient();
  const { data: loadData } = await supabase
    .from(MANAGER_LOADS_TABLE)
    .select("*")
    .eq("id", id)
    .single();
  if (!loadData) notFound();
  const load = loadData as Load;

  const [{ data: customerData }, { data: vehiclesData }, { data: carrierRow }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", load.customer_id).single(),
    supabase.from("load_vehicles").select("*").eq("load_id", id).order("created_at"),
    load.carrier_id
      ? supabase
          .from("carriers")
          .select("company_name, contact_name, phone, email, mc_number, city, state")
          .eq("id", load.carrier_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const customer = customerData as Customer | null;
  const vehicles = (vehiclesData ?? []) as LoadVehicle[];
  const carrier = carrierRow as {
    company_name: string;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    mc_number: string | null;
    city: string | null;
    state: string | null;
  } | null;

  const cell = "border border-black px-2 py-1 align-top";
  const label = (t: string) => <span className="font-bold">{t}: </span>;

  const party = (
    title: string,
    name: string | null,
    company: string | null,
    address: string | null,
    city: string | null,
    state: string | null,
    zip: string | null,
    phone: string | null,
    cell2: string | null,
    date: string | null,
    dateLabel: string
  ) => (
    <td className={cell} style={{ width: "50%" }}>
      <p className="mb-1 font-bold underline">{title}</p>
      <p>{label("Name")}{name || "—"}</p>
      {company && <p>{label("Company")}{company}</p>}
      <p>{label("Address")}{address || "—"}</p>
      <p>
        {label("City/State/Zip")}
        {[city, state, zip].filter(Boolean).join(", ") || "—"}
      </p>
      <p>{label("Phone")}{phone ? formatPhone(phone) : "—"}</p>
      {cell2 && <p>{label("Cell")}{formatPhone(cell2)}</p>}
      <p>{label(dateLabel)}{formatDate(date)}</p>
    </td>
  );

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-[13px] leading-snug text-black print:p-0">
      <PrintButton />

      <div className="mb-3 flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <h1 className="text-xl font-bold">{COMPANY.name}</h1>
          <p>M.C.# {COMPANY.mcNumber}</p>
          <p>{COMPANY.website}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">DISPATCH SHEET</p>
          <p>Order #{load.load_number}</p>
          <p>Date: {formatDate(new Date().toISOString())}</p>
        </div>
      </div>

      {/* Carrier block — who is hauling and for how much. */}
      <table className="mb-3 w-full border-collapse">
        <tbody>
          <tr>
            <td className={cell}>
              <p className="mb-1 font-bold underline">CARRIER</p>
              <p>{label("Company")}{carrier?.company_name || "—"}</p>
              <p>{label("Contact")}{carrier?.contact_name || "—"}</p>
              <p>{label("Phone")}{carrier?.phone ? formatPhone(carrier.phone) : "—"}</p>
              <p>{label("MC #")}{carrier?.mc_number || "—"}</p>
              <p>
                {label("Driver")}
                {[load.driver_first_name, load.driver_last_name].filter(Boolean).join(" ") || "—"}
                {load.driver_phone ? ` · ${formatPhone(load.driver_phone)}` : ""}
              </p>
            </td>
            <td className={cell}>
              <p className="mb-1 font-bold underline">PAYMENT TERMS</p>
              <p>{label("Carrier pay")}{formatCurrency(load.carrier_pay)}</p>
              <p>{label("Balance paid by")}{load.balance_paid_by ?? DISPATCH_TERM_DEFAULTS.balance_paid_by}</p>
              <p>{label("COD/COP method")}{load.cod_method ?? DISPATCH_TERM_DEFAULTS.cod_method}</p>
              <p>{label("Payment terms")}{load.payment_terms ?? DISPATCH_TERM_DEFAULTS.payment_terms}</p>
              <p>{label("Terms begin")}{load.terms_begin ?? DISPATCH_TERM_DEFAULTS.terms_begin}</p>
              <p>{label("Payment method")}{load.payment_method ?? DISPATCH_TERM_DEFAULTS.payment_method}</p>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Origin / destination */}
      <table className="mb-3 w-full border-collapse">
        <tbody>
          <tr>
            {party(
              "PICKUP",
              load.pickup_contact_name || customer?.contact_name || null,
              load.pickup_company,
              load.pickup_address,
              load.pickup_city,
              load.pickup_state,
              load.pickup_zip,
              load.pickup_contact_phone || customer?.phone || null,
              load.pickup_contact_cell,
              load.pickup_ready_date,
              "1st available"
            )}
            {party(
              "DELIVERY",
              load.delivery_contact_name || customer?.contact_name || null,
              load.delivery_company,
              load.delivery_address,
              load.delivery_city,
              load.delivery_state,
              load.delivery_zip,
              load.delivery_contact_phone || customer?.phone || null,
              load.delivery_contact_cell,
              load.delivery_eta,
              "Estimated delivery"
            )}
          </tr>
        </tbody>
      </table>

      {/* Vehicles — the only table here wide enough to put the document itself
          on a horizontal scrollbar (a VIN alone is ~105px of unbreakable
          min-content), so below md it pans inside its own scroller. Print
          media measures the paper box, not the viewport, so the sheet is
          unaffected. */}
      <div className="max-md:overflow-x-auto">
        <table className="mb-3 w-full border-collapse">
          <thead>
            <tr className="bg-black text-white">
              <th className={`${cell} text-left`}>Year</th>
              <th className={`${cell} text-left`}>Make</th>
              <th className={`${cell} text-left`}>Model</th>
              <th className={`${cell} text-left`}>Type</th>
              <th className={`${cell} text-left`}>VIN</th>
              <th className={`${cell} text-left`}>Plate</th>
              <th className={`${cell} text-left`}>Lot #</th>
              <th className={`${cell} text-left`}>Runs</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td className={cell}>{v.year ?? "—"}</td>
                <td className={cell}>{v.make ?? "—"}</td>
                <td className={cell}>{v.model ?? "—"}</td>
                <td className={cell}>{v.vehicle_type}</td>
                <td className={cell}>{v.vin ?? "—"}</td>
                <td className={cell}>
                  {[v.plate, v.plate_state].filter(Boolean).join(" ") || "—"}
                </td>
                <td className={cell}>{v.lot_number ?? "—"}</td>
                <td className={cell}>{v.condition === "non_running" ? "NO" : "Yes"}</td>
              </tr>
            ))}
            {vehicles.length === 0 && (
              <tr>
                <td className={cell} colSpan={8}>
                  No vehicles listed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <table className="mb-3 w-full border-collapse">
        <tbody>
          <tr>
            <td className={cell}>
              <p className="font-bold underline">TRANSPORT</p>
              <p className="capitalize">{label("Ship via")}{load.transport_type}</p>
              {load.cd_note && <p>{label("CD note")}{load.cd_note}</p>}
            </td>
            <td className={cell}>
              <p className="font-bold underline">DISPATCH INSTRUCTIONS</p>
              <p className="whitespace-pre-wrap">{load.dispatch_instructions || "—"}</p>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-6 border-t border-black pt-3">
        <p className="mb-6 text-[11px]">
          By accepting this dispatch the carrier confirms active authority and insurance, agrees to
          the payment terms above, and agrees to provide a signed Bill of Lading at both pickup and
          delivery. Damage claims must be noted on the Bill of Lading at delivery.
        </p>
        <div className="flex gap-8">
          <p className="flex-1 border-t border-black pt-1">Carrier signature / date</p>
          <p className="flex-1 border-t border-black pt-1">Dispatcher: {COMPANY.name}</p>
        </div>
      </div>
    </div>
  );
}
