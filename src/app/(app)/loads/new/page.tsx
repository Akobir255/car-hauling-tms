import { requireRole } from "@/lib/auth";
import { NewLoadForm } from "./new-load-form";

export default async function NewLoadPage() {
  await requireRole("admin", "dispatcher", "sales");

  return (
    <div className="space-y-6">
      <h1 className="text-[15px]">New load</h1>
      <NewLoadForm />
    </div>
  );
}
