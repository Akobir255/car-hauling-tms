import { NextRequest, NextResponse } from "next/server";
import { normalizeVehicleImageParams, wikiTitleCandidates } from "@/lib/vehicles/image";

// Vehicle photo proxy — resolves make/model to a Wikipedia page image and
// streams the bytes back from OUR origin (same pattern as msgplane's
// get_car_image.php). Sits behind the auth middleware like /api/geo/*.
// Misses return 404 and the UI falls back to the type silhouette.
//
// Images come from Wikimedia (freely licensed); we send a descriptive
// User-Agent per Wikimedia's API etiquette.

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "USStarTMS/1.0 (internal dispatch tool; contact: dispatch@mail.carshiphelp.com)";
// A day of CDN cache per unique make/model URL; photos of car models don't
// churn, and a miss (404) is cached briefly so retries stay cheap.
const HIT_CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";
const MISS_CACHE = "public, s-maxage=3600";

type WikiPage = { title?: string; thumbnail?: { source?: string } };

export async function GET(req: NextRequest) {
  // An uploaded photo always wins over the make/model lookup. The file sits
  // in the PRIVATE bucket, so it is fetched server-side with the service
  // role and streamed from here — the bucket never becomes public, and the
  // no-login contract page can still show the picture.
  const vehicleId = req.nextUrl.searchParams.get("vehicleId");
  if (vehicleId && /^[0-9a-f-]{36}$/i.test(vehicleId)) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { data: vehicle } = await admin
        .from("load_vehicles")
        .select("photo_path")
        .eq("id", vehicleId)
        .maybeSingle();
      if (vehicle?.photo_path) {
        const { data: file } = await admin.storage.from("load-files").download(vehicle.photo_path);
        if (file) {
          return new NextResponse(file, {
            headers: {
              "Content-Type": file.type || "image/jpeg",
              // Private to the viewer's browser: an override is customer
              // content, not a public model shot.
              "Cache-Control": "private, max-age=3600",
            },
          });
        }
      }
    } catch (err) {
      console.error("Vehicle photo override failed:", err);
      // fall through to the make/model lookup
    }
  }

  const params = normalizeVehicleImageParams(
    req.nextUrl.searchParams.get("make"),
    req.nextUrl.searchParams.get("model")
  );
  if (!params) {
    return NextResponse.json({ error: "make and model are required" }, { status: 400 });
  }

  try {
    const candidates = wikiTitleCandidates(params);
    const query = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      redirects: "1",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "480",
      titles: candidates.join("|"),
    });
    const lookup = await fetch(`${WIKI_API}?${query}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6_000),
    });
    if (!lookup.ok) {
      return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } });
    }
    const data = await lookup.json();
    const pages: WikiPage[] = data?.query?.pages ?? [];
    const thumb = pages.find((p) => p.thumbnail?.source)?.thumbnail?.source;

    // Only ever fetch from Wikimedia's image host — the URL came from an
    // external API response, so pin the host rather than trusting it.
    if (!thumb || new URL(thumb).hostname !== "upload.wikimedia.org") {
      return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } });
    }

    const image = await fetch(thumb, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!image.ok || !image.body) {
      return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } });
    }

    return new NextResponse(image.body, {
      status: 200,
      headers: {
        "Content-Type": image.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": HIT_CACHE,
        "X-Image-Source": "wikipedia",
      },
    });
  } catch (err) {
    console.error("Vehicle image lookup failed:", err);
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } });
  }
}
