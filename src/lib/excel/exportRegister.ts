import * as XLSX from "xlsx";
import { fmtDate } from "../format";
import type { EnquiryRow } from "../types";

const COMPANY = import.meta.env.VITE_COMPANY_NAME ?? "SILVER LYNX COMPANY LLC";

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

/**
 * Writes enquiries in the same layout as the Excel register (rows 1-4 header, data from row 5),
 * so the file opens like the old workbook and can be re-imported.
 */
export function exportRegister(rows: EnquiryRow[], title: string, fileName: string): void {
  const body = rows.map((r, i) => [
    i + 1,
    fmtDate(r.enquiry_date),
    fmtDate(r.quoted_date),
    fmtDate(r.confirmed_date),
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
  ]);
  const ws = XLSX.utils.aoa_to_sheet([[COMPANY], [title], HEADER_1, HEADER_2, ...body]);
  ws["!merges"] = MERGES.map((m) => XLSX.utils.decode_range(m));
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "REGISTER");
  XLSX.writeFile(wb, fileName);
}
