import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assess, atRiskQueue, daysUntil, type RiskInput } from "../src/lib/risk/score";

const NOW = new Date("2026-07-31T15:00:00Z");
const iso = (offsetDays: number) =>
  new Date(NOW.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const load = (over: Partial<RiskInput> = {}): RiskInput => ({
  id: "l1",
  load_number: "10000005-US",
  status: "booked",
  carrier_id: "c1",
  pickup_ready_date: iso(3),
  delivery_eta: iso(7),
  date_signed: NOW.toISOString(),
  contract_sent_at: NOW.toISOString(),
  contract_sent: false,
  follow_up_at: null,
  updated_at: NOW.toISOString(),
  ...over,
});

describe("daysUntil", () => {
  it("counts forward and backward", () => {
    expect(daysUntil(iso(3), NOW)).toBe(3);
    expect(daysUntil(iso(-2), NOW)).toBe(-2);
  });

  it("anchors a date-only column at noon so a timezone cannot shift the day", () => {
    // pickup_ready_date and delivery_eta are DATEs. Parsed as midnight UTC and
    // compared against a 15:00 clock, today would read as -1 — every order in
    // the system would look a day overdue.
    expect(daysUntil(iso(0), NOW)).toBe(0);
  });

  it("returns null for missing or unparseable input", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("whenever", NOW)).toBeNull();
  });
});

describe("assess", () => {
  it("finds nothing wrong with a healthy order", () => {
    expect(assess(load(), NOW).factors).toHaveLength(0);
    expect(assess(load(), NOW).band).toBe("low");
  });

  it("escalates a missed delivery the longer it runs", () => {
    const one = assess(load({ delivery_eta: iso(-1) }), NOW).score;
    const five = assess(load({ delivery_eta: iso(-5) }), NOW).score;
    expect(five).toBeGreaterThan(one);
    expect(assess(load({ delivery_eta: iso(-5) }), NOW).band).toBe("high");
  });

  it("weighs a missed delivery above an unsigned agreement", () => {
    // Ordered by what it costs when it goes wrong, not by how often it fires.
    const late = assess(load({ delivery_eta: iso(-1) }), NOW).factors[0];
    const unsigned = assess(load({ date_signed: null, status: "dispatched" }), NOW).factors[0];
    expect(late.weight).toBeGreaterThan(unsigned.weight);
  });

  it("treats a missing carrier as urgent only when pickup is close", () => {
    const far = assess(load({ carrier_id: null, pickup_ready_date: iso(10) }), NOW);
    const near = assess(load({ carrier_id: null, pickup_ready_date: iso(1) }), NOW);
    expect(near.score).toBeGreaterThan(far.score);
    expect(near.factors[0].detail).toMatch(/pickup is in 1 day/);
  });

  it("does not ask for a carrier on a load already on a truck", () => {
    const moving = assess(load({ status: "picked_up", carrier_id: null }), NOW);
    expect(moving.factors.map((f) => f.key)).not.toContain("no_carrier");
  });

  it("says whether the agreement was ever sent, because the fix differs", () => {
    const never = assess(load({ date_signed: null, contract_sent_at: null, contract_sent: false }), NOW);
    const sent = assess(load({ date_signed: null, contract_sent_at: NOW.toISOString() }), NOW);
    expect(never.factors[0].detail).toMatch(/none has been sent/);
    expect(sent.factors[0].detail).toMatch(/has not been signed/);
  });

  it("flags an order nobody has touched in a week, but only while it is moving", () => {
    const stale = { updated_at: iso(-9), status: "in_transit" };
    expect(assess(load(stale), NOW).factors.map((f) => f.key)).toContain("stale");
    expect(assess(load({ ...stale, status: "booked" }), NOW).factors.map((f) => f.key)).not.toContain("stale");
  });

  it("drops a factor somebody has acknowledged", () => {
    const l = load({ carrier_id: null, pickup_ready_date: iso(1) });
    expect(assess(l, NOW).factors).toHaveLength(1);
    expect(assess(l, NOW, new Set(["no_carrier"])).factors).toHaveLength(0);
  });

  it("acknowledging one worry does not silence the others", () => {
    // Per-factor on purpose: "I know it has no carrier" must not also hide
    // "it is three days past delivery".
    const l = load({ carrier_id: null, pickup_ready_date: iso(-1), delivery_eta: iso(-3) });
    const keys = assess(l, NOW, new Set(["no_carrier"])).factors.map((f) => f.key);
    expect(keys).toContain("delivery_overdue");
    expect(keys).not.toContain("no_carrier");
  });

  it("caps the score at 100 however many things are wrong", () => {
    // 50 + 40 + 35 + 10 + 15 = 150 before the cap.
    const wreck = load({
      status: "booked", carrier_id: null, date_signed: null, contract_sent_at: null,
      pickup_ready_date: iso(-20), delivery_eta: iso(-20), follow_up_at: iso(-20),
    });
    const a = assess(wreck, NOW);
    expect(a.factors.reduce((s, f) => s + f.weight, 0)).toBeGreaterThan(100);
    expect(a.score).toBe(100);
  });

  it("a moving order is not asked for a carrier or a pickup date it is past", () => {
    // Same wreck, on a truck: pickup_overdue and no_carrier both drop out,
    // because neither is actionable once the car is loaded.
    const moving = load({
      status: "dispatched", carrier_id: null, date_signed: null, contract_sent_at: null,
      pickup_ready_date: iso(-20), delivery_eta: iso(-20), follow_up_at: iso(-20), updated_at: iso(-30),
    });
    const keys = assess(moving, NOW).factors.map((f) => f.key);
    expect(keys).not.toContain("no_carrier");
    expect(keys).not.toContain("pickup_overdue");
    expect(keys).toEqual(expect.arrayContaining(["delivery_overdue", "unsigned", "stale"]));
  });

  it("treats ONE serious problem as urgent, not just an accumulation", () => {
    // Caught on the real sample set: a delivery two days late summed to 42 and
    // landed in "watch", while three moderate problems summed to 77 and
    // shouted. The late delivery is the one with a customer in a driveway.
    const late = assess(load({ delivery_eta: iso(-2) }), NOW);
    expect(late.score).toBeLessThan(45);
    expect(late.band).toBe("high");
  });

  it("still leaves a single mild problem alone", () => {
    // The escape hatch must not turn every warning into an emergency.
    const mild = assess(load({ carrier_id: null, pickup_ready_date: iso(10) }), NOW);
    expect(mild.factors).toHaveLength(1);
    expect(mild.band).toBe("low");
  });

  it("sorts factors worst-first so the top line is the reason", () => {
    const l = load({ delivery_eta: iso(-4), follow_up_at: iso(-1) });
    const f = assess(l, NOW).factors;
    expect(f[0].key).toBe("delivery_overdue");
    expect(f[0].weight).toBeGreaterThanOrEqual(f[1].weight);
  });
});

describe("atRiskQueue", () => {
  it("ignores quotes and finished work — neither can be late", () => {
    const rows = [
      load({ id: "q", status: "quote", delivery_eta: iso(-10) }),
      load({ id: "d", status: "delivered", delivery_eta: iso(-10) }),
      load({ id: "b", status: "booked", delivery_eta: iso(-10) }),
    ];
    expect(atRiskQueue(rows, NOW).map((a) => a.id)).toEqual(["b"]);
  });

  it("drops healthy orders instead of listing them at zero", () => {
    expect(atRiskQueue([load()], NOW)).toHaveLength(0);
  });

  it("returns worst first", () => {
    const rows = [
      load({ id: "mild", follow_up_at: iso(-1) }),
      load({ id: "bad", delivery_eta: iso(-6) }),
    ];
    expect(atRiskQueue(rows, NOW).map((a) => a.id)).toEqual(["bad", "mild"]);
  });

  it("applies per-load acknowledgements", () => {
    const rows = [load({ id: "x", delivery_eta: iso(-6) })];
    const ack = new Map([["x", new Set(["delivery_overdue"])]]);
    expect(atRiskQueue(rows, NOW, ack)).toHaveLength(0);
  });
});

describe("migration 0059", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_exception_engine.sql"), "utf8");

  it("gives the table brokerage_id and an RLS policy", () => {
    expect(sql).toMatch(/create table risk_acknowledgements[\s\S]*?brokerage_id/);
    expect(sql).toMatch(/alter table risk_acknowledgements enable row level security;/);
    expect(sql).toMatch(/on risk_acknowledgements for select/);
    expect(sql).toMatch(/revoke all on risk_acknowledgements from anon, authenticated;/);
  });

  it("makes acknowledgements follow their parent load", () => {
    expect(sql).toMatch(/exists \(select 1 from loads l where l\.id = risk_acknowledgements\.load_id\)/);
  });

  it("allows delete — this is working state, not an audit trail", () => {
    // "Actually, that is not handled" has to be expressible.
    expect(sql).toMatch(/on risk_acknowledgements for delete/);
    expect(sql).toMatch(/grant select, insert, delete on risk_acknowledgements to authenticated;/);
  });

  it("adds NO scoring function — the score stays in TypeScript over the role views", () => {
    // A SECURITY DEFINER scorer would have been the sixth thing to bypass a row
    // policy in one day. See the table in STATUS.md.
    // Asserted on statements, not on prose — the header comment explains why
    // there is no definer function, and that must not be what makes this pass.
    const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(statements).not.toMatch(/security definer/i);
    expect(statements).not.toMatch(/create (or replace )?function/i);
  });

  it("ships the phase dark", () => {
    expect(sql).toMatch(/\('exception_engine', false/);
  });
});
