import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentSessionId, isSessionVerified } from "@/lib/login-verification";
import type { Profile, UserRole } from "@/types/database";

// The signed-in user's profile WITHOUT the second-factor gate. Only the
// /verify screen may use this — it has to know who is signing in in order to
// email them a code, which is exactly the moment the gate is still shut.
export async function getSessionProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data as Profile | null;
}

/** Has this session cleared the emailed second factor? */
export async function isCurrentSessionVerified(userId: string): Promise<boolean> {
  const sessionId = await currentSessionId();
  if (!sessionId) return false;
  return isSessionVerified(sessionId, userId);
}

// Fetches the signed-in user's profile (role, name, etc). Returns null if
// there is no session — and also if the session has not cleared the emailed
// second factor. Every caller already treats null as "not signed in", so the
// gate fails closed through API routes as well as pages.
export async function getCurrentProfile(): Promise<Profile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  if (!(await isCurrentSessionVerified(profile.id))) return null;
  return profile;
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  if (!profile.active) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }
  // A session now only comes into existence AFTER the emailed code is
  // accepted, so an unverified one is stale by definition — a cookie from
  // before this shipped, or one obtained some way that skipped /verify. Ending
  // it is both the safe answer and the only non-looping one: redirecting to
  // /verify sends a visitor with no pending login on to /login, which the
  // middleware bounces straight back here for having a session.
  if (!(await isCurrentSessionVerified(profile.id))) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }
  return profile;
}

export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/dashboard");
  return profile;
}
