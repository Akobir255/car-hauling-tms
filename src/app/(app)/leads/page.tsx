import { PipelineList } from "@/components/pipeline-list";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string }>;
}) {
  const { rep } = await searchParams;
  return (
    <PipelineList
      stage="lead"
      title="Leads"
      description="New inquiries — add a price to move them to Quotes."
      rep={rep}
    />
  );
}
