"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { blockedFromWritingLoad } from "@/lib/record-access";
import { isFeatureEnabled } from "@/lib/flags";

// Phase 6a. Why a quote died.
//
// The brief calls win/loss at a given price the most valuable pricing signal
// there is, and notes that almost no brokerage captures it. This book proves
// the point: 6,612 cancelled quotes, not one recorded reason, because there was
// nowhere to put one. Everything from here is a row the old system never had.
//
// The competitor's price is the expensive field to collect and the one that
// makes the rest mean anything — "lost at $900" is a fact, "lost at $900 to
// $780" is a lesson.

const OUTCOMES = ["won", "lost", "expired"] as const;
const REASONS = [
  "price",
  "timing",
  "no_response",
  "went_with_competitor",
  "customer_cancelled",
  "vehicle_not_ready",
  "other",
] as const;

export type OutcomeState = { error: string | null; success?: string };

const money = (v: FormDataEntryValue | null): number | null => {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function recordQuoteOutcome(
  loadId: string,
  _prev: OutcomeState,
  formData: FormData
): Promise<OutcomeState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("lane_pricing"))) {
    return { error: "Quote outcome tracking is switched off for this account." };
  }

  // Reading a load is company-wide since 0037; writing one is not.
  const notMine = await blockedFromWritingLoad(loadId, profile);
  if (notMine) return { error: notMine };

  const outcome = (formData.get("outcome") || "").toString();
  const reason = (formData.get("reason") || "").toString();
  if (!OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) {
    return { error: "Pick whether this was won, lost, or expired." };
  }
  if (reason && !REASONS.includes(reason as (typeof REASONS)[number])) {
    return { error: "That is not one of the reasons." };
  }

  const supabase = await createClient();

  // The price AS IT STANDS, read server-side rather than posted from the form.
  // A number the browser supplies is a number the browser can get wrong, and
  // this row is supposed to be evidence.
  const { data: load } = await supabase
    .from("loads")
    .select("customer_rate, status")
    .eq("id", loadId)
    .maybeSingle();

  const { error } = await supabase.from("quote_outcomes").insert({
    load_id: loadId,
    outcome,
    reason: reason || null,
    reason_note: (formData.get("reason_note") || "").toString().trim() || null,
    quoted_price: load?.customer_rate ?? null,
    competitor_price: money(formData.get("competitor_price")),
    recorded_by: profile.id,
  });
  if (error) {
    console.error("quote outcome insert failed:", error.message);
    return { error: "Could not record that — try again." };
  }

  // Moving the load to `lost` is a SEPARATE decision from recording why, and it
  // only happens on the way down. An outcome recorded on a booked load is a
  // correction to the record, not an instruction to cancel freight that is
  // already moving.
  const stillOpen = ["lead", "quote", "hold"].includes(load?.status ?? "");
  if (outcome === "lost" && stillOpen) {
    const { error: sErr } = await supabase
      .from("loads")
      .update({ status: "lost" })
      .eq("id", loadId);
    if (sErr) console.error("could not move load to lost:", sErr.message);
    else {
      await supabase.from("load_status_history").insert({
        load_id: loadId,
        status: "lost",
        changed_by: profile.id,
        note: reason ? `Lost — ${reason.replace(/_/g, " ")}` : "Lost",
      });
    }
  }

  revalidatePath(`/loads/${loadId}`);
  return { error: null, success: "Recorded. That is the pricing signal." };
}

/**
 * The dispatcher priced against the suggestion and disagreed.
 *
 * Never blocks and never validates hard: this is telemetry about the model, and
 * a quote must not fail to save because its telemetry did.
 */
export async function recordPriceOverride(input: {
  loadId: string | null;
  originState: string | null;
  destState: string | null;
  suggested: number | null;
  entered: number | null;
  sampleSize: number | null;
  reason: string | null;
}): Promise<void> {
  try {
    const profile = await requireRole("admin", "dispatcher", "sales");
    if (!(await isFeatureEnabled("lane_pricing"))) return;
    const supabase = await createClient();
    await supabase.from("price_overrides").insert({
      load_id: input.loadId,
      origin_state: input.originState?.toUpperCase() || null,
      destination_state: input.destState?.toUpperCase() || null,
      suggested_price: input.suggested,
      entered_price: input.entered,
      sample_size: input.sampleSize,
      reason: input.reason?.trim() || null,
      created_by: profile.id,
    });
  } catch (err) {
    console.error("price override not recorded:", err);
  }
}
