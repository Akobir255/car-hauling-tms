"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/flags";
import { RISK_FACTOR_KEYS } from "@/lib/risk/score";

// The write half of the Needs-attention card (migration 0059). The table had
// RLS from day one but no writer, which is the exact death the migration's own
// header predicts: a queue nobody can dismiss nags forever and gets ignored.
//
// Every write goes through the CALLER'S client — the insert/delete policies
// (is_active_staff + user_can_access_load) decide whether this person may
// touch this load, so a sales rep can only acknowledge their own orders and
// nothing here restates that.

export type RiskAckState = { error: string | null };

const DAY = 86_400_000;

/** "I know about this one worry on this order." */
export async function acknowledgeRiskFactor(
  loadId: string,
  factor: string
): Promise<RiskAckState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("exception_engine"))) {
    return { error: "The exception engine is switched off for this account." };
  }
  // The factor arrives from the browser; only the scorer's own vocabulary is
  // storable, so a mangled request cannot seed rows assess() will never match.
  if (!(RISK_FACTOR_KEYS as readonly string[]).includes(factor)) {
    return { error: "That is not a known risk factor." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("risk_acknowledgements").insert({
    load_id: loadId,
    factor,
    created_by: profile.id,
  });
  if (error) {
    console.error("risk acknowledge failed:", error.message);
    return { error: "Could not mark that handled — try again." };
  }
  revalidatePath("/dashboard");
  return { error: null };
}

/** Quiet the WHOLE order until a date — a null-factor row with snoozed_until. */
export async function snoozeLoadRisk(loadId: string, days: number): Promise<RiskAckState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("exception_engine"))) {
    return { error: "The exception engine is switched off for this account." };
  }
  const span = Math.trunc(days);
  if (!Number.isFinite(span) || span < 1 || span > 30) {
    return { error: "A snooze runs between 1 and 30 days." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("risk_acknowledgements").insert({
    load_id: loadId,
    factor: null,
    snoozed_until: new Date(Date.now() + span * DAY).toISOString(),
    created_by: profile.id,
  });
  if (error) {
    console.error("risk snooze failed:", error.message);
    return { error: "Could not snooze that — try again." };
  }
  revalidatePath("/dashboard");
  return { error: null };
}

/**
 * "Actually, that is not handled." A DELETE, and allowed by design — this
 * table is working state, not an audit trail, and removing the row is what
 * restores the warning. Null factor removes whole-order rows (snoozes).
 */
export async function unacknowledgeRisk(
  loadId: string,
  factor: string | null
): Promise<RiskAckState> {
  await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("exception_engine"))) {
    return { error: "The exception engine is switched off for this account." };
  }
  if (factor != null && !(RISK_FACTOR_KEYS as readonly string[]).includes(factor)) {
    return { error: "That is not a known risk factor." };
  }

  const supabase = await createClient();
  let query = supabase.from("risk_acknowledgements").delete().eq("load_id", loadId);
  query = factor == null ? query.is("factor", null) : query.eq("factor", factor);
  const { error } = await query;
  if (error) {
    console.error("risk un-acknowledge failed:", error.message);
    return { error: "Could not restore that warning — try again." };
  }
  revalidatePath("/dashboard");
  return { error: null };
}
