"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Car, MapPin, StickyNote, Truck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, FieldLabel } from "@/components/form-section";
import type { Customer } from "@/types/database";
import type { LoadFormState } from "../actions";
import { createLoad } from "../actions";
import { VehiclesFieldArray } from "./vehicles-field-array";

const initialState: LoadFormState = { error: null };

function EndpointFields({ prefix, title }: { prefix: "pickup" | "delivery"; title: string }) {
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="flex items-center gap-1.5 pb-1 text-xs font-semibold text-muted-foreground">
        <MapPin className="size-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        {title}
      </legend>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={`${prefix}_address`}>Address</FieldLabel>
        <Input id={`${prefix}_address`} name={`${prefix}_address`} />
      </div>
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-3 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_city`}>City</FieldLabel>
          <Input id={`${prefix}_city`} name={`${prefix}_city`} />
        </div>
        <div className="col-span-1 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_state`}>State</FieldLabel>
          <Input id={`${prefix}_state`} name={`${prefix}_state`} maxLength={2} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_zip`}>ZIP</FieldLabel>
          <Input id={`${prefix}_zip`} name={`${prefix}_zip`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_name`}>Contact</FieldLabel>
          <Input id={`${prefix}_contact_name`} name={`${prefix}_contact_name`} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${prefix}_contact_phone`}>Phone</FieldLabel>
          <Input id={`${prefix}_contact_phone`} name={`${prefix}_contact_phone`} type="tel" />
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor={prefix === "pickup" ? "pickup_ready_date" : "delivery_eta"}>
          {prefix === "pickup" ? "Ready date" : "ETA"}
        </FieldLabel>
        <Input
          id={prefix === "pickup" ? "pickup_ready_date" : "delivery_eta"}
          name={prefix === "pickup" ? "pickup_ready_date" : "delivery_eta"}
          type="date"
          className="w-44"
        />
      </div>
    </fieldset>
  );
}

export function NewLoadForm({ customers }: { customers: Customer[] }) {
  const [state, formAction, pending] = useActionState(createLoad, initialState);
  const [dirty, setDirty] = useState(false);

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
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_id" required>
              Customer
            </FieldLabel>
            <NativeSelect id="customer_id" name="customer_id" required defaultValue="">
              <option value="" disabled>
                Select a customer
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contact_name}
                  {c.company_name ? ` (${c.company_name})` : ""}
                </option>
              ))}
            </NativeSelect>
            {customers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No customers yet —{" "}
                <Link href="/customers/new" className="underline">
                  add one first
                </Link>
                .
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="create_as">Create as</FieldLabel>
            <NativeSelect id="create_as" name="create_as" defaultValue="booked" className="w-44">
              <option value="booked">Order (booked)</option>
              <option value="quote">Quote</option>
            </NativeSelect>
          </div>
        </div>
      </FormSection>

      <FormSection icon={MapPin} title="Origin & Destination">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <EndpointFields prefix="pickup" title="Origin" />
          <EndpointFields prefix="delivery" title="Destination" />
        </div>
      </FormSection>

      <FormSection icon={Truck} title="Shipping">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="transport_type">Transport type</FieldLabel>
            <NativeSelect id="transport_type" name="transport_type" defaultValue="open">
              <option value="open">Open</option>
              <option value="enclosed">Enclosed</option>
              <option value="driveaway">Driveaway</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="distance_miles">Distance (mi)</FieldLabel>
            <Input id="distance_miles" name="distance_miles" inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="customer_rate">Rate ($)</FieldLabel>
            <Input id="customer_rate" name="customer_rate" inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="deposit_amount">Deposit ($)</FieldLabel>
            <Input id="deposit_amount" name="deposit_amount" inputMode="decimal" />
          </div>
          <div className="col-span-2 space-y-1.5 lg:col-span-4">
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
              placeholder="Gate codes, flexible dates, keys location..."
            />
          </div>
        </div>
      </FormSection>

      <FormSection icon={Car} title="Vehicles">
        <VehiclesFieldArray />
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
