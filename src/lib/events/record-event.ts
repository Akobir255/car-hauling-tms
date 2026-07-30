// Server-only: never import this from a Client Component. It reaches
// createAdminClient(), which carries SUPABASE_SERVICE_ROLE_KEY. The convention
// here is the same one src/lib/supabase/admin.ts uses — a stated boundary, not
// the `server-only` package, which this project does not depend on.
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventSource, EventType, PayloadFor } from "./types";

// The single write path onto an order's timeline (migration 0049). Every later
// phase goes through here — GPS, AI, calls, exceptions — so there is one place
// that knows what an event looks like and one place to change when that
// changes.
//
// It NEVER THROWS. An event is a record of something that already happened;
// failing to write it must not roll back the business action that caused it.
// That is how the status history it replaces already behaved (every one of the
// fifteen insert sites ignores its error), so this preserves the contract
// rather than quietly tightening it. The error comes back for a caller that
// wants to log it.

type RecordEventInput<T extends EventType> = {
  loadId: string;
  type: T;
  payload: PayloadFor<T>;
  source: EventSource;
  /** Omit for system sources; the caller's session supplies it otherwise. */
  actorUserId?: string | null;
  /** When the thing HAPPENED, if that is not now — buffered GPS, a late webhook. */
  occurredAt?: string | Date;
};

// gps and integration events arrive with no user session at all: a driver PWA
// post, a provider webhook, a cron sweep. Those write through the service role.
// Everything a human causes writes as that human, so the row-level policy in
// 0049 still applies and an event cannot be planted on someone else's load.
const SYSTEM_SOURCES: readonly EventSource[] = ["gps", "integration"];

export async function recordEvent<T extends EventType>(
  input: RecordEventInput<T>
): Promise<{ error: string | null }> {
  try {
    const client = SYSTEM_SOURCES.includes(input.source)
      ? createAdminClient()
      : await createClient();

    const occurredAt =
      input.occurredAt instanceof Date
        ? input.occurredAt.toISOString()
        : (input.occurredAt ?? new Date().toISOString());

    const { error } = await client.from("load_events").insert({
      load_id: input.loadId,
      event_type: input.type,
      payload: input.payload as unknown as Record<string, unknown>,
      source: input.source,
      actor_user_id: input.actorUserId ?? null,
      occurred_at: occurredAt,
    });

    if (error) {
      console.error(`recordEvent(${input.type}) failed for load ${input.loadId}:`, error.message);
      return { error: error.message };
    }
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`recordEvent(${input.type}) threw for load ${input.loadId}:`, message);
    return { error: message };
  }
}
