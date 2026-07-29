import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
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
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  LOAD_STATUSES,
  type Load,
  type LoadStatus,
  type LoadVehicle,
  type Profile,
} from "@/types/database";

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; rep?: string }>;
}) {
  const { status: statusParam, rep: repParam } = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();
  const canSeeMargin = profile.role === "admin" || profile.role === "dispatcher";
  const table = canSeeMargin ? MANAGER_LOADS_TABLE : "loads_sales_safe";

  const statusFilter = LOAD_STATUSES.includes(statusParam as LoadStatus)
    ? (statusParam as LoadStatus)
    : null;

  let query = supabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (canSeeMargin && repParam) query = query.eq("sales_owner_id", repParam);
  // Every record is readable since 0037, so "my orders" is now something this
  // query has to say rather than something the row policy says for it.
  if (profile.role === "sales") query = query.eq("sales_owner_id", profile.id);

  // Per-status counts for the section tabs (one lightweight column, scoped the
  // same way so the numbers match the visible list).
  let countQuery = supabase.from(table).select("status");
  if (canSeeMargin && repParam) countQuery = countQuery.eq("sales_owner_id", repParam);
  if (profile.role === "sales") countQuery = countQuery.eq("sales_owner_id", profile.id);

  const [{ data, error }, { data: countRows }] = await Promise.all([query, countQuery]);
  const loads = (data ?? []) as Load[];

  const statusCounts = new Map<string, number>();
  for (const row of (countRows ?? []) as { status: LoadStatus }[]) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  }
  const totalCount = (countRows ?? []).length;

  const loadIds = loads.map((l) => l.id);
  const customerIds = [...new Set(loads.map((l) => l.customer_id).filter(Boolean))];
  const carrierIds = [...new Set(loads.map((l) => l.carrier_id).filter(Boolean) as string[])];

  const [{ data: customers }, { data: carriers }, { data: reps }, { data: vehicles }] =
    await Promise.all([
      customerIds.length
        ? supabase
            .from("customers")
            .select("id, contact_name, company_name, phone, email")
            .in("id", customerIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              contact_name: string;
              company_name: string | null;
              phone: string | null;
              email: string | null;
            }[],
          }),
      carrierIds.length
        ? supabase.from("carriers").select("id, company_name").in("id", carrierIds)
        : Promise.resolve({ data: [] as { id: string; company_name: string }[] }),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      loadIds.length
        ? supabase.from("load_vehicles").select("*").in("load_id", loadIds)
        : Promise.resolve({ data: [] as LoadVehicle[] }),
    ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const carrierById = new Map((carriers ?? []).map((c) => [c.id, c]));
  const repById = new Map(
    ((reps ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((r) => [r.id, r])
  );
  const vehiclesByLoad = new Map<string, LoadVehicle[]>();
  for (const v of (vehicles ?? []) as LoadVehicle[]) {
    const list = vehiclesByLoad.get(v.load_id) ?? [];
    list.push(v);
    vehiclesByLoad.set(v.load_id, list);
  }

  const tabHref = (status: LoadStatus | null) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (repParam) params.set("rep", repParam);
    const qs = params.toString();
    return qs ? `/loads?${qs}` : "/loads";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px]">Loads</h1>
          <p className="text-sm text-muted-foreground">
            {loads.length} load{loads.length === 1 ? "" : "s"}
            {statusFilter ? ` · ${titleCase(statusFilter)}` : ""}
          </p>
        </div>
        <Button className="max-md:min-h-12" render={<Link href="/loads/new" />}>
          New load
        </Button>
      </div>

      {/* msgplane-style section tabs: boxed buttons with a coral selected
          fill and per-status counts. The strip carries no rule of its own. */}
      <div className="flex items-end justify-between gap-3 max-md:flex-wrap">
        <div className="flex flex-wrap items-center gap-1">
          <StatusTab href={tabHref(null)} label="All" count={totalCount} active={!statusFilter} />
          {LOAD_STATUSES.map((s) => (
            <StatusTab
              key={s}
              href={tabHref(s)}
              label={titleCase(s)}
              count={statusCounts.get(s) ?? 0}
              active={statusFilter === s}
            />
          ))}
        </div>
        {canSeeMargin && (reps ?? []).length > 0 && (
          <form className="mb-1.5 shrink-0" action="/loads" method="get">
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            {/* Was a raw select with its own geometry, which also missed the
                16px mobile step NativeSelect carries to stop Safari zooming
                the viewport on focus. h-7 was the old height; md:h-7 keeps it. */}
            <NativeSelect
              name="rep"
              defaultValue={repParam ?? ""}
              // No text-sm here: the base is text-[16px] md:text-sm and passing
              // text-sm would make tailwind-merge drop the 16px step. md:px-2
              // pins the desk padding to the raw select's own px-2.
              className="h-12 w-auto max-w-40 md:h-7 md:max-w-none md:px-2"
            >
              <option value="">All reps</option>
              {(reps ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name || r.email}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="ml-1 max-md:min-h-12 max-md:px-4"
            >
              Filter
            </Button>
          </form>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* Nine columns, every cell whitespace-nowrap: the only loads list left
          that was pan-only on a phone, while /leads, /quotes and /orders all
          reflow through PipelineList. Same rows as cards below md. */}
      {/* One space-y slot for both layouts: `space-y-*` margins land on
          `:not(:last-child)`, so a bare card-list sibling would give the
          desktop table a bottom margin it never had. */}
      <div>
      <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Assigned to</TableHead>
            <TableHead>Shipper</TableHead>
            <TableHead>Vehicles</TableHead>
            <TableHead>Orig/Dest</TableHead>
            <TableHead>Quote</TableHead>
            <TableHead>Est. Ship</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loads.map((load) => {
            const customer = customerById.get(load.customer_id);
            const carrier = load.carrier_id ? carrierById.get(load.carrier_id) : undefined;
            const rep = load.sales_owner_id ? repById.get(load.sales_owner_id) : undefined;
            const loadVehicles = vehiclesByLoad.get(load.id) ?? [];
            return (
              <TableRow key={load.id} className="align-top">
                <TableCell>
                  <Link href={`/loads/${load.id}`} className="text-msg-link hover:underline">
                    {load.load_number}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(load.created_at)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {rep ? rep.full_name || rep.email : "—"}
                </TableCell>
                <TableCell>
                  <div className="text-sm leading-5">
                    <p>{customer?.contact_name ?? "—"}</p>
                    {customer?.phone && <p className="text-muted-foreground">{customer.phone}</p>}
                    {customer?.email && (
                      <p className="max-w-44 truncate text-muted-foreground">{customer.email}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1 text-sm leading-5">
                    {loadVehicles.length === 0 && <span className="text-muted-foreground">—</span>}
                    {loadVehicles.map((v) => (
                      <div key={v.id}>
                        <p>
                          {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {titleCase(v.vehicle_type)}
                          {v.condition === "non_running" ? " · Non-running" : ""}
                          {load.transport_type === "enclosed" ? (
                            <span className="text-destructive"> · enclosed</span>
                          ) : null}
                        </p>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm leading-5">
                    <p>
                      {/* Route pins take the spec's row-icon hues. */}
                      <span className="mr-1 inline-block size-2 rounded-full border-2 border-msg-shipper" />
                      {load.pickup_city || "—"} {load.pickup_state || ""} {load.pickup_zip || ""}
                    </p>
                    <p>
                      <span className="mr-1 inline-block size-2 rounded-full bg-destructive" />
                      {load.delivery_city || "—"} {load.delivery_state || ""} {load.delivery_zip || ""}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-xs leading-5">
                    <p>Tariff: {formatCurrency(load.customer_rate)}</p>
                    <p className="text-muted-foreground">
                      Deposit: {formatCurrency(load.deposit_amount)}
                    </p>
                    {canSeeMargin && (
                      <p className="text-muted-foreground">
                        Carrier: {formatCurrency(load.carrier_pay)}
                        {carrier ? ` (${carrier.company_name})` : ""}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(load.pickup_ready_date)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={load.status} />
                </TableCell>
              </TableRow>
            );
          })}
          {loads.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                No loads{statusFilter ? ` with status ${titleCase(statusFilter)}` : ""} yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      <ul className="divide-y divide-msg-rule overflow-hidden rounded-md border bg-card text-sm md:hidden">
        {loads.map((load) => {
          const customer = customerById.get(load.customer_id);
          const carrier = load.carrier_id ? carrierById.get(load.carrier_id) : undefined;
          const rep = load.sales_owner_id ? repById.get(load.sales_owner_id) : undefined;
          const loadVehicles = vehiclesByLoad.get(load.id) ?? [];
          return (
            <li key={load.id} className="relative p-3">
              {/* The card is one tap target, the way the pipeline cards are. */}
              <Link
                href={`/loads/${load.id}`}
                aria-label={`Open ${load.load_number}`}
                className="focus-ring absolute inset-0"
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular-nums text-msg-link">{load.load_number}</span>
                <StatusBadge status={load.status} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDate(load.created_at)}
                </span>
              </div>

              <p className="mt-2 break-words">{customer?.contact_name ?? "—"}</p>
              {customer?.phone && (
                <p className="tabular-nums text-muted-foreground">{customer.phone}</p>
              )}
              {customer?.email && (
                <p className="break-all text-muted-foreground">{customer.email}</p>
              )}

              <div className="mt-2 space-y-0.5">
                <p>
                  <span className="mr-1 inline-block size-2 rounded-full border-2 border-msg-shipper" />
                  {load.pickup_city || "—"} {load.pickup_state || ""} {load.pickup_zip || ""}
                </p>
                <p>
                  <span className="mr-1 inline-block size-2 rounded-full bg-destructive" />
                  {load.delivery_city || "—"} {load.delivery_state || ""} {load.delivery_zip || ""}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs tabular-nums">
                <div>
                  <p>Tariff: {formatCurrency(load.customer_rate)}</p>
                  <p className="text-muted-foreground">
                    Deposit: {formatCurrency(load.deposit_amount)}
                  </p>
                  {canSeeMargin && (
                    <p className="text-muted-foreground">
                      Carrier: {formatCurrency(load.carrier_pay)}
                      {carrier ? ` (${carrier.company_name})` : ""}
                    </p>
                  )}
                </div>
                <p className="text-right text-muted-foreground">
                  Est. ship {formatDate(load.pickup_ready_date)}
                </p>
              </div>

              <div className="mt-2 space-y-1 border-t border-msg-rule pt-2 text-xs text-muted-foreground">
                {loadVehicles.map((v) => (
                  <p key={v.id}>
                    {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                    {" · "}
                    {titleCase(v.vehicle_type)}
                    {v.condition === "non_running" ? " · Non-running" : ""}
                    {load.transport_type === "enclosed" ? (
                      <span className="text-destructive"> · enclosed</span>
                    ) : null}
                  </p>
                ))}
                <p>{rep ? rep.full_name || rep.email : "—"}</p>
              </div>
            </li>
          );
        })}
        {loads.length === 0 && (
          <li className="p-3 text-center text-muted-foreground">
            No loads{statusFilter ? ` with status ${titleCase(statusFilter)}` : ""} yet.
          </li>
        )}
      </ul>
      </div>
    </div>
  );
}

function StatusTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Eleven of these are the page's primary navigation; below md each
        // takes a thumb target, the way pipeline-list's tab strip already
        // does. md:min-h-6 is under the chip's natural height, so the desk
        // box is untouched.
        "focus-ring flex min-h-12 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-sm transition-colors md:min-h-6",
        active
          ? "border-msg-selected bg-msg-selected text-msg-selected-foreground"
          : "bg-card text-foreground hover:bg-msg-hover"
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-xs leading-none tabular-nums",
          active ? "bg-black/10 text-msg-selected-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </Link>
  );
}
