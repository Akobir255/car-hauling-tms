import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clampSessionCookie } from "./cookie-lifetime";

// Server Component / Server Action client — reads the user's session from
// cookies so RLS policies apply as that user, not as the service role.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, clampSessionCookie(options))
            );
          } catch {
            // Called from a Server Component (not a Server Action/Route
            // Handler) — the middleware refreshes the session instead, so
            // this can be safely ignored.
          }
        },
      },
    }
  );
}
