import { describe, expect, it } from "vitest";
import { ACTIONS_BY_STATUS, actionsFor } from "@/lib/order-status";
import type { LoadStatus } from "@/types/database";

// The pipeline rule set from the msgplane workflow: statuses advance in
// order, and everything post-dispatch mirrors what the carrier reports —
// dispatch-desk territory, invisible to sales.

describe("actionsFor", () => {
  it("hides dispatch from sales on posted orders", () => {
    for (const status of ["posted_cd", "posted_sd", "booked"] as LoadStatus[]) {
      expect(actionsFor(status, "sales")).not.toContain("dispatch");
      expect(actionsFor(status, "dispatcher")).toContain("dispatch");
      expect(actionsFor(status, "admin")).toContain("dispatch");
    }
  });

  it("hides picked-up/delivered from sales — the carrier reports those", () => {
    expect(actionsFor("dispatched", "sales")).not.toContain("mark_picked_up");
    expect(actionsFor("picked_up", "sales")).not.toContain("mark_delivered");
    expect(actionsFor("in_transit", "sales")).not.toContain("mark_delivered");
    expect(actionsFor("dispatched", "dispatcher")).toContain("mark_picked_up");
    expect(actionsFor("picked_up", "dispatcher")).toContain("mark_delivered");
  });

  it("lets sales unpost a posted order but not un-dispatch one", () => {
    expect(actionsFor("posted_cd", "sales")).toContain("unpost");
    expect(actionsFor("dispatched", "sales")).not.toContain("unpost");
    expect(actionsFor("dispatched", "admin")).toContain("unpost");
  });

  it("keeps the sales workflow intact: quote, convert, cancel, payment", () => {
    expect(actionsFor("quote", "sales")).toEqual(
      expect.arrayContaining(["convert_to_order", "record_payment", "mark_lost"])
    );
    expect(actionsFor("lead", "sales")).toContain("convert_to_quote");
    expect(actionsFor("hold", "sales")).toContain("reactivate");
  });

  it("managers see the full action set for every status", () => {
    for (const status of Object.keys(ACTIONS_BY_STATUS) as LoadStatus[]) {
      expect(actionsFor(status, "admin")).toEqual(ACTIONS_BY_STATUS[status]);
      expect(actionsFor(status, "dispatcher")).toEqual(ACTIONS_BY_STATUS[status]);
    }
  });
});

describe("stage discipline encoded in the action map", () => {
  it("no status offers a stage-skipping action", () => {
    // A quote can never dispatch or mark transit statuses; ready can't
    // dispatch (must post first); dispatched can't deliver (must pick up).
    expect(ACTIONS_BY_STATUS.quote).not.toContain("dispatch");
    expect(ACTIONS_BY_STATUS.quote).not.toContain("mark_picked_up");
    expect(ACTIONS_BY_STATUS.quote).not.toContain("mark_delivered");
    expect(ACTIONS_BY_STATUS.ready).not.toContain("dispatch");
    expect(ACTIONS_BY_STATUS.dispatched).not.toContain("mark_delivered");
    expect(ACTIONS_BY_STATUS.lead).not.toContain("convert_to_order");
  });
});
