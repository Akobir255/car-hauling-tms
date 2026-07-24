import type { ReactNode } from "react";
import { Truck } from "lucide-react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { TERMS_SECTIONS } from "@/lib/esign-terms";
import type { Load, LoadVehicle } from "@/types/database";
import { SignatureForm } from "./sign-button";

// Public, no-login contract page reached from the SMS/email link. Loads by the
// unguessable token via the service-role client (like the webhooks). Shows only
// what the customer needs to see — never carrier pay or internal fields.
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

  const [{ data: customer }, { data: vehiclesData }] = await Promise.all([
    supabase.from("customers").select("contact_name, company_name").eq("id", load.customer_id).single(),
    supabase.from("load_vehicles").select("*").eq("load_id", load.id).order("created_at"),
  ]);
  const vehicles = (vehiclesData ?? []) as LoadVehicle[];

  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Truck className="size-6" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            US Star Trucking
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Vehicle Transport Agreement</h1>
          <p className="text-sm text-muted-foreground">Order {load.load_number}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5 shadow-sm">
        {row("Customer", customer?.contact_name ?? "—")}
        {row(
          "Origin",
          `${load.pickup_city ?? "—"} ${load.pickup_state ?? ""} ${load.pickup_zip ?? ""}`.trim()
        )}
        {row(
          "Destination",
          `${load.delivery_city ?? "—"} ${load.delivery_state ?? ""} ${load.delivery_zip ?? ""}`.trim()
        )}
        {row("Transport", <span className="capitalize">{load.transport_type}</span>)}
        {row("Ready date", formatDate(load.pickup_ready_date))}
        {row(
          "Vehicles",
          <span className="text-right">
            {vehicles.length === 0
              ? "—"
              : vehicles.map((v) => [v.year, v.make, v.model].filter(Boolean).join(" ")).join(", ")}
          </span>
        )}
        {row("Price", formatCurrency(load.customer_rate))}
        {row("Deposit", formatCurrency(load.deposit_amount))}
      </div>

      {/* The agreement itself. Scrolls on screen; prints in full. */}
      <div className="max-h-96 space-y-5 overflow-y-auto rounded-lg border bg-card p-5 text-sm leading-relaxed shadow-sm print:max-h-none print:overflow-visible">
        {TERMS_SECTIONS.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="text-base font-bold">{section.heading}</h2>
            {section.intro && <p className="italic">{section.intro}</p>}
            {section.clauses.map((c) => (
              <p key={c.label} className={c.important ? "font-semibold" : undefined}>
                <span className="font-bold">{c.label}.</span> {c.body}
              </p>
            ))}
          </section>
        ))}
      </div>

      <SignatureForm
        token={token}
        alreadySigned={Boolean(load.date_signed)}
        signedName={load.contract_signed_name}
      />

      {load.date_signed && (
        <p className="text-center text-xs text-muted-foreground">
          Signed {formatDate(load.date_signed)}
          {load.contract_signed_name ? ` by ${load.contract_signed_name}` : ""}
        </p>
      )}
    </div>
  );
}
