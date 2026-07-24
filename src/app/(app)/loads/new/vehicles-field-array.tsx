"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FieldLabel } from "@/components/form-section";
import { VEHICLE_TYPES } from "@/types/database";

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

export function VehiclesFieldArray() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([{ ...EMPTY_ROW }]);

  function update(index: number, field: keyof VehicleRow, value: string) {
    setVehicles((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  }

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
          className="grid grid-cols-2 items-end gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-6 lg:grid-cols-12"
        >
          <div className="space-y-1 lg:col-span-1">
            <FieldLabel>Year</FieldLabel>
            <Input value={v.year} onChange={(e) => update(i, "year", e.target.value)} inputMode="numeric" />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <FieldLabel>Make</FieldLabel>
            <Input value={v.make} onChange={(e) => update(i, "make", e.target.value)} />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <FieldLabel>Model</FieldLabel>
            <Input value={v.model} onChange={(e) => update(i, "model", e.target.value)} />
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
                  {t}
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
              disabled={vehicles.length === 1}
              onClick={() => setVehicles((prev) => prev.filter((_, idx) => idx !== i))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setVehicles((prev) => [...prev, { ...EMPTY_ROW }])}
        >
          Add another vehicle
        </Button>
        <p className="text-sm">
          <span className="text-muted-foreground">Total tariff: </span>
          <span className="font-semibold tabular-nums">
            ${totalTariff.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
        </p>
      </div>
    </div>
  );
}
