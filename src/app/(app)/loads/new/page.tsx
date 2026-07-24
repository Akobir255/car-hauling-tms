import { requireRole } from "@/lib/auth";
import { NewLoadForm } from "./new-load-form";

export default async function NewLoadPage() {
  await requireRole("admin", "dispatcher", "sales");

  return (
    <div className="space-y-6">
      <h1 className="mx-auto max-w-5xl text-2xl font-semibold">New load</h1>
      <NewLoadForm />
    </div>
  );
}
