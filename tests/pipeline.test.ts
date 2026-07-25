import { describe, expect, it } from "vitest";
import { ACTIONS_BY_STATUS, actionsFor } from "@/lib/order-status";
import type { LoadStatus } from "@/types/database";

// The pipeline rule set from the msgplane workflow: statuses advance in
// order, dispatch happens by ASSIGNING A CARRIER to a posted order (not by
// a button), and picked-up / delivered mirror what the carrier reports —
// nobody on the broker side, admin included, can click those.

const ALL_STATUSES = Object.keys(ACTIONS_BY_STATUS) as LoadStatus[];
const ROLES = ["admin", "dispatcher", "sales"] as const;

describe("no manual carrier-side transitions for anyone", () => {
  it("dispatch / picked-up / delivered buttons don't exist for any role or status", () => {
    for (const status of ALL_STATUSES) {
      for (const role of ROLES) {
        const actions = actionsFor(status, role) as string[];
        expect(actions, `${role} on ${status}`).not.toContain("dispatch");
        expect(actions, `${role} on ${status}`).not.toContain("mark_picked_up");
        expect(actions, `${role} on ${status}`).not.toContain("mark_delivered");
      }
    }
  });
});

describe("actionsFor role filtering", () => {
  it("lets sales unpost a posted order but not un-dispatch one", () => {
    expect(actionsFor("posted_cd", "sales")).toContain("unpost");
    expect(actionsFor("dispatched", "sales")).not.toContain("unpost");
    expect(actionsFor("dispatched", "admin")).toContain("unpost");
    expect(actionsFor("dispatched", "dispatcher")).toContain("unpost");
  });

  it("keeps the sales workflow intact: quote, convert, cancel, payment", () => {
    expect(actionsFor("quote", "sales")).toEqual(
      expect.arrayContaining(["convert_to_order", "record_payment", "mark_lost"])
    );
    expect(actionsFor("lead", "sales")).toContain("convert_to_quote");
    expect(actionsFor("hold", "sales")).toContain("reactivate");
  });

  it("managers see the full action set for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(actionsFor(status, "admin")).toEqual(ACTIONS_BY_STATUS[status]);
      expect(actionsFor(status, "dispatcher")).toEqual(ACTIONS_BY_STATUS[status]);
    }
  });
});

describe("stage discipline encoded in the action map", () => {
  it("no status offers a stage-skipping action", () => {
    expect(ACTIONS_BY_STATUS.lead).not.toContain("convert_to_order");
    expect(ACTIONS_BY_STATUS.quote).not.toContain("post");
    expect(ACTIONS_BY_STATUS.ready).toContain("post");
    // Post-dispatch statuses offer only payment (and unpost as the escape
    // hatch on dispatched) — progress comes from the carrier side.
    expect(ACTIONS_BY_STATUS.dispatched).toEqual(["record_payment", "unpost"]);
    expect(ACTIONS_BY_STATUS.picked_up).toEqual(["record_payment"]);
    expect(ACTIONS_BY_STATUS.in_transit).toEqual(["record_payment"]);
  });
});
