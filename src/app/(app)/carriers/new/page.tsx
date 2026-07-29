import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { CarrierForm } from "../carrier-form";
import { createCarrier } from "../actions";

export const metadata: Metadata = { title: "Add carrier" };

export default async function NewCarrierPage() {
  await requireRole("admin", "dispatcher");

  return (
    <div className="space-y-6">
      <h1 className="text-[15px]">Add carrier</h1>
      <CarrierForm action={createCarrier} />
    </div>
  );
}
