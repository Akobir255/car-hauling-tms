import { createClient } from "@/lib/supabase/server";

// What a browser tab and a history row show. Both truncate from the RIGHT, so
// the identifying value has to lead: "32048715-US · Broker TMS", never the
// other way round. The suffix comes from the template in app/layout.tsx.
//
// One narrow query per title, deliberately. A title is not worth a second
// round trip to Supabase in the document head, which is why an order is its
// NUMBER alone — the shipper's name lives on another table and fetching it
// would put the head behind two sequential remote calls.

async function field(table: string, id: string, column: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from(table).select(column).eq("id", id).maybeSingle();
  const value = (data as Record<string, unknown> | null)?.[column];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * loads_sales_safe rather than loads_full: it is granted to every staff role
 * (0013) and a load_number is not one of the margin columns, so the title does
 * not have to ask who is looking first.
 */
export const loadNumber = (id: string) => field("loads_sales_safe", id, "load_number");
export const customerName = (id: string) => field("customers", id, "contact_name");
export const carrierName = (id: string) => field("carriers", id, "company_name");
export const ticketSubject = (id: string) => field("tickets", id, "subject");
export const templateName = (id: string) => field("message_templates", id, "name");
