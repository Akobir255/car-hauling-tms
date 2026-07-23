"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Carrier, Load } from "@/types/database";
import type { LoadFormState } from "../actions";

const initialState: LoadFormState = { error: null };

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

  return (
    <form action={formAction} className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Pickup</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pickup_address">Address</Label>
            <Input id="pickup_address" name="pickup_address" defaultValue={load.pickup_address ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_city">City</Label>
            <Input id="pickup_city" name="pickup_city" defaultValue={load.pickup_city ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_state">State</Label>
            <Input id="pickup_state" name="pickup_state" maxLength={2} defaultValue={load.pickup_state ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_zip">ZIP</Label>
            <Input id="pickup_zip" name="pickup_zip" defaultValue={load.pickup_zip ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_contact_name">Contact name</Label>
            <Input id="pickup_contact_name" name="pickup_contact_name" defaultValue={load.pickup_contact_name ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_contact_phone">Contact phone</Label>
            <Input
              id="pickup_contact_phone"
              name="pickup_contact_phone"
              type="tel"
              defaultValue={load.pickup_contact_phone ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pickup_ready_date">Ready date</Label>
            <Input id="pickup_ready_date" name="pickup_ready_date" type="date" defaultValue={load.pickup_ready_date ?? ""} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Delivery</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="delivery_address">Address</Label>
            <Input id="delivery_address" name="delivery_address" defaultValue={load.delivery_address ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_city">City</Label>
            <Input id="delivery_city" name="delivery_city" defaultValue={load.delivery_city ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_state">State</Label>
            <Input id="delivery_state" name="delivery_state" maxLength={2} defaultValue={load.delivery_state ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_zip">ZIP</Label>
            <Input id="delivery_zip" name="delivery_zip" defaultValue={load.delivery_zip ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_contact_name">Contact name</Label>
            <Input
              id="delivery_contact_name"
              name="delivery_contact_name"
              defaultValue={load.delivery_contact_name ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_contact_phone">Contact phone</Label>
            <Input
              id="delivery_contact_phone"
              name="delivery_contact_phone"
              type="tel"
              defaultValue={load.delivery_contact_phone ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery_eta">ETA</Label>
            <Input id="delivery_eta" name="delivery_eta" type="date" defaultValue={load.delivery_eta ?? ""} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Transport & rate</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="transport_type">Transport type</Label>
            <NativeSelect id="transport_type" name="transport_type" defaultValue={load.transport_type}>
              <option value="open">Open</option>
              <option value="enclosed">Enclosed</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="distance_miles">Distance (mi)</Label>
            <Input id="distance_miles" name="distance_miles" inputMode="numeric" defaultValue={load.distance_miles ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer_rate">Customer rate ($)</Label>
            <Input id="customer_rate" name="customer_rate" inputMode="decimal" defaultValue={load.customer_rate ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deposit_amount">Deposit ($)</Label>
            <Input id="deposit_amount" name="deposit_amount" inputMode="decimal" defaultValue={load.deposit_amount ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="balance_due">Balance due ($)</Label>
            <Input id="balance_due" name="balance_due" inputMode="decimal" defaultValue={load.balance_due ?? ""} />
          </div>
        </div>
      </section>

      {canManageCarrier && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Carrier assignment</h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="carrier_id">Carrier</Label>
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
              <Label htmlFor="carrier_pay">Carrier pay ($)</Label>
              <Input id="carrier_pay" name="carrier_pay" inputMode="decimal" defaultValue={load.carrier_pay ?? ""} />
            </div>
          </div>
        </section>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
