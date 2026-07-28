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
const GRID =
  "grid grid-cols-[5.5rem_6.5rem_minmax(11rem,1fr)_7.5rem_minmax(6rem,0.6fr)_3.5rem_6.5rem_6.5rem_5.5rem] items-center gap-x-2";

export function LoadRequestsBand({
  loadId,
  requests,
  canDispatch,
}: {
  loadId: string;
  requests: LoadRequest[];
  canDispatch: boolean;
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
        "h-8 rounded-md px-3 text-xs uppercase transition-colors",
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
        <div className="min-w-[64rem]">
          {/* The blue band: add-form row + column labels */}
          <div className="bg-primary px-3 pb-2 pt-3 text-primary-foreground">
            <form ref={formRef} action={formAction} className={GRID}>
              <Input
                name="price"
                placeholder="PRICE"
                inputMode="decimal"
                // bg-card, not bg-white: these fields sit on the blue band and
                // must still be a legible surface in dark mode.
                className="h-8 bg-card text-sm text-foreground"
              />
              <span className="text-sm tabular-nums">{today}</span>
              <div>
                <CarrierPicker
                  value={carrierName}
                  onChange={setCarrierName}
                  onPick={setPicked}
                />
                <input type="hidden" name="carrier_name" value={carrierName} />
                <input type="hidden" name="carrier_id" value={picked?.id ?? ""} />
                <input type="hidden" name="phone" value={picked?.phone ?? ""} />
                <input type="hidden" name="city" value={picked?.city ?? ""} />
                <input type="hidden" name="state" value={picked?.state ?? ""} />
                <input type="hidden" name="source" value={source ?? ""} />
              </div>
              <div className="flex gap-1.5">
                {sourceBtn("cd")}
                {sourceBtn("sd")}
              </div>
              <span />
              <span />
              <Input
                name="pickup_date"
                type="date"
                aria-label="Pickup date"
                className="h-8 bg-card text-xs text-foreground"
              />
              <Input
                name="delivery_date"
                type="date"
                aria-label="Delivery date"
                className="h-8 bg-card text-xs text-foreground"
              />
              <Button
                type="submit"
                size="sm"
                disabled={pending || !carrierName.trim()}
                className="h-8 bg-black/10 text-xs uppercase text-primary-foreground shadow-none hover:bg-black/20"
              >
                {pending ? "…" : "Add"}
              </Button>
            </form>
            <div className={cn(GRID, "mt-2 text-xs")}>
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
      <span className="tabular-nums">
        {r.price != null ? formatCurrency(r.price) : "—"}
      </span>
      <span className="tabular-nums text-muted-foreground">{formatDate(r.requested_on)}</span>
      <span className="truncate">
        {r.carrier_name}
        {r.source && (
          <span className="ml-1.5 rounded-md bg-muted px-1 py-0.5 text-xs uppercase text-muted-foreground">
            {r.source}
          </span>
        )}
      </span>
      <span className="tabular-nums text-muted-foreground">{r.phone || "—"}</span>
      <span className="truncate text-muted-foreground">{r.city || "—"}</span>
      <span className="text-muted-foreground">{r.state || "—"}</span>
      <span className="tabular-nums text-muted-foreground">
        {r.pickup_date ? formatDate(r.pickup_date) : "—"}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {r.delivery_date ? formatDate(r.delivery_date) : "—"}
      </span>
      <span className="flex items-center justify-end gap-1">
        {canDispatch && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs uppercase"
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
          className="h-6 w-6 p-0 text-muted-foreground"
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
