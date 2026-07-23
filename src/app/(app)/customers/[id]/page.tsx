import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { Customer, Profile } from "@/types/database";
import { CustomerForm } from "../customer-form";
import { updateCustomer, deleteCustomer } from "../actions";
import { DeleteButton } from "@/components/delete-button";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("*").eq("id", id).single();

  if (!data) notFound();
  const customer = data as Customer;
  const canAssignOwner = profile.role !== "sales";

  let salesReps: Profile[] = [];
  if (canAssignOwner) {
    const { data: reps } = await supabase.from("profiles").select("*").order("full_name");
    salesReps = (reps ?? []) as Profile[];
  }

  const boundUpdate = updateCustomer.bind(null, customer.id);
  const boundDelete = deleteCustomer.bind(null, customer.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{customer.contact_name}</h1>
        {profile.role === "admin" && (
          <DeleteButton
            onDelete={boundDelete}
            confirmMessage={`Delete customer "${customer.contact_name}"? This cannot be undone.`}
          />
        )}
      </div>
      <CustomerForm
        action={boundUpdate}
        customer={customer}
        salesReps={salesReps}
        canAssignOwner={canAssignOwner}
      />
    </div>
  );
}
