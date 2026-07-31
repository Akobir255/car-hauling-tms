"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/form-section";
import { cn } from "@/lib/utils";
// Everything below comes from the PURE schema module. Nothing here may import
// src/lib/ai/extract-intake.ts — that module holds the Anthropic client, and a
// client component reaching into it is how a provider SDK ends up in a browser
// bundle.
import {
  LOW_CONFIDENCE,
  MAX_UPLOAD_LABEL,
  asDateInput,
  fieldText,
  vehiclesPayload,
  type IntakeExtraction,
  type VehicleDraft,
} from "@/lib/ai/intake-schema";
import { EMPTY_INTAKE, confirmIntake, runIntakeExtraction } from "./actions";

// Two screens in one component: READ (paste or attach) and REVIEW (check the
// draft, then commit). The draft is never an order — the second screen's button
// is the only thing that creates one, and it posts through createLoad.
//
// The rule that shapes everything below: what the dispatcher SEES is what
// createLoad GETS. Every editable field posts twice — once as `f:<path>` so the
// confirm action can diff it against the model, and once under the name
// createLoad reads — and both carry the edited value, never the model's
// original. Getting that wrong means logging a corrected VIN and shipping the
// wrong one.

type Leaf = { value: unknown; confidence: number };

const leaf = (x: unknown): Leaf =>
  x && typeof x === "object" && "confidence" in (x as object)
    ? (x as Leaf)
    : { value: null, confidence: 1 };

type Choice = { value: string; label: string };

const CONDITION_CHOICES: Choice[] = [
  // The document not saying is not the same as the car running, but the
  // vehicle_condition enum has only the two values — so the label says out loud
  // what the blank will become rather than letting it look like a finding.
  { value: "", label: "Not stated — recorded as operable" },
  { value: "operable", label: "Operable" },
  { value: "inoperable", label: "Inoperable — needs a winch" },
];

const TRANSPORT_CHOICES: Choice[] = [
  { value: "", label: "Not stated — booked open" },
  { value: "open", label: "Open" },
  { value: "enclosed", label: "Enclosed" },
  // The model is only allowed to answer open/enclosed; a driveaway is a
  // dispatcher's call, so it exists here and nowhere in the schema.
  { value: "driveaway", label: "Driveaway" },
];

/**
 * One reviewable field. `path` is the dotted path so the confirm action can diff
 * it against what the model said; `formName` is what createLoad expects; both
 * get the CURRENT value, not the extracted one.
 */
function ReviewField({
  label,
  path,
  formName,
  field,
  type = "text",
  choices,
  onValueChange,
}: {
  label: string;
  path: string;
  formName?: string;
  field: Leaf;
  type?: string;
  choices?: Choice[];
  onValueChange?: (next: string) => void;
}) {
  const low = field.confidence < LOW_CONFIDENCE;
  const raw = fieldText(field.value);
  const initial = type === "date" ? asDateInput(raw) : raw;
  const [value, setValue] = useState(initial);
  const droppedDate = type === "date" && raw !== "" && initial === "";

  const change = (next: string) => {
    setValue(next);
    onValueChange?.(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel htmlFor={`f:${path}`}>{label}</FieldLabel>
        {low && (
          <span
            title={`The model was ${Math.round(field.confidence * 100)}% sure — check this one.`}
            className="rounded-full bg-ord-deposit-bg px-2 text-[12px] uppercase tracking-wide text-ord-deposit"
          >
            check
          </span>
        )}
      </div>
      {choices ? (
        <NativeSelect
          id={`f:${path}`}
          name={`f:${path}`}
          value={value}
          onChange={(e) => change(e.target.value)}
          className={cn(low && "border-ord-deposit")}
        >
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={`f:${path}`}
          name={`f:${path}`}
          type={type}
          defaultValue={initial}
          onChange={(e) => change(e.target.value)}
          className={cn(low && "border-ord-deposit")}
        />
      )}
      {droppedDate && (
        <p className="text-xs text-ord-deposit">
          The document said &ldquo;{raw}&rdquo; — pick the actual date.
        </p>
      )}
      {/* The same value under the name createLoad reads. Kept separate from the
          f: field so the correction diff stays keyed on the model's own paths. */}
      {formName && <input type="hidden" name={formName} value={value} readOnly />}
    </div>
  );
}

export function IntakeForm() {
  const [readState, readAction, reading] = useActionState(runIntakeExtraction, EMPTY_INTAKE);
  const extraction = readState.extraction;

  if (!extraction) {
    return (
      <form action={readAction} className="max-w-2xl space-y-5">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="text">Paste the email or load sheet</FieldLabel>
          <Textarea id="text" name="text" rows={12} placeholder="Paste the order text here…" />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="file">…or attach a PDF or photo</FieldLabel>
          <Input id="file" name="file" type="file" accept="application/pdf,image/*" />
          <p className="text-xs text-muted-foreground">
            Up to {MAX_UPLOAD_LABEL} — a phone photo is normally well under it. The document is
            stored so corrections can be traced back to it.
          </p>
        </div>

        {readState.error && <p className="text-sm text-destructive">{readState.error}</p>}

        <Button type="submit" disabled={reading}>
          {reading ? "Reading…" : "Read it"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Nothing is created yet — you get a draft to check first.
        </p>
      </form>
    );
  }

  return <ReviewScreen extractionId={readState.extractionId} extraction={extraction} lowCount={readState.lowConfidence.length} />;
}

const draftFrom = (v: Record<string, Leaf>): VehicleDraft => ({
  vin: fieldText(leaf(v.vin).value),
  year: fieldText(leaf(v.year).value),
  make: fieldText(leaf(v.make).value),
  model: fieldText(leaf(v.model).value),
  condition: fieldText(leaf(v.condition).value),
});

const BLANK_VEHICLE: Record<string, Leaf> = {};

function ReviewScreen({
  extractionId,
  extraction,
  lowCount,
}: {
  extractionId: string | null;
  extraction: IntakeExtraction;
  lowCount: number;
}) {
  const bound = confirmIntake.bind(null, extractionId);
  const [state, action, pending] = useActionState(bound, { error: null as string | null });
  const e = extraction as unknown as Record<string, Record<string, Leaf>>;
  const found = (extraction.vehicles ?? []) as unknown as Record<string, Leaf>[];
  // createLoad refuses an order with no vehicle. Rendering nothing when the
  // model found none left the dispatcher at a button that could only ever fail,
  // under a caption promising they could add the car later — they cannot. One
  // empty row instead, so the screen that says "check this" is also the screen
  // that can fix it.
  const vehicles = found.length > 0 ? found : [BLANK_VEHICLE];
  const [drafts, setDrafts] = useState<VehicleDraft[]>(() => vehicles.map(draftFrom));

  const setDraft = (i: number, key: keyof VehicleDraft, next: string) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, [key]: next } : d)));

  // In an effect, not during render: a render-time toast fires again on every
  // re-render (and every keystroke re-renders this form). Same pattern as
  // status-form.tsx. toast is not setState, so react-hooks/set-state-in-effect
  // does not apply here.
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="max-w-3xl space-y-6">
      <div className="rounded-md border p-4">
        <p className="text-sm">
          {lowCount === 0
            ? "Everything read cleanly. Check it anyway before confirming."
            : `${lowCount} field${lowCount === 1 ? "" : "s"} marked CHECK — the model wasn't sure.`}
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-ord-head">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ReviewField label="Name" path="contact.name" formName="customer_name" field={leaf(e.contact?.name)} />
          <ReviewField label="Company" path="contact.company" field={leaf(e.contact?.company)} />
          <ReviewField label="Phone" path="contact.phone" formName="customer_phone" field={leaf(e.contact?.phone)} />
          <ReviewField label="Email" path="contact.email" formName="customer_email" field={leaf(e.contact?.email)} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-ord-head">Route</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ReviewField label="Pickup city" path="origin.city" formName="pickup_city" field={leaf(e.origin?.city)} />
          <ReviewField label="Pickup state" path="origin.state" formName="pickup_state" field={leaf(e.origin?.state)} />
          <ReviewField label="Pickup ZIP" path="origin.zip" formName="pickup_zip" field={leaf(e.origin?.zip)} />
          <ReviewField label="Pickup address" path="origin.address" formName="pickup_address" field={leaf(e.origin?.address)} />
          <ReviewField label="Delivery city" path="destination.city" formName="delivery_city" field={leaf(e.destination?.city)} />
          <ReviewField label="Delivery state" path="destination.state" formName="delivery_state" field={leaf(e.destination?.state)} />
          <ReviewField label="Delivery ZIP" path="destination.zip" formName="delivery_zip" field={leaf(e.destination?.zip)} />
          <ReviewField label="Delivery address" path="destination.address" formName="delivery_address" field={leaf(e.destination?.address)} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-ord-head">Dates &amp; price</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ReviewField label="First available" path="requested_pickup_date" formName="pickup_ready_date" field={leaf(extraction.requested_pickup_date as unknown as Leaf)} type="date" />
          <ReviewField label="Delivery by" path="requested_delivery_date" formName="delivery_eta" field={leaf(extraction.requested_delivery_date as unknown as Leaf)} type="date" />
          <ReviewField label="Quoted price" path="quoted_price" formName="customer_rate" field={leaf(extraction.quoted_price as unknown as Leaf)} />
          <TransportTypeField field={leaf(extraction.transport_type as unknown as Leaf)} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-ord-head">Vehicles</h2>
        {found.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None found in the document — an order needs at least one, so type it in below.
          </p>
        )}
        {vehicles.map((v, i) => (
          <div key={i} className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
            <ReviewField label="VIN" path={`vehicles.${i}.vin`} field={leaf(v.vin)} onValueChange={(x) => setDraft(i, "vin", x)} />
            <ReviewField label="Year" path={`vehicles.${i}.year`} field={leaf(v.year)} onValueChange={(x) => setDraft(i, "year", x)} />
            <ReviewField label="Make" path={`vehicles.${i}.make`} field={leaf(v.make)} onValueChange={(x) => setDraft(i, "make", x)} />
            <ReviewField label="Model" path={`vehicles.${i}.model`} field={leaf(v.model)} onValueChange={(x) => setDraft(i, "model", x)} />
            <ReviewField
              label="Condition"
              path={`vehicles.${i}.condition`}
              field={leaf(v.condition)}
              choices={CONDITION_CHOICES}
              onValueChange={(x) => setDraft(i, "condition", x)}
            />
          </div>
        ))}
        {/* createLoad reads vehicles as one JSON blob. Built from the DRAFTS
            above, not from the extraction: a VIN corrected on this screen has to
            be the VIN that reaches load_vehicles, or the correction is recorded
            and the wrong car is shipped. */}
        <input
          type="hidden"
          name="vehicles_json"
          value={JSON.stringify(vehiclesPayload(drafts))}
          readOnly
        />
      </section>

      <ReviewField label="Notes" path="notes" formName="notes" field={leaf(extraction.notes as unknown as Leaf)} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Confirm and create order"}
        </Button>
        <span className="text-xs text-muted-foreground">
          This is the only step that creates anything.
        </span>
      </div>
    </form>
  );
}

/**
 * Open vs enclosed changes the price and the equipment, so it gets a control
 * like every other extracted field rather than a hidden input seeded from the
 * model. The `f:` half is the model's own value — blank stays blank — so
 * accepting the "not stated, book it open" default does not get written down as
 * a human correction that never happened. createLoad's enum still needs a
 * value, which is what the second hidden input is for.
 */
function TransportTypeField({ field }: { field: Leaf }) {
  const [value, setValue] = useState(fieldText(field.value));
  return (
    <div className="space-y-1.5">
      <ReviewField
        label="Transport type"
        path="transport_type"
        field={field}
        choices={TRANSPORT_CHOICES}
        onValueChange={setValue}
      />
      <input type="hidden" name="transport_type" value={value || "open"} readOnly />
    </div>
  );
}
