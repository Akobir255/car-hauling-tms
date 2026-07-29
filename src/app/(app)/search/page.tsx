import Link from "next/link";
import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { SectionBand } from "@/components/section-band";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";
import type { Load, LoadStatus } from "@/types/database";

// Search results, msgplane-style: type in the top bar, press Enter, land
// here. The headline section is ORDERS — a match on a shipper's name, phone
// or email pulls up every order that belongs to them, not just the shipper
// row. Shippers and carriers get their own sections below.

function esc(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}
function likePattern(term: string): string {
  const escaped = esc(term).replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await requireProfile();
  const raw = ((await searchParams).q || "").trim().slice(0, 60);
  const supabase = await createClient();

  if (raw.length < 2) {
    return (
      <div>
        <h1 className="text-[15px]">Search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Type at least two characters in the search box and press Enter.
        </p>
      </div>
    );
  }

  const pat = likePattern(raw);
  const digits = raw.replace(/\D/g, "");

  const customerFilters = [
    `contact_name.ilike.${pat}`,
    `company_name.ilike.${pat}`,
    `email.ilike.${pat}`,
  ];
  if (digits.length >= 4) customerFilters.push(`phone_digits.ilike.${likePattern(digits)}`);

  const carrierFilters = [
    `company_name.ilike.${pat}`,
    `contact_name.ilike.${pat}`,
    `city.ilike.${pat}`,
  ];
  if (digits.length >= 4) carrierFilters.push(`phone_digits.ilike.${likePattern(digits)}`);

  const [{ data: customersData }, { data: carriers }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, contact_name, company_name, phone, email")
      .or(customerFilters.join(","))
      .limit(25),
    supabase
      .from("carriers")
      .select("id, company_name, contact_name, phone, city, state, source")
      .or(carrierFilters.join(","))
      .limit(25),
  ]);
  const customers = customersData ?? [];
  const customerIds = customers.map((c) => c.id);

  // Every order that belongs to a matched shipper OR a matched CARRIER, plus
  // direct order-number hits. The carrier arm is what makes "Garden State
  // Haulers LLC" answer the question a dispatcher is actually asking — which
  // of our loads did we give them — instead of just confirming the company
  // exists in the directory. Role view keeps margin columns away from sales.
  const table = profile.role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE;
  const carrierIds = (carriers ?? []).map((c) => c.id);
  const loadFilters = [`load_number.ilike.${pat}`];
  if (customerIds.length > 0) loadFilters.push(`customer_id.in.(${customerIds.join(",")})`);
  if (carrierIds.length > 0) loadFilters.push(`carrier_id.in.(${carrierIds.join(",")})`);
  const { data: loadsData } = await supabase
    .from(table)
    .select("*")
    .or(loadFilters.join(","))
    .order("created_at", { ascending: false })
    .limit(100);
  const loads = (loadsData ?? []) as Load[];
  const customerById = new Map(customers.map((c) => [c.id, c]));

  // Searching by ORDER NUMBER matches no shipper, so the map above is empty
  // and every result row printed "—" in the Shipper column — on exactly the
  // search a rep does most. The shipper of a matched order has to be fetched
  // whether or not their name matched the term. Kept out of the Shippers
  // section's own count, which still means "shippers matching what you typed".
  const unfetched = [
    ...new Set(loads.map((l) => l.customer_id).filter((id) => id && !customerById.has(id))),
  ];
  if (unfetched.length > 0) {
    const { data: loadCustomers } = await supabase
      .from("customers")
      .select("id, contact_name, company_name, phone, email")
      .in("id", unfetched);
    for (const c of loadCustomers ?? []) customerById.set(c.id, c);
  }

  // Same for the hauler on each result: a search for a shipper or an order
  // number should still say who is carrying it.
  const carrierById = new Map((carriers ?? []).map((c) => [c.id, c]));
  const unfetchedCarriers = [
    ...new Set(loads.map((l) => l.carrier_id).filter((id) => id && !carrierById.has(id))),
  ] as string[];
  if (unfetchedCarriers.length > 0) {
    const { data: loadCarriers } = await supabase
      .from("carriers")
      .select("id, company_name, contact_name, phone, city, state, source")
      .in("id", unfetchedCarriers);
    for (const c of loadCarriers ?? []) carrierById.set(c.id, c);
  }

  // Whose order this is. Since 0037 a search reaches the whole board, so the
  // rep's name is the column that tells you what to do with a hit you did not
  // recognise — call them, or open it read-only. Names are staff-readable
  // (0002), so this resolves for sales as well as managers.
  const ownerIds = [
    ...new Set(loads.map((l) => l.sales_owner_id).filter(Boolean)),
  ] as string[];
  const ownerById = new Map<string, { full_name: string | null; email: string | null }>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ownerIds);
    for (const o of owners ?? []) ownerById.set(o.id, o);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[15px]">Search results</h1>
        <p className="text-sm text-muted-foreground">
          “{raw}” — {loads.length} order{loads.length === 1 ? "" : "s"}, {customers.length}{" "}
          shipper{customers.length === 1 ? "" : "s"}, {carriers?.length ?? 0} carrier
          {(carriers?.length ?? 0) === 1 ? "" : "s"}
        </p>
      </div>

      <SectionBand title={`Orders (${loads.length})`} bodyClassName="p-0">
        {loads.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No matching orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-sm text-msg-header [&>th]:font-normal">
                  <th className="px-4 py-2.5">ID</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Assigned</th>
                  <th className="px-4 py-2.5">Shipper</th>
                  <th className="px-4 py-2.5">Orig/Dest</th>
                  <th className="px-4 py-2.5">Carrier</th>
                  <th className="px-4 py-2.5">Tariff</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody>
                {loads.map((l, i) => {
                  const c = customerById.get(l.customer_id);
                  const hauler = l.carrier_id ? carrierById.get(l.carrier_id) : null;
                  const owner = l.sales_owner_id ? ownerById.get(l.sales_owner_id) : null;
                  return (
                    <tr
                      key={l.id}
                      className={
                        // Zebra takes --secondary and hover the darker
                        // --msg-hover, so hover still reads on a striped row.
                        // --muted is 1.04:1 on white and showed as nothing.
                        "border-b last:border-b-0 hover:bg-msg-hover " +
                        (i % 2 === 1 ? "bg-secondary" : "")
                      }
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/loads/${l.id}`}
                          className="tabular-nums text-msg-link hover:underline"
                        >
                          {l.load_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={l.status as LoadStatus} />
                      </td>
                      {/* "Unassigned" rather than an em dash: a lead nobody
                          owns is something to pick up, not a missing value. */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {owner ? (
                          (owner.full_name || owner.email)
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{c?.contact_name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {[l.pickup_city, l.pickup_state].filter(Boolean).join(", ") || "—"}{" "}
                        → {[l.delivery_city, l.delivery_state].filter(Boolean).join(", ") || "—"}
                      </td>
                      {/* The old system puts the hauler's name and phone right
                          in the row — the dispatcher chasing a truck should not
                          have to open the order to get the number. */}
                      <td className="px-4 py-3">
                        {hauler ? (
                          <>
                            <Link
                              href={`/carriers/${hauler.id}`}
                              className="text-msg-link hover:underline"
                            >
                              {hauler.company_name}
                            </Link>
                            {hauler.phone && (
                              <div className="tabular-nums text-muted-foreground">
                                {formatPhone(hauler.phone)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatCurrency(l.customer_rate)}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {formatDate(l.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionBand>

      <SectionBand title={`Shippers (${customers.length})`} bodyClassName="p-0">
        {customers.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No matching shippers.</p>
        ) : (
          <div className="divide-y">
            {customers.map((c) => (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-msg-hover"
              >
                <span className="text-msg-link">{c.contact_name || "—"}</span>
                {c.company_name && <span className="text-muted-foreground">{c.company_name}</span>}
                {c.phone && (
                  <span className="tabular-nums text-muted-foreground">{formatPhone(c.phone)}</span>
                )}
                {c.email && <span className="text-muted-foreground">{c.email}</span>}
              </Link>
            ))}
          </div>
        )}
      </SectionBand>

      <SectionBand title={`Carriers (${carriers?.length ?? 0})`} bodyClassName="p-0">
        {(carriers ?? []).length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No matching carriers.</p>
        ) : (
          <div className="divide-y">
            {(carriers ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/carriers/${c.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-msg-hover"
              >
                <span className="text-msg-link">{c.company_name}</span>
                {c.contact_name && <span className="text-muted-foreground">{c.contact_name}</span>}
                <span className="text-muted-foreground">
                  {[c.city, c.state].filter(Boolean).join(", ")}
                </span>
                {c.phone && (
                  <span className="tabular-nums text-muted-foreground">{formatPhone(c.phone)}</span>
                )}
                {c.source && (
                  <span className="rounded-md border px-1.5 text-xs uppercase text-muted-foreground">
                    {c.source}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </SectionBand>
    </div>
  );
}
