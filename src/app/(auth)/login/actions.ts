"use server";

import { redirect } from "next/navigation";
import { startPendingLogin } from "@/lib/pending-login";

export type LoginState = { error: string | null };

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = (formData.get("email") || "").toString().trim();
  const password = (formData.get("password") || "").toString();
  const next = (formData.get("next") || "").toString();

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // A correct password does NOT sign anyone in. It starts a challenge and
  // nothing else — no session, no access token, nothing that authorises a
  // request against the database. The session is minted on /verify, after the
  // emailed code checks out.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  const error = await startPendingLogin(email, password, safeNext);
  if (error) return { error };

  redirect("/verify");
}
