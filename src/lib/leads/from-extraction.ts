import type { IntakeExtraction } from "@/lib/ai/intake-schema";
import {
  normalizeDate,
  normalizePhone,
  normalizeState,
  normalizeYear,
  normalizeZip,
  type NormalizedLead,
} from "./normalize";

// Map the AI intake extraction onto a NormalizedLead, so a lead that arrives
// as an EMAIL and gets read by the model lands exactly like one that arrives
// as JSON. The email route and the JSON route converge on the same shape and
// the same createLeadFromNormalized() from here on.
//
// The extraction wraps every field as { value, confidence }; we take .value
// and run it through the same normalizers the JSON path uses, so a phone the
// model pulled and a phone a provider posted are cleaned the same way.
//
// Confidence is deliberately NOT gated here. A lead is not a signed order — a
// half-confident lead in a rep's queue is worth far more than a dropped one,
// and the rep confirms the details on the first call anyway. The raw email is
// always kept in webhook_events regardless.

const val = <T>(f: { value: T | null } | null | undefined): T | null => f?.value ?? null;

export function extractionToNormalizedLead(x: IntakeExtraction): NormalizedLead {
  const firstVehicle = x.vehicles?.[0];
  const condition = val(firstVehicle?.condition); // "operable" | "inoperable" | null

  const transport = val(x.transport_type); // "open" | "enclosed" | null

  return {
    contactName: val(x.contact.name),
    phone: normalizePhone(val(x.contact.phone)),
    email: (val(x.contact.email) || "").toLowerCase().trim() || null,

    originCity: val(x.origin.city),
    originState: normalizeState(val(x.origin.state)),
    originZip: normalizeZip(val(x.origin.zip)),

    destCity: val(x.destination.city),
    destState: normalizeState(val(x.destination.state)),
    destZip: normalizeZip(val(x.destination.zip)),

    vehicleYear: normalizeYear(val(firstVehicle?.year)),
    vehicleMake: val(firstVehicle?.make),
    vehicleModel: val(firstVehicle?.model),
    // The model already resolved the wording to a two-value enum; treat
    // anything that is not explicitly "inoperable" as operable, matching the
    // JSON path's default-to-running.
    operable: condition !== "inoperable",
    transportType: transport === "enclosed" ? "enclosed" : "open",

    readyDate: normalizeDate(val(x.requested_pickup_date)),

    // The model has no provider-assigned id to offer; the email route supplies
    // its own dedup key (the Message-Id) as source_ref instead.
    sourceRef: null,
    notes: val(x.notes),
  };
}
