import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Load, LoadVehicle } from "@/types/database";
import { SignButton } from "./sign-button";

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
      <div className="text-center">
        <h1 className="text-xl font-bold">Vehicle Transport Agreement</h1>
        <p className="text-sm text-muted-foreground">Order {load.load_number}</p>
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

      <SignButton token={token} alreadySigned={Boolean(load.date_signed)} />
    </div>
  );
}
