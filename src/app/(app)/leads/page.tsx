import { PipelineList } from "@/components/pipeline-list";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; rep?: string }>;
}) {
  const { tab, rep } = await searchParams;
  return (
    <PipelineList
      stage="lead"
      title="Leads"
      description="New inquiries — add a price to move them to Quotes."
      tab={tab}
      rep={rep}
    />
  );
}
