import { NextRequest, NextResponse } from "next/server";
import { MANAGER_LOADS_TABLE } from "@/lib/loads-table";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// Global search across shippers, carriers and orders — the omnibox in the
// sidebar. Reads go through the caller's session client, so RLS decides what
// each role can see (sales only their own customers/loads); loads are read
// through the role-appropriate view, never the base table.

export type SearchHit = {
  kind: "customer" | "carrier" | "load";
  id: string;
  title: string;
  detail: string;
  href: string;
};

// Two layers of escaping are needed here:
//  1. LIKE wildcards (% _ \) so a stray % isn't a wildcard search;
//  2. PostgREST's `or=(...)` grammar, which treats , . ( ) : as structure —
//     a phone typed as "(865) 328-7418" would otherwise corrupt the filter
//     and silently return nothing. Wrapping the pattern in double quotes
//     makes it a literal; inner quotes and backslashes get escaped.
function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}

export async function GET(req: NextRequest) {
  const profile = await requireProfile();
  const raw = (req.nextUrl.searchParams.get("q") || "").trim();
  if (raw.length < 2) return NextResponse.json({ hits: [] as SearchHit[] });

  const term = raw.slice(0, 60);
  const pat = likePattern(term);
  const digits = term.replace(/\D/g, "");
  const digitPat = likePattern(digits);
  const supabase = await createClient();
  const hits: SearchHit[] = [];

  // phone_digits is a generated column (migration 0017) holding the number
  // stripped to digits, so a search matches however the number was typed.
  const customerFilters = [
    `contact_name.ilike.${pat}`,
    `company_name.ilike.${pat}`,
    `email.ilike.${pat}`,
  ];
  if (digits.length >= 4) customerFilters.push(`phone_digits.ilike.${digitPat}`);

  const carrierFilters = [
    `company_name.ilike.${pat}`,
    `contact_name.ilike.${pat}`,
    `city.ilike.${pat}`,
  ];
  if (digits.length >= 4) carrierFilters.push(`phone_digits.ilike.${digitPat}`);

  const [customers, carriers, loads] = await Promise.all([
    supabase
      .from("customers")
      .select("id, contact_name, company_name, phone, email")
      .or(customerFilters.join(","))
      .limit(6),
    supabase
      .from("carriers")
      .select("id, company_name, contact_name, phone, city, state, source")
      .or(carrierFilters.join(","))
      .limit(6),
    supabase
      .from(profile.role === "sales" ? "loads_sales_safe" : MANAGER_LOADS_TABLE)
      .select("id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state")
      .ilike("load_number", `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      .limit(5),
  ]);

  for (const c of customers.data ?? []) {
    hits.push({
      kind: "customer",
      id: c.id,
      title: c.contact_name || c.company_name || "Shipper",
      detail: [c.company_name, c.phone, c.email].filter(Boolean).join(" · "),
      href: `/customers/${c.id}`,
    });
  }
  for (const c of carriers.data ?? []) {
    hits.push({
      kind: "carrier",
      id: c.id,
      title: c.company_name,
      detail: [
        c.contact_name,
        [c.city, c.state].filter(Boolean).join(", "),
        c.phone,
        c.source ? c.source.toUpperCase() : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/carriers/${c.id}`,
    });
  }
  for (const l of loads.data ?? []) {
    hits.push({
      kind: "load",
      id: l.id,
      title: l.load_number,
      detail: [
        l.status,
        [l.pickup_city, l.pickup_state].filter(Boolean).join(", "),
        [l.delivery_city, l.delivery_state].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(" → "),
      href: `/loads/${l.id}`,
    });
  }

  return NextResponse.json({ hits });
}
