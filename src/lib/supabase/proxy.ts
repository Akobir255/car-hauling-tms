import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/security-headers";

// /sign/<token> is the customer-facing contract page — no login, reached from
// an SMS/email link. It authenticates by the unguessable token, not a session.
// The vehicle-image proxy is public with it: the contract shows the car's
// photo, and the route only serves cached Wikipedia page images by make/model.
// /verify is reached with a correct password but NO session — the session is
// only minted once the emailed code is accepted — so it has to be public to
// the middleware. Its own httpOnly cookie is what authorises it.
// /t/<token> is the driver's location page and /track/<token> the customer's,
// both reached from a text message with no account behind them (0050). Same
// contract as /sign: an unguessable token, validated server-side on every
// request, standing in for a session. Neither page renders anything the holder
// of that token should not see -- the driver gets an order number, the customer
// gets status and a distance.
const PUBLIC_PATHS = [
  "/login",
  "/verify",
  "/set-password",
  "/sign",
  "/t",
  "/track",
  "/api/vehicles/image",
];

// Telephony endpoints authenticate themselves (carrier signature / shared
// token) and must never be redirected to /login — a carrier that follows a
// 307 to an HTML page records the delivery as failed and eventually disables
// the webhook. NOTE: this bypass is prefix-based, so anything added under
// /api/telephony must do its own authentication.
// /api/track/<token> is the driver PWA's position ingest. It carries a token,
// not a cookie, and a phone that follows a 307 to an HTML login page just loses
// the fix. NOTE the warning above applies with full force: this bypass is
// prefix-based, so that handler authenticates itself -- token, kind, expiry,
// load state and rate limit are all checked there.
const SELF_AUTHENTICATING_PREFIXES = ["/api/telephony", "/api/track"];

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // One nonce per request. Setting the CSP on the REQUEST headers is what lets
  // Next.js find the nonce and stamp it onto its inline hydration scripts;
  // setting it on the response is what makes the browser enforce it.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  const withCspRequestHeaders = (req: NextRequest) => {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    return headers;
  };

  const applyCsp = (res: NextResponse) => {
    res.headers.set("content-security-policy", csp);
    return res;
  };

  if (SELF_AUTHENTICATING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // No CSP on machine-to-machine endpoints: it protects browsers, and these
    // are never rendered in one.
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request: { headers: withCspRequestHeaders(request) },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request: { headers: withCspRequestHeaders(request) },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshes the auth token if needed — required by @supabase/ssr.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return applyCsp(NextResponse.redirect(url));
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return applyCsp(NextResponse.redirect(url));
  }

  return applyCsp(supabaseResponse);
}
