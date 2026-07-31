import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOW_CONFIDENCE,
  PROMPT_VERSION,
  asDateInput,
  fieldText,
  flattenFields,
  intakeSchema,
  lowConfidenceFields,
  vehiclesPayload,
  type IntakeExtraction,
  type VehicleDraft,
} from "../src/lib/ai/intake-schema";
import { storedPhone } from "../src/lib/messaging/ringcentral";

const f = (value: unknown, confidence: number) => ({ value, confidence });

const sample = (): IntakeExtraction =>
  ({
    contact: {
      name: f("Dana Ruiz", 0.99),
      company: f(null, 1),
      phone: f("(865) 328-7418", 0.97),
      email: f("dana@example.com", 0.6),
    },
    origin: { city: f("Dallas", 0.98), state: f("TX", 0.98), zip: f(null, 1), address: f(null, 1) },
    destination: {
      city: f("Phoenix", 0.72),
      state: f("AZ", 0.95),
      zip: f(null, 1),
      address: f(null, 1),
    },
    vehicles: [
      {
        vin: f("1HGCM82633A004352", 0.55),
        year: f(2019, 0.99),
        make: f("Toyota", 0.99),
        model: f("Camry", 0.93),
        condition: f("operable", 0.88),
      },
    ],
    requested_pickup_date: f("2026-08-04", 0.9),
    requested_delivery_date: f(null, 1),
    quoted_price: f(1150, 0.8),
    transport_type: f("open", 0.95),
    notes: f(null, 1),
  }) as IntakeExtraction;

describe("intake schema", () => {
  it("accepts a well-formed extraction", () => {
    expect(intakeSchema.safeParse(sample()).success).toBe(true);
  });

  it("requires every field to carry a confidence", () => {
    const bad = sample() as unknown as Record<string, Record<string, unknown>>;
    bad.contact.name = { value: "Dana" }; // no confidence
    expect(intakeSchema.safeParse(bad).success).toBe(false);
  });

  it("allows null on every value — an absent field must be representable", () => {
    // The prompt's first rule is never invent a value. If the schema could not
    // hold a null, the model would have to fabricate one to satisfy it.
    const empty = {
      contact: { name: f(null, 1), company: f(null, 1), phone: f(null, 1), email: f(null, 1) },
      origin: { city: f(null, 1), state: f(null, 1), zip: f(null, 1), address: f(null, 1) },
      destination: { city: f(null, 1), state: f(null, 1), zip: f(null, 1), address: f(null, 1) },
      vehicles: [],
      requested_pickup_date: f(null, 1),
      requested_delivery_date: f(null, 1),
      quoted_price: f(null, 1),
      transport_type: f(null, 1),
      notes: f(null, 1),
    };
    expect(intakeSchema.safeParse(empty).success).toBe(true);
  });

  it("rejects a condition outside the operable/inoperable pair", () => {
    const bad = sample();
    bad.vehicles[0].condition = f("maybe", 1) as never;
    expect(intakeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("flattenFields", () => {
  it("names every leaf with a dotted path, arrays included", () => {
    const paths = flattenFields(sample()).map((x) => x.path);
    expect(paths).toContain("contact.phone");
    expect(paths).toContain("origin.city");
    expect(paths).toContain("vehicles.0.vin");
    expect(paths).toContain("quoted_price");
  });

  it("treats a { value, confidence } pair as a leaf and does not descend into it", () => {
    // Otherwise "contact.name.value" would appear as its own field and the
    // correction rows would point at paths the review screen never rendered.
    const paths = flattenFields(sample()).map((x) => x.path);
    expect(paths.some((p) => p.endsWith(".value"))).toBe(false);
    expect(paths.some((p) => p.endsWith(".confidence"))).toBe(false);
  });

  it("counts every field exactly once", () => {
    const paths = flattenFields(sample()).map((x) => x.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("lowConfidenceFields", () => {
  it("flags exactly the fields below the threshold", () => {
    expect(lowConfidenceFields(sample()).sort()).toEqual(
      ["contact.email", "destination.city", "quoted_price", "vehicles.0.vin"].sort()
    );
  });

  it("does not flag a field sitting exactly on the threshold", () => {
    const e = sample();
    e.contact.email = f(null, LOW_CONFIDENCE) as never;
    expect(lowConfidenceFields(e)).not.toContain("contact.email");
  });

  it("flags a confidently-wrong-looking VIN, which is the case that matters", () => {
    // A 17-character VIN transcribed from a photo is the single most damaging
    // field to get wrong, so the sample pins it below the bar.
    expect(lowConfidenceFields(sample())).toContain("vehicles.0.vin");
  });
});

describe("fieldText", () => {
  it("renders null as empty, never as the string 'null'", () => {
    expect(fieldText(null)).toBe("");
    expect(fieldText(undefined)).toBe("");
  });

  it("renders numbers and strings as typed", () => {
    expect(fieldText(1150)).toBe("1150");
    expect(fieldText("Dallas")).toBe("Dallas");
  });
});

describe("asDateInput", () => {
  it("passes an ISO date through", () => {
    expect(asDateInput("2026-08-04")).toBe("2026-08-04");
  });

  it("blanks anything a date input cannot show, rather than posting it", () => {
    // These reached a `date` column and failed the insert with "Could not create
    // load" — while the field on screen looked empty, so nothing pointed at the
    // cause.
    for (const bad of ["next Tuesday", "ASAP", "8/4", "2026-8-4", "04-08-2026", "soon"]) {
      expect(asDateInput(bad)).toBe("");
    }
  });

  it("leaves empty empty", () => {
    expect(asDateInput("")).toBe("");
  });
});

describe("vehiclesPayload", () => {
  const draft = (over: Partial<VehicleDraft> = {}): VehicleDraft => ({
    vin: "1HGCM82633A004352",
    year: "2019",
    make: "Toyota",
    model: "Camry",
    condition: "operable",
    ...over,
  });

  it("carries the DRAFT's values, which is the whole point of it existing", () => {
    // The bug this replaces: the blob was built from the extraction, so a VIN
    // the dispatcher corrected on screen was recorded as a correction and then
    // thrown away — the order got the model's original. Corrected in, corrected
    // out.
    const out = vehiclesPayload([draft({ vin: "5YJ3E1EA7KF317250" })]);
    expect(out[0].vin).toBe("5YJ3E1EA7KF317250");
  });

  it("maps inoperable to the enum's non_running and everything else to running", () => {
    expect(vehiclesPayload([draft({ condition: "inoperable" })])[0].condition).toBe("non_running");
    expect(vehiclesPayload([draft({ condition: "operable" })])[0].condition).toBe("running");
  });

  it("treats not-stated as running, because the enum has no third value", () => {
    // The review screen's label says so out loud; this pins the behaviour it
    // promises.
    expect(vehiclesPayload([draft({ condition: "" })])[0].condition).toBe("running");
  });

  it("keeps every row, so a two-car order stays a two-car order", () => {
    expect(vehiclesPayload([draft(), draft({ vin: "JH4KA7561PC008269" })])).toHaveLength(2);
  });
});

describe("storedPhone", () => {
  it("normalizes a readable US number to E.164", () => {
    expect(storedPhone("(865) 328-7418")).toBe("+18653287418");
    expect(storedPhone("1-865-328-7418")).toBe("+18653287418");
    expect(storedPhone("8653287418")).toBe("+18653287418");
  });

  it("keeps what the rep typed when it cannot be read as one", () => {
    // Dropping the number would be worse than storing it unformatted, and
    // formatPhone() passes anything it does not recognise straight through.
    expect(storedPhone("865-328-7418 x12")).toBe("865-328-7418 x12");
    expect(storedPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(storedPhone("328-7418")).toBe("328-7418");
  });

  it("renders blank as null, not as an empty string in the column", () => {
    expect(storedPhone("")).toBeNull();
    expect(storedPhone("   ")).toBeNull();
    expect(storedPhone(null)).toBeNull();
    expect(storedPhone(undefined)).toBeNull();
  });
});

describe("migration 0051", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0051_ai_intake.sql"), "utf8");

  it("gives both tables RLS, a policy, and revoked default grants", () => {
    for (const t of ["ai_extractions", "ai_corrections"]) {
      expect(sql).toMatch(new RegExp(`alter table ${t} enable row level security;`));
      expect(sql).toMatch(new RegExp(`on ${t} for select`));
      expect(sql).toMatch(new RegExp(`revoke all on ${t} from anon, authenticated;`));
    }
  });

  it("keeps the corrections table append-only — it is the training set", () => {
    expect(sql).toMatch(/grant select, insert on ai_corrections to authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*update[^;]*on ai_corrections/i);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*on ai_corrections/i);
    expect(sql).not.toMatch(/on ai_corrections for (update|delete|all)/i);
  });

  it("keeps the extractions table append-only too — the brief calls it the audit trail", () => {
    // It shipped with an UPDATE policy and grant for a load_id stamp that no
    // code performs, which meant any staff member could rewrite `output`,
    // `model` or `prompt_version` after the fact. An audit trail that its
    // subjects can edit is a note.
    expect(sql).toMatch(/grant select, insert on ai_extractions to authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*update[^;]*on ai_extractions/i);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*on ai_extractions/i);
    expect(sql).not.toMatch(/on ai_extractions for (update|delete|all)/i);
  });

  it("scopes reads to the author or a manager, not to all staff", () => {
    // input_text is a customer's email verbatim. `customers` has been scoped to
    // the owning rep since 0001; a table holding the same contact details as
    // free text must not route around it.
    for (const [table, author] of [
      ["ai_extractions", "created_by"],
      ["ai_corrections", "corrected_by"],
    ]) {
      const policy = sql.slice(sql.indexOf(`on ${table} for select`));
      expect(policy.slice(0, 400)).toContain(`${author} = auth.uid()`);
      expect(policy.slice(0, 400)).toMatch(/current_profile_role\(\) in \('admin', 'dispatcher'\)/);
    }
  });

  it("cannot record the same correction twice — a retried confirm is a no-op", () => {
    // createLoad can reject the form and the dispatcher presses confirm again.
    // Nothing may delete from this table, so a duplicate would be permanent and
    // would double-count that field in the eval set.
    expect(sql).toMatch(
      /create unique index idx_ai_corrections_once\s+on ai_corrections \(extraction_id, field_path, human_value\);/
    );
    // The dedupe only works if the column cannot be null — null <> null.
    expect(sql).toMatch(/human_value\s+text not null/);
  });

  it("records model and prompt_version as NOT NULL — an unreproducible row is an anecdote", () => {
    expect(sql).toMatch(/model\s+text not null/);
    expect(sql).toMatch(/prompt_version text not null/);
  });

  it("stores the model's confidence alongside each correction", () => {
    // Without it you cannot tell confidently-wrong (fix the prompt) from
    // unconfidently-wrong (the review screen already did its job).
    expect(sql).toMatch(/model_confidence double precision/);
  });

  it("ships the feature dark", () => {
    expect(sql).toMatch(/\('ai_intake', false/);
  });
});

describe("prompt version", () => {
  it("is set, and is what gets stored on every extraction", () => {
    expect(PROMPT_VERSION).toMatch(/^intake-v\d+$/);
  });
});
