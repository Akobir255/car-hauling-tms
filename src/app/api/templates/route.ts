import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// Templates for the pick-and-send sheets. Fetched on demand rather than
// shipped with every list page — the library is 50+ rows and most page views
// never open a composer.
export async function GET(req: NextRequest) {
  await requireProfile();
  const channel = req.nextUrl.searchParams.get("channel") === "email" ? "email" : "sms";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, name, channel, subject, body")
    .eq("channel", channel)
    .order("name");
  if (error) return NextResponse.json({ templates: [], error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}
