// One place that turns text into coordinates.
//
// The same OpenRouteService geocode call is written out in three route handlers
// already (api/geo/citystate, api/geo/quote, api/geo/route). Phase 2 needs a
// fourth caller, so it becomes a function instead. Server-side only: ORS_KEY
// must never reach a browser.

export type LatLng = { lat: number; lng: number };

/**
 * Geocode free-text US location. Returns null on a miss, a bad key, or a
 * network failure — every caller here treats "no coordinates" as a normal
 * outcome rather than an error, because a load with a vague address is common
 * and must not break the flow that asked.
 */
export async function geocodeUS(text: string): Promise<LatLng | null> {
  const key = process.env.ORS_KEY;
  if (!key || !text.trim()) return null;

  try {
    const res = await fetch(
      `https://api.openrouteservice.org/geocode/search?text=${encodeURIComponent(
        text
      )}&boundary.country=USA&size=1`,
      { headers: { Authorization: key }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: { geometry?: { coordinates?: [number, number] } }[];
    };
    // ORS returns [lon, lat]. Getting this backwards puts a truck in the Indian
    // Ocean, which is why it is written down once here.
    const coords = data.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    const [lng, lat] = coords;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/** The address string this app hands the geocoder, in one place. */
export function addressText(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  return [parts.address, parts.city, parts.state, parts.zip].filter(Boolean).join(", ");
}
