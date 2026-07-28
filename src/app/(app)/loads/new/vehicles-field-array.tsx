"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Autocomplete } from "@/components/ui/autocomplete";
import { FieldLabel } from "@/components/form-section";
import { searchMakes, searchModels } from "@/lib/vehicles/nhtsa";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@/types/database";

type VehicleRow = {
  year: string;
  make: string;
  model: string;
  vin: string;
  vehicle_type: string;
  condition: string;
  tariff: string;
};

const EMPTY_ROW: VehicleRow = {
  year: "",
  make: "",
  model: "",
  vin: "",
  vehicle_type: "sedan",
  condition: "running",
  tariff: "",
};

export function VehiclesFieldArray({
  onFirstVehicleChange,
}: {
  // Reports the first vehicle's type/condition up to the form for the quote suggestion.
  onFirstVehicleChange?: (v: { vehicle_type: string; condition: string }) => void;
}) {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([{ ...EMPTY_ROW }]);

  function update(index: number, field: keyof VehicleRow, value: string) {
    setVehicles((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  }

  const first = vehicles[0];
  useEffect(() => {
    onFirstVehicleChange?.({ vehicle_type: first.vehicle_type, condition: first.condition });
  }, [first.vehicle_type, first.condition, onFirstVehicleChange]);

  const totalTariff = vehicles.reduce((sum, v) => {
    const n = Number(v.tariff);
    return sum + (v.tariff.trim() !== "" && !Number.isNaN(n) ? n : 0);
  }, 0);

  return (
    <div className="space-y-3">
      <input type="hidden" name="vehicles_json" value={JSON.stringify(vehicles)} readOnly />
      {vehicles.map((v, i) => (
        <div
          key={i}
          // One field per row on a phone: at two tracks the cell is ~126px, which
          // is narrower than a VIN and narrower than the Make/Model suggestion
          // popover that sizes to it. Every col-span here is lg:-prefixed, so
          // the base track count moves on its own.
          className="grid grid-cols-1 items-end gap-2 rounded-md bg-muted p-3 sm:grid-cols-6 lg:grid-cols-12"
        >
          <div className="space-y-1 lg:col-span-1">
            <FieldLabel>Year</FieldLabel>
            <Input value={v.year} onChange={(e) => update(i, "year", e.target.value)} inputMode="numeric" />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <FieldLabel>Make</FieldLabel>
            <Autocomplete
              value={v.make}
              onValueChange={(val) => update(i, "make", val)}
              fetchOptions={(q) => searchMakes(q)}
            />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <FieldLabel>Model</FieldLabel>
            <Autocomplete
              value={v.model}
              onValueChange={(val) => update(i, "model", val)}
              fetchOptions={(q) => searchModels(v.make, q)}
            />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <FieldLabel>VIN</FieldLabel>
            <Input value={v.vin} onChange={(e) => update(i, "vin", e.target.value)} />
          </div>
          <div className="space-y-1 lg:col-span-1">
            <FieldLabel>Type</FieldLabel>
            <NativeSelect value={v.vehicle_type} onChange={(e) => update(i, "vehicle_type", e.target.value)}>
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <FieldLabel>Condition</FieldLabel>
            <NativeSelect value={v.condition} onChange={(e) => update(i, "condition", e.target.value)}>
              <option value="running">Running</option>
              <option value="non_running">Non-running</option>
            </NativeSelect>
          </div>
          <div className="space-y-1 lg:col-span-1">
            <FieldLabel>Tariff ($)</FieldLabel>
            <Input value={v.tariff} onChange={(e) => update(i, "tariff", e.target.value)} inputMode="decimal" />
          </div>
          <div className="lg:col-span-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:min-h-12 max-md:w-full"
              disabled={vehicles.length === 1}
              onClick={() => setVehicles((prev) => prev.filter((_, idx) => idx !== i))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-4 max-md:flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:min-h-12"
          onClick={() => setVehicles((prev) => [...prev, { ...EMPTY_ROW }])}
        >
          Add another vehicle
        </Button>
        <p className="text-sm">
          <span className="text-muted-foreground">Total tariff: </span>
          <span className="tabular-nums">
            ${totalTariff.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
        </p>
      </div>
    </div>
  );
}
