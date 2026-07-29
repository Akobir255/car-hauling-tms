import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

// Since migration 0037, ownership is an EDIT boundary rather than a
// VISIBILITY one: anyone on staff can open any order or shipper — by number,
// by name, by phone, by carrier — and a sales rep still changes only the ones
// assigned to them. Managers work the whole board.
//
// The database enforces the write half (the update policies never widened).
// These helpers exist because RLS enforces it SILENTLY: an UPDATE that matches
// no row is not an error in PostgREST, it is a successful no-op. Without them
// a rep would press Save on somebody else's order, see no complaint, and
// believe the change landed.

export const NOT_YOURS =
  "This record belongs to another rep. You can open it, but only its owner, a dispatcher or an admin can change it.";

/** Read-only for this viewer? Both loads and customers carry sales_owner_id. */
export function canEdit(
  record: { sales_owner_id?: string | null } | null | undefined,
  profile: Profile
): boolean {
  if (profile.role !== "sales") return true;
  return Boolean(record) && record!.sales_owner_id === profile.id;
}

/**
 * Server-side twin of canEdit, for actions that only receive an id.
 * Returns an error message when the write must not go ahead, else null.
 */
export async function blockedFromWriting(
  table: "loads_sales_safe" | "customers",
  id: string,
  profile: Profile
): Promise<string | null> {
  if (profile.role !== "sales") return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from(table)
    .select("sales_owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return "Not found.";
  return data.sales_owner_id === profile.id ? null : NOT_YOURS;
}

/** Same question for an order, which is the only thing most actions touch. */
export function blockedFromWritingLoad(id: string, profile: Profile): Promise<string | null> {
  return blockedFromWriting("loads_sales_safe", id, profile);
}
