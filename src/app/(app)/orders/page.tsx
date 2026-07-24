import { PipelineList } from "@/components/pipeline-list";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; rep?: string }>;
}) {
  const { tab, rep } = await searchParams;
  return (
    <PipelineList
      stage="order"
      title="Orders"
      description="Converted orders — post to a board, dispatch, and track."
      tab={tab}
      rep={rep}
    />
  );
}
