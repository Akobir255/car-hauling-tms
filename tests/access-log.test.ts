import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESS_ACTIONS,
  MAX_IP_LENGTH,
  MAX_TERM_LENGTH,
  accessRow,
  firstForwardedIp,
  normalizeCount,
  normalizeTerm,
  recordAccess,
} from "../src/lib/events/record-access";

const MIGRATION = join(process.cwd(), "supabase/migrations/0067_access_log_and_two_boundaries.sql");
const sql = readFileSync(MIGRATION, "utf8");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// The four CUSTOMER-BOOK paths — the ones whose subject is the contact record
// itself: search it, list it, open it. Adding a fifth means adding it here too;
// a search screen nobody remembered to log is how an access log becomes
// decorative.
//
// This is NOT yet every screen that puts a shipper's name or phone in front of
// a rep. Order detail, the edit page, the pipeline lists and the row quick-view
// all render contact data off a load and none of them writes a row, so the log
// answers "who went looking through the book", not "who saw this shipper".
// Widening it is a decision about volume — the pipeline list is the busiest
// screen in the app — not an oversight to fix by adding four more call sites.
const CALL_SITES = {
  route: "src/app/api/search/route.ts",
  searchPage: "src/app/(app)/search/page.tsx",
  list: "src/app/(app)/customers/page.tsx",
  detail: "src/app/(app)/customers/[id]/page.tsx",
} as const;

describe("normalizeTerm", () => {
  it("trims, and treats an empty or blank term as no term at all", () => {
    expect(normalizeTerm("  smith  ")).toBe("smith");
    expect(normalizeTerm("")).toBeNull();
    expect(normalizeTerm("   ")).toBeNull();
    expect(normalizeTerm(null)).toBeNull();
    expect(normalizeTerm(undefined)).toBeNull();
  });

  it("caps the term, because the callers' 60-char slice is not this file's guarantee", () => {
    const long = "x".repeat(MAX_TERM_LENGTH + 500);
    expect(normalizeTerm(long)).toHaveLength(MAX_TERM_LENGTH);
  });
});

describe("firstForwardedIp", () => {
  // x-forwarded-for is client-to-proxy order, so the original caller is the
  // first hop. Taking the last one logs our own proxy on every row.
  it("takes the first hop of the list", () => {
    expect(firstForwardedIp("203.0.113.7, 70.41.3.18, 150.172.238.178")).toBe("203.0.113.7");
    expect(firstForwardedIp("203.0.113.7")).toBe("203.0.113.7");
    expect(firstForwardedIp("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  it("is null when the header is absent or empty, never the string 'unknown'", () => {
    expect(firstForwardedIp(null)).toBeNull();
    expect(firstForwardedIp(undefined)).toBeNull();
    expect(firstForwardedIp("")).toBeNull();
    expect(firstForwardedIp("  ,  ")).toBeNull();
  });

  it("caps a header a client can set to anything", () => {
    expect(firstForwardedIp("a".repeat(4000))).toHaveLength(MAX_IP_LENGTH);
  });

  it("passes a full-length IPv6 address through intact", () => {
    const v6 = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
    expect(firstForwardedIp(v6)).toBe(v6);
  });
});

describe("normalizeCount", () => {
  it("keeps real counts, zero included", () => {
    // A search that found nothing is still a search, and the zero is the
    // interesting part when someone is probing for a name.
    expect(normalizeCount(0)).toBe(0);
    expect(normalizeCount(25)).toBe(25);
  });

  it("turns anything that is not a count into null rather than failing the insert", () => {
    // result_count is an integer column: NaN from `undefined.length`-style
    // arithmetic, or a float, would be rejected by Postgres — and this writer
    // must never cost its caller anything.
    expect(normalizeCount(Number.NaN)).toBeNull();
    expect(normalizeCount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeCount(null)).toBeNull();
    expect(normalizeCount(undefined)).toBeNull();
    expect(normalizeCount(3.9)).toBe(3);
    expect(normalizeCount(-4)).toBe(0);
  });
});

describe("accessRow", () => {
  // The test this file exists for. accessRow() is the only thing that decides
  // what reaches access_events, so if a contact field ever gets added to a
  // call site it has to fail HERE — an access log holding names, phones and
  // emails is a second copy of the customer book, which is the thing the log
  // was built to protect.
  const ALLOWED_COLUMNS = [
    "actor_id",
    "action",
    "entity_type",
    "entity_id",
    "result_count",
    "term",
    "ip",
  ];

  it("emits exactly the seven allowed columns and nothing else", () => {
    const row = accessRow({
      action: "customer_view",
      actorId: "11111111-1111-1111-1111-111111111111",
      entityType: "customer",
      entityId: "22222222-2222-2222-2222-222222222222",
      resultCount: 1,
      ip: "203.0.113.7",
    });
    expect(Object.keys(row).sort()).toEqual([...ALLOWED_COLUMNS].sort());
  });

  it("names no column the migration does not declare", () => {
    // Guards the other direction: a key renamed here but not in 0067 fails the
    // insert at runtime, silently, on a path whose contract is to stay silent.
    const declared = sql
      .slice(sql.indexOf("create table if not exists access_events"))
      .slice(0, sql.slice(sql.indexOf("create table if not exists access_events")).indexOf(");"));
    for (const column of ALLOWED_COLUMNS) {
      expect(declared, `0067 must declare ${column}`).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("carries no entity_id for a list or a search — those are not one record", () => {
    const row = accessRow({
      action: "customer_list",
      actorId: "11111111-1111-1111-1111-111111111111",
      entityType: "customer",
      resultCount: 100,
    });
    expect(row.entity_id).toBeNull();
    expect(row.result_count).toBe(100);
    expect(row.term).toBeNull();
    expect(row.ip).toBeNull();
  });

  it("normalizes term, ip and count on the way in", () => {
    const row = accessRow({
      action: "customer_search",
      actorId: null,
      entityType: "customer",
      resultCount: 2.7,
      term: "  Smith  ",
      ip: "203.0.113.7, 70.41.3.18",
    });
    expect(row).toEqual({
      actor_id: null,
      action: "customer_search",
      entity_type: "customer",
      entity_id: null,
      result_count: 2,
      term: "Smith",
      ip: "203.0.113.7",
    });
  });
});

describe("recordAccess", () => {
  it("never throws — a failed log must not fail the read it describes", async () => {
    // Configuration removed entirely, which is the harshest version of the
    // failure: createAdminClient() throws before any request is made, so this
    // stays a unit test with no network. The contract is that the caller still
    // gets a resolved promise and an error to ignore.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await recordAccess({
        action: "customer_view",
        actorId: "11111111-1111-1111-1111-111111111111",
        entityType: "customer",
        entityId: "22222222-2222-2222-2222-222222222222",
        resultCount: 1,
      });
      expect(result.error).toBeTruthy();
      expect(errors).toHaveBeenCalled();
      // The console line must not carry the term or the id — it goes to a
      // drain with none of the access log's protections.
      const logged = errors.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).not.toMatch(/22222222-2222-2222-2222-222222222222/);
    } finally {
      errors.mockRestore();
      if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    }
  });
});

describe("migration 0067", () => {
  it("grants no insert on access_events to authenticated — writes are service-role", () => {
    // This is the whole reason the writer uses the admin client. If staff
    // could insert here they could also forge a trail, and a log a suspect can
    // write is not evidence of anything.
    expect(sql).toMatch(/revoke all on access_events from anon, authenticated;/);
    expect(sql).toMatch(/grant select on access_events to authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*insert[^;]*on access_events/i);
  });

  it("is append-only twice over: no update or delete grant, and no such policy", () => {
    expect(sql).not.toMatch(/grant[^;]*update[^;]*on access_events/i);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*on access_events/i);
    expect(sql).not.toMatch(/on access_events for (update|delete|all)/i);
  });
});

describe("the call sites", () => {
  it("logs from every path that reads customer contact data", () => {
    for (const [name, path] of Object.entries(CALL_SITES)) {
      const src = read(path);
      expect(src, `${name} must import the writer`).toMatch(
        /import \{ recordAccess \} from "@\/lib\/events\/record-access";/
      );
      expect(src, `${name} must not block the response on the write`).toMatch(/after\(\(\) =>/);
      expect(src, `${name} must not reach the admin client itself`).not.toMatch(
        /createAdminClient/
      );
    }
  });

  it("uses only declared actions", () => {
    for (const path of Object.values(CALL_SITES)) {
      const used = [...read(path).matchAll(/action: "([a-z_]+)"/g)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(0);
      for (const action of used) {
        expect(ACCESS_ACTIONS as readonly string[]).toContain(action);
      }
    }
  });

  it("reads the header during render in Server Components, never inside after()", () => {
    // The runtime trap, and it is silent until someone opens the page: a
    // Server Component may not call headers() or cookies() inside an after()
    // callback — Next has to learn during render which parts of the tree touch
    // request data. Route handlers are exempt, which is why the API route is
    // not in this list.
    for (const path of [CALL_SITES.searchPage, CALL_SITES.list, CALL_SITES.detail]) {
      const src = read(path);
      const headerRead = src.indexOf("const forwardedFor = (await headers()).get(");
      expect(headerRead, `${path} must read the header into a local`).toBeGreaterThan(-1);
      const afterCall = src.indexOf("after(() =>");
      expect(afterCall, `${path} must schedule the write with after()`).toBeGreaterThan(headerRead);
      // Everything from the after() call to the end of the file — the callback
      // may only use the value captured above.
      expect(src.slice(afterCall)).not.toMatch(/headers\(\)/);
      expect(src.slice(afterCall)).toMatch(/ip: forwardedFor,/);
    }
  });

  it("logs a customer_view only after the record was actually found", () => {
    // notFound() disclosed nothing, and RLS returning zero rows is the same
    // non-disclosure. A row written before this guard would have the log
    // claiming access that never happened.
    const src = read(CALL_SITES.detail);
    expect(src.indexOf("if (!data) notFound();")).toBeLessThan(
      src.indexOf('action: "customer_view"')
    );
  });
});
