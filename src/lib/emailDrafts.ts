import { parseQty } from "./normalize";
import type { EnquiryDraft, EnquiryPayload } from "./types";

/**
 * Separates what the sender wrote from the quoted history in email_messages.body_text.
 * Keep the marker in sync with QUOTE_MARKER in supabase/functions/_shared/email/parse.ts.
 */
export const QUOTE_MARKER = "――― earlier messages ―――";

export function splitBody(body: string | null | undefined): { text: string; earlier: string } {
  if (!body) return { text: "", earlier: "" };
  const i = body.indexOf(QUOTE_MARKER);
  if (i < 0) return { text: body.trim(), earlier: "" };
  return { text: body.slice(0, i).trim(), earlier: body.slice(i + QUOTE_MARKER.length).trim() };
}

/** Oman calendar date (UTC+4) of a timestamp, as YYYY-MM-DD. */
export function muscatDate(ts: string): string {
  return new Date(new Date(ts).getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

/** The upsert_enquiry payload that "Create enquiry" sends for a draft, as extracted from the e-mail. */
export function draftToPayload(d: EnquiryDraft, customerName: string | null = d.customer_name): EnquiryPayload {
  const f = d.fields ?? {};
  const qty = parseQty(f.qty_text ?? null);
  const mode = qty.mode && qty.mode !== "OTHER" ? qty.mode : (f.shipment_mode ?? qty.mode);
  return {
    reference: null,
    enquiry_date: f.enquiry_date || muscatDate(d.received_at),
    quoted_date: null,
    confirmed_date: null,
    closure: null,
    closure_reason: null,
    customer_name: (customerName ?? "").replace(/\s+/g, " ").trim().toUpperCase(),
    subject: f.subject ?? null,
    trade_type: f.trade_type ?? null,
    qty_text: f.qty_text ?? null,
    shipment_mode: mode,
    units: qty.units,
    container_type: qty.containerType,
    currency: "USD",
    buy_rate: null,
    buy_total: null,
    sell_rate: null,
    sell_total: null,
    pol: f.pol ?? null,
    pod: f.pod ?? null,
    agent_name: null,
    sales_person_name: d.sales_person_name,
    remarks: null,
    contact_name: d.contact_name,
    contact_email: d.contact_email,
    contact_phone: d.contact_phone,
    requirements: d.requirements,
  };
}

export function confidenceLevel(c: number | null | undefined): "high" | "medium" | "low" | null {
  if (c == null) return null;
  return c >= 0.85 ? "high" : c >= 0.6 ? "medium" : "low";
}

/** Opens the conversation in Gmail, in the watched mailbox's account when it is known. */
export function gmailThreadUrl(threadId: string, mailbox?: string | null): string {
  const account = mailbox ? `?authuser=${encodeURIComponent(mailbox)}` : "";
  return `https://mail.google.com/mail/${account}#all/${threadId}`;
}
