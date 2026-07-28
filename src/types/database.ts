// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Regenerate with `supabase gen types typescript` once a live project exists,
// and replace this file with the generated output.

export type UserRole = "admin" | "dispatcher" | "sales";

export type LoadStatus =
  | "lead"
  | "quote"
  | "ready"
  | "posted_cd"
  | "posted_sd"
  | "booked"
  | "dispatched"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "hold"
  | "archived"
  | "lost"
  | "invoiced"
  | "paid"
  | "cancelled";

export type TransportType = "open" | "enclosed" | "driveaway";
export type VehicleType =
  | "sedan"
  | "suv"
  | "pickup"
  | "van"
  | "motorcycle"
  | "boat"
  | "rv"
  | "atv"
  | "trailer"
  | "heavy_equipment"
  | "other";
export type VehicleCondition = "running" | "non_running";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  phone: string | null;
  active: boolean;
  created_at: string;
}

export interface Carrier {
  id: string;
  company_name: string;
  mc_number: string | null;
  dot_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  insurance_carrier: string | null;
  insurance_policy_number: string | null;
  coi_expiry_date: string | null;
  equipment_types: string[];
  safety_rating: string | null;
  preferred: boolean;
  blacklisted: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  company_name: string | null;
  contact_name: string;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  sales_owner_id: string | null;
  source: string | null;
  notes: string | null;
  sms_opt_out: boolean;
  email_opt_out: boolean;
  blacklisted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Load {
  id: string;
  load_number: string;
  customer_id: string;
  carrier_id: string | null;
  status: LoadStatus;
  pickup_address: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_zip: string | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  pickup_ready_date: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_zip: string | null;
  delivery_contact_name: string | null;
  delivery_contact_phone: string | null;
  delivery_eta: string | null;
  transport_type: TransportType;
  distance_miles: number | null;
  customer_rate: number | null;
  carrier_pay: number | null;
  deposit_amount: number | null;
  balance_due: number | null;
  sales_owner_id: string | null;
  dispatcher_id: string | null;
  posted_to_central_dispatch_at: string | null;
  cd_external_id: string | null;
  posted_to_super_dispatch_at: string | null;
  sd_external_id: string | null;
  cancelled_reason: string | null;
  follow_up_at: string | null;
  follow_up_note: string | null;
  notes: string | null;
  received_amount: number | null;
  carrier_received: number | null;
  cod_to_carrier: number | null;
  date_signed: string | null;
  contract_token: string | null;
  contract_sent_at: string | null;
  contract_signed_ip: string | null;
  contract_signed_name: string | null;
  contract_signed_email: string | null;
  contract_requires_card: boolean;
  /** Imported order: a contract went out, but the old system never recorded when. */
  contract_sent: boolean;
  // The old system's verbatim status word on imported records (null for
  // anything created here) — shown in lists so they read identically.
  msgplane_status: string | null;
  // Where this order should be posted: "all" | "cd" | "sd" (null = ask).
  loadboard: string | null;
  balance_paid_by: string | null;
  cod_method: string | null;
  payment_terms: string | null;
  terms_begin: string | null;
  payment_method: string | null;
  invoice_payment_method: string | null;
  driver_first_name: string | null;
  driver_last_name: string | null;
  driver_phone: string | null;
  cd_note: string | null;
  dispatch_instructions: string | null;
  pickup_buyer_number: string | null;
  delivery_buyer_number: string | null;
  dispatched_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  lost_reason: string | null;
  campaign: string | null;
  shipper_info: string | null;
  pickup_company: string | null;
  pickup_contact_cell: string | null;
  delivery_company: string | null;
  delivery_contact_cell: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoadVehicle {
  id: string;
  load_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  vehicle_type: VehicleType;
  condition: VehicleCondition;
  tariff: number | null;
  deposit: number | null;
  plate: string | null;
  plate_state: string | null;
  lot_number: string | null;
  color: string | null;
  /** Uploaded photo in the private bucket; overrides the make/model lookup. */
  photo_path: string | null;
  notes: string | null;
  created_at: string;
}

// A carrier offer logged by hand against an order (msgplane's Load Requests).
export interface LoadRequest {
  id: string;
  load_id: string;
  price: number | null;
  requested_on: string;
  carrier_id: string | null;
  carrier_name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  source: "cd" | "sd" | null;
  created_by: string | null;
  created_at: string;
}

// One "send" of the customer contract. loads.* mirrors the CURRENT version.
export interface ContractVersion {
  id: string;
  load_id: string;
  token: string;
  requires_card: boolean;
  tariff: number | null;
  deposit: number | null;
  note: string | null;
  sent_at: string | null;
  sent_via: string | null;
  superseded_at: string | null;
  signed_at: string | null;
  signed_name: string | null;
  signature_image: string | null;
  created_by: string | null;
  created_at: string;
}

// Masked card details from a card-required contract. Full number and CVV are
// never stored — real vaulting arrives with the payment processor.
export interface ContractCard {
  id: string;
  load_id: string;
  contract_version_id: string | null;
  cardholder_first: string;
  cardholder_last: string;
  brand: string | null;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  created_at: string;
}

export interface LoadStatusHistoryEntry {
  id: string;
  load_id: string;
  status: LoadStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
}

export type MessageChannel = "sms" | "email" | "internal_note";
export type MessageStatus = "queued" | "sent" | "delivered" | "failed";

export interface Message {
  id: string;
  load_id: string | null;
  carrier_id: string | null;
  customer_id: string | null;
  channel: MessageChannel;
  direction: "inbound" | "outbound";
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null; // email only
  body: string;
  provider_message_id: string | null;
  status: MessageStatus;
  sent_by: string | null;
  read_at: string | null;
  created_at: string;
}

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const TICKET_STATUSES: TicketStatus[] = ["open", "pending", "resolved", "closed"];
export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export interface Ticket {
  id: string;
  ticket_number: number;
  subject: string;
  body: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  load_id: string | null;
  customer_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  body: string;
  author_id: string | null;
  created_at: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const LOAD_STATUSES: LoadStatus[] = [
  "lead",
  "quote",
  "ready",
  "posted_cd",
  "posted_sd",
  "booked",
  "dispatched",
  "picked_up",
  "in_transit",
  "delivered",
  "hold",
  "archived",
  "lost",
  "invoiced",
  "paid",
  "cancelled",
];

export const VEHICLE_TYPES: VehicleType[] = [
  "sedan",
  "suv",
  "pickup",
  "van",
  "motorcycle",
  "boat",
  "rv",
  "atv",
  "trailer",
  "heavy_equipment",
  "other",
];

// Industry labels shown in the UI. The stored enum values stay as-is (pricing
// and the DB depend on them) — this is display only.
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  sedan: "Car",
  suv: "SUV",
  pickup: "Pickup Truck",
  van: "Van",
  motorcycle: "Motorcycle",
  boat: "Boat",
  rv: "RV / Motorhome",
  atv: "ATV / UTV",
  trailer: "Trailer",
  heavy_equipment: "Heavy Equipment",
  other: "Other",
};
