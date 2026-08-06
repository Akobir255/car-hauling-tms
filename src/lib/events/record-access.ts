// Server-only: never import this from a Client Component. It reaches
// createAdminClient(), which carries SUPABASE_SERVICE_ROLE_KEY. The convention
// here is the same one src/lib/supabase/admin.ts and record-event.ts use — a
// stated boundary, not the `server-only` package, which this project does not
// depend on.
import { createAdminClient } from "@/lib/supabase/admin";

// The READ side of the spine (migration 0067). `load_events` records what
// HAPPENED to an order — status changed, contract sent. Nothing anywhere
// recorded that a person LOOKED at a customer, so if the book walked out there
// was nothing to point at anyone. This is that record.
//
// Three things about this file are load-bearing:
//
// 1. It writes as the SERVICE ROLE, and that is not a way around a boundary —
//    it IS the boundary. 0067 grants `authenticated` SELECT only and gives the
//    table no insert policy, so staff cannot write here through their own
//    client. That is what stops a rep forging, suppressing or thinning out
//    their own trail. Nothing margin-bearing lives on this table, so the
//    admin client is not being used to step around 0013's column grants.
//
// 2. Ids, counts and the search term ONLY. Never a name, phone, email or
//    address — the same rule 0049 puts on `load_events.payload`, and for a
//    stronger reason: an access log that copies contact details is a SECOND
//    copy of the customer book, and the point of the log is to protect the
//    first one. `accessRow()` is the only thing that decides what a row may
//    contain, so that rule is enforced in one place rather than remembered at
//    four call sites.
//
// 3. It NEVER THROWS, for the reason recordEvent() does not: this records a
//    read that has ALREADY HAPPENED. Failing to write the log must not fail
//    the read it describes. The error comes back for a caller that wants it.
//
// Callers schedule it with `after()` from next/server so the insert lands
// behind the response instead of inside it. In a Server Component the request
// headers must be read during render and closed over — see the call sites.

export const ACCESS_ACTIONS = ["customer_search", "customer_view", "customer_list"] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

// `entity_type` is TEXT in 0067 and only customers are logged today. Narrowing
// it here means a second entity type is a deliberate edit, not a typo that
// writes a category nobody thinks to query for later.
export type AccessEntity = "customer";

// Both search paths already slice what the user typed to 60 characters before
// they run the query, but the writer does not trust its callers: `term` is raw
// keyboard input and this is the last stop before a column with no length
// limit of its own.
export const MAX_TERM_LENGTH = 120;

// The longest textual IPv6 address is 45 characters. `x-forwarded-for` is a
// client-settable header anywhere it is not overwritten by the proxy in front
// (Vercel does overwrite it), so it is evidence, not proof — and an arbitrarily
// long one must not reach the column either way.
export const MAX_IP_LENGTH = 45;

export type AccessEventRow = {
  actor_id: string | null;
  action: AccessAction;
  entity_type: AccessEntity | null;
  entity_id: string | null;
  result_count: number | null;
  term: string | null;
  ip: string | null;
};

type RecordAccessInput = {
  action: AccessAction;
  /**
   * profiles.id of the reader. 0067 declares a foreign key to profiles, so a
   * value that is not a real staff id fails the insert rather than logging an
   * anonymous read.
   */
  actorId: string | null;
  entityType?: AccessEntity | null;
  /** Only when the read was of a single record. */
  entityId?: string | null;
  /** How many records the read actually returned — rows disclosed, not a total. */
  resultCount?: number | null;
  /** What was typed, when the read was a search. */
  term?: string | null;
  /** The raw `x-forwarded-for` header; the first hop is taken here. */
  ip?: string | null;
};

export function normalizeTerm(term: string | null | undefined): string | null {
  if (typeof term !== "string") return null;
  const trimmed = term.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TERM_LENGTH);
}

// `x-forwarded-for` is a list in client-to-proxy order, so the original caller
// is the FIRST hop — the same read the RingCentral webhook and the e-sign open
// audit already do.
export function firstForwardedIp(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const first = header.split(",")[0].trim();
  if (!first) return null;
  return first.slice(0, MAX_IP_LENGTH);
}

// `result_count` is an integer column. A caller doing arithmetic on a
// possibly-undefined length hands over NaN, and a NaN or a float fails the
// insert — which would breach this file's one contract, that it never costs
// the caller anything. So a value that is not a count becomes null instead.
export function normalizeCount(count: number | null | undefined): number | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  return Math.max(0, Math.floor(count));
}

// The single place that decides what an access row may contain. It is total —
// every column is named here — so a caller cannot widen a row by passing extra
// keys, which is how contact details would eventually leak into the log.
export function accessRow(input: RecordAccessInput): AccessEventRow {
  return {
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    result_count: normalizeCount(input.resultCount),
    term: normalizeTerm(input.term),
    ip: firstForwardedIp(input.ip),
  };
}

export async function recordAccess(input: RecordAccessInput): Promise<{ error: string | null }> {
  try {
    const { error } = await createAdminClient().from("access_events").insert(accessRow(input));

    if (error) {
      // The action, never the term or the id — this line goes to a log drain
      // that is not the access log and has none of its protections.
      console.error(`recordAccess(${input.action}) failed:`, error.message);
      return { error: error.message };
    }
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`recordAccess(${input.action}) threw:`, message);
    return { error: message };
  }
}
