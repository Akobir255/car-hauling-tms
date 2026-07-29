import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canEdit } from "@/lib/record-access";
import type { Customer, Message, Profile } from "@/types/database";
import { CustomerForm } from "../customer-form";
import { updateCustomer, deleteCustomer } from "../actions";
import { sendReply } from "../../messages/actions";
import { SmsThread } from "../sms-thread";
import { DeleteButton } from "@/components/delete-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toE164 } from "@/lib/messaging/ringcentral";

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
  // Shippers are searchable by anyone since 0037 — by name, phone or email —
  // so this page now opens for people who do not own the account.
  const readOnly = !canEdit(customer, profile);

  let salesReps: Profile[] = [];
  if (canAssignOwner) {
    const { data: reps } = await supabase.from("profiles").select("*").order("full_name");
    salesReps = (reps ?? []) as Profile[];
  }
  const owner = customer.sales_owner_id
    ? ((
        await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", customer.sales_owner_id)
          .maybeSingle()
      ).data as Pick<Profile, "full_name" | "email"> | null)
    : null;

  const { data: messagesData } = await supabase
    .from("messages")
    .select("*")
    .eq("customer_id", customer.id)
    .eq("channel", "sms")
    .order("created_at", { ascending: true })
    .limit(200);
  const messages = (messagesData ?? []) as Message[];

  const boundUpdate = updateCustomer.bind(null, customer.id);
  const boundDelete = deleteCustomer.bind(null, customer.id);
  const boundReply = sendReply.bind(null, customer.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px]">{customer.contact_name}</h1>
        {profile.role === "admin" && (
          <DeleteButton
            onDelete={boundDelete}
            confirmMessage={`Delete customer "${customer.contact_name}"? This cannot be undone.`}
          />
        )}
      </div>
      {readOnly && (
        <p className="rounded-lg border border-chart-2 bg-chart-2/15 px-4 py-2.5 text-sm">
          Read-only —{" "}
          {owner ? (
            <>this shipper belongs to {owner.full_name || owner.email}.</>
          ) : (
            <>this shipper has no owner yet.</>
          )}{" "}
          <span className="text-muted-foreground">
            Their details are here so you can answer a call about them; only{" "}
            {owner ? "they, a dispatcher or an admin" : "a dispatcher or an admin"} can change the
            account.
          </span>
        </p>
      )}
      <CustomerForm
        action={boundUpdate}
        customer={customer}
        salesReps={salesReps}
        canAssignOwner={canAssignOwner}
        readOnly={readOnly}
      />
      {/* The thread itself is still owner-scoped in the database, so this
          section has nothing to show a visitor and would only invite them to
          text somebody else's shipper. */}
      {!readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>SMS conversation</CardTitle>
          </CardHeader>
          <CardContent>
            <SmsThread
              messages={messages}
              action={boundReply}
              optedOut={customer.sms_opt_out}
              hasPhone={toE164(customer.phone) !== null}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
