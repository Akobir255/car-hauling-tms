import { PipelineList } from "@/components/pipeline-list";

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string }>;
}) {
  const { rep } = await searchParams;
  return (
    <PipelineList
      stage="quote"
      title="Quotes"
      description="Priced — edit, or convert to an order to book it."
      rep={rep}
    />
  );
}
