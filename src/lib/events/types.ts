import type { LoadStatus } from "@/types/database";

// The event spine's vocabulary (migration 0049).
//
// `source` is a CHECK constraint in Postgres, so this list and that list must
// agree — tests/events.test.ts reads the migration and fails if they drift.
export const EVENT_SOURCES = ["user", "gps", "sms", "call", "ai", "integration"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

// `event_type` is deliberately TEXT in the database, not an enum: a later phase
// adding an event type should not need a migration, and an unknown type must
// render as a plain row rather than break the timeline. This union is the
// compile-time contract; the database accepts anything.
export const EVENT_TYPES = [
  // Phase 1
  "status_changed",
  "note_added",
  // Phase 2 — GPS
  "tracking_link_issued",
  "geofence_entered",
  "geofence_exited",
  "eta_updated",
  // Phase 3 — AI intake
  "ai_intake_parsed",
  "ai_intake_confirmed",
  // Phase 4 — calls and SMS
  "call_completed",
  "message_sent",
  "message_received",
  // Phase 5 — AI on communications
  "call_summarized",
  "commitment_extracted",
  // Phase 7 — exceptions
  "risk_flagged",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Payload shapes, per type. Anything not listed takes an open record — a new
// phase can write before this file catches up, it just loses the type check.
export type EventPayloads = {
  status_changed: { status: LoadStatus; note?: string | null };
  note_added: { note_id: string; excerpt?: string };
  tracking_link_issued: { kind: "driver" | "customer" };
  geofence_entered: { fence: "pickup" | "delivery"; recorded_at: string };
  geofence_exited: { fence: "pickup" | "delivery"; recorded_at: string };
  eta_updated: { eta: string; reason?: string; previous_eta?: string | null };
  ai_intake_parsed: { model: string; prompt_version: string; field_count: number };
  ai_intake_confirmed: { corrections: number };
  call_completed: { call_id: string; direction: "inbound" | "outbound"; seconds: number };
  message_sent: { message_id: string; channel: "sms" | "email" };
  message_received: { message_id: string; channel: "sms" | "email" };
  call_summarized: { call_id: string; model: string; prompt_version: string };
  commitment_extracted: { kind: string; transcript_offset_seconds: number };
  risk_flagged: { score: number; reason: string };
};

export type PayloadFor<T extends EventType> = T extends keyof EventPayloads
  ? EventPayloads[T]
  : Record<string, unknown>;

export type LoadEventRow = {
  id: string;
  load_id: string;
  brokerage_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  source: EventSource;
  actor_user_id: string | null;
  occurred_at: string;
  created_at: string;
};

export function isEventSource(value: unknown): value is EventSource {
  return typeof value === "string" && (EVENT_SOURCES as readonly string[]).includes(value);
}

// The one payload the view in 0049 casts back into the load_status enum. If
// this key is missing the row drops out of load_status_history entirely, so it
// is built in one place rather than spelled out at each call site.
export function statusChangedPayload(
  status: LoadStatus,
  note?: string | null
): EventPayloads["status_changed"] {
  return note ? { status, note } : { status };
}
