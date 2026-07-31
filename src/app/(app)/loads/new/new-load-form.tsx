"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Car, MapPin, StickyNote, Truck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, FieldLabel } from "@/components/form-section";
import { defaultReservationFee, offeredCarrierPay } from "@/lib/pricing";
import { isOutlier, type LaneSuggestion } from "@/lib/pricing/lanes";
import type { LoadFormState } from "../actions";
import { createLoad } from "../actions";
import { VehiclesFieldArray } from "./vehicles-field-array";

const initialState: LoadFormState = { error: null };

type EndpointState = {
  address: string;
  city: string;
  state: string;
  zip: string;
  contact_name: string;
  contact_phone: string;
  date: string;
};

const EMPTY_ENDPOINT: EndpointState = {
  address: "",
  city: "",
  state: "",
  zip: "",
  contact_name: "",
  contact_phone: "",
  date: "",
};

type CopyOption = { label: string; checked: boolean; onToggle: (checked: boolean) => void };

function EndpointFields({
  prefix,
  title,
  values,
  onField,
  locked,
  copyOptions,
}: {
  prefix: "pickup" | "delivery";
  title: string;
  values: EndpointState;
  onField: (field: keyof EndpointState, value: string) => void;
  /** A "copy … info" box is ticked: the contact pair tracks its source. */
  locked: boolean;
  copyOptions: CopyOption[];
}) {
  const dateName = prefix === "pickup" ? "pickup_ready_date" : "delivery_eta";
  const lockedClass = locked ? "bg-muted text-muted-foreground" : undefined;
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="flex items-center gap-1.5 pb-1 text-xs text-msg-header">
        <MapPin className="size-4 text-msg-shipper" aria-hidden="true" />
        {title}
      </legend>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={`${prefix}_address`}>Address</FieldLabel>
        <Input
          id={`${prefix}_address`}
          name={`${prefix}_address`}
          value={values.address}
          onChange={(e) => onField("address", e.target.value)}
        />
      </div>
      {/* Six tracks would leave the State field ~19px of text box on a phone.
          Two tracks put City on its own row with State and ZIP beneath it. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <div className="col-span-2 space-y-1.5 md:col-span-3">
          <FieldLabel htmlFor={`${prefix}_city`}>City</FieldLabel>
          <Input
            id={`${prefix}_city`}
            name={`${prefix}_city`}
            value={values.city}
            onChange={(e) => onField("city", e.target.value)}
          />
        </div>
        <div className="col-span-1 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_state`}>State</FieldLabel>
          <Input
            id={`${prefix}_state`}
            name={`${prefix}_state`}
            value={values.state}
            onChange={(e) => onField("state", e.target.value)}
            maxLength={2}
          />
        </div>
        <div className="col-span-1 space-y-1.5 md:col-span-2">
          <FieldLabel htmlFor={`${prefix}_zip`}>ZIP</FieldLabel>
          <Input
            id={`${prefix}_zip`}
            name={`${prefix}_zip`}
            value={values.zip}
            onChange={(e) => onField("zip", e.target.value)}
            inputMode="numeric"
            maxLength={5}
          />
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
            value={values.contact_name}
            onChange={(e) => onField("contact_name", e.target.value)}
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
            value={values.contact_phone}
            onChange={(e) => onField("contact_phone", e.target.value)}
            readOnly={locked}
            className={lockedClass}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={dateName}>{prefix === "pickup" ? "Ready date" : "ETA"}</FieldLabel>
        <Input
          id={dateName}
          name={dateName}
          type="date"
          className="w-44 max-md:w-full"
          value={values.date}
          onChange={(e) => onField("date", e.target.value)}
        />
      </div>
    </fieldset>
  );
}

export function NewLoadForm() {
  const [state, formAction, pending] = useActionState(createLoad, initialState);
  const [dirty, setDirty] = useState(false);

  const [pickup, setPickup] = useState<EndpointState>({ ...EMPTY_ENDPOINT });
  const [delivery, setDelivery] = useState<EndpointState>({ ...EMPTY_ENDPOINT });
  // Controlled only so the "copy shipper info" boxes have a live source: on a
  // new order the shipper is being typed in the same breath as the pickup.
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupCopy, setPickupCopy] = useState(false);
  const [deliveryCopy, setDeliveryCopy] = useState<"shipper" | "pickup" | null>(null);
  const [transport, setTransport] = useState("open");
  const [rate, setRate] = useState("");
  const [reservation, setReservation] = useState("");
  // Once the rep types in the fee themselves, the total stops driving it —
  // otherwise a negotiated fee would be overwritten by the next keystroke in
  // the total.
  const [reservationTouched, setReservationTouched] = useState(false);
  const [distance, setDistance] = useState("");
  // Once the agent types a distance themselves, the estimator stops
  // overwriting it (it re-runs on transport/vehicle changes too). A ref so
  // the in-flight timer always sees the current value.
  const distanceEditedRef = useRef(false);
  const [firstVehicle, setFirstVehicle] = useState({ vehicle_type: "sedan", condition: "running" });

  const [suggestion, setSuggestion] = useState<{ miles: number; price: number } | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const handleFirstVehicle = useCallback((v: { vehicle_type: string; condition: string }) => {
    setFirstVehicle((prev) =>
      prev.vehicle_type === v.vehicle_type && prev.condition === v.condition ? prev : v
    );
  }, []);

  // ZIP -> city/state autofill (fires when a ZIP reaches 5 digits).
  const autofill = useCallback(
    async (zip: string, setEndpoint: React.Dispatch<React.SetStateAction<EndpointState>>) => {
      if (!/^\d{5}$/.test(zip)) return;
      try {
        const r = await fetch(`/api/geo/citystate?zip=${zip}`);
        if (!r.ok) return;
        const d = await r.json();
        if (d.city || d.state) {
          setEndpoint((prev) =>
            prev.zip === zip ? { ...prev, city: d.city || prev.city, state: d.state || prev.state } : prev
          );
        }
      } catch {
        /* leave fields for manual entry */
      }
    },
    []
  );

  useEffect(() => {
    autofill(pickup.zip, setPickup);
  }, [pickup.zip, autofill]);
  useEffect(() => {
    autofill(delivery.zip, setDelivery);
  }, [delivery.zip, autofill]);

  // Suggested quote once both ZIPs are valid. The PRICE is only a suggestion
  // (never auto-filled — the agent sets the rate); the computed mileage does
  // auto-fill the Distance field, still editable. All state updates are
  // deferred into the timer so the effect body itself stays side-effect free.
  useEffect(() => {
    const valid = /^\d{5}$/.test(pickup.zip) && /^\d{5}$/.test(delivery.zip);
    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      if (!valid) {
        setSuggestion(null);
        setSuggestError(null);
        setSuggestLoading(false);
        return;
      }
      setSuggestLoading(true);
      setSuggestError(null);
      try {
        const params = new URLSearchParams({
          from: pickup.zip,
          to: delivery.zip,
          type: firstVehicle.vehicle_type,
          condition: firstVehicle.condition,
          transport,
        });
        const r = await fetch(`/api/geo/quote?${params.toString()}`);
        if (!active) return;
        if (!r.ok) {
          setSuggestion(null);
          setSuggestError(
            r.status === 503
              ? "Distance pricing isn't set up yet (needs ORS_KEY)."
              : "Couldn't estimate this lane automatically."
          );
        } else {
          const d = await r.json();
          if (!active) return;
          setSuggestion({ miles: d.miles, price: d.price });
          if (!distanceEditedRef.current) setDistance(String(d.miles));
        }
      } catch {
        if (active) {
          setSuggestion(null);
          setSuggestError("Couldn't estimate this lane automatically.");
        }
      } finally {
        if (active) setSuggestLoading(false);
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pickup.zip, delivery.zip, transport, firstVehicle.vehicle_type, firstVehicle.condition]);

  // Phase 6a — what we have actually quoted on this state lane before.
  //
  // Separate from the ORS estimate above and deliberately so: that one is a
  // computed price from distance, this one is our own history. When they
  // disagree, the disagreement is the useful part, so both are shown.
  //
  // Keyed on STATE, not ZIP, so it answers as soon as the states are known —
  // typically several fields before a ZIP is typed.
  const [lane, setLane] = useState<LaneSuggestion | null>(null);
  useEffect(() => {
    let active = true;
    // Every setLane below sits inside the timer, including the "not two states
    // yet" clear. A synchronous setState in an effect body is a lint ERROR
    // under React 19 (react-hooks/set-state-in-effect) — same fix as the toast
    // in intake-form.tsx.
    const timer = setTimeout(async () => {
      const from = pickup.state.trim();
      const to = delivery.state.trim();
      if (from.length !== 2 || to.length !== 2) {
        if (active) setLane(null);
        return;
      }
      try {
        const params = new URLSearchParams({
          from,
          to,
          vehicle: firstVehicle.vehicle_type,
          transport,
        });
        const r = await fetch(`/api/pricing/lane?${params.toString()}`);
        // 503 is the feature being off. Not an error worth showing anyone.
        if (!active || !r.ok) {
          if (active) setLane(null);
          return;
        }
        const d = await r.json();
        if (active) setLane(d.suggestion ?? null);
      } catch {
        if (active) setLane(null);
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pickup.state, delivery.state, transport, firstVehicle.vehicle_type]);

  // What the carrier is offered = total minus the reservation fee we keep.
  const rateNum = Number(rate);
  const reservationNum = Number(reservation || 0);
  const carrierPay =
    rate.trim() !== "" && Number.isFinite(rateNum) && Number.isFinite(reservationNum)
      ? offeredCarrierPay(rateNum, reservationNum)
      : null;

  const pickupField = (field: keyof EndpointState, value: string) =>
    setPickup((prev) => ({ ...prev, [field]: value }));
  const deliveryField = (field: keyof EndpointState, value: string) =>
    setDelivery((prev) => ({ ...prev, [field]: value }));

  // A ticked box MIRRORS its source rather than pasting once, so the contact
  // keeps up while the shipper's name is still being typed. Only the contact
  // pair is copied — addresses and dates are never the same on both ends.
  const pickupEffective: EndpointState = pickupCopy
    ? { ...pickup, contact_name: customerName, contact_phone: customerPhone }
    : pickup;
  const deliveryEffective: EndpointState =
    deliveryCopy === "shipper"
      ? { ...delivery, contact_name: customerName, contact_phone: customerPhone }
      : deliveryCopy === "pickup"
        ? {
            ...delivery,
            contact_name: pickupEffective.contact_name,
            contact_phone: pickupEffective.contact_phone,
          }
        : delivery;

  // Unticking KEEPS what was copied — those values belong to the order now.
  const togglePickupCopy = (on: boolean) => {
    if (!on) setPickup(pickupEffective);
    setPickupCopy(on);
    setDirty(true);
  };
  const toggleDeliveryCopy = (source: "shipper" | "pickup", on: boolean) => {
    if (!on) setDelivery(deliveryEffective);
    setDeliveryCopy(on ? source : null);
    setDirty(true);
  };

  return (
    <form
      action={formAction}
      onInput={() => setDirty(true)}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "INPUT") e.preventDefault();
      }}
      className="space-y-8"
    >
      <FormSection icon={User} title="Shipper">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_name" required>
              Customer name
            </FieldLabel>
            <Input
              id="customer_name"
              name="customer_name"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_phone">Phone</FieldLabel>
            <Input
              id="customer_phone"
              name="customer_phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_email">Email</FieldLabel>
            <Input id="customer_email" name="customer_email" type="email" />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          A matching phone/email reuses the existing customer. No rate yet → saved as a{" "}
          <strong>Lead</strong>. Add a rate below → saved as a <strong>Quote</strong>.
        </p>
      </FormSection>

      <FormSection icon={MapPin} title="Origin & Destination">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <EndpointFields
            prefix="pickup"
            title="Origin"
            values={pickupEffective}
            onField={pickupField}
            locked={pickupCopy}
            copyOptions={[
              { label: "copy shipper info", checked: pickupCopy, onToggle: togglePickupCopy },
            ]}
          />
          <EndpointFields
            prefix="delivery"
            title="Destination"
            values={deliveryEffective}
            onField={deliveryField}
            locked={deliveryCopy !== null}
            copyOptions={[
              {
                label: "copy shipper info",
                checked: deliveryCopy === "shipper",
                onToggle: (on: boolean) => toggleDeliveryCopy("shipper", on),
              },
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
              onChange={(e) => {
                const v = e.target.value;
                // Typing a value pins it; clearing the field hands control
                // back to the estimator so it fills the routed mileage again.
                distanceEditedRef.current = v.trim() !== "";
                setDistance(v);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_rate">Total ($)</FieldLabel>
            <Input
              id="customer_rate"
              name="customer_rate"
              inputMode="decimal"
              value={rate}
              onChange={(e) => {
                const next = e.target.value;
                setRate(next);
                // The fee follows the total at the house rate until somebody
                // overrides it. Left blank it used to reach the server as
                // zero, and the load was recorded earning nothing.
                if (!reservationTouched) {
                  const n = Number(next);
                  setReservation(next.trim() !== "" && Number.isFinite(n) ? String(defaultReservationFee(n)) : "");
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="deposit_amount">Reservation fee ($)</FieldLabel>
            <Input
              id="deposit_amount"
              name="deposit_amount"
              inputMode="decimal"
              value={reservation}
              onChange={(e) => {
                setReservationTouched(true);
                setReservation(e.target.value);
              }}
            />
          </div>

          {/* Total − reservation is what the carrier is offered on the board. */}
          {carrierPay !== null && (
            <div className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted px-3 py-2 text-sm lg:col-span-4">
              <span className="text-muted-foreground">Carrier pay</span>
              <span className="tabular-nums">${carrierPay.toLocaleString()}</span>
              <span className="text-muted-foreground">
                — total ${Number(rate).toLocaleString()} − reservation $
                {Number(reservation || 0).toLocaleString()}. This is the amount posted to CD/SD.
              </span>
            </div>
          )}

          {/* What we have quoted on this lane before. Advisory, like the
              estimate below it, but sourced from our own book rather than from
              distance — so the wording says "quoted", never "predicted". */}
          {lane && (
            <div className="col-span-2 space-y-1 rounded-md border border-dashed bg-muted px-3 py-2 text-sm lg:col-span-4">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  We usually quote{" "}
                  <span className="font-semibold tabular-nums">
                    ${lane.median.toLocaleString()}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · typically ${lane.low.toLocaleString()}–${lane.high.toLocaleString()} · from{" "}
                    {lane.samples.toLocaleString()} past loads
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="max-md:min-h-12"
                  onClick={() => setRate(String(lane.median))}
                >
                  Use ${lane.median.toLocaleString()}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {lane.matchedOn}
                {lane.broadened && " — no history for this exact vehicle and transport, so this is the wider lane"}
                {lane.winRate != null &&
                  ` · ${Math.round(lane.winRate * 100)}% of decided quotes here were won`}
              </p>
              {isOutlier(rate.trim() === "" ? null : rateNum, lane) && (
                <p className="text-xs text-ord-deposit">
                  ${rateNum.toLocaleString()} is{" "}
                  {rateNum > lane.median ? "above" : "below"} the usual by{" "}
                  {Math.abs(Math.round(((rateNum - lane.median) / lane.median) * 100))}% — worth a
                  second look, and worth a note saying why.
                </p>
              )}
            </div>
          )}

          {/* Suggested price — advisory only; the agent sets the real rate. */}
          {(suggestLoading || suggestion || suggestError) && (
            <div className="col-span-2 rounded-md border border-dashed bg-muted px-3 py-2 text-sm lg:col-span-4">
              {suggestLoading && <span className="text-muted-foreground">Estimating this lane…</span>}
              {!suggestLoading && suggestion && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Suggested{" "}
                    <span className="tabular-nums">${suggestion.price.toLocaleString()}</span>{" "}
                    <span className="text-muted-foreground">
                      · ~{suggestion.miles.toLocaleString()} mi · {transport}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="max-md:min-h-12"
                    onClick={() => setRate(String(suggestion.price))}
                  >
                    Use ${suggestion.price.toLocaleString()}
                  </Button>
                  <span className="text-xs text-muted-foreground">— or set your own.</span>
                </div>
              )}
              {!suggestLoading && !suggestion && suggestError && (
                <span className="text-muted-foreground">{suggestError}</span>
              )}
            </div>
          )}

          <div className="col-span-2 space-y-1.5 lg:col-span-4">
            <FieldLabel htmlFor="notes">
              <span className="inline-flex items-center gap-1">
                <StickyNote className="size-3" aria-hidden="true" />
                Notes from shipper
              </span>
            </FieldLabel>
            <Textarea id="notes" name="notes" rows={3} />
          </div>
        </div>
      </FormSection>

      <FormSection icon={Car} title="Vehicles">
        <VehiclesFieldArray onFirstVehicleChange={handleFirstVehicle} />
      </FormSection>

      {/* bg-card: --background and --card are both white now, and in dark mode
          this bar belongs to the card surface, not the page. */}
      {/* The negative margin bleeds the bar to main's edge, so it has to track
          main's gutter — which halves below md. Never exceed it: a bleed wider
          than the padding scrolls the document sideways. */}
      <div className="sticky bottom-0 z-10 -mx-6 border-t bg-card/95 px-6 py-3 backdrop-blur max-md:-mx-4 max-md:px-4">
        <div className="flex items-center justify-end gap-3 max-md:flex-wrap">
          {/* mr-auto puts the error leftmost, so without its own row it is the
              first thing squeezed out of a narrow bar. */}
          {state.error && (
            <p className="mr-auto text-sm text-destructive max-md:basis-full">{state.error}</p>
          )}
          {dirty && !pending && !state.error && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button
            type="button"
            variant="outline"
            className="max-md:min-h-12"
            render={<Link href="/loads" />}
          >
            Cancel
          </Button>
          <Button type="submit" className="max-md:min-h-12" disabled={pending}>
            {pending ? "Creating..." : "Create load"}
          </Button>
        </div>
      </div>
    </form>
  );
}
