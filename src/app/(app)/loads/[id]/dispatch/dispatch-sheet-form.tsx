"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/form-section";
import { CarrierPicker, type PickedCarrier } from "@/components/carrier-picker";
import { TermsSelect } from "@/components/terms-select";
import { formatCurrency } from "@/lib/format";
import {
  BALANCE_PAID_BY,
  COD_METHOD,
  PAYMENT_TERMS,
  TERMS_BEGIN,
  PAYMENT_METHOD,
  INVOICE_PAYMENT_METHOD,
  DISPATCH_TERM_DEFAULTS,
  CD_NOTE_MAX,
} from "@/lib/dispatch-terms";
import type { Load, LoadRequest, LoadVehicle } from "@/types/database";
import { saveDispatchSheet, type DispatchSheetState } from "../../actions";

const initial: DispatchSheetState = { error: null };

export function DispatchSheetForm({
  load,
  vehicles,
  requests,
  currentCarrier,
  canDispatch,
}: {
  load: Load;
  vehicles: LoadVehicle[];
  requests: LoadRequest[];
  currentCarrier: { id: string; company_name: string; phone: string | null } | null;
  canDispatch: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveDispatchSheet.bind(null, load.id), initial);
  const [carrierName, setCarrierName] = useState(currentCarrier?.company_name ?? "");
  const [picked, setPicked] = useState<PickedCarrier | null>(
    currentCarrier
      ? {
          id: currentCarrier.id,
          name: currentCarrier.company_name,
          phone: currentCarrier.phone,
          city: null,
          state: null,
          source: null,
        }
      : null
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.dispatched) {
      toast.success("Dispatched.");
      router.push(`/loads/${load.id}`);
    } else if (state !== initial) {
      toast.success("Dispatch sheet saved.");
    }
  }, [state, router, load.id]);

  return (
    <form action={formAction} className="space-y-6">
      {/* Dates */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="pickup_ready_date">1st avail / pickup date</FieldLabel>
          <Input id="pickup_ready_date" name="pickup_ready_date" type="date" defaultValue={load.pickup_ready_date ?? ""} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="delivery_eta">Delivery date</FieldLabel>
          <Input id="delivery_eta" name="delivery_eta" type="date" defaultValue={load.delivery_eta ?? ""} />
        </div>
      </div>

      {/* Carrier + driver */}
      <div className="space-y-3 border-t pt-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel>Carrier name</FieldLabel>
            <CarrierPicker
              value={carrierName}
              onChange={setCarrierName}
              onPick={setPicked}
              placeholder="Search the carrier directory…"
              className="max-md:[&_input]:min-h-12"
            />
            <input type="hidden" name="carrier_id" value={picked?.id ?? ""} />
            {requests.length > 0 && !picked && (
              <p className="text-xs text-muted-foreground">
                Logged offers:{" "}
                {requests.slice(0, 3).map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && " · "}
                    <button
                      type="button"
                      className="text-msg-link hover:underline max-md:min-h-12"
                      onClick={() => {
                        setCarrierName(r.carrier_name);
                        if (r.carrier_id) {
                          setPicked({
                            id: r.carrier_id,
                            name: r.carrier_name,
                            phone: r.phone,
                            city: r.city,
                            state: r.state,
                            source: r.source,
                          });
                        }
                      }}
                    >
                      {r.carrier_name}
                      {r.price != null ? ` (${formatCurrency(r.price)})` : ""}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="driver_first_name">Driver&apos;s first name</FieldLabel>
              <Input id="driver_first_name" name="driver_first_name" defaultValue={load.driver_first_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="driver_last_name">Driver&apos;s last name</FieldLabel>
              <Input id="driver_last_name" name="driver_last_name" defaultValue={load.driver_last_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="driver_phone">Driver&apos;s phone</FieldLabel>
              <Input id="driver_phone" name="driver_phone" type="tel" defaultValue={load.driver_phone ?? ""} />
            </div>
          </div>
        </div>
      </div>

      {/* Special dispatch instructions */}
      <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="dispatch_instructions">
            Driver&apos;s instructions (dispatch instructions)
          </FieldLabel>
          <Textarea
            id="dispatch_instructions"
            name="dispatch_instructions"
            rows={3}
            defaultValue={load.dispatch_instructions ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="cd_note">Central Dispatch note (max {CD_NOTE_MAX} characters)</FieldLabel>
          <Input id="cd_note" name="cd_note" maxLength={CD_NOTE_MAX} defaultValue={load.cd_note ?? ""} />
        </div>
      </div>

      {/* Vehicles under dispatch — review only; edit them on the order form. */}
      <div className="border-t pt-4 text-sm">
        <p className="text-msg-header">Vehicles</p>
        {vehicles.map((v) => (
          <p key={v.id} className="mt-1 text-muted-foreground">
            {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"} ({v.vehicle_type})
            {v.vin ? ` · VIN ${v.vin}` : ""}
            {v.lot_number ? ` · LOT ${v.lot_number}` : ""}
            {v.tariff != null ? ` · ${formatCurrency(v.tariff)}` : ""}
          </p>
        ))}
        {vehicles.length === 0 && <p className="mt-1 text-muted-foreground">No vehicles.</p>}
      </div>

      {/* Pricing + terms */}
      <div className="grid grid-cols-1 gap-4 border-t pt-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="customer_rate">Total tariff ($)</FieldLabel>
          <Input id="customer_rate" name="customer_rate" inputMode="decimal" defaultValue={load.customer_rate ?? ""} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="deposit_amount">Deposit ($)</FieldLabel>
          <Input id="deposit_amount" name="deposit_amount" inputMode="decimal" defaultValue={load.deposit_amount ?? ""} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="carrier_pay">Carrier pay ($)</FieldLabel>
          <Input id="carrier_pay" name="carrier_pay" inputMode="decimal" defaultValue={load.carrier_pay ?? ""} />
        </div>
        <TermsSelect
          name="balance_paid_by"
          label="Balance paid by"
          options={BALANCE_PAID_BY}
          value={load.balance_paid_by}
          fallback={DISPATCH_TERM_DEFAULTS.balance_paid_by}
        />
        <TermsSelect
          name="cod_method"
          label="COD/COP method"
          options={COD_METHOD}
          value={load.cod_method}
          fallback={DISPATCH_TERM_DEFAULTS.cod_method}
        />
        <TermsSelect
          name="payment_terms"
          label="Payment terms"
          options={PAYMENT_TERMS}
          value={load.payment_terms}
          fallback={DISPATCH_TERM_DEFAULTS.payment_terms}
        />
        <TermsSelect
          name="terms_begin"
          label="Terms begin"
          options={TERMS_BEGIN}
          value={load.terms_begin}
          fallback={DISPATCH_TERM_DEFAULTS.terms_begin}
        />
        <TermsSelect
          name="payment_method"
          label="Payment method"
          options={PAYMENT_METHOD}
          value={load.payment_method}
          fallback={DISPATCH_TERM_DEFAULTS.payment_method}
        />
        <TermsSelect
          name="invoice_payment_method"
          label="Invoice payment method"
          options={INVOICE_PAYMENT_METHOD}
          value={load.invoice_payment_method}
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4 max-md:flex-wrap max-md:gap-3">
        {/* mr-auto puts the error leftmost, i.e. first off the edge — give it
            its own line before the row can push it out. */}
        {state.error && (
          <p className="mr-auto text-sm text-destructive max-md:basis-full">{state.error}</p>
        )}
        <Button type="submit" variant="secondary" className="max-md:min-h-12" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {canDispatch && (
          <Button
            type="submit"
            name="dispatch"
            value="1"
            disabled={pending || !picked}
            className="bg-chart-5 uppercase text-msg-selected-foreground hover:bg-chart-5/85 max-md:min-h-12"
          >
            Save and dispatch
          </Button>
        )}
      </div>
      {canDispatch && !picked && (
        <p className="text-right text-xs text-muted-foreground">
          Pick a carrier from the directory to enable Save and dispatch.
        </p>
      )}
    </form>
  );
}
