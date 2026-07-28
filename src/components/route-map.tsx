"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polyline, CircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";

// Embedded route map with auto mileage — msgplane-style. Geocoding and
// routing go through our own /api/geo/route (OpenRouteService server-side):
// the public Nominatim/OSRM servers this first used throttle and block
// anonymous browser traffic, which is exactly the "Couldn't locate the
// origin" failure. Every failure path still degrades to "type the miles
// yourself" rather than blocking the form.

export type RouteEndpoint = { city: string; state: string; zip: string };

type RouteResult = { miles: number; hours: number };

// The map is a 270px band in the middle of the edit form, and Leaflet claims
// one-finger drags for panning — so a rep scrolling the form gets caught in it
// with no way out. Below md the gesture goes back to the page; the route is
// fitted to bounds on draw, so there is nothing to pan to. Unchanged at the
// desk, where dragging is on by default.
const DESK = "(min-width: 48rem)";

function syncDragging(map: LeafletMap | null) {
  if (!map) return;
  if (window.matchMedia(DESK).matches) map.dragging.enable();
  else map.dragging.disable();
}

function endpointText(p: RouteEndpoint): string {
  return [[p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean).join(" ").trim();
}

export function RouteMap({
  getEndpoints,
  onMiles,
}: {
  // Reads the CURRENT form values so recalculation uses unsaved edits.
  getEndpoints: () => { origin: RouteEndpoint; destination: RouteEndpoint } | null;
  onMiles: (miles: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<(Polyline | CircleMarker)[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRanRef = useRef(false);

  const calculate = useCallback(async () => {
    const endpoints = getEndpoints();
    if (!endpoints) {
      setError("Enter an origin and destination city (or ZIP) first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const L = (await import("leaflet")).default;
      if (!mapRef.current && containerRef.current) {
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
      if (!map) return;

      const params = new URLSearchParams({
        from: endpointText(endpoints.origin),
        to: endpointText(endpoints.destination),
      });
      const res = await fetch(`/api/geo/route?${params.toString()}`);
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({ error: "" }))) as {
          error?: string;
        };
        if (code === "ORIGIN_NOT_FOUND")
          throw new Error("Couldn't locate the origin — check city/state/ZIP.");
        if (code === "DEST_NOT_FOUND")
          throw new Error("Couldn't locate the destination — check city/state/ZIP.");
        if (code === "NOT_CONFIGURED")
          throw new Error("Distance service isn't set up (ORS_KEY) — enter miles manually.");
        if (code === "NO_ROUTE") throw new Error("No drivable route found between these points.");
        throw new Error("Route service is unavailable — enter miles manually.");
      }
      const data = (await res.json()) as { miles: number; hours: number; coords: [number, number][] };

      for (const layer of layersRef.current) layer.remove();
      layersRef.current = [];

      const coords = data.coords;
      const line = L.polyline(coords, { color: "#2563eb", weight: 4, opacity: 0.85 }).addTo(map);
      const originMarker = L.circleMarker(coords[0], {
        radius: 7, color: "#2563eb", fillColor: "#ffffff", fillOpacity: 1, weight: 3,
      }).addTo(map);
      const destMarker = L.circleMarker(coords[coords.length - 1], {
        radius: 7, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 1, weight: 3,
      }).addTo(map);
      layersRef.current = [line, originMarker, destMarker];
      map.fitBounds(line.getBounds(), { padding: [30, 30] });

      setResult({ miles: data.miles, hours: data.hours });
      onMiles(data.miles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Route lookup failed — enter miles manually.");
    } finally {
      setBusy(false);
    }
  }, [getEndpoints, onMiles]);

  // Draw once on load when the saved load already has both endpoints.
  // Deferred a tick so the state updates inside calculate() don't fire
  // synchronously within the effect.
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    const t = setTimeout(() => {
      if (getEndpoints()) calculate();
    }, 0);
    return () => clearTimeout(t);
  }, [calculate, getEndpoints]);

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

  const formatDrive = (h: number) => `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-md border"
        aria-label="Route map"
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:min-h-12 max-md:px-4"
          onClick={calculate}
          disabled={busy}
        >
          {busy ? "Calculating..." : "Calculate route"}
        </Button>
        {result && (
          <span className="tabular-nums">
            {result.miles.toLocaleString()} mi
            <span className="ml-2 text-muted-foreground">
              ~{formatDrive(result.hours)} drive
            </span>
          </span>
        )}
        {result && (
          <span className="text-xs text-muted-foreground">Distance field updated.</span>
        )}
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  );
}
