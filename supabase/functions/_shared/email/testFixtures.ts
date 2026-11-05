// Synthetic Gmail messages for the unit tests. Names, companies and addresses are made up.
import type { Candidate, GmailMessage, GmailMessagePart, MatchContext } from "./types.ts";

export function b64url(text: string | Uint8Array): string {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface FakeMessage {
  id?: string;
  threadId?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  html?: string;
  date?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  labels?: string[];
  extraHeaders?: Record<string, string>;
  attachments?: { filename: string; mimeType: string; size: number; attachmentId?: string; contentId?: string; disposition?: string }[];
}

let counter = 0;

export function gmailMessage(m: FakeMessage = {}): GmailMessage {
  const id = m.id ?? `msg${++counter}`;
  const headers: Record<string, string> = {
    From: m.from ?? "Ahmed Khan <ahmed@example-trading.com>",
    To: m.to ?? "pricing@silverlynx.test",
    Subject: m.subject ?? "Rate request",
    "Message-ID": m.messageId ?? `<${id}@mail.example>`,
    ...(m.cc ? { Cc: m.cc } : {}),
    ...(m.inReplyTo ? { "In-Reply-To": m.inReplyTo } : {}),
    ...(m.references ? { References: m.references } : {}),
    ...m.extraHeaders,
  };
  const bodyParts: GmailMessagePart[] = [];
  if (m.text !== undefined || m.html === undefined) {
    bodyParts.push({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }], body: { data: b64url(m.text ?? "Hello") } });
  }
  if (m.html !== undefined) {
    bodyParts.push({ mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }], body: { data: b64url(m.html) } });
  }
  const files: GmailMessagePart[] = (m.attachments ?? []).map((a, i) => ({
    partId: `2.${i}`,
    mimeType: a.mimeType,
    filename: a.filename,
    headers: [
      ...(a.contentId ? [{ name: "Content-ID", value: a.contentId }] : []),
      { name: "Content-Disposition", value: a.disposition ?? `attachment; filename="${a.filename}"` },
    ],
    body: { size: a.size, attachmentId: a.attachmentId ?? `att-${id}-${i}` },
  }));
  return {
    id,
    threadId: m.threadId ?? `thread-${id}`,
    labelIds: m.labels ?? ["INBOX"],
    snippet: (m.text ?? "").slice(0, 100),
    internalDate: String(new Date(m.date ?? "2026-11-04T09:00:00Z").getTime()),
    payload: {
      mimeType: "multipart/mixed",
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      parts: [{ mimeType: "multipart/alternative", parts: bodyParts }, ...files],
    },
  };
}

export function emptyContext(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    already_ingested: false,
    ref_matches: [],
    unknown_refs: [],
    reply_match: null,
    customer: null,
    sales_person: null,
    customer_sales_person: null,
    sales_persons: ["AMAL", "VIVEK", "ZAHRA"],
    candidates: [],
    ...overrides,
  };
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    kind: "enquiry",
    id: "11111111-1111-1111-1111-111111111111",
    reference: "SL262700",
    date: "2026-10-30",
    customer: "EXAMPLE TRADING LLC",
    subject: "SL262700 1X40' EX-WORKS NINGBO CHINA TO SOHAR OMAN",
    qty: "1X40'",
    pol: "NINGBO CHINA",
    pod: "SOHAR OMAN",
    status: "quoted",
    ...overrides,
  };
}

/** A complete answer in the shape of OUTPUT_SCHEMA. */
export function aiAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    classification: "new_enquiry",
    confidence: 0.92,
    about_pricing: true,
    reason: "Asks for a rate for a new shipment",
    summary: "Rate request: 1x40' HC Ningbo to Sohar, plastic granules, ex-works.",
    related_candidate_id: "",
    sales_person: "vivek",
    customer: {
      company_name: "Example Trading LLC",
      contact_name: "Ahmed Khan",
      contact_email: "ahmed@example-trading.com",
      phone: "+968 9000 0000",
      designation: "Procurement Manager",
    },
    shipment: {
      trade_type: "IMP",
      shipment_mode: "FCL",
      qty_text: "1X40' HC",
      pol: "ningbo china",
      pod: "SOHAR OMAN",
      incoterm: "exw",
      commodity: "Plastic granules",
      weight: "24 t",
      volume: "",
      packages: "960 bags",
      dimensions: "",
      cargo_ready: "15 November",
      special_requirements: "",
      other_details: "N/A",
    },
    ...overrides,
  };
}
