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
          <h1 className="text-[15px]">Carriers</h1>
          <p className="text-sm text-muted-foreground">
            {carriers.length} carrier{carriers.length === 1 ? "" : "s"} on file
          </p>
        </div>
        {canManage && (
          <Button className="max-md:min-h-12" render={<Link href="/carriers/new" />}>
            Add carrier
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* Bordered, not raised — the flat white page leaves the border as the
          only boundary, and the spec puts a shadow nowhere but the nav. */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-sm text-msg-header">
              <th className="px-4 py-3 font-normal">Company</th>
              <th className="px-4 py-3 font-normal">MC# / DOT#</th>
              <th className="px-4 py-3 font-normal">Contact</th>
              <th className="px-4 py-3 font-normal">Equipment</th>
              <th className="px-4 py-3 font-normal">COI</th>
              <th className="px-4 py-3 font-normal">Flags</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((carrier) => (
              <tr key={carrier.id} className="border-b last:border-b-0 hover:bg-msg-hover">
                <td className="px-4 py-3.5">
                  {/* The row's only tap target — an inline link is ~23px tall. */}
                  <Link
                    href={`/carriers/${carrier.id}`}
                    className="text-msg-link hover:underline max-md:inline-flex max-md:min-h-12 max-md:items-center"
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
                      {/* Spec's phone icon is ink, not gray. */}
                      <Phone className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
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
                        <Button
                          size="sm"
                          className="max-md:min-h-12"
                          render={<Link href="/carriers/new" />}
                        >
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
