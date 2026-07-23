import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { Profile } from "@/types/database";
import { CustomerForm } from "../customer-form";
import { createCustomer } from "../actions";

export default async function NewCustomerPage() {
  const profile = await requireProfile();
  const canAssignOwner = profile.role !== "sales";

  let salesReps: Profile[] = [];
  if (canAssignOwner) {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("*").order("full_name");
    salesReps = (data ?? []) as Profile[];
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add customer</h1>
      <CustomerForm action={createCustomer} salesReps={salesReps} canAssignOwner={canAssignOwner} />
    </div>
  );
}
