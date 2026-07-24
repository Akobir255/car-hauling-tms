import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { DeleteButton } from "@/components/delete-button";
import type { MessageTemplate } from "@/types/database";
import { TemplateForm } from "../template-form";
import { saveTemplate, deleteTemplate } from "../../actions";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("message_templates").select("*").eq("id", id).single();
  if (!data) notFound();
  const template = data as MessageTemplate;

  const boundSave = saveTemplate.bind(null, template.id);
  const boundDelete = deleteTemplate.bind(null, template.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{template.name}</h1>
        {(profile.role === "admin" || profile.role === "dispatcher") && (
          <DeleteButton
            onDelete={boundDelete}
            confirmMessage={`Delete template "${template.name}"?`}
          />
        )}
      </div>
      <TemplateForm action={boundSave} template={template} />
    </div>
  );
}
