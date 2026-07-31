import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/flags";
import { isAiConfigured } from "@/lib/ai/extract-intake";
import { IntakeForm } from "./intake-form";

// Phase 3's entry point. Dark until the ai_intake flag is on, and honest about
// the difference between "switched off" and "not configured" — the second is a
// missing ANTHROPIC_API_KEY, which is an operator problem, not a user one.

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("ai_intake"))) notFound();

  return (
    <div className="space-y-6 p-1">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Read an order</h1>
        <p className="text-sm text-muted-foreground">
          Paste an email or attach a load sheet. You get a draft to check — nothing is created
          until you confirm it.
        </p>
      </header>

      {!isAiConfigured() ? (
        <div className="max-w-2xl rounded-md border p-4">
          <p className="text-sm font-bold">Not configured on this deployment</p>
          <p className="mt-1 text-sm text-muted-foreground">
            ANTHROPIC_API_KEY is not set, so documents can&apos;t be read. Add it in the Vercel
            project settings and redeploy.{" "}
            <Link href="/loads/new" className="text-ord-accent">
              Enter the order manually
            </Link>{" "}
            in the meantime.
          </p>
        </div>
      ) : (
        <IntakeForm />
      )}
    </div>
  );
}
