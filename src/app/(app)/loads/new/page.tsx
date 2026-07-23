import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { Customer } from "@/types/database";
import { NewLoadForm } from "./new-load-form";

export default async function NewLoadPage() {
  await requireRole("admin", "dispatcher", "sales");
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("*").order("contact_name");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New load</h1>
      <NewLoadForm customers={(data ?? []) as Customer[]} />
    </div>
  );
}
