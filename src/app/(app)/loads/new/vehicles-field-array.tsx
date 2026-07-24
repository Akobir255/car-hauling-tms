"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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

  return (
    <div className="space-y-3">
      <input type="hidden" name="vehicles_json" value={JSON.stringify(vehicles)} readOnly />
      {vehicles.map((v, i) => (
        <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border p-3">
          <div className="col-span-1 space-y-1">
            <label className="text-xs text-muted-foreground">Year</label>
            <Input value={v.year} onChange={(e) => update(i, "year", e.target.value)} inputMode="numeric" />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground">Make</label>
            <Input value={v.make} onChange={(e) => update(i, "make", e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground">Model</label>
            <Input value={v.model} onChange={(e) => update(i, "model", e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground">VIN</label>
            <Input value={v.vin} onChange={(e) => update(i, "vin", e.target.value)} />
          </div>
          <div className="col-span-1 space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <NativeSelect value={v.vehicle_type} onChange={(e) => update(i, "vehicle_type", e.target.value)}>
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground">Condition</label>
            <NativeSelect value={v.condition} onChange={(e) => update(i, "condition", e.target.value)}>
              <option value="running">Running</option>
              <option value="non_running">Non-running</option>
            </NativeSelect>
          </div>
          <div className="col-span-1 space-y-1">
            <label className="text-xs text-muted-foreground">Tariff ($)</label>
            <Input value={v.tariff} onChange={(e) => update(i, "tariff", e.target.value)} inputMode="decimal" />
          </div>
          <div className="col-span-1">
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
      <Button type="button" variant="outline" size="sm" onClick={() => setVehicles((prev) => [...prev, { ...EMPTY_ROW }])}>
        Add another vehicle
      </Button>
    </div>
  );
}
