"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Carrier } from "@/types/database";
import type { CarrierFormState } from "./actions";

const initialState: CarrierFormState = { error: null };

const EQUIPMENT_OPTIONS = ["open", "enclosed"];

export function CarrierForm({
  action,
  carrier,
}: {
  action: (state: CarrierFormState, formData: FormData) => Promise<CarrierFormState>;
  carrier?: Carrier;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="company_name">Company name *</Label>
          <Input id="company_name" name="company_name" defaultValue={carrier?.company_name} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mc_number">MC #</Label>
          <Input id="mc_number" name="mc_number" defaultValue={carrier?.mc_number ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dot_number">DOT #</Label>
          <Input id="dot_number" name="dot_number" defaultValue={carrier?.dot_number ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact_name">Contact name</Label>
          <Input id="contact_name" name="contact_name" defaultValue={carrier?.contact_name ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={carrier?.phone ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={carrier?.email ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="safety_rating">Safety rating</Label>
          <Input id="safety_rating" name="safety_rating" defaultValue={carrier?.safety_rating ?? ""} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" defaultValue={carrier?.address ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insurance_carrier">Insurance carrier</Label>
          <Input id="insurance_carrier" name="insurance_carrier" defaultValue={carrier?.insurance_carrier ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insurance_policy_number">Policy #</Label>
          <Input
            id="insurance_policy_number"
            name="insurance_policy_number"
            defaultValue={carrier?.insurance_policy_number ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="coi_expiry_date">COI expiry date</Label>
          <Input
            id="coi_expiry_date"
            name="coi_expiry_date"
            type="date"
            defaultValue={carrier?.coi_expiry_date ?? ""}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Equipment types</Label>
        <div className="flex gap-4">
          {EQUIPMENT_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="equipment_types"
                value={opt}
                defaultChecked={carrier?.equipment_types?.includes(opt)}
              />
              {opt === "open" ? "Open" : "Enclosed"}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="preferred" defaultChecked={carrier?.preferred} />
          Preferred carrier
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="blacklisted" defaultChecked={carrier?.blacklisted} />
          Blacklisted
        </label>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={carrier?.notes ?? ""} />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : carrier ? "Save changes" : "Create carrier"}
        </Button>
        <Button type="button" variant="outline" render={<Link href="/carriers" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
