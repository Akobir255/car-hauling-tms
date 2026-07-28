import Link from "next/link";
import { Mail, Phone, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { formatDate, formatPhone } from "@/lib/format";
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px]">Customers</h1>
          <p className="text-sm text-muted-foreground">
            {customers.length} customer{customers.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button className="max-md:min-h-12" render={<Link href="/customers/new" />}>
          Add customer
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* The page is flat white now, so the border is the only thing making
          this read as a box — no shadow, per the spec. */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-sm text-msg-header">
              <th className="px-4 py-3 font-normal">Contact</th>
              <th className="px-4 py-3 font-normal">Phone / Email</th>
              <th className="px-4 py-3 font-normal">Source</th>
              <th className="px-4 py-3 font-normal">Added</th>
              <th className="px-4 py-3 font-normal">Flags</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-b last:border-b-0 hover:bg-msg-hover">
                <td className="px-4 py-3.5">
                  {/* The row's only tap target — an inline link is ~23px tall. */}
                  <Link
                    href={`/customers/${customer.id}`}
                    className="text-msg-link hover:underline max-md:inline-flex max-md:min-h-12 max-md:items-center"
                  >
                    {customer.contact_name}
                  </Link>
                  {customer.company_name && (
                    <p className="text-sm text-muted-foreground">{customer.company_name}</p>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  {customer.phone && (
                    <p className="flex items-center gap-1.5 tabular-nums">
                      {/* Row-icon palette from the spec: phone ink, email red. */}
                      <Phone className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                      {formatPhone(customer.phone)}
                    </p>
                  )}
                  {customer.email && (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                      <span className="max-w-56 truncate">{customer.email}</span>
                    </p>
                  )}
                  {!customer.phone && !customer.email && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-muted-foreground">{customer.source || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted-foreground">
                  {formatDate(customer.created_at)}
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex gap-1">
                    {customer.sms_opt_out && <Badge variant="outline">SMS opt-out</Badge>}
                    {customer.blacklisted && <Badge variant="destructive">Blacklisted</Badge>}
                  </div>
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={Users}
                    title="No customers yet"
                    hint="Customers are created automatically when you make a lead, or add one manually."
                    action={
                      <Button
                        size="sm"
                        className="max-md:min-h-12"
                        render={<Link href="/customers/new" />}
                      >
                        Add customer
                      </Button>
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
