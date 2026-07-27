import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// Carrier-name autocomplete for the Load Requests band and the Dispatch
// panel — top matches from the ~4.7k directory. RLS-scoped like everything.

export type CarrierSuggestion = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
};

// Same double-quote escaping as /api/search — PostgREST's or=() grammar
// treats , . ( ) as structure, so patterns must be quoted literals.
function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}

export async function GET(req: NextRequest) {
  await requireProfile();
  const raw = (req.nextUrl.searchParams.get("q") || "").trim();
  if (raw.length < 2) return NextResponse.json({ carriers: [] as CarrierSuggestion[] });

  const term = raw.slice(0, 60);
  const pat = likePattern(term);
  const digits = term.replace(/\D/g, "");
  const filters = [`company_name.ilike.${pat}`];
  if (digits.length >= 4) filters.push(`phone_digits.ilike.${likePattern(digits)}`);

  const supabase = await createClient();
  const { data } = await supabase
    .from("carriers")
    .select("id, company_name, phone, city, state, source")
    .or(filters.join(","))
    .order("company_name")
    .limit(8);

  const carriers: CarrierSuggestion[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.company_name,
    phone: c.phone,
    city: c.city,
    state: c.state,
    source: c.source,
  }));
  return NextResponse.json({ carriers });
}
