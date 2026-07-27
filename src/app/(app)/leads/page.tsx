import { PipelineList } from "@/components/pipeline-list";

export default async function LeadsPage({
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
      stage="lead"
      title="Leads"
      description="New inquiries — add a price to move them to Quotes."
      tab={tab}
      rep={rep}
      filters={{ optout, signed, docs, vehicles }}
    />
  );
}
