import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CoiBadge } from "@/components/coi-badge";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Carriers</h1>
          <p className="text-sm text-muted-foreground">
            {carriers.length} carrier{carriers.length === 1 ? "" : "s"} on file
          </p>
        </div>
        {canManage && (
          <Button render={<Link href="/carriers/new" />}>Add carrier</Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>MC# / DOT#</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Equipment</TableHead>
            <TableHead>COI status</TableHead>
            <TableHead>Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {carriers.map((carrier) => (
            <TableRow key={carrier.id}>
              <TableCell className="font-medium">
                <Link href={`/carriers/${carrier.id}`} className="hover:underline">
                  {carrier.company_name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {carrier.mc_number || "—"} / {carrier.dot_number || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {carrier.contact_name || "—"}
                {carrier.phone ? ` · ${carrier.phone}` : ""}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {carrier.equipment_types?.length ? carrier.equipment_types.join(", ") : "—"}
              </TableCell>
              <TableCell>
                <CoiBadge expiryDate={carrier.coi_expiry_date} />
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {carrier.preferred && <Badge variant="secondary">Preferred</Badge>}
                  {carrier.blacklisted && <Badge variant="destructive">Blacklisted</Badge>}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {carriers.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No carriers yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
