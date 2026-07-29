"use server";

import { redirect } from "next/navigation";
import {
  clearPendingCookie,
  completePendingLogin,
  resendPendingCode,
} from "@/lib/pending-login";

export type VerifyState = { error: string | null; sent: boolean };

// Nothing identifying comes from the form. Which login is being completed is
// read from an httpOnly cookie set at the password step, so a submitted code
// can only ever be checked against the caller's own pending login.

export async function sendCode(_prev: VerifyState, _formData: FormData): Promise<VerifyState> {
  const error = await resendPendingCode();
  return { error, sent: !error };
}

export async function submitCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const r = await completePendingLogin((formData.get("code") || "").toString());
  if (r.ok) redirect(r.nextPath);

  // A wrong code is spent — one attempt each. Send the next one straight away
  // rather than making someone hunt for a resend link; the per-login send cap
  // is what stops this turning into a mail bomb.
  if (r.error === "Enter the 6-digit code from your email.") {
    return { error: r.error, sent: true };
  }
  const resendError = await resendPendingCode();
  return {
    error: resendError ? resendError : `${r.error} A new code is on its way — check your email.`,
    sent: true,
  };
}

export async function abandon(): Promise<void> {
  await clearPendingCookie();
  redirect("/login");
}
