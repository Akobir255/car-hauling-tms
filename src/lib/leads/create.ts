import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedLead } from "./normalize";

// The shared "turn a normalized lead into a load" step, used by every inbound
// path — the JSON webhook and the email webhook both call this, so a lead
// arrives the same way and is deduped the same way regardless of how it came
// in. Kept out of the route handlers because it is the part that must not
// drift between them.
//
// Writes with the service role, and ONLY the four things a lead consists of:
// a customer, a load at stage `lead`, its vehicle, and the attribution row.
// It never touches a margin column. The caller owns auth, rate limiting, body
// limits and the receipt log; this owns the database shape.

export type CreateLeadResult =
  | { duplicate: true; loadId: string }
  | { duplicate: false; loadId: string; loadNumber: string; assigned: boolean };

// Match an existing customer before making another one. `phone_digits` is the
// generated column (0017) the rest of the app dedupes on; email is the
// fallback for web-form providers that collect no phone. Hidden rows are
// excluded on purpose — 0052 hid the old book, and matching a live lead onto a
// hidden record would attach new work to an invisible row.
async function findCustomer(
  supabase: SupabaseClient,
  lead: NormalizedLead
): Promise<string | null> {
  if (lead.phone) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("phone_digits", lead.phone)
      .is("hidden_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  if (lead.email) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .ilike("email", lead.email)
      .is("hidden_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

/**
 * Create (or dedupe) a lead. Throws on a hard database failure so the caller
 * can keep the raw payload in its receipt log; returns a duplicate result
 * without writing when this source has already sent this source_ref.
 */
export async function createLeadFromNormalized(
  supabase: SupabaseClient,
  lead: NormalizedLead,
  source: string,
  sourceRef: string | null
): Promise<CreateLeadResult> {
  // Dedupe. Providers retry and resend; the unique index on
  // (source, source_ref) is the real guard, this makes the answer cheap and
  // hands the provider its original load id back.
  if (sourceRef) {
    const { data: existing } = await supabase
      .from("lead_intake")
      .select("load_id")
      .eq("source", source)
      .eq("source_ref", sourceRef)
      .maybeSingle();
    if (existing?.load_id) {
      return { duplicate: true, loadId: existing.load_id as string };
    }
  }

  let customerId = await findCustomer(supabase, lead);
  if (!customerId) {
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        contact_name: lead.contactName || "Unknown (web lead)",
        phone: lead.phone,
        email: lead.email,
        source: `lead:${source}`,
      })
      .select("id")
      .single();
    if (error) throw new Error(`customer insert: ${error.message}`);
    customerId = created.id as string;
  }

  const { data: seq, error: seqError } = await supabase.rpc("next_load_number");
  if (seqError) throw new Error(`next_load_number: ${seqError.message}`);

  const { data: owner } = await supabase.rpc("next_lead_owner");

  const { data: load, error: loadError } = await supabase
    .from("loads")
    .insert({
      load_number: `${seq}-US`,
      customer_id: customerId,
      // Set STATUS, not pipeline_stage. trg_loads_pipeline_stage (0030)
      // derives the stage from the status on insert, so a row inserted with
      // only pipeline_stage would have it overwritten to 'quote'.
      status: "lead",
      sales_owner_id: owner ?? null,
      transport_type: lead.transportType,
      pickup_city: lead.originCity,
      pickup_state: lead.originState,
      pickup_zip: lead.originZip,
      delivery_city: lead.destCity,
      delivery_state: lead.destState,
      delivery_zip: lead.destZip,
      pickup_ready_date: lead.readyDate,
      notes: lead.notes,
    })
    .select("id, load_number")
    .single();
  if (loadError) throw new Error(`load insert: ${loadError.message}`);

  if (lead.vehicleYear || lead.vehicleMake || lead.vehicleModel) {
    const { error: vErr } = await supabase.from("load_vehicles").insert({
      load_id: load.id,
      year: lead.vehicleYear,
      make: lead.vehicleMake,
      model: lead.vehicleModel,
      condition: lead.operable ? "running" : "non_running",
    });
    // A bad vehicle row must not cost us the lead — a rep can add the car.
    if (vErr) console.error(`lead ${load.id} vehicle insert failed:`, vErr.message);
  }

  const { error: attrError } = await supabase.from("lead_intake").insert({
    load_id: load.id,
    source,
    source_ref: sourceRef,
  });
  if (attrError) throw new Error(`lead_intake insert: ${attrError.message}`);

  return {
    duplicate: false,
    loadId: load.id as string,
    loadNumber: load.load_number as string,
    assigned: Boolean(owner),
  };
}
