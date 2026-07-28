// Vehicle photo lookup helpers — pure functions, unit-tested. The API route
// resolves "year make model" to a Wikipedia page image the same way msgplane
// resolves photos server-side: the browser only ever sees OUR origin, so the
// nonce CSP needs no new hosts.

// Accept letters/digits and the punctuation that appears in real make/model
// names (F-150, Model 3, S&S, Grand Wagoneer). Everything else is dropped so
// the value is safe to embed in a Wikipedia title query.
const NAME_SAFE = /[^a-zA-Z0-9 .&'\-]/g;

export type VehicleImageParams = { make: string; model: string };

export function normalizeVehicleImageParams(
  make: string | null | undefined,
  model: string | null | undefined
): VehicleImageParams | null {
  const clean = (v: string | null | undefined) =>
    (v || "").replace(NAME_SAFE, "").replace(/\s+/g, " ").trim().slice(0, 40);
  const m = clean(make);
  const md = clean(model);
  if (!m || !md) return null;
  return { make: m, model: md };
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Wikipedia pages are per-generation ("Toyota RAV4"), not per-year, so the
// year is not part of the title. redirects=1 absorbs first-letter casing but
// NOT mid-word casing ("Nissan Nv" does not reach "Nissan NV"), so the
// all-caps model is tried too — many models are initialisms (NV, BRZ, CX-5).
export function wikiTitleCandidates({ make, model }: VehicleImageParams): string[] {
  const m = titleCase(make);
  const candidates = [`${m} ${model}`];
  const upper = model.toUpperCase();
  if (upper !== model) candidates.push(`${m} ${upper}`);
  candidates.push(`${m} ${model} (automobile)`);
  return candidates;
}

// A representative model per body type, used when the record's own make/model
// resolve to nothing — a blank make, or a model Wikipedia does not carry.
//
// The old system does the same thing: its list shows a photograph for every
// row, never a drawing, and a row whose model it cannot place still gets a
// picture of that kind of vehicle. Matching it is the point.
//
// The consequence is worth stating plainly: this is a photo of A vehicle of
// the right type, not THE vehicle on the order. The UI marks it as generic so
// nobody quotes it to a carrier as the customer's actual car.
const TYPE_STAND_IN: Record<string, VehicleImageParams> = {
  sedan: { make: "Honda", model: "Accord" },
  suv: { make: "Jeep", model: "Grand Cherokee" },
  pickup: { make: "Ford", model: "F-150" },
  van: { make: "Ford", model: "Transit" },
  motorcycle: { make: "Harley", model: "Davidson" },
  boat: { make: "Cabin", model: "cruiser" },
  rv: { make: "Recreational", model: "vehicle" },
  atv: { make: "All-terrain", model: "vehicle" },
  trailer: { make: "Semi", model: "trailer" },
  heavy_equipment: { make: "Loader", model: "(equipment)" },
};

export function standInForType(type: string | null | undefined): VehicleImageParams | null {
  return TYPE_STAND_IN[String(type ?? "").toLowerCase()] ?? null;
}
