import { NextRequest, NextResponse } from "next/server";
import {
  normalizeVehicleImageParams,
  standInForType,
  wikiTitleCandidates,
  type VehicleImageParams,
} from "@/lib/vehicles/image";

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
  // in the PRIVATE bucket and is fetched with the service role, so the bucket
  // never becomes public.
  //
  // This branch REQUIRES A SESSION. The route is on the middleware's public
  // list (src/lib/supabase/proxy.ts) so the no-login contract page can show a
  // make/model photo — but that exemption applied to this branch too, which
  // meant a service-role read of customer content behind nothing but a vehicle
  // id. Those ids are printed into every staff order page, so anyone who
  // copied them kept access after their account was gone.
  //
  // Checked: the contract page renders <VehiclePhoto> without a vehicleId
  // (src/app/sign/[token]/page.tsx:317), so it never took this branch and
  // nothing customer-facing changes. A caller without a session falls through
  // to the make/model lookup and gets a model shot, matching how this branch
  // already behaves when the lookup fails.
  const vehicleId = req.nextUrl.searchParams.get("vehicleId");
  if (vehicleId && /^[0-9a-f-]{36}$/i.test(vehicleId)) {
    try {
      const { createClient } = await import("@/lib/supabase/server");
      const {
        data: { user },
      } = await (await createClient()).auth.getUser();

      // No session is an ordinary outcome here, not an error — an anonymous
      // caller must not be able to fill the logs by guessing ids.
      if (user) {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        const { data: vehicle } = await admin
          .from("load_vehicles")
          .select("photo_path")
          .eq("id", vehicleId)
          .maybeSingle();
        // Only ever read back what the uploader wrote: photo-actions.ts stores
        // under `vehicles/<loadId>/...`, so anything else in that column is
        // not a vehicle photo and must not be streamed out of a shared bucket.
        if (vehicle?.photo_path?.startsWith("vehicles/")) {
          const { data: file } = await admin.storage
            .from("load-files")
            .download(vehicle.photo_path);
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
      }
    } catch (err) {
      console.error("Vehicle photo override failed:", err);
      // fall through to the make/model lookup
    }
  }

  // Two attempts, in order: the record's own make/model, then a representative
  // model for the body type.
  //
  // The second is not just for blank fields. Only 39 of 26,000 vehicles have no
  // make/model at all — what actually happens is that the value is there and
  // unresolvable ("2 2 2", "toy", "Trailer 16ft"). Falling back only on a blank
  // field left every one of those on a drawing, which is the whole complaint.
  const attempts = [
    normalizeVehicleImageParams(
      req.nextUrl.searchParams.get("make"),
      req.nextUrl.searchParams.get("model")
    ),
    standInForType(req.nextUrl.searchParams.get("type")),
  ].filter((p): p is NonNullable<typeof p> => p !== null);

  if (attempts.length === 0) {
    return NextResponse.json({ error: "make and model, or a known type, are required" }, { status: 400 });
  }

  async function resolveThumb(params: VehicleImageParams): Promise<string | null> {
    const query = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      redirects: "1",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "480",
      titles: wikiTitleCandidates(params).join("|"),
    });
    const lookup = await fetch(`${WIKI_API}?${query}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6_000),
    });
    if (!lookup.ok) return null;
    const data = await lookup.json();
    const pages: WikiPage[] = data?.query?.pages ?? [];
    const thumb = pages.find((p) => p.thumbnail?.source)?.thumbnail?.source;
    // Only ever fetch from Wikimedia's image host — the URL came from an
    // external API response, so pin the host rather than trusting it.
    if (!thumb || new URL(thumb).hostname !== "upload.wikimedia.org") return null;
    return thumb;
  }

  try {
    let thumb: string | null = null;
    let usedStandIn = false;
    for (let i = 0; i < attempts.length && !thumb; i++) {
      thumb = await resolveThumb(attempts[i]);
      usedStandIn = Boolean(thumb) && i > 0;
    }
    if (!thumb) {
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
        // Lets the caller tell a real model shot from a body-type stand-in.
        "X-Image-Source": usedStandIn ? "wikipedia-standin" : "wikipedia",
      },
    });
  } catch (err) {
    console.error("Vehicle image lookup failed:", err);
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } });
  }
}
