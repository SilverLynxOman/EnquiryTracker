import { describe, expect, it } from "vitest";
import { confidenceLevel, draftToPayload, gmailThreadUrl, muscatDate, splitBody } from "./emailDrafts";
import type { EnquiryDraft } from "./types";

function draft(overrides: Partial<EnquiryDraft> = {}): EnquiryDraft {
  return {
    id: "d1",
    status: "pending",
    gmail_thread_id: "t1",
    received_at: "2026-11-04T21:00:00Z",
    customer_name: " Example  Trading llc ",
    customer_id: null,
    contact_name: "Ahmed Khan",
    contact_email: "ahmed@example-trading.com",
    contact_phone: "+968 9000 0000",
    contact_designation: null,
    sales_person_name: "VIVEK",
    fields: { qty_text: "2X40' HC", shipment_mode: "FCL", trade_type: "IMP", pol: "NINGBO CHINA", pod: "SOHAR OMAN", subject: "2X40' HC NINGBO CHINA TO SOHAR OMAN" },
    requirements: "Commodity: Plastic granules",
    summary: null,
    confidence: 0.9,
    enquiry_id: null,
    dismiss_reason: null,
    created_at: "2026-11-04T21:01:00Z",
    updated_at: "2026-11-04T21:01:00Z",
    emails: [],
    ...overrides,
  };
}

describe("draftToPayload", () => {
  it("maps the extracted fields to an upsert_enquiry payload", () => {
    expect(draftToPayload(draft())).toEqual({
      reference: null,
      enquiry_date: "2026-11-05", // received 01:00 in Oman
      quoted_date: null,
      confirmed_date: null,
      closure: null,
      closure_reason: null,
      customer_name: "EXAMPLE TRADING LLC",
      subject: "2X40' HC NINGBO CHINA TO SOHAR OMAN",
      trade_type: "IMP",
      qty_text: "2X40' HC",
      shipment_mode: "FCL",
      units: 2,
      container_type: "40HC",
      currency: "USD",
      buy_rate: null,
      buy_total: null,
      sell_rate: null,
      sell_total: null,
      pol: "NINGBO CHINA",
      pod: "SOHAR OMAN",
      agent_name: null,
      sales_person_name: "VIVEK",
      remarks: null,
      contact_name: "Ahmed Khan",
      contact_email: "ahmed@example-trading.com",
      contact_phone: "+968 9000 0000",
      requirements: "Commodity: Plastic granules",
    });
  });

  it("uses the reviewer's customer name and keeps Claude's mode when the qty text says nothing", () => {
    const p = draftToPayload(draft({ fields: { qty_text: "3 PALLETS", shipment_mode: "AIR", enquiry_date: "2026-11-03" } }), "acme co");
    expect(p).toMatchObject({ customer_name: "ACME CO", shipment_mode: "AIR", units: null, enquiry_date: "2026-11-03" });
  });
});

describe("helpers", () => {
  it("splits stored bodies at the quote marker", () => {
    expect(splitBody("Noted.\n\n――― earlier messages ―――\nFrom: X")).toEqual({ text: "Noted.", earlier: "From: X" });
    expect(splitBody("Only text")).toEqual({ text: "Only text", earlier: "" });
    expect(splitBody(null)).toEqual({ text: "", earlier: "" });
  });

  it("formats dates, confidence and Gmail links", () => {
    expect(muscatDate("2026-11-04T19:59:00Z")).toBe("2026-11-04");
    expect([0.9, 0.7, 0.3, null].map(confidenceLevel)).toEqual(["high", "medium", "low", null]);
    expect(gmailThreadUrl("1a1a", "pricing@x.com")).toBe("https://mail.google.com/mail/?authuser=pricing%40x.com#all/1a1a");
  });
});
