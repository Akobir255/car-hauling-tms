import { requireProfile } from "@/lib/auth";
import { TemplateForm } from "../template-form";
import { saveTemplate } from "../../actions";

export default async function NewTemplatePage() {
  await requireProfile();
  const boundSave = saveTemplate.bind(null, null);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New template</h1>
      <TemplateForm action={boundSave} />
    </div>
  );
}
