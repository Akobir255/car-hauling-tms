// The dispatch-terms vocabulary, captured VERBATIM from msgplane's order
// edit / Edit Dispatch Sheet selects (2026-07-26 tour). One place to edit;
// the DB columns are free text so imports can't violate a CHECK.

export const BALANCE_PAID_BY = [
  "COD to Carrier",
  "COD to Delivery Terminal",
  "COD to Pickup Terminal",
  "COP to Carrier (On Pickup)",
  "Shipper Invoice",
  "Additional Shipper Pre-payment",
] as const;

export const COD_METHOD = ["Cash/Certified Funds", "Check"] as const;

export const PAYMENT_TERMS = [
  "immediately",
  "2 business days (Quick Pay)",
  "5 business days",
  "10 business days",
  "15 business days",
  "30 business days",
] as const;

export const TERMS_BEGIN = [
  "pickup",
  "delivery",
  "receiving a signed Bill of Lading",
] as const;

export const PAYMENT_METHOD = [
  "Cash",
  "Certified Funds",
  "Company Check",
  "Comchek",
  "TCH",
] as const;

export const INVOICE_PAYMENT_METHOD = ["Credit Card with Fee"] as const;

// msgplane's operating defaults, visible on every order's Dispatch
// Information band.
export const DISPATCH_TERM_DEFAULTS = {
  balance_paid_by: "COD to Carrier",
  cod_method: "Cash/Certified Funds",
  payment_terms: "immediately",
  terms_begin: "delivery",
  payment_method: "Cash",
} as const;

export const CD_NOTE_MAX = 60;
