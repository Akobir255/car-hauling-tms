"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CarrierPicker, type PickedCarrier } from "@/components/carrier-picker";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LoadRequest } from "@/types/database";
import {
  addLoadRequest,
  deleteLoadRequest,
  dispatchFromRequest,
  type RequestFormState,
} from "./requests-actions";

const initial: RequestFormState = { error: null };

// msgplane's Load Requests band, top of every order: a blue strip whose
// header row IS the add form (price, carrier, CD/SD tag, dates, ADD), with
// the column labels underneath and the logged offers as plain rows below.
//
// Below md the nine columns stack one per row: 64rem of grid cannot be panned
// usefully through a phone, and this band is the first thing on every order.
// Every desktop token stays behind md:, so >=768px is untouched.
const GRID =
  "grid grid-cols-1 gap-y-2 md:grid-cols-[5.5rem_6.5rem_minmax(11rem,1fr)_7.5rem_minmax(6rem,0.6fr)_3.5rem_6.5rem_6.5rem_5.5rem] md:items-center md:gap-x-2 md:gap-y-0";

// The column-label row is desktop-only, so a stacked cell carries its own
// heading instead.
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="block w-24 shrink-0 text-xs md:hidden">{children}</span>;
}

export function LoadRequestsBand({
  loadId,
  requests,
  canDispatch,
  readOnly = false,
}: {
  loadId: string;
  requests: LoadRequest[];
  canDispatch: boolean;
  /** Another rep's order: offers are readable, logging one is not. */
  readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(addLoadRequest.bind(null, loadId), initial);
  const [carrierName, setCarrierName] = useState("");
  const [picked, setPicked] = useState<PickedCarrier | null>(null);
  const [source, setSource] = useState<"cd" | "sd" | null>(null);
  const [busy, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success("Request logged.");
      // Reset deferred out of the effect body (lint: set-state-in-effect).
      const t = setTimeout(() => {
        formRef.current?.reset();
        setCarrierName("");
        setPicked(null);
        setSource(null);
      });
      return () => clearTimeout(t);
    }
  }, [state]);

  const sourceBtn = (key: "cd" | "sd") => (
    <button
      type="button"
      onClick={() => setSource(source === key ? null : key)}
      className={cn(
        "h-8 rounded-md px-3 text-xs uppercase transition-colors max-md:min-h-12",
        source === key
          ? "bg-primary-foreground text-primary"
          // The spec's only overlay on the blue band is rgba(0,0,0,0.1).
          : "bg-black/10 text-primary-foreground hover:bg-black/20"
      )}
    >
      {key}
    </button>
  );

  return (
    <section className="space-y-0">
      <h2 className="pb-1.5 text-[15px]">Load Requests</h2>
      <div className="overflow-x-auto rounded-lg border">
        <div className="min-w-0 md:min-w-[64rem]">
          {/* The blue band: add-form row + column labels */}
          <div className="bg-primary px-3 pb-2 pt-3 text-primary-foreground">
            {!readOnly && (
            <form ref={formRef} action={formAction} className={GRID}>
              <Input
                name="price"
                placeholder="PRICE"
                inputMode="decimal"
                // bg-card, not bg-white: these fields sit on the blue band and
                // must still be a legible surface in dark mode.
                className="h-8 bg-card text-sm text-foreground max-md:min-h-12"
              />
              <span className="text-sm tabular-nums max-md:flex max-md:items-baseline max-md:gap-2">
                <CellLabel>Requested</CellLabel>
                {today}
              </span>
              <div>
                <CarrierPicker
                  value={carrierName}
                  onChange={setCarrierName}
                  onPick={setPicked}
                  className="max-md:[&_input]:min-h-12"
                />
                <input type="hidden" name="carrier_name" value={carrierName} />
                <input type="hidden" name="carrier_id" value={picked?.id ?? ""} />
                <input type="hidden" name="phone" value={picked?.phone ?? ""} />
                <input type="hidden" name="city" value={picked?.city ?? ""} />
                <input type="hidden" name="state" value={picked?.state ?? ""} />
                <input type="hidden" name="source" value={source ?? ""} />
              </div>
              <div className="flex gap-1.5 max-md:gap-3">
                {sourceBtn("cd")}
                {sourceBtn("sd")}
              </div>
              {/* City / State spacers — nothing to stack on a phone. */}
              <span className="max-md:hidden" />
              <span className="max-md:hidden" />
              <div className="max-md:space-y-1">
                <CellLabel>Pickup Date</CellLabel>
                <Input
                  name="pickup_date"
                  type="date"
                  aria-label="Pickup date"
                  className="h-8 bg-card text-xs text-foreground max-md:min-h-12"
                />
              </div>
              <div className="max-md:space-y-1">
                <CellLabel>Delivery Date</CellLabel>
                <Input
                  name="delivery_date"
                  type="date"
                  aria-label="Delivery date"
                  className="h-8 bg-card text-xs text-foreground max-md:min-h-12"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={pending || !carrierName.trim()}
                className="h-8 bg-black/10 text-xs uppercase text-primary-foreground shadow-none hover:bg-black/20 max-md:min-h-12"
              >
                {pending ? "…" : "Add"}
              </Button>
            </form>
            )}
            <div className={cn(GRID, "mt-2 text-xs max-md:hidden")}>
              <span>Price</span>
              <span>Requested</span>
              <span>Carrier</span>
              <span>Phone</span>
              <span>City</span>
              <span>State</span>
              <span>Pickup Date</span>
              <span>Delivery Date</span>
              <span />
            </div>
          </div>

          {/* Logged offers */}
          <div className="divide-y bg-card">
            {requests.length === 0 && (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">
                No carrier requests yet — log offers as carriers call in.
              </p>
            )}
            {requests.map((r) => (
              <RequestRow key={r.id} r={r} loadId={loadId} canDispatch={canDispatch} busy={busy} start={start} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// One logged-offer value. `md:contents` drops the wrapper out of the box tree
// at >=768px, so the value span is the grid item it has always been and the
// heading is display:none — the desktop row is unchanged.
function Cell({
  label,
  valueClassName,
  children,
}: {
  label: string;
  valueClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="max-md:flex max-md:items-baseline max-md:gap-2 md:contents">
      <CellLabel>{label}</CellLabel>
      <span className={valueClassName}>{children}</span>
    </span>
  );
}

function RequestRow({
  r,
  loadId,
  canDispatch,
  busy,
  start,
}: {
  r: LoadRequest;
  loadId: string;
  canDispatch: boolean;
  busy: boolean;
  start: React.TransitionStartFunction;
}) {
  return (
    <div className={cn(GRID, "px-3 py-2 text-sm")}>
      <Cell label="Price" valueClassName="tabular-nums">
        {r.price != null ? formatCurrency(r.price) : "—"}
      </Cell>
      <Cell label="Requested" valueClassName="tabular-nums text-muted-foreground">
        {formatDate(r.requested_on)}
      </Cell>
      <Cell label="Carrier" valueClassName="truncate max-md:whitespace-normal">
        {r.carrier_name}
        {r.source && (
          <span className="ml-1.5 rounded-md bg-muted px-1 py-0.5 text-xs uppercase text-muted-foreground">
            {r.source}
          </span>
        )}
      </Cell>
      <Cell label="Phone" valueClassName="tabular-nums text-muted-foreground">
        {r.phone || "—"}
      </Cell>
      <Cell label="City" valueClassName="truncate text-muted-foreground max-md:whitespace-normal">
        {r.city || "—"}
      </Cell>
      <Cell label="State" valueClassName="text-muted-foreground">
        {r.state || "—"}
      </Cell>
      <Cell label="Pickup Date" valueClassName="tabular-nums text-muted-foreground">
        {r.pickup_date ? formatDate(r.pickup_date) : "—"}
      </Cell>
      <Cell label="Delivery Date" valueClassName="tabular-nums text-muted-foreground">
        {r.delivery_date ? formatDate(r.delivery_date) : "—"}
      </Cell>
      {/* Dispatch commits the order to this carrier and X deletes the offer —
          they cannot stay 4px apart at thumb size. */}
      <span className="flex items-center justify-end gap-1 max-md:justify-start max-md:gap-3">
        {canDispatch && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs uppercase max-md:min-h-12 max-md:px-4"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Dispatch this order to ${r.carrier_name}?`)) return;
              start(async () => {
                const res = await dispatchFromRequest(r.id);
                if (!res.ok) toast.error(res.error ?? "Couldn't dispatch.");
                else toast.success(`Dispatched to ${r.carrier_name}.`);
              });
            }}
          >
            Dispatch
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground max-md:size-12"
          aria-label={`Remove request from ${r.carrier_name}`}
          disabled={busy}
          onClick={() =>
            start(async () => {
              const res = await deleteLoadRequest(r.id, loadId);
              if (!res.ok) toast.error(res.error ?? "Couldn't remove.");
            })
          }
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </span>
    </div>
  );
}
