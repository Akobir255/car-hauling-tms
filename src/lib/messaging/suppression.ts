// The do-not-text list. Server-only.
//
// Read with the service role on purpose: this must answer the same way no
// matter who is sending — a sales rep whose RLS scope excludes a customer
// still must not be able to text a number that opted out.

import { createAdminClient } from "@/lib/supabase/admin";

export function phoneDigits(value: string | null | undefined): string {
  const d = (value || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

export async function isSuppressed(phone: string | null | undefined): Promise<boolean> {
  const digits = phoneDigits(phone);
  if (!digits) return false;
  const { data, error } = await createAdminClient()
    .from("sms_suppressions")
    .select("phone_digits")
    .eq("phone_digits", digits)
    .maybeSingle();
  // Fail CLOSED: if the list can't be read we don't know whether this number
  // opted out, and guessing wrong costs $500-$1,500 a message.
  if (error) throw new Error(`Suppression list unreadable: ${error.message}`);
  return Boolean(data);
}

// Bulk variant — one round trip for a whole chunk instead of one per recipient.
export async function suppressedAmong(
  phones: readonly (string | null | undefined)[]
): Promise<Set<string>> {
  const digits = [...new Set(phones.map(phoneDigits).filter(Boolean))];
  if (digits.length === 0) return new Set();
  const { data, error } = await createAdminClient()
    .from("sms_suppressions")
    .select("phone_digits")
    .in("phone_digits", digits);
  if (error) throw new Error(`Suppression list unreadable: ${error.message}`);
  return new Set((data ?? []).map((r) => r.phone_digits));
}

// Record an opt-out. Idempotent: a second STOP from the same number keeps the
// FIRST one, because the earliest request is the one that binds.
export async function suppressPhone(
  phone: string | null | undefined,
  reason: "stop_reply" | "wrong_number" | "complaint" | "manual" | "import",
  sourceText?: string | null
): Promise<void> {
  const digits = phoneDigits(phone);
  if (!digits) return;
  const { error } = await createAdminClient()
    .from("sms_suppressions")
    .upsert(
      {
        phone_digits: digits,
        reason,
        source_text: sourceText?.slice(0, 500) ?? null,
      },
      { onConflict: "phone_digits", ignoreDuplicates: true }
    );
  if (error) throw new Error(`Could not record opt-out: ${error.message}`);
}

// A START/UNSTOP reply is a real re-consent, so it clears the row.
export async function unsuppressPhone(phone: string | null | undefined): Promise<void> {
  const digits = phoneDigits(phone);
  if (!digits) return;
  const { error } = await createAdminClient()
    .from("sms_suppressions")
    .delete()
    .eq("phone_digits", digits);
  if (error) throw new Error(`Could not clear opt-out: ${error.message}`);
}
