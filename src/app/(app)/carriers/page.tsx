import Link from "next/link";
import { Phone, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CoiBadge } from "@/components/coi-badge";
import { EmptyState } from "@/components/empty-state";
import { formatPhone } from "@/lib/format";
import type { Carrier } from "@/types/database";

export default async function CarriersPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carriers")
    .select("*")
    .order("company_name", { ascending: true });

  const carriers = (data ?? []) as Carrier[];
  const canManage = profile.role === "admin" || profile.role === "dispatcher";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Carriers</h1>
          <p className="text-sm text-muted-foreground">
            {carriers.length} carrier{carriers.length === 1 ? "" : "s"} on file
          </p>
        </div>
        {canManage && <Button render={<Link href="/carriers/new" />}>Add carrier</Button>}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-sm font-bold uppercase tracking-wide text-foreground">
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">MC# / DOT#</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Equipment</th>
              <th className="px-4 py-3">COI</th>
              <th className="px-4 py-3">Flags</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((carrier) => (
              <tr key={carrier.id} className="border-b last:border-b-0 hover:bg-muted/40">
                <td className="px-4 py-3.5">
                  <Link
                    href={`/carriers/${carrier.id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {carrier.company_name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted-foreground">
                  {carrier.mc_number || "—"} / {carrier.dot_number || "—"}
                </td>
                <td className="px-4 py-3.5">
                  <p>{carrier.contact_name || "—"}</p>
                  {carrier.phone && (
                    <p className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                      <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                      {formatPhone(carrier.phone)}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3.5 text-muted-foreground">
                  {carrier.equipment_types?.length ? carrier.equipment_types.join(", ") : "—"}
                </td>
                <td className="px-4 py-3.5">
                  <CoiBadge expiryDate={carrier.coi_expiry_date} />
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex gap-1">
                    {carrier.preferred && <Badge variant="secondary">Preferred</Badge>}
                    {carrier.blacklisted && <Badge variant="destructive">Blacklisted</Badge>}
                  </div>
                </td>
              </tr>
            ))}
            {carriers.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    icon={Truck}
                    title="No carriers yet"
                    hint="Add the carriers you dispatch loads to — MC/DOT, insurance, and contact info live here."
                    action={
                      canManage ? (
                        <Button size="sm" render={<Link href="/carriers/new" />}>
                          Add carrier
                        </Button>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
