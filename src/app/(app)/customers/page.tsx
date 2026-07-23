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
import type { Customer } from "@/types/database";

export default async function CustomersPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  const customers = (data ?? []) as Customer[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            {customers.length} customer{customers.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button render={<Link href="/customers/new" />}>Add customer</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contact</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Phone / email</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer) => (
            <TableRow key={customer.id}>
              <TableCell className="font-medium">
                <Link href={`/customers/${customer.id}`} className="hover:underline">
                  {customer.contact_name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{customer.company_name || "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {customer.phone || "—"}
                {customer.email ? ` · ${customer.email}` : ""}
              </TableCell>
              <TableCell className="text-muted-foreground">{customer.source || "—"}</TableCell>
            </TableRow>
          ))}
          {customers.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No customers yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
