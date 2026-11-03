import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { diffRow } from "./diff";
import { hasErrors, listRegisterSheets, parseWorkbookSheets } from "./register";
import type { EnquiryRow } from "../types";

const HEADER_1 = [
  "SL. NO.", "ENQUIRY DATE", "QUOTED DATE", "CONFIRMATION DATE", "MY REFERENCE", "NAME OF CUSTOMER LOCAL/OVERSEAS",
  "SUBJECT", "JOB NATURE & QTY", null, "BUY RATE", null, "SELL", null, "PROFIT", "PORT & AGENT DETAILS ", null, null, "SALES PERSON",
];
const HEADER_2 = [null, null, null, null, null, null, null, "MODE", "QTY", "BUY", "TOTAL", "TOTAL", "SELL", null, "POL", "POD", "AGENT"];

/** Same shape as "Daily Report NOVEMBER, 2026.xlsx", sheet 01.11. */
function dailyReport(): XLSX.WorkBook {
  const rows = [
    ["SILVER LYNX COMPANY LLC"],
    ["DAILY REPORT 01.11.2026"],
    HEADER_1,
    HEADER_2,
    [1, "01.11.2026", null, null, "SL262731", "SYNERGIES CASTING", "SL262731 LCL EX-WORKS SHANGHAI CHINA TO SOHAR OMAN", "IMP", "LCL", null, null, null, null, null, "SHANGHAI CHINA", "SOHAR OMAN", null, "ASHWIN"],
    [3, "01.11.2026", "01.11.2026", "01.11.2026", "SL262733", "ANHAR TARWADA TRADING", "SL262733 1X40' SHENZHEN CHINA TO SOHAR OMAN", "IMP", "1X40' ", 7060, 7060, 7200, 7200, 140, "SHENZHEN CHINA", "SOHAR OMAN", "CONSOL CLUB", "FIDA"],
    [6, null, null, null, "SL262736", "WHITE ROCK UNITED ", "SL262736 LCL FOB NHAVA SHEVA INDIA TO SOHAR OMAN", "IMP", "LCL", null, null, null, null, null, "NHAVA-SHEVA INDIA", "SOHAR OMAN", null, "SHIYAD"],
    [8, null, null, null, "SL262738"],
    ["PREVIOUS DAY'S CONFIRMATION "],
    [288, "28.10.2026", "28.10.2026", "01.11.2026", "SL262708", "CHANNEL BUSINESS LLC", "SL262708 2X20' SHANGHAI CHINA TO SOHAR OMAN", "IMP", "2X20'", 6255, 12510, 13990, 6995, 1480, "SHANGHAI CHINA", "SOHAR OMAN", "CONSOL CLUB", "MALIK"],
    [592, "15.03.2026", null, null, "SL260592", "NORDIC LLC", null, "AIR", "IMP", null, null, null, null, null, "NORWAY", "MUSCAT OMAN", null, "VIVEK"],
    [999, "13.10.20226", null, null, "SL262999", "TYPO LLC", null, "IMP", "AIR", null, null, null, null, null, "X", "Y", null, "VIVEK"],
    [],
    [null, null, null, null, "NO. OF ENQUIRIES", null, 7],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "01.11");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["PERSONS", "TOTAL INQUIRIES"], ["ASHWIN", 8]]), "DATA ");
  return wb;
}

describe("register sheet parsing", () => {
  const wb = dailyReport();
  const sheets = listRegisterSheets(wb, "Daily Report NOVEMBER, 2026.xlsx");
  const { rows, skipped } = parseWorkbookSheets(wb, sheets);
  const byRef = new Map(rows.map((r) => [r.reference, r]));

  it("finds only sheets laid out like the register", () => {
    expect(sheets.map((s) => s.name)).toEqual(["01.11"]);
    expect(sheets[0]).toMatchObject({ headerRow: 2, offset: 0, contextYear: 2026, candidateRows: 6, suggested: true });
  });

  it("ignores pre-numbered empty rows, section titles and footers", () => {
    expect(skipped).toBe(1);
    expect(rows.map((r) => r.reference).sort()).toEqual(["SL260592", "SL262708", "SL262731", "SL262733", "SL262736", "SL262999"]);
  });

  it("maps columns A-R", () => {
    expect(byRef.get("SL262733")).toMatchObject({
      sheet: "01.11",
      rowNumber: 6,
      enquiry_date: "2026-11-01",
      quoted_date: "2026-11-01",
      confirmed_date: "2026-11-01",
      customer_name: "ANHAR TARWADA TRADING",
      trade_type: "IMP",
      qty_text: "1X40'",
      shipment_mode: "FCL",
      units: 1,
      container_type: "40",
      buy_rate: 7060,
      buy_total: 7060,
      sell_total: 7200,
      sell_rate: 7200,
      pol: "SHENZHEN CHINA",
      pod: "SOHAR OMAN",
      agent_name: "CONSOL CLUB",
      sales_person_name: "FIDA",
    });
    expect(byRef.get("SL262733")!.issues).toEqual([]);
    expect(byRef.get("SL262708")).toMatchObject({ units: 2, buy_total: 12510, sell_total: 13990, confirmed_date: "2026-11-01" });
  });

  it("carries a blank enquiry date forward from the row above", () => {
    const r = byRef.get("SL262736")!;
    expect(r.enquiry_date).toBe("2026-11-01");
    expect(r.enquiry_date_inferred).toBe(true);
    expect(r.customer_name).toBe("WHITE ROCK UNITED");
    expect(hasErrors(r)).toBe(false);
  });

  it("swaps MODE and QTY when typed into each other's column", () => {
    expect(byRef.get("SL260592")).toMatchObject({ trade_type: "IMP", qty_text: "AIR", shipment_mode: "AIR" });
  });

  it("repairs a mistyped year with a warning", () => {
    const r = byRef.get("SL262999")!;
    expect(r.enquiry_date).toBe("2026-10-13");
    expect(r.issues.some((i) => i.level === "warning" && i.field === "enquiry_date")).toBe(true);
  });
});

describe("duplicate references", () => {
  function workbookWith(...dataRows: unknown[][]): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["X"], ["OCTOBER JOB ENQUIRIES - 2026"], HEADER_1, HEADER_2, ...dataRows]), "OCT");
    return wb;
  }

  it("merges repeats of the same enquiry, later values winning", () => {
    const wb = workbookWith(
      [1, "07.10.2026", "08.10.2026", null, "SL262469", "AL HAJIRY GROUP", null, "IMP", "1X20'"],
      [49, "07.10.2026", "08.10.2026", "29.10.2026", "SL262469", "AL HAJIRY GROUP", null, "IMP", "1X20'", 6470, 6470, 7431, 7431],
    );
    const { rows } = parseWorkbookSheets(wb, listRegisterSheets(wb));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ confirmed_date: "2026-10-29", sell_total: 7431 });
    expect(hasErrors(rows[0])).toBe(false);
  });

  it("flags a reference reused for different customers", () => {
    const wb = workbookWith(
      [1, "30.09.2026", null, null, "SL262421", "CUSTOMER A", null, "IMP", "AIR"],
      [2, "01.10.2026", null, null, "SL262421", "V R LOGISTICS", null, "IMP", "1X20'"],
    );
    const { rows } = parseWorkbookSheets(wb, listRegisterSheets(wb));
    expect(rows).toHaveLength(2);
    expect(rows.every(hasErrors)).toBe(true);
  });
});

describe("diffRow", () => {
  const wb = dailyReport();
  const { rows } = parseWorkbookSheets(wb, listRegisterSheets(wb));
  const row = rows.find((r) => r.reference === "SL262708")!;
  const stored = {
    reference: "SL262708",
    enquiry_date: "2026-10-28",
    quoted_date: "2026-10-28",
    confirmed_date: null,
    customer_name: "Channel Business LLC.",
    subject: "SL262708 2X20' SHANGHAI CHINA TO SOHAR OMAN",
    trade_type: "IMP",
    qty_text: "2X20'",
    shipment_mode: "FCL",
    units: 2,
    container_type: "20",
    buy_rate: null,
    buy_total: null,
    sell_rate: null,
    sell_total: null,
    pol: "SHANGHAI CHINA",
    pod: "SOHAR OMAN",
    agent_name: null,
    sales_person_name: "MALIK",
    remarks: "KEEP ME",
  } as unknown as EnquiryRow;

  it("reports only fields the sheet fills in or changes", () => {
    const d = diffRow(row, stored);
    expect(d.kind).toBe("changed");
    expect(d.changes.map((c) => c.field).sort()).toEqual(["agent_name", "buy_rate", "buy_total", "confirmed_date", "sell_rate", "sell_total"]);
  });

  it("treats an enquiry already in sync as unchanged", () => {
    const synced = { ...stored, confirmed_date: "2026-11-01", buy_rate: 6255, buy_total: 12510, sell_rate: 6995, sell_total: 13990, agent_name: "CONSOL CLUB" };
    expect(diffRow(row, synced as EnquiryRow).kind).toBe("unchanged");
  });

  it("does not let a carried-forward date replace a stored one", () => {
    const inferred = rows.find((r) => r.reference === "SL262736")!;
    const d = diffRow(inferred, { ...stored, reference: "SL262736", enquiry_date: "2026-10-31" } as EnquiryRow);
    expect(d.payload.enquiry_date).toBe("2026-10-31");
  });
});
