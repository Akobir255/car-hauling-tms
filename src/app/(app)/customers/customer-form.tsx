"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import type { Customer, Profile } from "@/types/database";
import type { CustomerFormState } from "./actions";

const initialState: CustomerFormState = { error: null };

export function CustomerForm({
  action,
  customer,
  salesReps,
  canAssignOwner,
}: {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  customer?: Customer;
  salesReps: Profile[];
  canAssignOwner: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact_name">Contact name *</Label>
          <Input id="contact_name" name="contact_name" defaultValue={customer?.contact_name} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company_name">Company name</Label>
          <Input id="company_name" name="company_name" defaultValue={customer?.company_name ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={customer?.phone ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={customer?.email ?? ""} />
        </div>
        {/* col-span demoted in step with the base grid — a 2-wide span in a
            1-column grid would open an implicit second column. */}
        <div className="col-span-1 space-y-1.5 md:col-span-2">
          <Label htmlFor="billing_address">Billing address</Label>
          <Input id="billing_address" name="billing_address" defaultValue={customer?.billing_address ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="source">Lead source</Label>
          <Input id="source" name="source" defaultValue={customer?.source ?? ""} />
        </div>
        {canAssignOwner && (
          <div className="space-y-1.5">
            <Label htmlFor="sales_owner_id">Sales owner</Label>
            <NativeSelect
              id="sales_owner_id"
              name="sales_owner_id"
              defaultValue={customer?.sales_owner_id ?? ""}
            >
              <option value="">Unassigned</option>
              {salesReps.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.full_name || rep.email}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={customer?.notes ?? ""} />
      </div>

      {/* The label wraps the box, so the whole 44px row is the hit area and the
          checkbox glyph itself never moves. */}
      <div className="flex gap-6 max-md:flex-wrap">
        <label className="flex items-center gap-2 text-sm max-md:min-h-12">
          <input type="checkbox" name="sms_opt_out" defaultChecked={customer?.sms_opt_out} />
          Opted out of SMS
        </label>
        <label className="flex items-center gap-2 text-sm max-md:min-h-12">
          <input type="checkbox" name="email_opt_out" defaultChecked={customer?.email_opt_out} />
          Opted out of email
        </label>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-3">
        <Button type="submit" className="max-md:min-h-12" disabled={pending}>
          {pending ? "Saving..." : customer ? "Save changes" : "Create customer"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="max-md:min-h-12"
          render={<Link href="/customers" />}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
