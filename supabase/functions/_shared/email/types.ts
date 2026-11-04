// Types shared by the gmail-sync Edge Function and its tests. Plain TypeScript, no Deno or Node APIs.
// The database side of these shapes is supabase/migrations/20261104202737_email_intake.sql.

export type SenderType = "external" | "staff" | "self";
export type EmailStatus = "linked" | "draft" | "awaiting_enquiry" | "review" | "ignored";
export type Classification = "new_enquiry" | "follow_up" | "not_enquiry";
export type MatchMethod = "reference" | "reply" | "ai" | "rule" | "manual";
export type TradeType = "IMP" | "EXP" | "CT";
export type ShipmentMode = "FCL" | "LCL" | "AIR" | "COURIER" | "RORO" | "BREAK_BULK" | "MULTI" | "OTHER";

/** Subset of the Gmail API `users.messages` resource (format=full) that the sync reads. */
export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

export interface AttachmentMeta {
  filename: string;
  mime_type: string;
  size: number;
  /** Signature logos and other images embedded in the HTML body. */
  inline: boolean;
  attachment_id?: string;
  /** Path in the email-attachments bucket once stored. */
  storage_path?: string | null;
  /** Why the file was not stored (too large, message ignored, download failed). */
  skipped?: string | null;
}

export interface ParsedEmail {
  gmail_message_id: string;
  gmail_thread_id: string;
  rfc_message_id: string | null;
  in_reply_to: string | null;
  reference_ids: string[];
  sender_type: SenderType;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  received_at: string;
  snippet: string;
  /** What the sender wrote in this message (quoted history removed). */
  new_text: string;
  /** Quoted / forwarded history below it. Forwarded enquiries live here. */
  quoted_text: string;
  /** SL references, subject first, then the new text. */
  sl_refs: string[];
  label_ids: string[];
  attachments: AttachmentMeta[];
  /** Newsletter, mailing list, promotion tab or automatic reply. */
  is_bulk: boolean;
}

export interface Candidate {
  kind: "enquiry" | "draft";
  id: string;
  reference: string | null;
  date: string | null;
  customer: string | null;
  subject: string | null;
  qty: string | null;
  pol: string | null;
  pod: string | null;
  status: string | null;
}

/** Result of the email_match_context RPC. */
export interface MatchContext {
  already_ingested: boolean;
  ref_matches: { reference: string; enquiry_id: string; enquiry_date: string; status: string }[];
  unknown_refs: string[];
  reply_match: {
    email_id: string;
    enquiry_id: string | null;
    reference: string | null;
    enquiry_date: string | null;
    status: string | null;
    draft_id: string | null;
  } | null;
  customer: { id: string; name: string; via: "contact" | "domain" } | null;
  sales_person: string | null;
  customer_sales_person: string | null;
  sales_persons: string[];
  candidates: Candidate[];
}

/** What Claude extracted from one e-mail (normalised: unknown values are null). */
export interface AiResult {
  classification: Classification;
  confidence: number;
  reason: string;
  summary: string;
  related_candidate_id: string | null;
  sales_person: string | null;
  customer: {
    company_name: string | null;
    contact_name: string | null;
    contact_email: string | null;
    phone: string | null;
    designation: string | null;
  };
  shipment: {
    trade_type: TradeType | null;
    shipment_mode: ShipmentMode | null;
    qty_text: string | null;
    pol: string | null;
    pod: string | null;
    incoterm: string | null;
    commodity: string | null;
    weight: string | null;
    volume: string | null;
    packages: string | null;
    dimensions: string | null;
    cargo_ready: string | null;
    special_requirements: string | null;
    other_details: string | null;
  };
}

/** Proposed register fields of a draft (enquiry_drafts.fields). */
export interface DraftFields {
  enquiry_date: string;
  subject: string | null;
  trade_type: TradeType | null;
  qty_text: string | null;
  shipment_mode: ShipmentMode | null;
  pol: string | null;
  pod: string | null;
  incoterm: string | null;
}

/** A new enquiry_drafts row, as sent to ingest_email (new_draft) and kept in ai_result.draft. */
export interface NewDraft {
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
}

export interface Decision {
  status: EmailStatus;
  classification: Classification | null;
  match_method: MatchMethod | null;
  confidence: number | null;
  summary: string | null;
  note: string | null;
  enquiry_id: string | null;
  draft_id: string | null;
  suggested_enquiry_id: string | null;
}

export interface Outcome {
  decision: Decision;
  new_draft: NewDraft | null;
  /** Stored as email_messages.ai_result when Claude ran. */
  ai_result: (AiResult & { draft: NewDraft }) | null;
}
