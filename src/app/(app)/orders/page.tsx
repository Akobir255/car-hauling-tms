import { PipelineList } from "@/components/pipeline-list";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; rep?: string; page?: string }>;
}) {
  const { tab, rep, page } = await searchParams;
  return (
    <PipelineList
      page={page}
      stage="order"
      title="Orders"
      description="Converted orders — post to a board, dispatch, and track."
      tab={tab}
      rep={rep}
    />
  );
}
