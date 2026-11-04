import * as XLSX from "xlsx";
import { fmtDate } from "../format";
import type { EnquiryRow } from "../types";

export const COMPANY = import.meta.env.VITE_COMPANY_NAME ?? "SILVER LYNX COMPANY LLC";

const HEADER_1 = [
  "SL. NO.", "ENQUIRY DATE", "QUOTED DATE", "CONFIRMATION DATE", "MY REFERENCE",
  "NAME OF CUSTOMER LOCAL/OVERSEAS", "SUBJECT", "JOB NATURE & QTY", null, "BUY RATE", null,
  "SELL", null, "PROFIT", "PORT & AGENT DETAILS ", null, null, "SALES PERSON", "REMARKS",
];
const HEADER_2 = [
  null, null, null, null, null, null, null, "MODE", "QTY", "BUY", "TOTAL", "TOTAL", "SELL", null,
  "POL", "POD", "AGENT", null, null,
];
const MERGES = [
  "A1:S1", "A2:S2", "A3:A4", "B3:B4", "C3:C4", "D3:D4", "E3:E4", "F3:F4", "G3:G4",
  "H3:I3", "J3:K3", "L3:M3", "N3:N4", "O3:Q3", "R3:R4", "S3:S4",
];
const WIDTHS = [6, 12, 12, 14, 12, 34, 52, 6, 12, 10, 10, 10, 10, 10, 22, 18, 18, 14, 28];
/** Rows above the data: company, title and the two header rows. */
const HEAD_ROWS = 4;
const LAST_COL = HEADER_1.length - 1;

/** One enquiry in the register's columns A..S. */
export function registerRow(r: EnquiryRow, slNo: number): unknown[] {
  return [
    slNo,
    fmtDate(r.enquiry_date),
    fmtDate(r.quoted_date) || null,
    fmtDate(r.confirmed_date) || null,
    r.reference,
    r.customer_name,
    r.subject,
    r.trade_type,
    r.qty_text,
    r.buy_rate,
    r.buy_total,
    r.sell_total,
    r.sell_rate,
    r.profit,
    r.pol,
    r.pod,
    r.agent_name,
    r.sales_person_name,
    r.remarks,
  ];
}

/**
 * A sheet in the Excel register layout (rows 1-4 header, data from row 5), so it opens like the old workbook
 * and can be re-imported. `sectionTitles` are 0-based indexes into `body` of title rows to merge across A:S.
 */
export function registerSheet(title: string, body: unknown[][], sectionTitles: number[] = []): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[COMPANY], [title], HEADER_1, HEADER_2, ...body]);
  ws["!merges"] = [
    ...MERGES.map((m) => XLSX.utils.decode_range(m)),
    ...sectionTitles.map((i) => ({ s: { r: HEAD_ROWS + i, c: 0 }, e: { r: HEAD_ROWS + i, c: LAST_COL } })),
  ];
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));
  return ws;
}

export function registerWorkbook(rows: EnquiryRow[], title: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, registerSheet(title, rows.map((r, i) => registerRow(r, i + 1))), "REGISTER");
  return wb;
}

/** Downloads the workbook in the browser. */
export function saveWorkbook(wb: XLSX.WorkBook, fileName: string): void {
  XLSX.writeFile(wb, fileName);
}

export function exportRegister(rows: EnquiryRow[], title: string, fileName: string): void {
  saveWorkbook(registerWorkbook(rows, title), fileName);
}
