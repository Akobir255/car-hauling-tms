// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Regenerate with `supabase gen types typescript` once a live project exists,
// and replace this file with the generated output.

export type UserRole = "admin" | "dispatcher" | "sales";

export type LoadStatus =
  | "quote"
  | "booked"
  | "dispatched"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "invoiced"
  | "paid"
  | "cancelled";

export type TransportType = "open" | "enclosed";
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

export const LOAD_STATUSES: LoadStatus[] = [
  "quote",
  "booked",
  "dispatched",
  "picked_up",
  "in_transit",
  "delivered",
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
