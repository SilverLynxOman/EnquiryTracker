import * as XLSX from "xlsx";
import { fmtDate } from "../format";
import {
  EARLIER_SECTION_TITLE,
  breakdownLabel,
  monthName,
  percent,
  periodTitle,
  registerSheetName,
  summaryTotals,
  type ModeTotal,
  type Period,
  type PeriodReport,
  type SummaryTotals,
} from "../reports";
import { MODE_LABELS, type BreakdownDimension, type BreakdownRow, type MonthlyTrendRow, type SalespersonSummaryRow } from "../types";
import { COMPANY, registerRow, registerSheet } from "./exportRegister";

/** Footer line in the register columns, e.g. "NO. OF ENQUIRIES" in E with the count in G, as in the daily report. */
const footer = (label: string, n: number) => [null, null, null, null, label, null, n];

/** A plain table sheet: company and title rows merged across the table, then the rows. */
function tableSheet(title: string, rows: unknown[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[COMPANY], [title], ...rows]);
  const lastCol = widths.length - 1;
  ws["!merges"] = [0, 1].map((r) => ({ s: { r, c: 0 }, e: { r, c: lastCol } }));
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

/** Register layout: enquiries raised in the period, the earlier ones confirmed in it, then the footer counts. */
export function periodRegisterSheet(p: Period, report: PeriodReport): XLSX.WorkSheet {
  const body: unknown[][] = report.raised.map((r, i) => registerRow(r, i + 1));
  body.push([]);
  const sectionTitle = body.length;
  body.push([EARLIER_SECTION_TITLE[p.kind]]);
  report.earlier.forEach((r, i) => body.push(registerRow(r, i + 1)));
  body.push([], footer("NO. OF ENQUIRIES", report.enquiries), footer("NO. OF CONFIRMATIONS", report.confirmations));
  return registerSheet(periodTitle(p), body, [sectionTitle]);
}

const SUMMARY_HEADER = ["PERSONS", "TOTAL INQUIRIES", "CONFIRMED", "NEW + OLD", "FCL", "UNITS", "AIR", "LCL", "COURIER", "OTHER", "PROFIT"];

/** The DATA sheet: per sales person, then totals per shipment mode. */
export function summarySheet(p: Period, rows: SalespersonSummaryRow[], modes: ModeTotal[]): XLSX.WorkSheet {
  const line = (name: string, r: SummaryTotals) => [
    name, r.total_enquiries, r.confirmed, `${r.confirmed_new}+${r.confirmed_old}`, r.fcl_jobs, r.fcl_units,
    r.air, r.lcl, r.courier, r.other, r.profit,
  ];
  return tableSheet(
    `SALES PERSON SUMMARY ${fmtDate(p.from)} TO ${fmtDate(p.to)}`,
    [
      SUMMARY_HEADER,
      ...rows.map((r) => line(r.sales_person, r)),
      line("TOTAL", summaryTotals(rows)),
      [],
      ["SHIPMENT MODE", "ENQUIRIES", "CONFIRMED", "UNITS", "PROFIT"],
      ...modes.map((m) => [MODE_LABELS[m.mode].toUpperCase(), m.enquiries, m.confirmed, m.units || null, m.profit]),
    ],
    [22, 15, 11, 11, 8, 8, 8, 8, 9, 8, 12],
  );
}

/** Daily report: one register sheet (named like 01.11). Weekly / monthly: register sheet + DATA summary. */
export function periodReportWorkbook(
  p: Period,
  report: PeriodReport,
  summary?: { rows: SalespersonSummaryRow[]; modes: ModeTotal[] },
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, periodRegisterSheet(p, report), registerSheetName(p));
  if (summary) XLSX.utils.book_append_sheet(wb, summarySheet(p, summary.rows, summary.modes), "DATA");
  return wb;
}

const monthLabel = (iso: string) => `${monthName(iso).slice(0, 3)} ${iso.slice(0, 4)}`;

/** Analytics: the monthly trend, then one sheet per breakdown dimension. */
export function analyticsWorkbook(
  from: string,
  to: string,
  trend: MonthlyTrendRow[],
  breakdowns: { dimension: BreakdownDimension; title: string; rows: BreakdownRow[] }[],
): XLSX.WorkBook {
  const range = `${fmtDate(from)} TO ${fmtDate(to)}`;
  const wb = XLSX.utils.book_new();

  const t = trend.reduce(
    (a, r) => ({
      enquiries: a.enquiries + r.enquiries,
      quoted: a.quoted + r.quoted,
      converted: a.converted + r.converted,
      converted_profit: a.converted_profit + r.converted_profit,
      confirmed: a.confirmed + r.confirmed,
      confirmed_sell: a.confirmed_sell + r.confirmed_sell,
      confirmed_profit: a.confirmed_profit + r.confirmed_profit,
    }),
    { enquiries: 0, quoted: 0, converted: 0, converted_profit: 0, confirmed: 0, confirmed_sell: 0, confirmed_profit: 0 },
  );
  const trendLine = (label: string, r: typeof t) => [
    label, r.enquiries, r.quoted, r.converted, percent(r.converted, r.enquiries), r.converted_profit,
    r.confirmed, r.confirmed_sell, r.confirmed_profit,
  ];
  const trendSheet = tableSheet(
    `MONTHLY TREND ${range}`,
    [
      [null, "ENQUIRIES RAISED IN THE MONTH", null, null, null, null, "JOBS CONFIRMED IN THE MONTH"],
      ["MONTH", "ENQUIRIES", "QUOTED", "CONFIRMED", "CONV. %", "PROFIT", "JOBS", "SALES", "PROFIT"],
      ...trend.map((r) => trendLine(monthLabel(r.month), r)),
      trendLine("TOTAL", t),
    ],
    [12, 11, 9, 11, 9, 12, 8, 12, 12],
  );
  trendSheet["!merges"]!.push({ s: { r: 2, c: 1 }, e: { r: 2, c: 5 } }, { s: { r: 2, c: 6 }, e: { r: 2, c: 8 } });
  XLSX.utils.book_append_sheet(wb, trendSheet, "MONTHLY");

  for (const b of breakdowns) {
    XLSX.utils.book_append_sheet(
      wb,
      tableSheet(
        `ENQUIRIES BY ${b.title} ${range}`,
        [
          ["NAME", "ENQUIRIES", "QUOTED", "CONFIRMED", "LOST", "CONV. %", "SALES", "PROFIT", "PROFIT / JOB"],
          ...b.rows.map((r) => [
            breakdownLabel(b.dimension, r.label), r.enquiries, r.quoted, r.confirmed, r.lost,
            percent(r.confirmed, r.enquiries), r.sell_total, r.profit,
            r.confirmed ? Math.round(r.profit / r.confirmed) : null,
          ]),
        ],
        [40, 11, 9, 11, 7, 9, 12, 12, 13],
      ),
      b.title.slice(0, 31),
    );
  }
  return wb;
}
