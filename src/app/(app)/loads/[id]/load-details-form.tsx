"use client";

import { useActionState, useCallback, useRef, useState } from "react";
import { ClipboardList, Handshake, MapPin, StickyNote, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, FieldLabel } from "@/components/form-section";
import { LaneSuggestionBand, overrideToRecord } from "@/components/pricing/lane-suggestion";
import type { LaneSuggestion } from "@/lib/pricing/lanes";
import { RouteMap } from "@/components/route-map";
import { recordPriceOverride } from "./quote-outcome-actions";
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

// The four fields a "copy … info" checkbox writes.
type ContactState = {
  contact_name: string;
  company: string;
  contact_cell: string;
  contact_phone: string;
};

/** The shipper as the customer record files them — the copy source. */
export type ShipperContact = { name: string; company: string; phone: string };

const EMPTY_CONTACT: ContactState = {
  contact_name: "",
  company: "",
  contact_cell: "",
  contact_phone: "",
};

function contactOf(load: Load, prefix: "pickup" | "delivery"): ContactState {
  const v = (field: string) => (load as unknown as Record<string, string | null>)[field] ?? "";
  return {
    contact_name: v(`${prefix}_contact_name`),
    company: v(`${prefix}_company`),
    contact_cell: v(`${prefix}_contact_cell`),
    contact_phone: v(`${prefix}_contact_phone`),
  };
}

// The shipper has ONE phone on the customer record and msgplane files it as
// the cell, which is what it almost always is — a mobile the rep already
// texts. The landline stays empty rather than guessing.
function contactOfShipper(shipper: ShipperContact): ContactState {
  return {
    contact_name: shipper.name,
    company: shipper.company,
    contact_cell: shipper.phone,
    contact_phone: "",
  };
}

type CopyOption = { label: string; checked: boolean; onToggle: (checked: boolean) => void };

// One endpoint column of the msgplane-style Origin & Destination pair.
//
// The four contact fields are controlled, unlike the address fields above
// them, because of the "copy … info" checkboxes: while one is ticked the
// column MIRRORS its source, so correcting the shipper's name corrects it
// everywhere it was copied to. Unticking keeps the copied values.
function EndpointFields({
  prefix,
  title,
  load,
  dateField,
  dateLabel,
  contact,
  onContact,
  stateValue,
  onStateChange,
  locked,
  copyOptions,
}: {
  prefix: "pickup" | "delivery";
  title: string;
  load: Load;
  dateField: "pickup_ready_date" | "delivery_eta";
  dateLabel: string;
  contact: ContactState;
  onContact: (field: keyof ContactState, value: string) => void;
  /** Controlled, unlike the fields around it: the lane-suggestion band needs
   *  to react as the state codes are typed, not after a save. */
  stateValue: string;
  onStateChange: (value: string) => void;
  /** A copy is active: these fields track their source instead of the rep. */
  locked: boolean;
  copyOptions: CopyOption[];
}) {
  const v = (field: string) => (load as unknown as Record<string, string | null>)[field] ?? "";
  // Mirrored fields read as filled-in rather than editable, which is the whole
  // signal that unticking the box is what hands them back.
  const lockedClass = locked ? "bg-muted text-muted-foreground" : undefined;
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
      {/* Six tracks inside the nested edit page leave the State field about one
          glyph wide on a phone, so below md City takes a row and State/ZIP
          share the next. The md: template is today's verbatim. */}
      <div className="grid grid-cols-4 gap-2 md:grid-cols-6">
        <div className="col-span-4 space-y-1.5 md:col-span-3">
          <FieldLabel htmlFor={`${prefix}_city`}>City</FieldLabel>
          <Input id={`${prefix}_city`} name={`${prefix}_city`} defaultValue={v(`${prefix}_city`)} />
        </div>
        <div className="col-span-1 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_state`}>State</FieldLabel>
          <Input
            id={`${prefix}_state`}
            name={`${prefix}_state`}
            maxLength={2}
            value={stateValue}
            onChange={(e) => onStateChange(e.target.value)}
          />
        </div>
        <div className="col-span-3 space-y-1.5 md:col-span-2">
          <FieldLabel htmlFor={`${prefix}_zip`}>ZIP</FieldLabel>
          <Input id={`${prefix}_zip`} name={`${prefix}_zip`} defaultValue={v(`${prefix}_zip`)} />
        </div>
      </div>
      {/* msgplane's copy boxes sit directly above the contact block, and the
          order matters: shipper first, then pickup on the destination side. */}
      {copyOptions.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {copyOptions.map((o) => (
            <label
              key={o.label}
              className="flex cursor-pointer items-center gap-2 text-sm max-md:min-h-12"
            >
              <input
                type="checkbox"
                checked={o.checked}
                onChange={(e) => o.onToggle(e.target.checked)}
                className="size-4 cursor-pointer accent-primary"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_name`}>Contact</FieldLabel>
          <Input
            id={`${prefix}_contact_name`}
            name={`${prefix}_contact_name`}
            value={contact.contact_name}
            onChange={(e) => onContact("contact_name", e.target.value)}
            readOnly={locked}
            className={lockedClass}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_company`}>Company</FieldLabel>
          <Input
            id={`${prefix}_company`}
            name={`${prefix}_company`}
            value={contact.company}
            onChange={(e) => onContact("company", e.target.value)}
            readOnly={locked}
            className={lockedClass}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_cell`}>Phone cell</FieldLabel>
          <Input
            id={`${prefix}_contact_cell`}
            name={`${prefix}_contact_cell`}
            type="tel"
            value={contact.contact_cell}
            onChange={(e) => onContact("contact_cell", e.target.value)}
            readOnly={locked}
            className={lockedClass}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_phone`}>Phone</FieldLabel>
          <Input
            id={`${prefix}_contact_phone`}
            name={`${prefix}_contact_phone`}
            type="tel"
            value={contact.contact_phone}
            onChange={(e) => onContact("contact_phone", e.target.value)}
            readOnly={locked}
            className={lockedClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={dateField}>{dateLabel}</FieldLabel>
          {/* The fixed 176px beats its track on a phone and overlaps Buyer
              number, which the section's overflow-hidden then clips. */}
          <Input
            id={dateField}
            name={dateField}
            type="date"
            defaultValue={load[dateField] ?? ""}
            className="w-44 max-md:w-full"
          />
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
  shipper = null,
}: {
  action: (state: LoadFormState, formData: FormData) => Promise<LoadFormState>;
  load: Load;
  carriers: Carrier[];
  canManageCarrier: boolean;
  campaigns?: string[];
  /** Omitted when the customer record couldn't be read — no copy box then. */
  shipper?: ShipperContact | null;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [distance, setDistance] = useState(load.distance_miles?.toString() ?? "");
  const [dirty, setDirty] = useState(false);

  // Controlled for the lane-suggestion band: leads get PRICED on this form
  // (updateLoad promotes lead→quote on pricing), so the pricing moment needs
  // the same history the new-load form shows. States and transport feed the
  // lookup; the rate feeds the outlier warning and the override record.
  const [pickupState, setPickupState] = useState(load.pickup_state ?? "");
  const [deliveryState, setDeliveryState] = useState(load.delivery_state ?? "");
  const [transport, setTransport] = useState<string>(load.transport_type);
  const [rate, setRate] = useState(load.customer_rate?.toString() ?? "");
  // The suggestion currently on screen — a ref because it is only read at
  // submit time, to record an override against exactly what the rep saw.
  const laneRef = useRef<LaneSuggestion | null>(null);
  const handleLaneSuggestion = useCallback((s: LaneSuggestion | null) => {
    laneRef.current = s;
  }, []);

  // What the rep typed, kept separately from what a ticked box is mirroring,
  // so unticking can hand the typed values back instead of the copy.
  const [pickupTyped, setPickupTyped] = useState<ContactState>(() => contactOf(load, "pickup"));
  const [deliveryTyped, setDeliveryTyped] = useState<ContactState>(() => contactOf(load, "delivery"));
  const [pickupCopy, setPickupCopy] = useState(false);
  const [deliveryCopy, setDeliveryCopy] = useState<"shipper" | "pickup" | null>(null);

  const shipperContact = shipper ? contactOfShipper(shipper) : EMPTY_CONTACT;
  const pickupContact = pickupCopy && shipper ? shipperContact : pickupTyped;
  // Destination copying pickup while pickup copies the shipper resolves to the
  // shipper, which is exactly what msgplane shows for a self-delivery.
  const deliveryContact =
    deliveryCopy === "shipper" && shipper
      ? shipperContact
      : deliveryCopy === "pickup"
        ? pickupContact
        : deliveryTyped;

  // Unticking KEEPS what was copied. Those values are this order's own now,
  // exactly as if the rep had typed them, and wiping four fields because
  // somebody unticked a box is not a thing an order form should do.
  const togglePickupCopy = (on: boolean) => {
    if (!on) setPickupTyped(pickupContact);
    setPickupCopy(on);
    setDirty(true);
  };
  const toggleDeliveryCopy = (source: "shipper" | "pickup", on: boolean) => {
    if (!on) setDeliveryTyped(deliveryContact);
    setDeliveryCopy(on ? source : null);
    setDirty(true);
  };

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
      onSubmit={() => {
        // Pricing telemetry, fire-and-forget: the rep re-priced this load away
        // from the suggestion on screen. Gated on the rate actually changing
        // this session — re-saving an old rate is not a new pricing decision —
        // and the action never throws, so the save cannot be hurt by it.
        if (Number(rate) === Number(load.customer_rate ?? NaN)) return;
        const rec = overrideToRecord(rate, laneRef.current);
        if (rec) {
          void recordPriceOverride({
            loadId: load.id,
            originState: pickupState,
            destState: deliveryState,
            suggested: rec.suggested,
            entered: rec.entered,
            sampleSize: rec.sampleSize,
            reason: null,
          });
        }
      }}
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
            contact={pickupContact}
            onContact={(field, value) => setPickupTyped((prev) => ({ ...prev, [field]: value }))}
            stateValue={pickupState}
            onStateChange={setPickupState}
            locked={pickupCopy && Boolean(shipper)}
            copyOptions={
              shipper
                ? [
                    {
                      label: "copy shipper info",
                      checked: pickupCopy,
                      onToggle: togglePickupCopy,
                    },
                  ]
                : []
            }
          />
          <EndpointFields
            prefix="delivery"
            title="Destination"
            load={load}
            dateField="delivery_eta"
            dateLabel="ETA"
            contact={deliveryContact}
            onContact={(field, value) => setDeliveryTyped((prev) => ({ ...prev, [field]: value }))}
            stateValue={deliveryState}
            onStateChange={setDeliveryState}
            locked={deliveryCopy !== null}
            copyOptions={[
              ...(shipper
                ? [
                    {
                      label: "copy shipper info",
                      checked: deliveryCopy === "shipper",
                      onToggle: (on: boolean) => toggleDeliveryCopy("shipper", on),
                    },
                  ]
                : []),
              {
                label: "copy pickup info",
                checked: deliveryCopy === "pickup",
                onToggle: (on: boolean) => toggleDeliveryCopy("pickup", on),
              },
            ]}
          />
        </div>
      </FormSection>

      <FormSection icon={Truck} title="Shipping">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="transport_type">Transport type</FieldLabel>
                <NativeSelect
                  id="transport_type"
                  name="transport_type"
                  value={transport}
                  onChange={(e) => setTransport(e.target.value)}
                >
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
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="customer_rate">Rate ($)</FieldLabel>
                <Input
                  id="customer_rate"
                  name="customer_rate"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
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
            {/* What we have quoted on this lane before — same band as the
                new-load form. No vehicle passed: vehicles are edited elsewhere
                on this page, and the API answers with the broader lane. */}
            <LaneSuggestionBand
              originState={pickupState}
              destState={deliveryState}
              transport={transport}
              rate={rate}
              onUseSuggestion={(price) => {
                setRate(String(price));
                setDirty(true);
              }}
              onSuggestionChange={handleLaneSuggestion}
            />
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
            {/* The label wraps the box, so the whole 44px row is the hit area
                and the checkbox glyph itself is untouched. */}
            <label className="flex items-center gap-2 text-sm max-md:min-h-12">
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
        {/* These selects hold strings like "Broker check on delivery" — a
            two-column phone track truncates them to a few characters. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
          {/* col-span-2 has to drop with the base template: left at 2 inside a
              single-column grid it would create an implicit second column. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="col-span-1 space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor="carrier_id">Carrier</FieldLabel>
              {/* Marker input, same pattern as require_card_present: it proves
                  this form actually carried the carrier control, so a partial
                  or future form that omits it cannot silently release the
                  carrier on a dispatched order. */}
              <input type="hidden" name="carrier_id_present" value="1" />
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
      {/* The negative margin bleeds the bar to the wrapping band's edge, so it
          has to track that band's padding — p-3 below md, p-5 above (see
          edit/page.tsx). Overshooting is clipped, not scrolled. */}
      <div className="sticky bottom-0 z-10 -mx-6 border-t bg-card/95 px-6 py-3 backdrop-blur max-md:-mx-3 max-md:px-3">
        {/* justify-end pushes overflow off the LEFT edge, where the band's
            overflow-hidden clips it — and the error is the leftmost item, so a
            failed save would show nothing at all on a phone. */}
        <div className="flex items-center justify-end gap-3 max-md:flex-wrap">
          {state.error && (
            <p className="mr-auto text-sm text-destructive max-md:basis-full">{state.error}</p>
          )}
          {dirty && !pending && !state.error && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          {(load.status === "lead" || load.status === "quote") && (
            <Button
              type="submit"
              name="convert"
              value="1"
              variant="outline"
              className="max-md:min-h-12"
              disabled={pending}
            >
              Save and convert to order
            </Button>
          )}
          <Button type="submit" className="max-md:min-h-12" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
