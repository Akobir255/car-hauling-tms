import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { describePending } from "@/lib/pending-login";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Check your email" };

export default async function VerifyPage() {
  // No session exists yet at this point — that is the entire design. The only
  // thing identifying this visitor is the httpOnly cookie from the password
  // step, and without it there is nothing to verify.
  const pending = await describePending();
  if (!pending) redirect("/login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-md">
        <div className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              We sent a code to confirm it&apos;s you.
            </p>
          </div>
        </div>
        <VerifyForm email={pending.email} />
      </div>
    </div>
  );
}
