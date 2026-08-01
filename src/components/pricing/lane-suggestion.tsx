"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isOutlier, type LaneSuggestion } from "@/lib/pricing/lanes";

// Phase 6a — what we have actually quoted on this state lane before.
//
// One band, two forms: the new-load form and the edit form both price loads
// (lead→quote happens by pricing, including on edit), so both show the same
// history. The forms hold very different state, so this stays controlled: they
// pass the states, the typed rate and a use-this-price callback, and this
// component owns only the debounced lookup and the display.
//
// Keyed on STATE, not ZIP, so it answers as soon as the states are known —
// typically several fields before a ZIP is typed. Flag off (503), no history,
// or any error all render nothing: this is advisory furniture, never a wall.

/**
 * What to write to price_overrides when a form is saved, or null for nothing.
 *
 * Null when no suggestion was on screen, when the rate is empty or unreadable
 * (a lead, not a price), and when the rep took the suggestion as-is — agreeing
 * with the median is not an override.
 */
export function overrideToRecord(
  rate: string,
  lane: LaneSuggestion | null
): { suggested: number; entered: number; sampleSize: number } | null {
  if (!lane) return null;
  const entered = Number(rate);
  if (rate.trim() === "" || !Number.isFinite(entered) || entered <= 0) return null;
  if (entered === lane.median) return null;
  return { suggested: lane.median, entered, sampleSize: lane.samples };
}

export function LaneSuggestionBand({
  originState,
  destState,
  vehicleType,
  transport,
  rate,
  onUseSuggestion,
  onSuggestionChange,
  className,
}: {
  originState: string;
  destState: string;
  /** Omit where the form doesn't know the vehicle (the edit page) — the API
   *  answers with the broader lane. */
  vehicleType?: string;
  transport?: string;
  /** The rate as typed — a string, so an empty field stays distinct from 0. */
  rate: string;
  onUseSuggestion: (price: number) => void;
  /** The suggestion currently on screen (or null). Parents keep it in a ref so
   *  saving can record an override against exactly what the rep was shown. */
  onSuggestionChange?: (s: LaneSuggestion | null) => void;
  className?: string;
}) {
  const [lane, setLane] = useState<LaneSuggestion | null>(null);

  // The parent's callback is usually an inline arrow; a ref keeps the fetch
  // effect from re-running on its identity. Updated in an effect, never during
  // render (react-hooks/refs is a build-failing error).
  const notifyRef = useRef(onSuggestionChange);
  useEffect(() => {
    notifyRef.current = onSuggestionChange;
  });

  useEffect(() => {
    let active = true;
    // Every publish below sits inside the timer, including the "not two states
    // yet" clear. A synchronous setState in an effect body is a lint ERROR
    // under React 19 (react-hooks/set-state-in-effect) — same fix as the toast
    // in intake-form.tsx.
    const publish = (next: LaneSuggestion | null) => {
      setLane(next);
      notifyRef.current?.(next);
    };
    const timer = setTimeout(async () => {
      const from = originState.trim();
      const to = destState.trim();
      if (from.length !== 2 || to.length !== 2) {
        if (active) publish(null);
        return;
      }
      try {
        const params = new URLSearchParams({ from, to });
        if (vehicleType) params.set("vehicle", vehicleType);
        if (transport) params.set("transport", transport);
        const r = await fetch(`/api/pricing/lane?${params.toString()}`);
        // 503 is the feature being off. Not an error worth showing anyone.
        if (!active || !r.ok) {
          if (active) publish(null);
          return;
        }
        const d = await r.json();
        if (active) publish(d.suggestion ?? null);
      } catch {
        if (active) publish(null);
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [originState, destState, transport, vehicleType]);

  if (!lane) return null;

  const rateNum = Number(rate);
  return (
    <div
      className={cn(
        "space-y-1 rounded-md border border-dashed bg-muted px-3 py-2 text-sm",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span>
          We usually quote{" "}
          <span className="font-semibold tabular-nums">${lane.median.toLocaleString()}</span>{" "}
          <span className="text-muted-foreground">
            · typically ${lane.low.toLocaleString()}–${lane.high.toLocaleString()} · from{" "}
            {lane.samples.toLocaleString()} past loads
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="max-md:min-h-12"
          onClick={() => onUseSuggestion(lane.median)}
        >
          Use ${lane.median.toLocaleString()}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {lane.matchedOn}
        {lane.broadened &&
          " — no history for this exact vehicle and transport, so this is the wider lane"}
        {lane.winRate != null &&
          ` · ${Math.round(lane.winRate * 100)}% of decided quotes here were won`}
      </p>
      {isOutlier(rate.trim() === "" ? null : rateNum, lane) && (
        <p className="text-xs text-ord-deposit">
          ${rateNum.toLocaleString()} is {rateNum > lane.median ? "above" : "below"} the usual by{" "}
          {Math.abs(Math.round(((rateNum - lane.median) / lane.median) * 100))}% — worth a second
          look, and worth a note saying why.
        </p>
      )}
    </div>
  );
}
