import { z } from "zod";

// The strict shape the model must return for an intake document (migration
// 0051). Every field carries its own confidence, because "the model got the VIN
// right and guessed at the delivery city" is the normal case, and a single
// document-level score would hide it.
//
// Bump PROMPT_VERSION whenever the prompt or this schema changes. It is stored
// on every extraction so a future eval can ask "how did v1 do on the inputs v2
// now sees?" — which is impossible if the version is implicit.
export const PROMPT_VERSION = "intake-v1";

// Below this, the review screen highlights the field and the dispatcher is
// expected to look at it. Tuned deliberately high to start: a false highlight
// costs two seconds, a missed wrong VIN costs a misdelivered car.
export const LOW_CONFIDENCE = 0.85;

/**
 * Input limits. They live HERE, in the pure module, and not next to the code
 * that calls the model — the review screen has to state the upload limit, and
 * importing it from extract-intake.ts would pull the Anthropic SDK and
 * `node:crypto` across the client boundary for the sake of one string. The
 * brief's rule is no provider SDK or key in a client bundle, ever, and the
 * cheapest way to keep it is to give the browser nothing to reach for.
 *
 * The byte figure is the smallest of three ceilings and the other two are not
 * ours: a Server Action body is capped by Next (`serverActions.bodySizeLimit`,
 * 1 MB by default — raised to 4 MB in next.config), and Vercel rejects any
 * request body over 4.5 MB before our code runs. This sits under both with room
 * for the multipart envelope.
 */
export const MAX_INPUT_BYTES = 3.5 * 1024 * 1024;
/** What the upload control tells the dispatcher. Kept beside the number it describes. */
export const MAX_UPLOAD_LABEL = "3.5 MB";
export const MAX_TEXT_CHARS = 200_000;

/**
 * A value the model extracted, plus how sure it is.
 *
 * `value` is nullable on every field on purpose — a load sheet that simply does
 * not state a delivery date must come back as null, not as a plausible-looking
 * invention. The prompt says so too; this makes it representable.
 */
const field = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    value: inner.nullable(),
    // The bounds are validated CLIENT-side by messages.parse() — the SDK strips
    // numeric min/max from the wire schema — so they change nothing the model
    // sees and need no PROMPT_VERSION bump. A confidence of 7 or −1 now fails
    // the parse instead of sailing past every threshold comparison.
    confidence: z.number().min(0).max(1),
  });

const str = () => field(z.string());

export const vehicleSchema = z.object({
  vin: str(),
  year: field(z.number()),
  make: str(),
  model: str(),
  // The operable/inoperable split is the one that changes the price and the
  // equipment, so it is an enum rather than free text.
  condition: field(z.enum(["operable", "inoperable"])),
});

export const addressSchema = z.object({
  city: str(),
  state: str(),
  zip: str(),
  // Kept separate from city/state/zip: a load sheet often gives a full street
  // address for one end and only a metro for the other.
  address: str(),
});

export const intakeSchema = z.object({
  contact: z.object({
    name: str(),
    company: str(),
    phone: str(),
    email: str(),
  }),
  origin: addressSchema,
  destination: addressSchema,
  vehicles: z.array(vehicleSchema),
  requested_pickup_date: str(),
  requested_delivery_date: str(),
  quoted_price: field(z.number()),
  transport_type: field(z.enum(["open", "enclosed"])),
  notes: str(),
});

export type IntakeExtraction = z.infer<typeof intakeSchema>;
export type ExtractedField = { value: unknown; confidence: number };

/**
 * Every leaf field as a dotted path, newest-first order irrelevant. Used by the
 * review screen to highlight, and by the correction capture to name what
 * changed — both need the same walk, so it lives in one place.
 */
export function flattenFields(
  extraction: IntakeExtraction
): { path: string; value: unknown; confidence: number }[] {
  const out: { path: string; value: unknown; confidence: number }[] = [];

  const visit = (node: unknown, prefix: string): void => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${prefix}${i}.`));
      return;
    }
    const obj = node as Record<string, unknown>;
    // A leaf is exactly the { value, confidence } pair produced by field().
    if ("confidence" in obj && "value" in obj) {
      out.push({
        path: prefix.replace(/\.$/, ""),
        value: obj.value,
        confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
      });
      return;
    }
    for (const [key, child] of Object.entries(obj)) visit(child, `${prefix}${key}.`);
  };

  visit(extraction, "");
  return out;
}

/** Fields the dispatcher should look at before confirming. */
export function lowConfidenceFields(extraction: IntakeExtraction): string[] {
  return flattenFields(extraction)
    .filter((f) => f.confidence < LOW_CONFIDENCE)
    .map((f) => f.path);
}

/** Render a field value for a form input — null becomes empty, never "null". */
export function fieldText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What an `<input type="date">` may be seeded with.
 *
 * A date input shows nothing for a value it cannot parse, so a model answer of
 * "next Tuesday" or "8/4" would sit invisible in the field and post straight
 * into a `date` column — the dispatcher's first sign of trouble being "Could not
 * create load". Anything not already YYYY-MM-DD comes back empty, and the review
 * screen says what was dropped.
 */
export function asDateInput(raw: string): string {
  return ISO_DATE.test(raw) ? raw : "";
}

/** A vehicle row as the review screen holds it while the dispatcher edits. */
export type VehicleDraft = {
  vin: string;
  year: string;
  make: string;
  model: string;
  /** "" | "operable" | "inoperable" — the schema's values, plus not-stated. */
  condition: string;
};

/**
 * The drafts as createLoad's `vehicles_json` blob.
 *
 * Takes the DRAFTS — what is on screen now — never the extraction. A VIN the
 * dispatcher corrected has to be the VIN that reaches load_vehicles; building
 * this from the model's output instead recorded the correction and shipped the
 * wrong car, which is the bug this function exists to make impossible to
 * reintroduce quietly.
 *
 * `condition` collapses to the vehicle_condition enum, which has no third value:
 * only an explicit "inoperable" is non_running, and the review screen's label
 * says so rather than letting a blank look like a finding.
 */
export function vehiclesPayload(drafts: VehicleDraft[]) {
  return drafts.map((d) => ({
    vin: d.vin,
    year: d.year,
    make: d.make,
    model: d.model,
    condition: d.condition === "inoperable" ? "non_running" : "running",
  }));
}
