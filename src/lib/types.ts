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
  contact_id: string | null;
  requirements: string | null;
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
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
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
  /** Contact person; matched or added to the customer's contacts by e-mail address. */
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  /** Commodity, weights, incoterm and other details without a register column. */
  requirements?: string | null;
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

// --- E-mail intake (supabase/migrations/20261104200000_email_intake.sql) ----------------

export type EmailStatus = "linked" | "draft" | "awaiting_enquiry" | "review" | "ignored";
export type DraftStatus = "pending" | "created" | "merged" | "dismissed";

export interface EmailAttachment {
  filename: string;
  mime_type: string;
  size: number;
  storage_path: string | null;
  skipped: string | null;
}

export interface EmailMessage {
  id: string;
  mailbox_id: string | null;
  gmail_message_id: string;
  gmail_thread_id: string;
  sender_type: "external" | "staff" | "self";
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  received_at: string;
  snippet: string | null;
  body_text: string | null;
  sl_refs: string[];
  attachments: EmailAttachment[];
  status: EmailStatus;
  classification: "new_enquiry" | "follow_up" | "not_enquiry" | null;
  match_method: "reference" | "reply" | "ai" | "rule" | "manual" | null;
  confidence: number | null;
  summary: string | null;
  note: string | null;
  suggested_enquiry_id: string | null;
  enquiry_id: string | null;
  draft_id: string | null;
}

/** An e-mail with the references of the enquiries it is linked or suggested to. */
export interface EmailListItem extends EmailMessage {
  enquiry: { id: string; reference: string } | null;
  suggested: { id: string; reference: string } | null;
}

/** Proposed register fields of an e-mail enquiry (enquiry_drafts.fields). */
export interface DraftFields {
  enquiry_date?: string | null;
  subject?: string | null;
  trade_type?: TradeType | null;
  qty_text?: string | null;
  shipment_mode?: ShipmentMode | null;
  pol?: string | null;
  pod?: string | null;
  incoterm?: string | null;
}

export interface EnquiryDraft {
  id: string;
  status: DraftStatus;
  gmail_thread_id: string | null;
  received_at: string;
  customer_name: string | null;
  customer_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_designation: string | null;
  sales_person_name: string | null;
  fields: DraftFields;
  requirements: string | null;
  summary: string | null;
  confidence: number | null;
  enquiry_id: string | null;
  dismiss_reason: string | null;
  created_at: string;
  updated_at: string;
  emails: EmailMessage[];
}

export interface MailboxStatus {
  email: string;
  active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  stats: Record<string, unknown>;
}

export interface InboxCounts {
  drafts: number;
  review: number;
  awaiting: number;
  mailboxes: MailboxStatus[];
}

export interface DuplicateCandidate {
  id: string;
  reference: string;
  enquiry_date: string;
  subject: string | null;
  status: Status;
  customer_name: string;
  same_route: boolean;
}

export interface CustomerSuggestion {
  id: string;
  name: string;
  match: "contact" | "name" | "alias" | "domain" | "similar";
  score: number;
}

export interface SyncResult {
  skipped?: string;
  error?: string;
  listed?: number;
  new?: number;
  processed?: number;
  linked?: number;
  draft?: number;
  awaiting_enquiry?: number;
  review?: number;
  ignored?: number;
  deferred?: number;
  errors?: number;
}
