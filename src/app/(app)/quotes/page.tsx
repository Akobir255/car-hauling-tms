import { PipelineList } from "@/components/pipeline-list";

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; rep?: string; page?: string }>;
}) {
  const { tab, rep, page } = await searchParams;
  return (
    <PipelineList
      page={page}
      stage="quote"
      title="Quotes"
      description="Priced — edit, or convert to an order to book it."
      tab={tab}
      rep={rep}
    />
  );
}
