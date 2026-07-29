import type { Metadata } from "next";
import { PipelineList } from "@/components/pipeline-list";

export const metadata: Metadata = { title: "Quotes" };

export default async function QuotesPage({
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
      stage="quote"
      title="Quotes"
      description="Priced — edit, or convert to an order to book it."
      tab={tab}
      rep={rep}
      filters={{ optout, signed, docs, vehicles }}
    />
  );
}
