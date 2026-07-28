import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import type { Profile } from "@/types/database";
import { TicketForm } from "./ticket-form";

// ?load=<id> pre-selects an order — that's how "Create ticket" on the order
// detail page arrives here.
export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ load?: string; customer?: string }>;
}) {
  const { load, customer } = await searchParams;
  const profile = await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();

  const [{ data: profs }, { data: loadRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
    supabase
      .from(profile.role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE)
      .select("id, load_number, pickup_city, delivery_city")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const reps = ((profs ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
  }));

  const loads = (
    (loadRows ?? []) as {
      id: string;
      load_number: string;
      pickup_city: string | null;
      delivery_city: string | null;
    }[]
  ).map((l) => ({
    id: l.id,
    label: `${l.load_number} — ${l.pickup_city ?? "?"} → ${l.delivery_city ?? "?"}`,
  }));

  return (
    <div className="space-y-6">
      <h1 className="mx-auto max-w-2xl text-[15px]">New ticket</h1>
      <TicketForm
        reps={reps}
        loads={loads}
        defaultLoadId={load}
        defaultCustomerId={customer}
        currentUserId={profile.id}
      />
    </div>
  );
}
