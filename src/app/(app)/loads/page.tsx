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
  const table = canSeeMargin ? "loads" : "loads_sales_safe";

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

  const { data, error } = await query;
  const loads = (data ?? []) as Load[];

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

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        <Link
          href={tabHref(null)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm",
            !statusFilter ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          All
        </Link>
        {LOAD_STATUSES.map((s) => (
          <Link
            key={s}
            href={tabHref(s)}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm",
              statusFilter === s
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {titleCase(s)}
          </Link>
        ))}
        {canSeeMargin && (reps ?? []).length > 0 && (
          <form className="ml-auto" action="/loads" method="get">
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
