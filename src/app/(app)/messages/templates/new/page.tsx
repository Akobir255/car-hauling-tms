import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { TemplateForm } from "../template-form";
import { saveTemplate } from "../../actions";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage() {
  await requireProfile();
  const boundSave = saveTemplate.bind(null, null);

  return (
    <div className="space-y-6">
      <h1 className="text-[15px]">New template</h1>
      <TemplateForm action={boundSave} />
    </div>
  );
}
