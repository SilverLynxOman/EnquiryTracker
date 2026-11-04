export type Role = "admin" | "editor" | "viewer";
export type Status = "new" | "quoted" | "confirmed" | "lost" | "cancelled";
export type Closure = "lost" | "cancelled";
export type TradeType = "IMP" | "EXP" | "CT";
export type ShipmentMode = "FCL" | "LCL" | "AIR" | "COURIER" | "RORO" | "BREAK_BULK" | "MULTI" | "OTHER";

export const STATUSES: Status[] = ["new", "quoted", "confirmed", "lost", "cancelled"];
export const TRADE_TYPES: TradeType[] = ["IMP", "EXP", "CT"];
export const SHIPMENT_MODES: ShipmentMode[] = ["FCL", "LCL", "AIR", "COURIER", "RORO", "BREAK_BULK", "MULTI", "OTHER"];

export const TRADE_TYPE_LABELS: Record<TradeType, string> = {
  IMP: "IMP — Import",
  EXP: "EXP — Export",
  CT: "CT — Cross trade",
};

export const MODE_LABELS: Record<ShipmentMode, string> = {
  FCL: "FCL",
  LCL: "LCL",
  AIR: "Air",
  COURIER: "Courier",
  RORO: "RoRo",
  BREAK_BULK: "Break bulk",
  MULTI: "Multiple options",
  OTHER: "Other",
};

export interface Profile {
  id: string;
  full_name: string | null;
  role: Role;
  sales_person_id: string | null;
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface Enquiry {
  id: string;
  reference: string;
  enquiry_date: string;
  quoted_date: string | null;
  confirmed_date: string | null;
  closure: Closure | null;
  closure_reason: string | null;
  status: Status;
  customer_id: string;
  subject: string | null;
  trade_type: TradeType | null;
  qty_text: string | null;
  shipment_mode: ShipmentMode | null;
  units: number | null;
  container_type: string | null;
  currency: string;
  buy_rate: number | null;
  buy_total: number | null;
  sell_rate: number | null;
  sell_total: number | null;
  profit: number | null;
  pol: string | null;
  pod: string | null;
  agent_id: string | null;
  sales_person_id: string | null;
  remarks: string | null;
  source: "manual" | "import" | "email";
  import_batch_id: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** Row of the `enquiry_register` view (enquiry + resolved names). */
export interface EnquiryRow extends Enquiry {
  customer_name: string;
  agent_name: string | null;
  sales_person_name: string | null;
  /**
   * Import columns changed in the app (enquiries.app_edited_fields); imports never overwrite them.
   * Not in the view: loaded separately where needed (the import preview).
   */
  app_edited_fields?: string[];
}

/** Body of the `upsert_enquiry` RPC. Names are resolved (or created) server-side. */
export interface EnquiryPayload {
  reference: string | null;
  enquiry_date: string;
  quoted_date: string | null;
  confirmed_date: string | null;
  closure: Closure | null;
  closure_reason: string | null;
  customer_name: string;
  subject: string | null;
  trade_type: TradeType | null;
  qty_text: string | null;
  shipment_mode: ShipmentMode | null;
  units: number | null;
  container_type: string | null;
  currency: string;
  buy_rate: number | null;
  buy_total: number | null;
  sell_rate: number | null;
  sell_total: number | null;
  pol: string | null;
  pod: string | null;
  agent_name: string | null;
  sales_person_name: string | null;
  remarks: string | null;
}

/** One row sent to the `import_enquiries` RPC. */
export type ImportPayload = Omit<EnquiryPayload, "closure" | "closure_reason" | "currency"> & { reference: string };

export interface AuditEntry {
  id: number;
  enquiry_id: string;
  reference: string;
  action: "insert" | "update" | "delete";
  changes: Record<string, unknown> | null;
  import_batch_id: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface ImportBatch {
  id: string;
  file_name: string;
  sheet_names: string[];
  rows_in_file: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  warnings: unknown[];
  storage_path: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PeriodStats {
  enquiries: number;
  quoted: number;
  confirmed: number;
  converted: number;
  profit: number;
  sell_total: number;
}

export type BreakdownDimension = "sales_person" | "customer" | "agent" | "lane" | "mode" | "trade_type";

/** Row of the `enquiry_breakdown` RPC: enquiries raised in the range, grouped by one dimension. */
export interface BreakdownRow {
  label: string;
  enquiries: number;
  quoted: number;
  confirmed: number;
  lost: number;
  sell_total: number;
  profit: number;
}

/** Row of the `monthly_trend` RPC. */
export interface MonthlyTrendRow {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  /** Enquiries raised in the month, and of those: quoted, now confirmed, and their profit. */
  enquiries: number;
  quoted: number;
  converted: number;
  converted_profit: number;
  /** Jobs confirmed in the month, whatever month the enquiry was raised in. */
  confirmed: number;
  confirmed_sell: number;
  confirmed_profit: number;
}

export interface SalespersonSummaryRow {
  sales_person: string;
  total_enquiries: number;
  confirmed: number;
  confirmed_new: number;
  confirmed_old: number;
  fcl_jobs: number;
  fcl_units: number;
  air: number;
  lcl: number;
  courier: number;
  other: number;
  profit: number;
}
