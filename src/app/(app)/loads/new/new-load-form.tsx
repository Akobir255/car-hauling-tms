"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/types/database";
import type { LoadFormState } from "../actions";
import { createLoad } from "../actions";
import { VehiclesFieldArray } from "./vehicles-field-array";

const initialState: LoadFormState = { error: null };

export function NewLoadForm({ customers }: { customers: Customer[] }) {
  const [state, formAction, pending] = useActionState(createLoad, initialState);

  return (
    <form action={formAction} className="max-w-3xl space-y-8">
      <div className="space-y-1.5">
        <Label htmlFor="customer_id">Customer *</Label>
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

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Pickup</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pickup_address">Address</Label>
            <Input id="pickup_address" name="pickup_address" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_city">City</Label>
            <Input id="pickup_city" name="pickup_city" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_state">State</Label>
            <Input id="pickup_state" name="pickup_state" maxLength={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_zip">ZIP</Label>
            <Input id="pickup_zip" name="pickup_zip" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_contact_name">Contact name</Label>
            <Input id="pickup_contact_name" name="pickup_contact_name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_contact_phone">Contact phone</Label>
            <Input id="pickup_contact_phone" name="pickup_contact_phone" type="tel" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_ready_date">Ready date</Label>
            <Input id="pickup_ready_date" name="pickup_ready_date" type="date" />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Delivery</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="delivery_address">Address</Label>
            <Input id="delivery_address" name="delivery_address" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_city">City</Label>
            <Input id="delivery_city" name="delivery_city" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_state">State</Label>
            <Input id="delivery_state" name="delivery_state" maxLength={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_zip">ZIP</Label>
            <Input id="delivery_zip" name="delivery_zip" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_contact_name">Contact name</Label>
            <Input id="delivery_contact_name" name="delivery_contact_name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_contact_phone">Contact phone</Label>
            <Input id="delivery_contact_phone" name="delivery_contact_phone" type="tel" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_eta">ETA</Label>
            <Input id="delivery_eta" name="delivery_eta" type="date" />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Transport & rate</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="create_as">Create as</Label>
            <NativeSelect id="create_as" name="create_as" defaultValue="booked">
              <option value="booked">Order (booked)</option>
              <option value="quote">Quote</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transport_type">Transport type</Label>
            <NativeSelect id="transport_type" name="transport_type" defaultValue="open">
              <option value="open">Open</option>
              <option value="enclosed">Enclosed</option>
              <option value="driveaway">Driveaway</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="distance_miles">Distance (mi)</Label>
            <Input id="distance_miles" name="distance_miles" inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer_rate">Customer rate ($)</Label>
            <Input id="customer_rate" name="customer_rate" inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deposit_amount">Deposit ($)</Label>
            <Input id="deposit_amount" name="deposit_amount" inputMode="decimal" />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Vehicles *</h2>
        <VehiclesFieldArray />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Notes from shipper</h2>
        <Textarea
          name="notes"
          rows={3}
          placeholder="Gate codes, flexible dates, keys location..."
        />
      </section>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create load"}
        </Button>
        <Button type="button" variant="outline" render={<Link href="/loads" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
