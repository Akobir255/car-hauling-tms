"use client";

import { useEffect, useRef } from "react";
import type { Circle, CircleMarker, Map as LeafletMap, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";

// The tracking map — the read side of the GPS pipeline (0050). Leaflet over
// tile.openstreetmap.org, the same stack route-map.tsx already runs under this
// CSP: the tile host is in img-src and leaflet is dynamically imported, so
// nothing new has to be allowed anywhere.
//
// Deliberately presentational: fixes and fences come in as props and Leaflet
// state lives entirely in refs, so this renders the staff map (with fences) and
// the public customer map (trail only) without knowing which it is.

export type TrackFix = { id: string; lat: number; lng: number; recorded_at: string };
export type TrackFence = {
  kind: "pickup" | "delivery";
  lat: number;
  lng: number;
  radius_m: number;
};

/** "just now" / "12 min ago" / "3 h ago" — the age of the last fix. */
export function fixAge(recordedAt: string, nowMs: number = Date.now()): string {
  const t = new Date(recordedAt).getTime();
  if (Number.isNaN(t)) return "";
  const minutes = Math.floor((nowMs - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

// Same one-finger-drag rule as route-map: below md the pan gesture goes back to
// the page, because the map is a band in the middle of a scrolling record.
const DESK = "(min-width: 48rem)";

function syncDragging(map: LeafletMap | null) {
  if (!map) return;
  if (window.matchMedia(DESK).matches) map.dragging.enable();
  else map.dragging.disable();
}

const FENCE_STYLES = {
  pickup: { color: "#2563eb", label: "Pickup area" },
  delivery: { color: "#16a34a", label: "Delivery area" },
} as const;

// Module constant, not a default-parameter literal: a fresh [] every render
// would re-trigger the draw effect on renders where nothing changed.
const NO_FENCES: TrackFence[] = [];

export function TrackingMap({
  fixes,
  fences = NO_FENCES,
  className,
}: {
  /** Oldest first — the polyline is drawn in array order. */
  fixes: TrackFix[];
  fences?: TrackFence[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<(Polyline | CircleMarker | Circle)[]>([]);
  const lastMarkerRef = useRef<CircleMarker | null>(null);
  const fittedRef = useRef(false);

  // Create-once, redraw-on-change. All map state is in refs, so nothing here
  // sets React state (react-hooks/set-state-in-effect is a build error).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
          [39.5, -96.5],
          4
        );
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 18,
        }).addTo(mapRef.current);
        syncDragging(mapRef.current);
      }
      const map = mapRef.current;

      for (const layer of layersRef.current) layer.remove();
      layersRef.current = [];
      lastMarkerRef.current = null;

      const bounds = L.latLngBounds([]);

      for (const f of fences) {
        const style = FENCE_STYLES[f.kind];
        const circle = L.circle([f.lat, f.lng], {
          radius: f.radius_m,
          color: style.color,
          weight: 2,
          fillColor: style.color,
          fillOpacity: 0.08,
        })
          .bindTooltip(style.label)
          .addTo(map);
        layersRef.current.push(circle);
        bounds.extend(circle.getBounds());
      }

      if (fixes.length >= 2) {
        const line = L.polyline(
          fixes.map((f) => [f.lat, f.lng] as [number, number]),
          { color: "#2563eb", weight: 3, opacity: 0.8 }
        ).addTo(map);
        layersRef.current.push(line);
        bounds.extend(line.getBounds());
      }

      const last = fixes[fixes.length - 1];
      if (last) {
        const marker = L.circleMarker([last.lat, last.lng], {
          radius: 7,
          color: "#2563eb",
          fillColor: "#2563eb",
          fillOpacity: 1,
          weight: 3,
        })
          .bindTooltip(fixAge(last.recorded_at), {
            permanent: true,
            direction: "top",
            offset: [0, -8],
          })
          .addTo(map);
        layersRef.current.push(marker);
        lastMarkerRef.current = marker;
        bounds.extend([last.lat, last.lng]);
      }

      // Fit once. Refitting on every incoming fix would yank the viewport away
      // from wherever the dispatcher just panned to.
      if (bounds.isValid() && !fittedRef.current) {
        fittedRef.current = true;
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fixes, fences]);

  // Keep the marker's "N min ago" honest between fixes — updated straight on
  // the Leaflet tooltip, no React state to re-render for.
  useEffect(() => {
    const t = setInterval(() => {
      const last = fixes[fixes.length - 1];
      if (last && lastMarkerRef.current) {
        lastMarkerRef.current.setTooltipContent(fixAge(last.recorded_at));
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [fixes]);

  // Rotating a phone into landscape crosses md, so the gesture follows.
  useEffect(() => {
    const mq = window.matchMedia(DESK);
    const onChange = () => syncDragging(mapRef.current);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("h-72 w-full overflow-hidden rounded-md border", className)}
      aria-label="Tracking map"
    />
  );
}
