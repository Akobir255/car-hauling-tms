"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/flags";
import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
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

export type HandledRiskItem = {
  loadId: string;
  loadNumber: string | null;
  /** Null is a whole-order snooze — restoring it lifts the quiet, not one factor. */
  factor: string | null;
  snoozedUntil: string | null;
};

/** Rows the card's collapsed "Recently handled" line shows. */
const HANDLED_LIMIT = 8;

/**
 * The read half of the restore affordance: what has been acknowledged or
 * snoozed lately, newest first. Runs as the CALLER — the select policy on
 * risk_acknowledgements follows the parent load, and load numbers come from
 * the role views — so this shows nothing the dashboard itself would not.
 */
export async function listHandledRisk(): Promise<{
  items: HandledRiskItem[];
  error: string | null;
}> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("exception_engine"))) {
    return { items: [], error: "The exception engine is switched off for this account." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("risk_acknowledgements")
    .select("load_id, factor, snoozed_until, created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    console.error("recently-handled read failed:", error.message);
    return { items: [], error: "Could not load the recently handled list." };
  }

  // An expired snooze has already stopped counting in the scorer — offering to
  // restore it would be a button that changes nothing visible.
  const now = Date.now();
  const live = (data ?? []).filter(
    (r) => !r.snoozed_until || Date.parse(r.snoozed_until) >= now
  );

  // One line per (load, factor): acknowledging twice is two inserts, and the
  // restore's delete removes them all at once anyway.
  const seen = new Set<string>();
  const distinct = live.filter((r) => {
    const key = `${r.load_id}:${r.factor ?? "*"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // The dashboard is a personal dashboard, so a rep's list is their own orders
  // — the same scoping the queue itself applies. The join to the role view is
  // also what drops acks whose load has since been hidden or deleted.
  const ids = [...new Set(distinct.map((r) => r.load_id))];
  const numbers = new Map<string, string | null>();
  if (ids.length) {
    let loadsQuery = supabase
      .from(profile.role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE)
      .select("id, load_number")
      .in("id", ids);
    if (profile.role === "sales") loadsQuery = loadsQuery.eq("sales_owner_id", profile.id);
    const { data: loads, error: loadsError } = await loadsQuery;
    if (loadsError) {
      console.error("recently-handled load read failed:", loadsError.message);
      return { items: [], error: "Could not load the recently handled list." };
    }
    for (const l of loads ?? []) numbers.set(l.id, l.load_number ?? null);
  }

  return {
    items: distinct
      .filter((r) => numbers.has(r.load_id))
      .slice(0, HANDLED_LIMIT)
      .map((r) => ({
        loadId: r.load_id,
        loadNumber: numbers.get(r.load_id) ?? null,
        factor: r.factor,
        snoozedUntil: r.snoozed_until,
      })),
    error: null,
  };
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
