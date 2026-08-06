import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { headers } from "next/headers";
import { Mail, Phone, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { recordAccess } from "@/lib/events/record-access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { formatDate, formatPhone } from "@/lib/format";
import type { Customer } from "@/types/database";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 100;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const page = Math.max(0, Number.parseInt((await searchParams).page ?? "0", 10) || 0);

  // Paged, and the total comes from the database. This asked for the whole
  // table and printed customers.length as the count — PostgREST caps a response
  // at 1,000 rows, so with 25,117 shippers the page showed the first 1,000 and
  // told you that was all of them, with no way to reach the other 24,117.
  let query = supabase
    .from("customers")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  // A rep's customer list stays their book of business. Everyone else's is
  // reachable — by name, phone or email from the search bar — but it does not
  // belong in this list. (Before 0037 the row policy did this silently.)
  if (profile.role === "sales") query = query.eq("sales_owner_id", profile.id);
  const { data, error, count } = await query;

  const customers = (data ?? []) as Customer[];
  const total = count ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE + customers.length, total);
  const pageHref = (p: number) => (p > 0 ? `/customers?page=${p}` : "/customers");

  // Access log (0067). The count is the rows on THIS page — what was actually
  // disclosed — not `total`, which is a number the database reported and
  // nobody read. Paging through the book therefore leaves one row per page,
  // which is the shape that makes a bulk read visible.
  //
  // `headers()` is read during render and closed over; calling it inside the
  // after() callback throws in a Server Component. See the customer detail
  // page for the full reason.
  const forwardedFor = (await headers()).get("x-forwarded-for");
  after(() =>
    recordAccess({
      action: "customer_list",
      actorId: profile.id,
      entityType: "customer",
      resultCount: customers.length,
      ip: forwardedFor,
    })
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px]">Customers</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} customer{total === 1 ? "" : "s"}
            {total > PAGE_SIZE && (
              <span>
                {" "}
                · showing {from.toLocaleString()}–{to.toLocaleString()}
              </span>
            )}
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

      {lastPage > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page + 1} of {(lastPage + 1).toLocaleString()}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="max-md:min-h-12"
              disabled={page === 0}
              render={page === 0 ? <span /> : <Link href={pageHref(page - 1)} />}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="max-md:min-h-12"
              disabled={page >= lastPage}
              render={page >= lastPage ? <span /> : <Link href={pageHref(page + 1)} />}
            >
              Next
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
