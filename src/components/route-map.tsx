"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polyline, CircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";

// Embedded route map with auto mileage — msgplane-style, but on the free
// OpenStreetMap stack: Nominatim geocodes city/state/zip, OSRM's public
// server returns the driving route. Both are keyless community services, so
// every failure path degrades to "type the miles yourself" rather than
// blocking the form.

export type RouteEndpoint = { city: string; state: string; zip: string };

type RouteResult = { miles: number; hours: number };

async function geocode(p: RouteEndpoint): Promise<[number, number] | null> {
  const params = new URLSearchParams({ format: "json", limit: "1", country: "USA" });
  if (p.city) params.set("city", p.city);
  if (p.state) params.set("state", p.state);
  if (p.zip) params.set("postalcode", p.zip);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string }[];
  if (!data[0]) return null;
  return [Number(data[0].lat), Number(data[0].lon)];
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
      }
      const map = mapRef.current;
      if (!map) return;

      const [origin, dest] = await Promise.all([
        geocode(endpoints.origin),
        geocode(endpoints.destination),
      ]);
      if (!origin) throw new Error("Couldn't locate the origin — check city/state/ZIP.");
      if (!dest) throw new Error("Couldn't locate the destination — check city/state/ZIP.");

      const osrm = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`
      );
      if (!osrm.ok) throw new Error("Route service is unavailable — enter miles manually.");
      const route = await osrm.json();
      const leg = route.routes?.[0];
      if (!leg) throw new Error("No drivable route found between these points.");

      for (const layer of layersRef.current) layer.remove();
      layersRef.current = [];

      const coords = (leg.geometry.coordinates as [number, number][]).map(
        ([lon, lat]) => [lat, lon] as [number, number]
      );
      const line = L.polyline(coords, { color: "#2563eb", weight: 4, opacity: 0.85 }).addTo(map);
      const originMarker = L.circleMarker(origin, {
        radius: 7, color: "#2563eb", fillColor: "#ffffff", fillOpacity: 1, weight: 3,
      }).addTo(map);
      const destMarker = L.circleMarker(dest, {
        radius: 7, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 1, weight: 3,
      }).addTo(map);
      layersRef.current = [line, originMarker, destMarker];
      map.fitBounds(line.getBounds(), { padding: [30, 30] });

      const miles = Math.round(leg.distance / 1609.344);
      const hours = leg.duration / 3600;
      setResult({ miles, hours });
      onMiles(miles);
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
        <Button type="button" variant="outline" size="sm" onClick={calculate} disabled={busy}>
          {busy ? "Calculating..." : "Calculate route"}
        </Button>
        {result && (
          <span className="font-medium tabular-nums">
            {result.miles.toLocaleString()} mi
            <span className="ml-2 font-normal text-muted-foreground">
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
