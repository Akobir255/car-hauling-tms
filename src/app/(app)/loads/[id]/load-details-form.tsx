"use client";

import { useActionState, useCallback, useRef, useState } from "react";
import { ClipboardList, Handshake, MapPin, StickyNote, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, FieldLabel } from "@/components/form-section";
import { RouteMap } from "@/components/route-map";
import {
  BALANCE_PAID_BY,
  COD_METHOD,
  PAYMENT_TERMS,
  TERMS_BEGIN,
  PAYMENT_METHOD,
  INVOICE_PAYMENT_METHOD,
  DISPATCH_TERM_DEFAULTS,
} from "@/lib/dispatch-terms";
import { TermsSelect } from "@/components/terms-select";
import type { Carrier, Load } from "@/types/database";
import type { LoadFormState } from "../actions";

const initialState: LoadFormState = { error: null };

// One endpoint column of the msgplane-style Origin & Destination pair.
function EndpointFields({
  prefix,
  title,
  load,
  dateField,
  dateLabel,
}: {
  prefix: "pickup" | "delivery";
  title: string;
  load: Load;
  dateField: "pickup_ready_date" | "delivery_eta";
  dateLabel: string;
}) {
  const v = (field: string) => (load as unknown as Record<string, string | null>)[field] ?? "";
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="flex items-center gap-1.5 pb-1 text-xs text-msg-header">
        <MapPin className="size-3.5 text-msg-shipper" aria-hidden="true" />
        {title}
      </legend>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={`${prefix}_address`}>Address</FieldLabel>
        <Input id={`${prefix}_address`} name={`${prefix}_address`} defaultValue={v(`${prefix}_address`)} />
      </div>
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-3 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_city`}>City</FieldLabel>
          <Input id={`${prefix}_city`} name={`${prefix}_city`} defaultValue={v(`${prefix}_city`)} />
        </div>
        <div className="col-span-1 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_state`}>State</FieldLabel>
          <Input id={`${prefix}_state`} name={`${prefix}_state`} maxLength={2} defaultValue={v(`${prefix}_state`)} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_zip`}>ZIP</FieldLabel>
          <Input id={`${prefix}_zip`} name={`${prefix}_zip`} defaultValue={v(`${prefix}_zip`)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_name`}>Contact</FieldLabel>
          <Input id={`${prefix}_contact_name`} name={`${prefix}_contact_name`} defaultValue={v(`${prefix}_contact_name`)} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_company`}>Company</FieldLabel>
          <Input id={`${prefix}_company`} name={`${prefix}_company`} defaultValue={v(`${prefix}_company`)} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_cell`}>Phone cell</FieldLabel>
          <Input
            id={`${prefix}_contact_cell`}
            name={`${prefix}_contact_cell`}
            type="tel"
            defaultValue={v(`${prefix}_contact_cell`)}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_phone`}>Phone</FieldLabel>
          <Input
            id={`${prefix}_contact_phone`}
            name={`${prefix}_contact_phone`}
            type="tel"
            defaultValue={v(`${prefix}_contact_phone`)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={dateField}>{dateLabel}</FieldLabel>
          <Input id={dateField} name={dateField} type="date" defaultValue={load[dateField] ?? ""} className="w-44" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_buyer_number`}>Buyer number</FieldLabel>
          <Input
            id={`${prefix}_buyer_number`}
            name={`${prefix}_buyer_number`}
            defaultValue={v(`${prefix}_buyer_number`)}
            placeholder="Auction buyer #"
          />
        </div>
      </div>
    </fieldset>
  );
}

export function LoadDetailsForm({
  action,
  load,
  carriers,
  canManageCarrier,
  campaigns = [],
}: {
  action: (state: LoadFormState, formData: FormData) => Promise<LoadFormState>;
  load: Load;
  carriers: Carrier[];
  canManageCarrier: boolean;
  campaigns?: string[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [distance, setDistance] = useState(load.distance_miles?.toString() ?? "");
  const [dirty, setDirty] = useState(false);

  // The map reads the LIVE field values, so a rep can retype cities and hit
  // Calculate before ever saving.
  const getEndpoints = useCallback(() => {
    const form = formRef.current;
    if (!form) return null;
    const fd = new FormData(form);
    const val = (name: string) => (fd.get(name) || "").toString().trim();
    const origin = { city: val("pickup_city"), state: val("pickup_state"), zip: val("pickup_zip") };
    const destination = {
      city: val("delivery_city"),
      state: val("delivery_state"),
      zip: val("delivery_zip"),
    };
    if ((!origin.city && !origin.zip) || (!destination.city && !destination.zip)) return null;
    return { origin, destination };
  }, []);

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={() => setDirty(true)}
      onKeyDown={(e) => {
        // Enter in a text input must never submit the whole form mid-edit;
        // Save is an explicit click (or tab + Enter on the button).
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "INPUT") e.preventDefault();
      }}
      className="space-y-8"
    >
      {/* The old system's header strip: Loadboard + Campaign sit above the
          record, deciding where it posts and which campaign it belongs to. */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-muted px-4 py-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="loadboard">Loadboard</FieldLabel>
          <NativeSelect id="loadboard" name="loadboard" defaultValue={load.loadboard ?? "all"} className="w-40">
            <option value="all">All</option>
            <option value="cd">Central</option>
            <option value="sd">Super</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="campaign">Campaign</FieldLabel>
          <Input
            id="campaign"
            name="campaign"
            list="campaign-options"
            defaultValue={load.campaign ?? ""}
            placeholder="—"
            className="w-48"
          />
          <datalist id="campaign-options">
            {campaigns.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <FormSection icon={MapPin} title="Origin & Destination">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <EndpointFields
            prefix="pickup"
            title="Origin"
            load={load}
            dateField="pickup_ready_date"
            dateLabel="Ready date"
          />
          <EndpointFields
            prefix="delivery"
            title="Destination"
            load={load}
            dateField="delivery_eta"
            dateLabel="ETA"
          />
        </div>
      </FormSection>

      <FormSection icon={Truck} title="Shipping">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="transport_type">Transport type</FieldLabel>
                <NativeSelect id="transport_type" name="transport_type" defaultValue={load.transport_type}>
                  <option value="open">Open</option>
                  <option value="enclosed">Enclosed</option>
                  <option value="driveaway">Driveaway</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="distance_miles">Distance (mi)</FieldLabel>
                <Input
                  id="distance_miles"
                  name="distance_miles"
                  inputMode="numeric"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="customer_rate">Rate ($)</FieldLabel>
                <Input id="customer_rate" name="customer_rate" inputMode="decimal" defaultValue={load.customer_rate ?? ""} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="deposit_amount">Deposit ($)</FieldLabel>
                <Input id="deposit_amount" name="deposit_amount" inputMode="decimal" defaultValue={load.deposit_amount ?? ""} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="balance_due">Balance ($)</FieldLabel>
                <Input id="balance_due" name="balance_due" inputMode="decimal" defaultValue={load.balance_due ?? ""} />
              </div>
            </div>
            <div className="space-y-1.5">
              {/* The one 700-weight string in the spec. msgplane also paints it
                  #2196f3, but that is 3.1:1 as text — the emphasis comes from
                  weight and the icon keeps the hue. */}
              <FieldLabel htmlFor="notes" className="text-sm font-bold text-foreground">
                <span className="inline-flex items-center gap-1">
                  <StickyNote className="size-3 text-msg-shipper" aria-hidden="true" />
                  Notes from Shipper
                </span>
              </FieldLabel>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={load.notes ?? ""}
                placeholder="Gate codes, flexible dates, keys location..."
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="shipper_info">Information for shipper</FieldLabel>
              <Textarea
                id="shipper_info"
                name="shipper_info"
                rows={2}
                defaultValue={load.shipper_info ?? ""}
                placeholder="Shown to the customer on the contract…"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="cd_note">Central Dispatch note (max 60 characters)</FieldLabel>
              <Input id="cd_note" name="cd_note" maxLength={60} defaultValue={load.cd_note ?? ""} />
            </div>
            {/* msgplane's "Request Credit Card Information": when checked, the
                contract's signing page asks the customer for card details.
                The marker input keeps partial forms from resetting the flag. */}
            <input type="hidden" name="require_card_present" value="1" />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="contract_requires_card"
                defaultChecked={load.contract_requires_card}
                className="size-4 accent-primary"
              />
              Request credit card information on the contract
            </label>
          </div>
          <RouteMap
            getEndpoints={getEndpoints}
            onMiles={(mi) => {
              setDistance(String(mi));
              setDirty(true);
            }}
          />
        </div>
      </FormSection>

      {/* msgplane's Pricing Information / Dispatch Info blocks: how the
          carrier gets paid, and who's driving. Free to edit for any staff —
          these are contract terms, not margin. */}
      <FormSection icon={ClipboardList} title="Dispatch & payment terms">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
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
        <div className="mt-4 space-y-1.5">
          <FieldLabel htmlFor="dispatch_instructions">
            Driver&apos;s instructions (dispatch instructions)
          </FieldLabel>
          <Textarea
            id="dispatch_instructions"
            name="dispatch_instructions"
            rows={2}
            defaultValue={load.dispatch_instructions ?? ""}
          />
        </div>
      </FormSection>

      {canManageCarrier && (
        <FormSection icon={Handshake} title="Carrier assignment">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="col-span-2 space-y-1.5">
              <FieldLabel htmlFor="carrier_id">Carrier</FieldLabel>
              <NativeSelect id="carrier_id" name="carrier_id" defaultValue={load.carrier_id ?? ""}>
                <option value="">Unassigned</option>
                {carriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="carrier_pay">Carrier pay ($)</FieldLabel>
              <Input id="carrier_pay" name="carrier_pay" inputMode="decimal" defaultValue={load.carrier_pay ?? ""} />
            </div>
          </div>
        </FormSection>
      )}

      {/* Sticky action bar: the one place Save lives, always in reach. */}
      {/* bg-card, not bg-background: the two were different colors only while
          the page was gray, and this bar sits inside a card. */}
      <div className="sticky bottom-0 z-10 -mx-6 border-t bg-card/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-3">
          {state.error && <p className="mr-auto text-sm text-destructive">{state.error}</p>}
          {dirty && !pending && !state.error && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          {(load.status === "lead" || load.status === "quote") && (
            <Button type="submit" name="convert" value="1" variant="outline" disabled={pending}>
              Save and convert to order
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
