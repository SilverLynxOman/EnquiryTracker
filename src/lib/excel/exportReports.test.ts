import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildPeriodReport, dayPeriod, modeTotals, monthPeriod, weekPeriod, type Period } from "../reports";
import { enquiry } from "../testFixtures";
import type { SalespersonSummaryRow } from "../types";
import { analyticsWorkbook, periodReportWorkbook } from "./exportReports";
import { hasErrors, listRegisterSheets, parseWorkbookSheets, readWorkbook } from "./register";

const raised = [
  enquiry({
    reference: "SL262733", enquiry_date: "2026-11-01", quoted_date: "2026-11-01", confirmed_date: "2026-11-01",
    qty_text: "1X40'", shipment_mode: "FCL", units: 1, container_type: "40",
    buy_rate: 7060, buy_total: 7060, sell_rate: 7200, sell_total: 7200, profit: 140, agent_name: "CONSOL CLUB",
  }),
  enquiry({ reference: "SL262731", enquiry_date: "2026-11-01" }),
];
const earlier = enquiry({
  reference: "SL262708", enquiry_date: "2026-10-28", quoted_date: "2026-10-28", confirmed_date: "2026-11-01",
  qty_text: "2X20'", shipment_mode: "FCL", units: 2, buy_total: 12510, sell_total: 13990, profit: 1480, sales_person_name: "MALIK",
});
const confirmed = [raised[0], earlier];

/** Writes the workbook to .xlsx bytes and reads it back with the app's importer. */
function roundTrip(wb: XLSX.WorkBook, fileName: string) {
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const back = readWorkbook(bytes);
  const sheets = listRegisterSheets(back, fileName);
  return { back, sheets, ...parseWorkbookSheets(back, sheets) };
}

function cells(wb: XLSX.WorkBook, sheet: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: null, blankrows: true });
}

describe("period report export", () => {
  it("writes the daily report in the register layout, re-importable without errors", () => {
    const p = dayPeriod("2026-11-01");
    const wb = periodReportWorkbook(p, buildPeriodReport(p, raised, confirmed));
    expect(wb.SheetNames).toEqual(["01.11"]);

    const { sheets, rows, skipped } = roundTrip(wb, "Daily Report 01-11-2026.xlsx");
    expect(sheets).toMatchObject([{ name: "01.11", headerRow: 2, offset: 0, contextYear: 2026, candidateRows: 3, suggested: true }]);
    expect(skipped).toBe(0);
    expect(rows.map((r) => r.reference)).toEqual(["SL262731", "SL262733", "SL262708"]);
    expect(rows.filter(hasErrors)).toEqual([]);
    expect(rows.find((r) => r.reference === "SL262708")).toMatchObject({
      enquiry_date: "2026-10-28",
      confirmed_date: "2026-11-01",
      shipment_mode: "FCL",
      units: 2,
      buy_total: 12510,
      sell_total: 13990,
      sales_person_name: "MALIK",
    });
  });

  it("has the section title and footer counts where the old daily report had them", () => {
    const p = dayPeriod("2026-11-01");
    const wb = periodReportWorkbook(p, buildPeriodReport(p, raised, confirmed));
    const aoa = cells(wb, "01.11");
    expect(aoa[1][0]).toBe("DAILY REPORT 01.11.2026");
    expect(aoa[4].slice(0, 5)).toEqual([1, "01.11.2026", null, null, "SL262731"]);
    expect(aoa[7][0]).toBe("PREVIOUS DAY'S CONFIRMATION");
    expect(aoa[8].slice(0, 5)).toEqual([1, "28.10.2026", "28.10.2026", "01.11.2026", "SL262708"]);
    expect(aoa[10].slice(4, 7)).toEqual(["NO. OF ENQUIRIES", null, 2]);
    expect(aoa[11].slice(4, 7)).toEqual(["NO. OF CONFIRMATIONS", null, 2]);
    expect(wb.Sheets["01.11"]["!merges"]).toContainEqual({ s: { r: 7, c: 0 }, e: { r: 7, c: 18 } });
  });

  it("adds the DATA summary to weekly and monthly reports; the summary is not taken for a register sheet", () => {
    const summary: SalespersonSummaryRow[] = [
      { sales_person: "ASHWIN", total_enquiries: 2, confirmed: 1, confirmed_new: 1, confirmed_old: 0, fcl_jobs: 1, fcl_units: 1, air: 0, lcl: 0, courier: 0, other: 0, profit: 140 },
      { sales_person: "MALIK", total_enquiries: 0, confirmed: 1, confirmed_new: 0, confirmed_old: 1, fcl_jobs: 1, fcl_units: 2, air: 0, lcl: 0, courier: 0, other: 0, profit: 1480 },
    ];
    const periods: [Period, string, string, boolean][] = [
      [weekPeriod("2026-11-01"), "DATA1", "WEEKLY REPORT 31.10.2026 TO 06.11.2026", false],
      [monthPeriod("2026-11-01"), "NOV", "NOVEMBER JOB ENQUIRIES - 2026", true],
    ];
    for (const [p, sheet, title, suggested] of periods) {
      const report = buildPeriodReport(p, raised, confirmed);
      const wb = periodReportWorkbook(p, report, { rows: summary, modes: modeTotals(raised, confirmed) });
      expect(wb.SheetNames).toEqual([sheet, "DATA"]);
      expect(cells(wb, sheet)[1][0]).toBe(title);

      const data = cells(wb, "DATA");
      expect(data[2]).toEqual(["PERSONS", "TOTAL INQUIRIES", "CONFIRMED", "NEW + OLD", "FCL", "UNITS", "AIR", "LCL", "COURIER", "OTHER", "PROFIT"]);
      expect(data[5]).toEqual(["TOTAL", 2, 2, "1+1", 2, 3, 0, 0, 0, 0, 1620]);
      expect(data[8].slice(0, 5)).toEqual(["FCL", 1, 2, 3, 1620]);
      expect(data[9].slice(0, 5)).toEqual(["LCL", 1, 0, null, 0]);

      const { sheets, rows } = roundTrip(wb, "report.xlsx");
      expect(sheets.map((s) => [s.name, s.suggested])).toEqual([[sheet, suggested]]);
      expect(rows.map((r) => r.reference)).toEqual(["SL262731", "SL262733", "SL262708"]);
    }
  });
});

describe("analytics export", () => {
  it("writes the monthly trend with totals and one sheet per breakdown", () => {
    const wb = analyticsWorkbook(
      "2026-01-01",
      "2026-02-28",
      [
        { month: "2026-01-01", enquiries: 337, quoted: 337, converted: 187, converted_profit: 62972, confirmed: 180, confirmed_sell: 500000, confirmed_profit: 60000 },
        { month: "2026-02-01", enquiries: 225, quoted: 222, converted: 96, converted_profit: 33311, confirmed: 100, confirmed_sell: 300000, confirmed_profit: 35000 },
      ],
      [{ dimension: "mode", title: "SHIPMENT MODES", rows: [{ label: "BREAK_BULK", enquiries: 4, quoted: 4, confirmed: 1, lost: 1, sell_total: 900, profit: 250 }] }],
    );
    expect(wb.SheetNames).toEqual(["MONTHLY", "SHIPMENT MODES"]);
    const trend = cells(wb, "MONTHLY");
    expect(trend[4]).toEqual(["JAN 2026", 337, 337, 187, 55.5, 62972, 180, 500000, 60000]);
    expect(trend[6]).toEqual(["TOTAL", 562, 559, 283, 50.4, 96283, 280, 800000, 95000]);
    expect(cells(wb, "SHIPMENT MODES")[3]).toEqual(["Break bulk", 4, 4, 1, 1, 25, 900, 250, 250]);
  });
});
