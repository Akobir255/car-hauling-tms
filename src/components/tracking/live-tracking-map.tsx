"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TrackingMap, fixAge, type TrackFence, type TrackFix } from "./tracking-map";

// The staff map, live. Migration 0050 put shipment_locations into the
// supabase_realtime publication for exactly this subscriber; RLS applies to
// postgres_changes, so the browser only receives rows its own select policy
// (is_active_staff) would have served. Server-fetched history comes in as
// props; realtime INSERTs are appended client-side. If the channel cannot
// subscribe (transport blocked, token trouble), it drops to a slow
// router.refresh() poll rather than sitting silently stale.

export function LiveTrackingMap({
  loadId,
  initialFixes,
  fences,
}: {
  loadId: string;
  /** Oldest first, from the server render. */
  initialFixes: TrackFix[];
  fences: TrackFence[];
}) {
  const router = useRouter();
  // Realtime rows live in their own state and are MERGED with the prop, rather
  // than seeding state from props — that way router.refresh() updating the
  // server-rendered history needs no state syncing.
  const [liveFixes, setLiveFixes] = useState<TrackFix[]>([]);
  const [feed, setFeed] = useState<"connecting" | "live" | "polling">("connecting");
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Ticks the "N min ago" caption between fixes.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let poll: ReturnType<typeof setInterval> | null = null;
    const channel = supabase
      .channel(`shipment-locations-${loadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "shipment_locations",
          filter: `load_id=eq.${loadId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            lat: number;
            lng: number;
            recorded_at: string;
          };
          setLiveFixes((prev) =>
            prev.some((f) => f.id === row.id)
              ? prev
              : [...prev, { id: row.id, lat: row.lat, lng: row.lng, recorded_at: row.recorded_at }]
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setFeed("live");
          if (poll) {
            clearInterval(poll);
            poll = null;
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // A map that LOOKS live but isn't is worse than admitting it.
          setFeed("polling");
          if (!poll) poll = setInterval(() => router.refresh(), 45_000);
        }
      });
    return () => {
      supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
    };
  }, [loadId, router]);

  const fixes = useMemo(() => {
    const seen = new Set(initialFixes.map((f) => f.id));
    const merged = [...initialFixes];
    for (const f of liveFixes) if (!seen.has(f.id)) merged.push(f);
    // A phone coming back into signal posts a backlog, so arrival order is not
    // recorded order.
    merged.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    return merged.slice(-200);
  }, [initialFixes, liveFixes]);

  const last = fixes[fixes.length - 1];

  if (!last && fences.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No positions yet — the map appears with the driver&apos;s first ping
        {feed === "live" ? ", and this page is watching for it live." : "."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <TrackingMap fixes={fixes} fences={fences} />
      <p className="text-sm text-muted-foreground">
        {last
          ? `Last position ${fixAge(last.recorded_at, nowMs)} · ${fixes.length} fix${fixes.length === 1 ? "" : "es"} on the trail`
          : "No positions yet — showing the pickup and delivery areas."}
        {" · "}
        {feed === "live" ? "updates live" : feed === "polling" ? "auto-refreshing" : "connecting…"}
      </p>
    </div>
  );
}
