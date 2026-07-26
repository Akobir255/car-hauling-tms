import type { Customer, Load } from "@/types/database";

// Variables available in message templates. Kept flat and predictable so
// templates read like: "Hi {{first_name}}, your quote for {{route}} is {{quote_price}}."
export type TemplateContext = {
  first_name: string;
  name: string;
  company: string;
  load_number: string;
  route: string;
  pickup_city: string;
  delivery_city: string;
  quote_price: string;
  pickup_date: string;
  // The sending rep's name and the latest load's first vehicle — the two
  // variables the msgplane template library leans on ("Hi {{agent}} with
  // US Star Trucking…", "We can ship your {{vehicle}} for {{quote_price}}").
  agent: string;
  vehicle: string;
};

export const TEMPLATE_VARIABLES: (keyof TemplateContext)[] = [
  "first_name",
  "name",
  "company",
  "load_number",
  "route",
  "pickup_city",
  "delivery_city",
  "quote_price",
  "pickup_date",
  "agent",
  "vehicle",
];

export function buildContext(
  customer: Customer,
  load?: Load | null,
  extras?: { agent?: string; vehicle?: string }
): TemplateContext {
  const name = customer.contact_name || "";
  const route =
    load && (load.pickup_city || load.delivery_city)
      ? `${load.pickup_city ?? "?"}, ${load.pickup_state ?? ""} → ${load.delivery_city ?? "?"}, ${load.delivery_state ?? ""}`
      : "";
  return {
    first_name: name.split(/\s+/)[0] || "there",
    name: name || "there",
    company: customer.company_name || "",
    load_number: load?.load_number ?? "",
    route,
    pickup_city: load?.pickup_city ?? "",
    delivery_city: load?.delivery_city ?? "",
    quote_price: load?.customer_rate != null ? `$${load.customer_rate}` : "",
    pickup_date: load?.pickup_ready_date ?? "",
    agent: extras?.agent ?? "",
    vehicle: extras?.vehicle ?? "",
  };
}

// Replace {{variable}} placeholders; unknown variables are left visible so
// a typo shows up in preview instead of silently disappearing.
export function renderTemplate(body: string, ctx: TemplateContext): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in ctx ? ctx[key as keyof TemplateContext] : match
  );
}
