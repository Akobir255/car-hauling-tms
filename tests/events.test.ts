import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVENT_SOURCES,
  isEventSource,
  statusChangedPayload,
  type EventSource,
} from "../src/lib/events/types";

const MIGRATION = join(process.cwd(), "supabase/migrations/0049_load_events.sql");
const sql = readFileSync(MIGRATION, "utf8");

describe("event sources", () => {
  // The TS union and the Postgres CHECK constraint are two spellings of one
  // rule, 200 files apart. This is the test that notices when only one of them
  // is updated — which is how `source` ends up rejecting a value the app is
  // already trying to write.
  it("matches the CHECK constraint in migration 0049 exactly", () => {
    const match = sql.match(/check \(source in \(([^)]+)\)\)/);
    expect(match, "0049 must declare a source CHECK constraint").toBeTruthy();
    const fromSql = (match![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ""));
    expect([...fromSql].sort()).toEqual([...EVENT_SOURCES].sort());
  });

  it("accepts every declared source and rejects anything else", () => {
    for (const s of EVENT_SOURCES) expect(isEventSource(s)).toBe(true);
    for (const s of ["", "USER", "webhook", "gps ", null, undefined, 7]) {
      expect(isEventSource(s)).toBe(false);
    }
  });

  it("routes only gps and integration through the service role", () => {
    // Mirrors SYSTEM_SOURCES in record-event.ts. Anything a human causes must
    // write as that human so the 0049 insert policy still applies to it.
    const system: EventSource[] = ["gps", "integration"];
    const human = EVENT_SOURCES.filter((s) => !system.includes(s));
    expect(human).toEqual(["user", "sms", "call", "ai"]);
  });
});

describe("status_changed payload", () => {
  // The view in 0049 casts payload->>'status' back into the load_status enum
  // and filters on `payload ? 'status'`. A row missing that key vanishes from
  // load_status_history entirely, so the key is not optional.
  it("always carries status", () => {
    expect(statusChangedPayload("ready")).toEqual({ status: "ready" });
    expect(statusChangedPayload("delivered", "left message")).toEqual({
      status: "delivered",
      note: "left message",
    });
  });

  it("omits note rather than writing null, so jsonb_strip_nulls has nothing to do", () => {
    expect(statusChangedPayload("quote", null)).toEqual({ status: "quote" });
    expect("note" in statusChangedPayload("quote", "")).toBe(false);
  });
});

describe("migration 0049", () => {
  it("grants no update or delete on load_events — append-only is the point", () => {
    expect(sql).toMatch(/grant select, insert on load_events to authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*update[^;]*on load_events/i);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*on load_events/i);
  });

  it("declares no update or delete policy on load_events", () => {
    expect(sql).not.toMatch(/on load_events for (update|delete|all)/i);
  });

  it("locks the rollback copy in the same migration", () => {
    // The lesson from messages_backup_pre_0013: a snapshot table whose grants
    // nobody revoked is still readable a year later.
    expect(sql).toMatch(/revoke all on load_status_history_pre_0049 from anon, authenticated;/);
    expect(sql).toMatch(/alter table load_status_history_pre_0049 enable row level security;/);
  });

  it("reads with is_active_staff, not load ownership", () => {
    // The regression this test exists for: the first draft of 0049 gated SELECT
    // on user_can_access_load(). 0037 had already dropped that predicate from
    // every child of a load precisely because it blanked the record for a rep
    // looking at a colleague's order — and RLS fails silently, so nobody would
    // have seen an error, only an empty History band on a 26k-load book.
    const selectPolicy = sql.match(
      /create policy "load_events_select_scoped"[\s\S]*?;/
    );
    expect(selectPolicy, "0049 must declare a select policy").toBeTruthy();
    expect(selectPolicy![0]).toMatch(/using \(public\.is_active_staff\(\)\)/);
    expect(selectPolicy![0]).not.toMatch(/user_can_access_load/);
  });

  it("still scopes WRITES to the load's owner", () => {
    const insertPolicy = sql.match(
      /create policy "load_events_insert_scoped"[\s\S]*?;/
    );
    expect(insertPolicy![0]).toMatch(/public\.user_can_access_load\(load_id\)/);
  });

  it("creates the replacement view with security_invoker", () => {
    // Without it the view runs as its owner and every caller sees every load.
    expect(sql).toMatch(/create view load_status_history with \([^)]*security_invoker = true/);
  });
});
