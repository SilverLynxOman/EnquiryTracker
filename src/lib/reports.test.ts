import { describe, expect, it } from "vitest";
import {
  breakdownLabel,
  comparePeriod,
  dailySeries,
  monthPace,
  periodHeading,
  rangeLabel,
  reportFigures,
  buildPeriodReport,
  dayPeriod,
  modeTotals,
  monthPeriod,
  percent,
  periodFileName,
  periodTitle,
  registerSheetName,
  shiftPeriod,
  summaryTotals,
  weekPeriod,
} from "./reports";
import { enquiry } from "./testFixtures";
import type { SalespersonSummaryRow } from "./types";

describe("periods", () => {
  it("uses Saturday-Friday weeks, like the weekly DATA sheet (24.10.2026 - 30.10.2026)", () => {
    for (const day of ["2026-10-24", "2026-10-27", "2026-10-30"]) {
      expect(weekPeriod(day)).toEqual({ kind: "weekly", from: "2026-10-24", to: "2026-10-30" });
    }
    expect(weekPeriod("2026-11-04")).toMatchObject({ from: "2026-10-31", to: "2026-11-06" });
  });

  it("covers whole calendar months, leap years included", () => {
    expect(monthPeriod("2026-02-14")).toEqual({ kind: "monthly", from: "2026-02-01", to: "2026-02-28" });
    expect(monthPeriod("2028-02-01").to).toBe("2028-02-29");
    expect(monthPeriod("2026-12-31")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("steps to the previous / next period", () => {
    expect(shiftPeriod(dayPeriod("2026-11-01"), -1)).toEqual(dayPeriod("2026-10-31"));
    expect(shiftPeriod(weekPeriod("2026-10-24"), 1)).toMatchObject({ from: "2026-10-31", to: "2026-11-06" });
    expect(shiftPeriod(monthPeriod("2026-01-31"), -1)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(shiftPeriod(monthPeriod("2026-01-31"), 1)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    // A custom range keeps its length.
    expect(shiftPeriod({ kind: "weekly", from: "2026-10-01", to: "2026-10-10" }, 1)).toMatchObject({ from: "2026-10-11", to: "2026-10-20" });
  });

  it("names titles, sheets and files like the old workbooks", () => {
    const day = dayPeriod("2026-11-01");
    const week = weekPeriod("2026-10-27");
    const month = monthPeriod("2026-10-05");
    expect(periodTitle(day)).toBe("DAILY REPORT 01.11.2026");
    expect(periodTitle(week)).toBe("WEEKLY REPORT 24.10.2026 TO 30.10.2026");
    expect(periodTitle(month)).toBe("OCTOBER JOB ENQUIRIES - 2026");
    expect([day, week, month].map(registerSheetName)).toEqual(["01.11", "DATA1", "OCT"]);
    expect([day, week, month].map(periodFileName)).toEqual([
      "Daily Report 01-11-2026.xlsx",
      "Weekly Report 24-10-2026 to 30-10-2026.xlsx",
      "Monthly Report OCTOBER 2026.xlsx",
    ]);
  });
});

describe("buildPeriodReport", () => {
  const p = dayPeriod("2026-11-01");
  const raised = [
    enquiry({ reference: "SL262733", enquiry_date: "2026-11-01", quoted_date: "2026-11-01", confirmed_date: "2026-11-01", buy_total: 7060, sell_total: 7200, profit: 140 }),
    enquiry({ reference: "SL262731", enquiry_date: "2026-11-01" }),
    enquiry({ reference: "SL262732", enquiry_date: "2026-11-01", closure: "cancelled", status: "cancelled" }),
  ];
  const confirmed = [
    raised[0],
    enquiry({ reference: "SL262708", enquiry_date: "2026-10-28", quoted_date: "2026-10-28", confirmed_date: "2026-11-01", buy_total: 12510.1, sell_total: 13990.3, profit: 1480.2 }),
    enquiry({ reference: "SL262650", enquiry_date: "2026-10-20", confirmed_date: "2026-11-01", sell_total: 500.1, profit: 100.1 }),
  ];
  const report = buildPeriodReport(p, raised, confirmed);

  it("lists the period's enquiries in reference order", () => {
    expect(report.raised.map((r) => r.reference)).toEqual(["SL262731", "SL262732", "SL262733"]);
  });

  it("lists earlier enquiries confirmed in the period, oldest first", () => {
    expect(report.earlier.map((r) => r.reference)).toEqual(["SL262650", "SL262708"]);
  });

  it("counts enquiries without cancelled ones, and every confirmation in the period", () => {
    expect(report).toMatchObject({ enquiries: 2, cancelled: 1, confirmations: 3 });
    expect(report.confirmedSell).toBe(21690.4);
    expect(report.confirmedProfit).toBe(1720.3);
  });

  it("totals enquiries and confirmed jobs per shipment mode", () => {
    const fcl = enquiry({ reference: "SL262740", enquiry_date: "2026-10-30", confirmed_date: "2026-11-01", shipment_mode: "FCL", units: 2, profit: 300 });
    const noMode = enquiry({ reference: "SL262741", enquiry_date: "2026-11-01", shipment_mode: null });
    expect(modeTotals([...raised, noMode], [...confirmed, fcl])).toEqual([
      { mode: "FCL", enquiries: 0, confirmed: 1, units: 2, profit: 300 },
      { mode: "LCL", enquiries: 2, confirmed: 3, units: 0, profit: 1720.3 },
      { mode: "OTHER", enquiries: 1, confirmed: 0, units: 0, profit: 0 },
    ]);
  });
});

describe("helpers", () => {
  it("adds up the sales-person summary", () => {
    const row = (sales_person: string, n: number, profit: number): SalespersonSummaryRow => ({
      sales_person, total_enquiries: n, confirmed: 1, confirmed_new: 1, confirmed_old: 0, fcl_jobs: 1, fcl_units: 2,
      air: 0, lcl: 0, courier: 0, other: 0, profit,
    });
    expect(summaryTotals([row("ASHWIN", 8, 100.1), row("FIDA", 5, 0.2)])).toMatchObject({ total_enquiries: 13, confirmed: 2, fcl_units: 4, profit: 100.3 });
  });

  it("formats percentages and breakdown labels", () => {
    expect(percent(187, 337)).toBe(55.5);
    expect(percent(1, 0)).toBeNull();
    expect(breakdownLabel("mode", "BREAK_BULK")).toBe("Break bulk");
    expect(breakdownLabel("trade_type", "CT")).toBe("CT — Cross trade");
    expect(breakdownLabel("customer", "CONSOL CLUB")).toBe("CONSOL CLUB");
  });
});

describe("on-screen report", () => {
  it("writes periods and ranges in words", () => {
    expect(periodHeading(dayPeriod("2026-11-05"))).toBe("Thursday, 5 November 2026");
    expect(periodHeading(weekPeriod("2026-11-05"))).toBe("31 Oct – 6 Nov 2026");
    expect(periodHeading(monthPeriod("2026-11-05"))).toBe("November 2026");
    expect(rangeLabel("2026-10-01", "2026-10-05")).toBe("1–5 Oct");
    expect(rangeLabel("2025-12-20", "2026-01-04", true)).toBe("20 Dec 2025 – 4 Jan 2026");
  });

  it("compares a finished period with the whole one before it", () => {
    expect(comparePeriod(dayPeriod("2026-11-05"), "2026-11-06")).toMatchObject({ previous: { from: "2026-11-04", to: "2026-11-04" }, label: "Wed 4 Nov" });
    expect(comparePeriod(monthPeriod("2026-10-10"), "2026-11-06")).toMatchObject({ previous: { from: "2026-09-01", to: "2026-09-30" }, label: "September" });
  });

  it("compares a running period like for like", () => {
    const c = comparePeriod(monthPeriod("2026-11-01"), "2026-11-05");
    expect(c.current).toMatchObject({ from: "2026-11-01", to: "2026-11-05" });
    expect(c.previous).toMatchObject({ from: "2026-10-01", to: "2026-10-05" });
    expect(c.label).toBe("1–5 Oct");
    expect(comparePeriod(weekPeriod("2026-11-02"), "2026-11-02").previous).toMatchObject({ from: "2026-10-24", to: "2026-10-26" });
  });

  it("counts the figures behind the tiles", () => {
    const raised = [
      enquiry({ id: "1", reference: "R1", status: "confirmed", quoted_date: "2026-11-02", enquiry_date: "2026-11-02" }),
      enquiry({ id: "2", reference: "R2", status: "quoted", quoted_date: "2026-11-03", enquiry_date: "2026-11-03" }),
      enquiry({ id: "3", reference: "R3", status: "new", enquiry_date: "2026-11-03" }),
      enquiry({ id: "4", reference: "R4", status: "cancelled", enquiry_date: "2026-11-03" }),
    ];
    const confirmed = [
      enquiry({ id: "1", reference: "R1", status: "confirmed", enquiry_date: "2026-11-02", confirmed_date: "2026-11-04", sell_total: 1000, profit: 150 }),
      enquiry({ id: "9", reference: "R9", status: "confirmed", confirmed_date: "2026-11-04", enquiry_date: "2026-10-20", sell_total: 500, profit: 50.5 }),
    ];
    expect(reportFigures(raised, confirmed)).toEqual({ enquiries: 3, quoted: 2, converted: 1, confirmations: 2, sales: 1500, profit: 200.5 });
    const days = dailySeries({ kind: "weekly", from: "2026-11-02", to: "2026-11-04" }, raised, confirmed);
    expect(days.map((d) => [d.enquiries, d.confirmed])).toEqual([[1, 0], [2, 0], [0, 2]]);
  });

  it("projects a running month's profit", () => {
    expect(monthPace(monthPeriod("2026-11-01"), "2026-11-05", 1000)).toBe(6000);
    expect(monthPace(monthPeriod("2026-10-01"), "2026-11-05", 1000)).toBeNull();
  });
});
