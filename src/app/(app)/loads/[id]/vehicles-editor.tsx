"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FieldLabel } from "@/components/form-section";
import { formatCurrency, titleCase } from "@/lib/format";
import { VEHICLE_TYPES, type LoadVehicle } from "@/types/database";
import type { LoadFormState } from "../actions";

const initialState: LoadFormState = { error: null };

function RemoveVehicleButton({
  onRemove,
  disabled,
}: {
  onRemove: () => Promise<void>;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="max-md:min-h-12"
      disabled={pending || disabled}
      onClick={() => {
        if (!confirm("Remove this vehicle from the load?")) return;
        startTransition(() => onRemove());
      }}
    >
      {pending ? "Removing..." : "Remove"}
    </Button>
  );
}

export function VehiclesEditor({
  vehicles,
  addAction,
  removeAction,
  tariffsAction,
}: {
  vehicles: LoadVehicle[];
  addAction: (state: LoadFormState, formData: FormData) => Promise<LoadFormState>;
  removeAction: (vehicleId: string) => Promise<void>;
  tariffsAction: (state: LoadFormState, formData: FormData) => Promise<LoadFormState>;
}) {
  const [state, formAction, pending] = useActionState(addAction, initialState);
  const [tariffState, tariffFormAction, tariffPending] = useActionState(tariffsAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state !== initialState) {
      toast.success("Vehicle added.");
      formRef.current?.reset();
    }
  }, [state]);

  useEffect(() => {
    if (tariffState.error) toast.error(tariffState.error);
    else if (tariffState !== initialState) toast.success("Tariffs saved.");
  }, [tariffState]);

  const totalTariff = vehicles.reduce((sum, v) => sum + (v.tariff ?? 0), 0);

  return (
    <div className="space-y-3">
      <form action={tariffFormAction} className="space-y-3">
        {/* msgplane's per-vehicle detail set: plate/state/lot/color for
            auction pickups, plus per-unit tariff and deposit. */}
        <div className="overflow-x-auto">
          <Table className="min-w-[64rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Make/Model</TableHead>
                <TableHead>VIN</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Plate</TableHead>
                <TableHead>State</TableHead>
                <TableHead>LOT #</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Tariff ($)</TableHead>
                <TableHead>Deposit ($)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((v) => {
                const unit = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
                return (
                  <TableRow key={v.id}>
                    <TableCell>{v.year ?? "—"}</TableCell>
                    <TableCell>
                      {v.make} {v.model}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{v.vin || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{titleCase(v.vehicle_type)}</TableCell>
                    <TableCell className="text-muted-foreground">{titleCase(v.condition)}</TableCell>
                    <TableCell>
                      <Input name={`plate_${v.id}`} defaultValue={v.plate ?? ""} className="w-20" aria-label={`Plate for ${unit}`} />
                    </TableCell>
                    <TableCell>
                      <Input name={`plate_state_${v.id}`} maxLength={2} defaultValue={v.plate_state ?? ""} className="w-14" aria-label={`Plate state for ${unit}`} />
                    </TableCell>
                    <TableCell>
                      <Input name={`lot_number_${v.id}`} defaultValue={v.lot_number ?? ""} className="w-20" aria-label={`Lot number for ${unit}`} />
                    </TableCell>
                    <TableCell>
                      <Input name={`color_${v.id}`} defaultValue={v.color ?? ""} className="w-20" aria-label={`Color for ${unit}`} />
                    </TableCell>
                    <TableCell>
                      <Input name={`tariff_${v.id}`} inputMode="decimal" defaultValue={v.tariff ?? ""} className="w-20" aria-label={`Tariff for ${unit}`} />
                    </TableCell>
                    <TableCell>
                      <Input name={`deposit_${v.id}`} inputMode="decimal" defaultValue={v.deposit ?? ""} className="w-20" aria-label={`Deposit for ${unit}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <RemoveVehicleButton
                        onRemove={removeAction.bind(null, v.id)}
                        disabled={vehicles.length === 1}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {vehicles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground">
                    No vehicles on this load.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {vehicles.length > 0 && (
          <div className="flex items-center gap-4">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="max-md:min-h-12"
              disabled={tariffPending}
            >
              {tariffPending ? "Saving..." : "Save vehicles"}
            </Button>
            <p className="text-sm">
              <span className="text-muted-foreground">Total tariff: </span>
              <span className="tabular-nums">{formatCurrency(totalTariff)}</span>
            </p>
          </div>
        )}
      </form>

      {/* Quick-add row: same columns as the table, no ceremony. */}
      <form
        ref={formRef}
        action={formAction}
        className="flex flex-wrap items-end gap-2 rounded-md bg-muted p-3 max-md:gap-3"
      >
        <div className="space-y-1">
          <FieldLabel>Year</FieldLabel>
          <Input name="year" inputMode="numeric" className="w-20" />
        </div>
        <div className="space-y-1">
          <FieldLabel>Make</FieldLabel>
          <Input name="make" className="w-32" />
        </div>
        <div className="space-y-1">
          <FieldLabel>Model</FieldLabel>
          <Input name="model" className="w-32" />
        </div>
        <div className="space-y-1">
          <FieldLabel>VIN</FieldLabel>
          <Input name="vin" className="w-44" />
        </div>
        <div className="space-y-1">
          <FieldLabel>Type</FieldLabel>
          <NativeSelect name="vehicle_type" defaultValue="sedan" className="w-32">
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <FieldLabel>Condition</FieldLabel>
          <NativeSelect name="condition" defaultValue="running" className="w-36">
            <option value="running">Running</option>
            <option value="non_running">Non-running</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <FieldLabel>Plate</FieldLabel>
          <Input name="plate" className="w-24" />
        </div>
        <div className="space-y-1">
          <FieldLabel>State</FieldLabel>
          <Input name="plate_state" maxLength={2} className="w-14" />
        </div>
        <div className="space-y-1">
          <FieldLabel>LOT #</FieldLabel>
          <Input name="lot_number" className="w-24" />
        </div>
        <div className="space-y-1">
          <FieldLabel>Color</FieldLabel>
          <Input name="color" className="w-24" />
        </div>
        <div className="space-y-1">
          <FieldLabel>Tariff ($)</FieldLabel>
          <Input name="tariff" inputMode="decimal" className="w-24" />
        </div>
        <Button type="submit" size="sm" className="max-md:min-h-12" disabled={pending}>
          {pending ? "Adding..." : "Add vehicle"}
        </Button>
      </form>
    </div>
  );
}
