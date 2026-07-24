import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isSmsConfigured } from "@/lib/messaging/ringcentral";
import type { Customer, MessageTemplate } from "@/types/database";
import { BulkCompose } from "./bulk-compose";

export default async function NewBlastPage() {
  await requireProfile();
  const supabase = await createClient();

  const [{ data: customers }, { data: templates }] = await Promise.all([
    supabase.from("customers").select("*").order("contact_name"),
    supabase.from("message_templates").select("*").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New blast</h1>
        {!isSmsConfigured() && (
          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            RingCentral isn&apos;t connected yet — sends will be logged as{" "}
            <strong>Queued</strong> (nothing actually goes out) until the credentials are added.
            Safe to test with real recipients.
          </p>
        )}
      </div>
      <BulkCompose
        customers={(customers ?? []) as Customer[]}
        templates={(templates ?? []) as MessageTemplate[]}
      />
    </div>
  );
}
