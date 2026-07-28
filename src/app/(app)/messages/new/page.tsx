import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isSmsConfigured } from "@/lib/messaging/ringcentral";
import { isEmailConfigured } from "@/lib/messaging/email";
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
        <h1 className="text-[15px]">New blast</h1>
        {/* Warning orange from the spec, carried as a tint behind body ink —
            #ff9800 itself is 2:1 as text. */}
        {!isSmsConfigured() && (
          <p className="mt-1 rounded-md border border-chart-2 bg-chart-2/15 px-3 py-2 text-sm text-foreground">
            RingCentral isn&apos;t connected yet — sends will be logged as{" "}
            <strong>Queued</strong> (nothing actually goes out) until the credentials are added.
            Safe to test with real recipients.
          </p>
        )}
      </div>
      <BulkCompose
        customers={(customers ?? []) as Customer[]}
        templates={(templates ?? []) as MessageTemplate[]}
        emailReady={isEmailConfigured()}
      />
    </div>
  );
}
