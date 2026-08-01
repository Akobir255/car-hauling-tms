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

// Next 16's route-segment-config docs: for Server Actions, maxDuration is set
// "at the page level to change the default timeout of all Server Actions used
// on the page" — an export from actions.ts does nothing. 120s sits over the
// 90s SDK timeout in extract-intake.ts with room for the upload and the audit
// insert, so the platform never kills the action before its never-throw
// handling and the ai_extractions row have run.
export const maxDuration = 120;

export default async function IntakePage() {
  const profile = await requireRole("admin", "dispatcher", "sales");
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
          {profile.role === "admin" && (
            <p className="mt-2 text-sm">
              <Link href="/admin/ai" className="text-ord-accent">
                AI intake telemetry →
              </Link>
            </p>
          )}
        </div>
      ) : (
        <IntakeForm />
      )}
    </div>
  );
}
