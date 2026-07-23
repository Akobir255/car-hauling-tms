import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/format";
import type { Load } from "@/types/database";

export default async function LoadsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const canSeeMargin = profile.role === "admin" || profile.role === "dispatcher";
  const table = canSeeMargin ? "loads" : "loads_sales_safe";

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const loads = (data ?? []) as Load[];

  const customerIds = [...new Set(loads.map((l) => l.customer_id).filter(Boolean))];
  const carrierIds = [...new Set(loads.map((l) => l.carrier_id).filter(Boolean) as string[])];

  const [{ data: customers }, { data: carriers }] = await Promise.all([
    customerIds.length
      ? supabase.from("customers").select("id, contact_name, company_name").in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; contact_name: string; company_name: string | null }[] }),
    carrierIds.length
      ? supabase.from("carriers").select("id, company_name").in("id", carrierIds)
      : Promise.resolve({ data: [] as { id: string; company_name: string }[] }),
  ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const carrierById = new Map((carriers ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Loads</h1>
          <p className="text-sm text-muted-foreground">
            {loads.length} load{loads.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button render={<Link href="/loads/new" />}>New load</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Load #</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Route</TableHead>
            <TableHead>Carrier</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Customer rate</TableHead>
            {canSeeMargin && <TableHead>Margin</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loads.map((load) => {
            const customer = customerById.get(load.customer_id);
            const carrier = load.carrier_id ? carrierById.get(load.carrier_id) : undefined;
            const margin =
              load.customer_rate != null && load.carrier_pay != null
                ? load.customer_rate - load.carrier_pay
                : null;
            return (
              <TableRow key={load.id}>
                <TableCell className="font-medium">
                  <Link href={`/loads/${load.id}`} className="hover:underline">
                    {load.load_number}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {customer?.contact_name ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {load.pickup_city || "—"}, {load.pickup_state || "—"} &rarr;{" "}
                  {load.delivery_city || "—"}, {load.delivery_state || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{carrier?.company_name ?? "Unassigned"}</TableCell>
                <TableCell>
                  <StatusBadge status={load.status} />
                </TableCell>
                <TableCell>{formatCurrency(load.customer_rate)}</TableCell>
                {canSeeMargin && <TableCell>{formatCurrency(margin)}</TableCell>}
              </TableRow>
            );
          })}
          {loads.length === 0 && (
            <TableRow>
              <TableCell colSpan={canSeeMargin ? 7 : 6} className="text-center text-muted-foreground">
                No loads yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
