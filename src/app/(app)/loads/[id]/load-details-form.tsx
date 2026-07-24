"use client";

import { useActionState, useCallback, useRef, useState } from "react";
import { Handshake, MapPin, StickyNote, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, FieldLabel } from "@/components/form-section";
import { RouteMap } from "@/components/route-map";
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
      <legend className="flex items-center gap-1.5 pb-1 text-xs font-semibold text-muted-foreground">
        <MapPin className="size-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
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
      <div className="space-y-1.5">
        <FieldLabel htmlFor={dateField}>{dateLabel}</FieldLabel>
        <Input id={dateField} name={dateField} type="date" defaultValue={load[dateField] ?? ""} className="w-44" />
      </div>
    </fieldset>
  );
}

export function LoadDetailsForm({
  action,
  load,
  carriers,
  canManageCarrier,
}: {
  action: (state: LoadFormState, formData: FormData) => Promise<LoadFormState>;
  load: Load;
  carriers: Carrier[];
  canManageCarrier: boolean;
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
              <FieldLabel htmlFor="notes">
                <span className="inline-flex items-center gap-1">
                  <StickyNote className="size-3" aria-hidden="true" />
                  Notes from shipper
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
      <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur">
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
