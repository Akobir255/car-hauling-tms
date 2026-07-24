"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Car, MapPin, StickyNote, Truck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, FieldLabel } from "@/components/form-section";
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

function EndpointFields({
  prefix,
  title,
  values,
  onField,
}: {
  prefix: "pickup" | "delivery";
  title: string;
  values: EndpointState;
  onField: (field: keyof EndpointState, value: string) => void;
}) {
  const dateName = prefix === "pickup" ? "pickup_ready_date" : "delivery_eta";
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="flex items-center gap-1.5 pb-1 text-[13px] font-semibold text-foreground">
        <MapPin className="size-4 text-primary" aria-hidden="true" />
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
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-3 space-y-1.5">
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
        <div className="col-span-2 space-y-1.5">
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
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_name`}>Contact</FieldLabel>
          <Input
            id={`${prefix}_contact_name`}
            name={`${prefix}_contact_name`}
            value={values.contact_name}
            onChange={(e) => onField("contact_name", e.target.value)}
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
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={dateName}>{prefix === "pickup" ? "Ready date" : "ETA"}</FieldLabel>
        <Input
          id={dateName}
          name={dateName}
          type="date"
          className="w-44"
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
  const [transport, setTransport] = useState("open");
  const [rate, setRate] = useState("");
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

  const pickupField = (field: keyof EndpointState, value: string) =>
    setPickup((prev) => ({ ...prev, [field]: value }));
  const deliveryField = (field: keyof EndpointState, value: string) =>
    setDelivery((prev) => ({ ...prev, [field]: value }));

  return (
    <form
      action={formAction}
      onInput={() => setDirty(true)}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "INPUT") e.preventDefault();
      }}
      className="mx-auto max-w-5xl space-y-8"
    >
      <FormSection icon={User} title="Shipper">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_name" required>
              Customer name
            </FieldLabel>
            <Input id="customer_name" name="customer_name" required />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_phone">Phone</FieldLabel>
            <Input id="customer_phone" name="customer_phone" type="tel" />
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
          <EndpointFields prefix="pickup" title="Origin" values={pickup} onField={pickupField} />
          <EndpointFields prefix="delivery" title="Destination" values={delivery} onField={deliveryField} />
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
            <Input id="deposit_amount" name="deposit_amount" inputMode="decimal" />
          </div>

          {/* Suggested price — advisory only; the agent sets the real rate. */}
          {(suggestLoading || suggestion || suggestError) && (
            <div className="col-span-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm lg:col-span-4">
              {suggestLoading && <span className="text-muted-foreground">Estimating this lane…</span>}
              {!suggestLoading && suggestion && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Suggested{" "}
                    <span className="font-semibold tabular-nums">${suggestion.price.toLocaleString()}</span>{" "}
                    <span className="text-muted-foreground">
                      · ~{suggestion.miles.toLocaleString()} mi · {transport}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
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

      <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          {state.error && <p className="mr-auto text-sm text-destructive">{state.error}</p>}
          {dirty && !pending && !state.error && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button type="button" variant="outline" render={<Link href="/loads" />}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating..." : "Create load"}
          </Button>
        </div>
      </div>
    </form>
  );
}
