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
export type VehicleType = "sedan" | "suv" | "pickup" | "van" | "motorcycle" | "other";
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
  notes: string | null;
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
  body: string;
  provider_message_id: string | null;
  status: MessageStatus;
  sent_by: string | null;
  read_at: string | null;
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
  "other",
];
