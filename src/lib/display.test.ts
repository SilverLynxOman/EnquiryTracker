import { describe, expect, it } from "vitest";
import { daysBetween, displayName, fmtDateLong, fmtDayMonth, initials, nextStep, shipmentLabel, shortPort, statusDetail } from "./display";
import { DEFAULT_VIEW, periodRange, readRegisterView, viewFilters, writeRegisterView } from "./registerView";
import { enquiry } from "./testFixtures";

describe("displayName", () => {
  it("title-cases names typed in capitals, keeping initials and company suffixes", () => {
    expect(displayName("AL MADINA TRADING")).toBe("Al Madina Trading");
    expect(displayName("JA SUPPLY")).toBe("JA Supply");
    expect(displayName("V R LOGISTICS")).toBe("V R Logistics");
    expect(displayName("A.V. FREIGHT")).toBe("A.V. Freight");
    expect(displayName("SOHAR STEEL LLC")).toBe("Sohar Steel LLC");
    expect(displayName("NHAVA-SHEVA")).toBe("Nhava-Sheva");
    expect(displayName("  GULF   STAR INDUSTRIES ")).toBe("Gulf Star Industries");
  });

  it("leaves mixed-case names and blanks alone", () => {
    expect(displayName("McKinsey & Co")).toBe("McKinsey & Co");
    expect(displayName(null)).toBe("");
  });
});

describe("shortPort", () => {
  it("drops the country for the compact route", () => {
    expect(shortPort("JEBEL ALI UAE")).toBe("Jebel Ali");
    expect(shortPort("NHAVA-SHEVA INDIA")).toBe("Nhava-Sheva");
    expect(shortPort("SOHAR OMAN")).toBe("Sohar");
    expect(shortPort("PORT KLANG, MALAYSIA")).toBe("Port Klang");
  });

  it("keeps a name that is only a country, or has none", () => {
    expect(shortPort("OMAN")).toBe("Oman");
    expect(shortPort("MUSCAT")).toBe("Muscat");
    expect(shortPort("")).toBe("");
  });
});

describe("dates", () => {
  it("formats and counts days", () => {
    expect(fmtDateLong("2026-11-04")).toBe("04 Nov 2026");
    expect(fmtDayMonth("2026-11-04", "2026-11-05")).toBe("04 Nov");
    expect(fmtDayMonth("2025-12-30", "2026-01-02")).toBe("30 Dec 2025");
    expect(daysBetween("2026-10-24", "2026-11-04")).toBe(11);
    expect(daysBetween("2026-11-05", "2026-11-04")).toBe(-1);
  });
});

describe("row status and actions", () => {
  const today = "2026-11-04";

  it("describes how long an open enquiry has waited, flagging long waits", () => {
    expect(statusDetail(enquiry({ reference: "SL1", enquiry_date: today }), today)).toEqual({ text: "Received today", longWait: false });
    expect(statusDetail(enquiry({ reference: "SL2", enquiry_date: "2026-11-03" }), today)).toEqual({ text: "Waiting 1 day", longWait: false });
    expect(statusDetail(enquiry({ reference: "SL3", enquiry_date: "2026-10-20", quoted_date: today }), today)).toEqual({ text: "Quoted today", longWait: false });
    expect(statusDetail(enquiry({ reference: "SL4", enquiry_date: "2026-10-20", quoted_date: "2026-10-24" }), today)).toEqual({ text: "Waiting 11 days", longWait: true });
  });

  it("shows the confirmation date, or the reason an enquiry closed", () => {
    expect(statusDetail(enquiry({ reference: "SL5", enquiry_date: "2026-11-01", confirmed_date: today }), today).text).toBe("04 Nov");
    expect(statusDetail(enquiry({ reference: "SL6", enquiry_date: "2026-11-01", status: "lost", closure: "lost", closure_reason: "Rate too high" }), today).text).toBe("Rate too high");
    expect(statusDetail(enquiry({ reference: "SL7", enquiry_date: "2026-11-01", status: "cancelled", closure: "cancelled" }), today).text).toBe("No reason recorded");
  });

  it("offers one next step per row, and only viewing to read-only users", () => {
    const open = enquiry({ reference: "SL8", enquiry_date: today });
    const quoted = enquiry({ reference: "SL9", enquiry_date: today, quoted_date: today });
    const done = enquiry({ reference: "SL10", enquiry_date: today, confirmed_date: today });
    expect([open, quoted, done].map((r) => nextStep(r, true))).toEqual(["quote", "confirm", "view"]);
    expect([open, quoted, done].map((r) => nextStep(r, false))).toEqual(["view", "view", "view"]);
  });

  it("labels shipments and people", () => {
    expect(shipmentLabel({ shipment_mode: "FCL", qty_text: "2X20'" })).toBe("2×20'");
    expect(shipmentLabel({ shipment_mode: "RORO", qty_text: "RORO" })).toBe("RoRo");
    expect(shipmentLabel({ shipment_mode: null, qty_text: null })).toBe("");
    expect(initials("SHIYAD")).toBe("S");
    expect(initials("anwar ali")).toBe("AA");
  });
});

describe("register view in the URL", () => {
  const today = "2026-11-04";

  it("turns periods into exact date ranges", () => {
    expect(periodRange("all", today)).toEqual({ from: "", to: "" });
    expect(periodRange("today", today)).toEqual({ from: today, to: today });
    expect(periodRange("this_week", today)).toEqual({ from: "2026-10-31", to: "2026-11-06" });
    expect(periodRange("this_month", today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("this_year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("keeps an October enquiry out of 'This month' in November", () => {
    const f = viewFilters(DEFAULT_VIEW, today);
    expect(f).toMatchObject({ basis: "enquiry_date", from: "2026-11-01", to: "2026-11-30" });
    expect("2026-10-23" >= f.from).toBe(false);
  });

  it("round-trips through the URL, writing only what differs from the defaults", () => {
    expect(writeRegisterView(DEFAULT_VIEW).toString()).toBe("");
    const v = { ...DEFAULT_VIEW, period: "custom" as const, from: "2026-10-01", to: "2026-10-15", status: "quoted" as const, q: "gulf", page: 2, size: 50, selected: "abc" };
    expect(readRegisterView(writeRegisterView(v))).toEqual(v);
  });

  it("reads old links and ignores bad values", () => {
    expect(readRegisterView(new URLSearchParams("from=2026-11-01&to="))).toMatchObject({ period: "custom", from: "2026-11-01", to: "" });
    expect(readRegisterView(new URLSearchParams("status=bogus&mode=X&size=7&page=-3&basis=nope"))).toMatchObject({
      status: "", mode: "", size: 25, page: 0, basis: "enquiry_date",
    });
  });
});

describe("pagination", () => {
  it("shows every page when there are few, else the ends and the current page's neighbours", async () => {
    const { pageItems } = await import("./registerView");
    expect(pageItems(0, 1)).toEqual([0]);
    expect(pageItems(2, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageItems(0, 20)).toEqual([0, 1, "gap", 19]);
    expect(pageItems(10, 20)).toEqual([0, "gap", 9, 10, 11, "gap", 19]);
    expect(pageItems(19, 20)).toEqual([0, "gap", 18, 19]);
  });
});
