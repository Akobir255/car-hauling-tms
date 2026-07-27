import { PipelineList } from "@/components/pipeline-list";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    rep?: string;
    page?: string;
    optout?: string;
    signed?: string;
    docs?: string;
    vehicles?: string;
  }>;
}) {
  const { tab, rep, page, optout, signed, docs, vehicles } = await searchParams;
  return (
    <PipelineList
      page={page}
      stage="order"
      title="Orders"
      description="Converted orders — post to a board, dispatch, and track."
      tab={tab}
      rep={rep}
      filters={{ optout, signed, docs, vehicles }}
    />
  );
}
