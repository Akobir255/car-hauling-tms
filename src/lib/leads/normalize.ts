// Turn whatever a lead generator posts into the handful of fields an order
// needs. Pure, so it is testable without a database or a request.
//
// There is no standard here and there never will be. Every provider invents
// its own spelling -- `phone`, `phone_number`, `telephone`, `contact_phone`,
// `customer.phone` -- and a broker typically buys from three or four at once.
// Writing a bespoke parser per provider means a code change and a deploy every
// time you add one, which is how brokers end up not adding one.
//
// So this reads a wide set of aliases and takes the first that has a value.
// A provider whose payload does not fit gets an alias added here, not a new
// file, and the handler still records the raw body in webhook_events either
// way -- so a lead is never lost while the mapping is being fixed.

export type NormalizedLead = {
  contactName: string | null;
  phone: string | null;
  email: string | null;
  originCity: string | null;
  originState: string | null;
  originZip: string | null;
  destCity: string | null;
  destState: string | null;
  destZip: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  operable: boolean;
  transportType: "open" | "enclosed";
  readyDate: string | null;
  sourceRef: string | null;
  notes: string | null;
};

type Loose = Record<string, unknown>;

// Providers nest as often as they flatten: {customer: {phone}}, {lead: {...}},
// {data: {...}}. Flatten one level deep under the usual wrapper names so the
// alias list stays flat instead of becoming a path language.
const WRAPPERS = ["lead", "data", "customer", "contact", "quote", "payload", "order", "shipment"];

export function flattenPayload(input: unknown): Loose {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const top = input as Loose;
  const out: Loose = { ...top };
  for (const w of WRAPPERS) {
    const nested = top[w];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      // Outer keys win: an explicit top-level `phone` beats `customer.phone`.
      for (const [k, v] of Object.entries(nested as Loose)) {
        if (out[k] === undefined) out[k] = v;
      }
    }
  }
  return out;
}

// Keys are compared with punctuation and case stripped, so `Phone Number`,
// `phone_number` and `phoneNumber` are one alias rather than three.
const canon = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(obj: Loose, aliases: string[]): unknown {
  const byCanon = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const c = canon(k);
    if (!byCanon.has(c)) byCanon.set(c, v);
  }
  for (const a of aliases) {
    const v = byCanon.get(canon(a));
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, 300);
};

// US ZIPs only, which is what this business hauls. Accepts ZIP+4 and keeps the
// first five. A "zip" that is really a city name returns null rather than
// writing rubbish into a column reports group by.
export function normalizeZip(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

// Two letters, so "Indiana" and "IN" both land as IN. Anything else is null:
// a bad state code silently breaks every lane report that groups on it.
const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  newhampshire: "NH", newjersey: "NJ", newmexico: "NM", newyork: "NY",
  northcarolina: "NC", northdakota: "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", rhodeisland: "RI", southcarolina: "SC",
  southdakota: "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", westvirginia: "WV", wisconsin: "WI",
  wyoming: "WY", districtofcolumbia: "DC",
};

export function normalizeState(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const c = canon(s);
  if (STATES[c]) return STATES[c];
  if (/^[a-z]{2}$/.test(c) && Object.values(STATES).includes(c.toUpperCase())) {
    return c.toUpperCase();
  }
  return null;
}

// Digits only, matching the `phone_digits` generated column (0017) that
// customer matching keys on. A leading US country code is dropped so
// +1 (865) 555-0118 and 8655550118 are the same person.
export function normalizePhone(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

export function normalizeEmail(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = s.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? t : null;
}

// A vehicle year, not any four-digit number in the payload. Anything outside
// living memory to next model year is more likely a typo or a stray ZIP.
export function normalizeYear(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/\b(19[2-9]\d|20[0-4]\d)\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1920 && y <= 2035 ? y : null;
}

// Providers say inoperable in every possible way, and getting it wrong is
// expensive: an inop needs a winch and costs more to move, so a lead that
// silently arrives as running gets quoted at the wrong price. Default is
// running, because that is what the overwhelming majority are -- but any hint
// of the opposite wins.
export function normalizeOperable(v: unknown): boolean {
  const s = str(v);
  if (s === null) return true;
  const t = s.toLowerCase();
  // Negatives first, because "inoperable" contains "operable": match the inop
  // stem without a trailing boundary so "non-running" and "does not run" are
  // caught, not just "non-run".
  if (/inop|non[\s-]?run|not[\s-]?run|doesn'?t[\s-]?run|\bno\b|\bfalse\b|\b0\b/.test(t)) return false;
  if (/\b(op|operable|runs?|running|drivable|driveable|yes|true|1)\b/.test(t)) return true;
  return true;
}

// ISO date only. A provider's free-text "ASAP" or "next week" is not a date and
// must not become one -- pickup_ready_date drives the follow-up queues.
export function normalizeDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const us = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (us) {
    const [, mm, dd, yy] = us;
    const year = yy.length === 2 ? `20${yy}` : yy;
    const d = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(d)) ? null : d;
  }
  return null;
}

export function normalizeLead(raw: unknown): NormalizedLead {
  const p = flattenPayload(raw);

  const first = str(pick(p, ["first_name", "firstname", "fname", "given_name"]));
  const last = str(pick(p, ["last_name", "lastname", "lname", "surname", "family_name"]));
  const whole = str(
    pick(p, ["name", "full_name", "fullname", "customer_name", "contact_name", "shipper_name"])
  );
  const contactName = whole ?? [first, last].filter(Boolean).join(" ") ?? null;

  const transport = str(pick(p, ["transport_type", "trailer", "trailer_type", "carrier_type", "service_type"]));

  return {
    contactName: contactName || null,
    phone: normalizePhone(
      pick(p, ["phone", "phone_number", "telephone", "mobile", "cell", "contact_phone", "phone1", "primary_phone"])
    ),
    email: normalizeEmail(pick(p, ["email", "email_address", "contact_email", "customer_email"])),

    originCity: str(pick(p, ["origin_city", "pickup_city", "from_city", "origincity", "ship_from_city"])),
    originState: normalizeState(
      pick(p, ["origin_state", "pickup_state", "from_state", "originstate", "ship_from_state"])
    ),
    originZip: normalizeZip(
      pick(p, ["origin_zip", "pickup_zip", "from_zip", "originzip", "origin_postal_code", "ship_from_zip", "pickup_postal"])
    ),

    destCity: str(pick(p, ["destination_city", "delivery_city", "to_city", "destcity", "ship_to_city", "dropoff_city"])),
    destState: normalizeState(
      pick(p, ["destination_state", "delivery_state", "to_state", "deststate", "ship_to_state", "dropoff_state"])
    ),
    destZip: normalizeZip(
      pick(p, ["destination_zip", "delivery_zip", "to_zip", "destzip", "destination_postal_code", "ship_to_zip", "dropoff_zip"])
    ),

    vehicleYear: normalizeYear(pick(p, ["year", "vehicle_year", "car_year", "model_year"])),
    vehicleMake: str(pick(p, ["make", "vehicle_make", "car_make", "manufacturer"])),
    vehicleModel: str(pick(p, ["model", "vehicle_model", "car_model"])),
    // `inoperable`/`non_running` mean the OPPOSITE of the positive aliases, so
    // they are read on their own branch, not folded into the list -- otherwise
    // `inoperable: true` reads as the string "true" and comes back operable.
    // The negative wins when present, since getting this wrong under-quotes an
    // inop that needs a winch.
    operable: (() => {
      const neg = pick(p, ["inoperable", "is_inoperable", "non_running"]);
      if (neg !== undefined && normalizeOperable(neg) === true) {
        // neg holds a truthy inoperable flag -> not operable
        return false;
      }
      return normalizeOperable(
        pick(p, ["operable", "running", "runs", "is_operable", "condition", "vehicle_condition"])
      );
    })(),
    transportType: transport && /enclos/i.test(transport) ? "enclosed" : "open",

    readyDate: normalizeDate(
      pick(p, ["ship_date", "pickup_date", "available_date", "ready_date", "first_available_date", "date"])
    ),

    sourceRef: str(
      pick(p, ["id", "lead_id", "leadid", "reference", "ref", "external_id", "quote_id", "order_id"])
    ),
    notes: str(pick(p, ["notes", "comments", "message", "additional_info", "customer_notes"])),
  };
}

/**
 * A lead with no way to contact anyone is not a lead. Everything else is
 * allowed through and left for a human to finish, because a half-filled lead
 * in the queue is worth far more than a 400 the provider will never look at.
 */
export function hasContact(lead: NormalizedLead): boolean {
  return Boolean(lead.phone || lead.email);
}
