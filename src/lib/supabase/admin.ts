import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Server-only: never import
// this from a Client Component, and never send SUPABASE_SERVICE_ROLE_KEY to
// the browser. Used solely for admin user management (creating/deactivating
// Supabase Auth accounts), which the Auth Admin API requires.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
