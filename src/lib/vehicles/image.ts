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
