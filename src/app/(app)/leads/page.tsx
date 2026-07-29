import type { Metadata } from "next";
import { PipelineList } from "@/components/pipeline-list";

export const metadata: Metadata = { title: "Leads" };

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
    age?: string;
    sms?: string;
  }>;
}) {
  const { tab, rep, page, optout, signed, docs, vehicles, age, sms } = await searchParams;
  return (
    <PipelineList
      page={page}
      stage="lead"
      title="Leads"
      description="New inquiries — add a price to move them to Quotes."
      tab={tab}
      rep={rep}
      filters={{ optout, signed, docs, vehicles, age, sms }}
    />
  );
}
