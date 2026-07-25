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

  // Per-status counts for the section tabs (one lightweight column, RLS-scoped
  // and rep-scoped to match the visible list).
  let countQuery = supabase.from(table).select("status");
  if (canSeeMargin && repParam) countQuery = countQuery.eq("sales_owner_id", repParam);

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
          <h1 className="text-2xl font-semibold">Loads</h1>
          <p className="text-sm text-muted-foreground">
            {loads.length} load{loads.length === 1 ? "" : "s"}
            {statusFilter ? ` · ${titleCase(statusFilter)}` : ""}
          </p>
        </div>
        <Button render={<Link href="/loads/new" />}>New load</Button>
      </div>

      {/* msgplane-style section tabs: underline-active, per-status counts. */}
      <div className="flex items-end justify-between gap-3 border-b">
        <div className="-mb-px flex flex-wrap items-center gap-x-1">
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
            <select
              name="rep"
              defaultValue={repParam ?? ""}
              className="h-7 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              <option value="">All reps</option>
              {(reps ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name || r.email}
                </option>
              ))}
            </select>
            <Button type="submit" variant="ghost" size="sm" className="ml-1">
              Filter
            </Button>
          </form>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

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
                  <Link href={`/loads/${load.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
                    {load.load_number}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(load.created_at)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {rep ? rep.full_name || rep.email : "—"}
                </TableCell>
                <TableCell>
                  <div className="text-sm leading-5">
                    <p className="font-medium">{customer?.contact_name ?? "—"}</p>
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
                            <span className="text-red-600"> · enclosed</span>
                          ) : null}
                        </p>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm leading-5">
                    <p>
                      <span className="mr-1 inline-block size-2 rounded-full border-2 border-blue-600" />
                      {load.pickup_city || "—"} {load.pickup_state || ""} {load.pickup_zip || ""}
                    </p>
                    <p>
                      <span className="mr-1 inline-block size-2 rounded-full bg-red-600" />
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
        "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-blue-600 font-medium text-foreground dark:border-blue-500"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums",
          active ? "bg-blue-600/10 text-blue-700 dark:text-blue-300" : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </Link>
  );
}
