import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// Notes for the quick-notes sheet on list rows. Session client: RLS decides
// whether this rep can see the load at all (sales only their own customers').
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ loadId: string }> }
) {
  const profile = await requireProfile();
  const { loadId } = await params;
  const supabase = await createClient();

  const [{ data: notes }, { data: docs }] = await Promise.all([
    supabase
      .from("load_notes")
      .select("id, body, author_id, created_at, updated_at")
      .eq("load_id", loadId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("documents")
      .select("id, note_id, file_name")
      .eq("entity_id", loadId)
      .not("note_id", "is", null),
  ]);

  const authorIds = [...new Set((notes ?? []).map((n) => n.author_id).filter(Boolean))] as string[];
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", authorIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const byId = new Map((authors ?? []).map((a) => [a.id, a]));

  const attachCount = new Map<string, number>();
  for (const d of docs ?? []) {
    if (d.note_id) attachCount.set(d.note_id, (attachCount.get(d.note_id) ?? 0) + 1);
  }

  return NextResponse.json({
    me: profile.id,
    notes: (notes ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      created_at: n.created_at,
      authorName: n.author_id
        ? (byId.get(n.author_id)?.full_name || byId.get(n.author_id)?.email || "Unknown")
        : "Unknown",
      attachments: attachCount.get(n.id) ?? 0,
    })),
  });
}
