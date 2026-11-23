import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const { applyPrefill } = await import("./EnquiryFormPage");

/** The form as the register fills it, with the fields the tests look at. */
function form(over: Record<string, string> = {}) {
  return {
    reference: "SL262784",
    enquiry_date: "2026-11-04",
    quoted_date: "",
    confirmed_date: "",
    closure: "",
    closure_reason: "",
    customer_name: "OMAN TEXTILES",
    sales_person_name: "JITTU",
    trade_type: "IMP",
    qty_text: "LCL",
    shipment_mode: "LCL",
    units: "",
    container_type: "",
    currency: "USD",
    buy_rate: "",
    buy_total: "",
    sell_rate: "",
    sell_total: "",
    pol: "NINGBO CHINA",
    pod: "SOHAR OMAN",
    agent_name: "",
    subject: "",
    remarks: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    requirements: "",
    ...over,
  };
}

describe("applyPrefill", () => {
  it("fills empty fields from the e-mails and turns off the auto totals it filled", () => {
    const { form: next, buy, sell } = applyPrefill(form(), {
      quoted_date: "2026-11-05",
      sell_total: 1224.6,
      buy_total: 1079,
      agent_name: "Frontline",
      notes: ["Sell OMR 471 × 2.6 = USD 1,225"],
    });
    expect(next).toMatchObject({ quoted_date: "2026-11-05", sell_total: "1224.6", buy_total: "1079", agent_name: "FRONTLINE" });
    expect(buy).toBe(true);
    expect(sell).toBe(true);
  });

  it("keeps what the register already holds unless the suggestion may replace it", () => {
    const base = form({ sell_total: "7000", pod: "SOHAR OMAN" });
    expect(applyPrefill(base, { sell_total: 1225, pod: "MUSCAT OMAN", notes: [] }).form).toMatchObject({ sell_total: "7000", pod: "SOHAR OMAN" });
    const replaced = applyPrefill(base, { sell_total: 1225, pod: "MUSCAT OMAN", replace: ["sell_total", "pod"], notes: [] });
    expect(replaced.form).toMatchObject({ sell_total: "1225", pod: "MUSCAT OMAN" });
    expect(replaced.sell).toBe(true);
  });

  it("reads a suggested quantity into mode, units and container", () => {
    const next = applyPrefill(form({ qty_text: "1X20' OT", shipment_mode: "FCL", units: "1" }), { qty_text: "1x40' OT HC", replace: ["qty_text"], notes: [] }).form;
    expect(next.qty_text).toBe("1X40' OT HC");
    expect(next.shipment_mode).toBe("FCL");
    expect(next.units).toBe("1");
  });

  it("works rate × unit totals out again for a new quantity, as typing it does", () => {
    const fcl = form({ qty_text: "1X40'", shipment_mode: "FCL", units: "1", container_type: "40", sell_rate: "1000", sell_total: "1000", buy_rate: "800", buy_total: "800" });
    const filled = applyPrefill(fcl, { qty_text: "2X40HC", replace: ["qty_text"], notes: ["E-mails say 2×40 HC"] });
    expect(filled.form).toMatchObject({ qty_text: "2X40HC", units: "2", sell_total: "2000", buy_total: "1600" });
    expect(filled.notes).toEqual(["E-mails say 2×40 HC", "Buy and sell totals worked out again for the new quantity (rate × units)."]);

    // A total typed by hand stays; a total the suggestion gives wins over rate × units.
    const typed = applyPrefill({ ...fcl, sell_total: "1850" }, { qty_text: "2X40HC", buy_total: 1500, replace: ["qty_text", "buy_total"], notes: [] });
    expect(typed.form).toMatchObject({ units: "2", sell_total: "1850", buy_total: "1500" });
    expect(typed.notes).toEqual([]);

    // A quantity without units or a container clears them, as typing it does.
    const air = applyPrefill(fcl, { qty_text: "AIR", shipment_mode: "AIR", replace: ["qty_text", "shipment_mode"], notes: [] }).form;
    expect(air).toMatchObject({ qty_text: "AIR", shipment_mode: "AIR", units: "", container_type: "", sell_total: "1000", buy_total: "800" });
  });

  it("drops the old contact's name and phone when the suggestion names another address without them", () => {
    const ahmed = form({ contact_name: "AHMED SALIM", contact_email: "ahmed@cust.example", contact_phone: "+968 9111 1111", quoted_date: "2026-11-05" });
    const drift = { contact_email: "sara@cust.example", replace: ["contact_name", "contact_email", "contact_phone"], notes: [] };
    const filled = applyPrefill(ahmed, drift);
    expect(filled.form).toMatchObject({ contact_name: "", contact_email: "sara@cust.example", contact_phone: "" });
    expect(filled.notes).toEqual(["Contact name and phone cleared: they were for ahmed@cust.example."]);
    // Only the contact: other fields the suggestion may replace are never cleared.
    expect(applyPrefill(ahmed, { ...drift, replace: [...drift.replace, "quoted_date"] }).form.quoted_date).toBe("2026-11-05");
    // A name it gives is used; the same address, or one not allowed to replace, leaves the person alone.
    expect(applyPrefill(ahmed, { ...drift, contact_name: "Sara" }).form).toMatchObject({ contact_name: "Sara", contact_phone: "" });
    expect(applyPrefill(ahmed, { ...drift, contact_email: "AHMED@cust.example" }).form).toMatchObject({ contact_name: "AHMED SALIM", contact_phone: "+968 9111 1111" });
    expect(applyPrefill(ahmed, { contact_email: "sara@cust.example", notes: [] }).form).toMatchObject({ contact_name: "AHMED SALIM", contact_email: "ahmed@cust.example" });
  });

  it("enters USD suggestions in the enquiry's own currency and says so", () => {
    const omr = form({ currency: "OMR", sell_total: "471", buy_total: "415" });
    const filled = applyPrefill(omr, { sell_total: 1225, buy_total: 1079.5, replace: ["sell_total", "buy_total"], notes: ["Sell OMR 471 × 2.6 = USD 1,225"] });
    // USD 1,225 is OMR 471 rounded to whole dollars; USD 1,079.5 is OMR 415.19.
    expect(filled.form).toMatchObject({ currency: "OMR", sell_total: "471", buy_total: "415.19" });
    expect(filled.notes).toEqual([
      "Sell OMR 471 × 2.6 = USD 1,225",
      "Sell USD 1,225 is entered as OMR 471, as this enquiry is in OMR (OMR 1 = USD 2.6).",
      "Buy USD 1,079.5 is entered as OMR 415.19, as this enquiry is in OMR (OMR 1 = USD 2.6).",
    ]);
    expect(applyPrefill(form({ currency: "EUR" }), { sell_total: 1080, notes: [] }).notes).toEqual(["Sell USD 1,080 is entered as EUR 1,000, as this enquiry is in EUR (EUR 1 ≈ USD 1.08)."]);
    // A USD enquiry takes the figures as they are, with nothing to add.
    expect(applyPrefill(form(), { sell_total: 1225, notes: [] })).toMatchObject({ form: { sell_total: "1225" }, notes: [] });
    // A currency without a rate is not guessed at.
    const odd = applyPrefill(form({ currency: "XYZ" }), { sell_total: 1225, notes: [] });
    expect(odd.form.sell_total).toBe("");
    expect(odd.sell).toBe(false);
    expect(odd.notes).toEqual(["Sell USD 1,225 is not filled in: this enquiry is in XYZ, which cannot be converted here."]);
  });
});
