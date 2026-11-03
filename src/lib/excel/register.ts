import * as XLSX from "xlsx";
import { cleanText, nameKey, parseExcelDate, parseNumber, parseQty, parseTradeType, round2 } from "../normalize";
import type { ShipmentMode, TradeType } from "../types";

/** Column positions relative to the "MY REFERENCE" column layout A..S of the register sheets. */
export const COLS = {
  enquiryDate: 1,
  quotedDate: 2,
  confirmedDate: 3,
  reference: 4,
  customer: 5,
  subject: 6,
  mode: 7,
  qty: 8,
  buyRate: 9,
  buyTotal: 10,
  sellTotal: 11,
  sellRate: 12,
  profit: 13,
  pol: 14,
  pod: 15,
  agent: 16,
  salesPerson: 17,
  remarks: 18,
} as const;

export const REFERENCE_RE = /^SL\d{6,}$/;

export interface Issue {
  level: "error" | "warning";
  field?: string;
  message: string;
}

export interface ParsedRow {
  sheet: string;
  rowNumber: number;
  reference: string;
  enquiry_date: string | null;
  /** True when the enquiry date was blank and carried forward from the row above. */
  enquiry_date_inferred: boolean;
  quoted_date: string | null;
  confirmed_date: string | null;
  customer_name: string;
  subject: string | null;
  trade_type: TradeType | null;
  qty_text: string | null;
  shipment_mode: ShipmentMode | null;
  units: number | null;
  container_type: string | null;
  buy_rate: number | null;
  buy_total: number | null;
  sell_rate: number | null;
  sell_total: number | null;
  excel_profit: number | null;
  pol: string | null;
  pod: string | null;
  agent_name: string | null;
  sales_person_name: string | null;
  remarks: string | null;
  issues: Issue[];
}

export interface SheetInfo {
  name: string;
  /** 0-based index of the row holding "MY REFERENCE". */
  headerRow: number;
  /** Column shift versus the standard layout (0 when "MY REFERENCE" is in column E). */
  offset: number;
  contextYear: number;
  /** Rows with a reference and a customer name. */
  candidateRows: number;
  /** Pre-selected for import (all register sheets except the DATA* summaries). */
  suggested: boolean;
}

export interface SheetParseResult {
  rows: ParsedRow[];
  /** Pre-allocated references without a customer (e.g. the empty tail of the NOV sheet). */
  skipped: number;
}

export function readWorkbook(data: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(data, { type: "array", cellDates: false, cellFormula: false, cellHTML: false });
}

/** All rows of a sheet as arrays, starting at A1 so indices match Excel rows/columns. */
function sheetRows(ws: XLSX.WorkSheet): unknown[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: { s: { r: 0, c: 0 }, e: range.e },
  });
}

function upperText(v: unknown): string {
  return (cleanText(v) ?? "").toUpperCase();
}

function findHeader(rows: unknown[][]): { headerRow: number; refCol: number } | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (upperText(row[c]).includes("MY REFERENCE")) return { headerRow: r, refCol: c };
    }
  }
  return null;
}

function findYear(rows: unknown[][], headerRow: number, sheetName: string, fileName: string): number {
  for (let r = 0; r <= headerRow; r++) {
    for (const cell of rows[r] ?? []) {
      const m = upperText(cell).match(/\b(20\d{2})\b/);
      if (m) return Number(m[1]);
    }
  }
  const m = `${sheetName} ${fileName}`.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function normaliseReference(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const ref = s.replace(/\s+/g, "").toUpperCase();
  return REFERENCE_RE.test(ref) ? ref : null;
}

/** Finds the sheets laid out like the enquiry register (header row containing "MY REFERENCE"). */
export function listRegisterSheets(wb: XLSX.WorkBook, fileName = ""): SheetInfo[] {
  const out: SheetInfo[] = [];
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[name]);
    const header = findHeader(rows);
    if (!header) continue;
    const offset = header.refCol - COLS.reference;
    let candidateRows = 0;
    for (let r = header.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      if (normaliseReference(row[COLS.reference + offset]) && cleanText(row[COLS.customer + offset])) candidateRows++;
    }
    out.push({
      name,
      headerRow: header.headerRow,
      offset,
      contextYear: findYear(rows, header.headerRow, name, fileName),
      candidateRows,
      suggested: candidateRows > 0 && !/^DATA/i.test(name.trim()),
    });
  }
  return out;
}

/** Turns one register sheet into validated rows. Section titles, footers and blank rows are ignored. */
export function parseRegisterSheet(wb: XLSX.WorkBook, info: SheetInfo): SheetParseResult {
  const rows = sheetRows(wb.Sheets[info.name]);
  const out: ParsedRow[] = [];
  let skipped = 0;
  let lastEnquiryDate: string | null = null;

  for (let r = info.headerRow + 1; r < rows.length; r++) {
    const cells = rows[r] ?? [];
    const at = (col: number) => cells[col + info.offset] ?? null;

    const reference = normaliseReference(at(COLS.reference));
    if (!reference) continue;
    const customer = cleanText(at(COLS.customer));
    if (!customer) {
      skipped++;
      continue;
    }

    const issues: Issue[] = [];
    const date = (col: number, field: string, label: string) => {
      const res = parseExcelDate(at(col), info.contextYear);
      if (res.error) issues.push({ level: "error", field, message: `${label}: ${res.error}` });
      else if (res.warning) issues.push({ level: "warning", field, message: `${label}: ${res.warning}` });
      return res.value;
    };
    const num = (col: number, field: string, label: string) => {
      const res = parseNumber(at(col));
      if (res.error) issues.push({ level: "warning", field, message: `${label}: ${res.error} (ignored)` });
      return res.value;
    };

    let enquiryDate = date(COLS.enquiryDate, "enquiry_date", "ENQUIRY DATE");
    let enquiryDateInferred = false;
    const quotedDate = date(COLS.quotedDate, "quoted_date", "QUOTED DATE");
    const confirmedDate = date(COLS.confirmedDate, "confirmed_date", "CONFIRMATION DATE");
    const enquiryDateHasError = issues.some((i) => i.field === "enquiry_date");

    if (!enquiryDate && !enquiryDateHasError) {
      if (lastEnquiryDate) {
        enquiryDate = lastEnquiryDate;
        enquiryDateInferred = true;
        issues.push({
          level: "warning",
          field: "enquiry_date",
          message: `ENQUIRY DATE is blank; assumed ${enquiryDate.split("-").reverse().join(".")} from the row above`,
        });
      } else {
        issues.push({ level: "error", field: "enquiry_date", message: "ENQUIRY DATE is blank" });
      }
    }
    if (enquiryDate) lastEnquiryDate = enquiryDate;

    // MODE (IMP/EXP/CT) and QTY are occasionally typed into each other's column.
    const modeCell = cleanText(at(COLS.mode));
    const qtyCell = cleanText(at(COLS.qty));
    let tradeType = parseTradeType(modeCell);
    let qtyText = qtyCell;
    if (!tradeType && modeCell && parseTradeType(qtyCell)) {
      tradeType = parseTradeType(qtyCell);
      qtyText = modeCell;
      issues.push({ level: "warning", field: "trade_type", message: `MODE "${modeCell}" and QTY "${qtyCell}" look swapped; corrected` });
    } else if (modeCell && !tradeType) {
      issues.push({ level: "warning", field: "trade_type", message: `MODE "${modeCell}" is not IMP / EXP / CT; left blank` });
    }
    const qty = parseQty(qtyText);

    const buyRate = num(COLS.buyRate, "buy_rate", "BUY");
    let buyTotal = num(COLS.buyTotal, "buy_total", "BUY TOTAL");
    const sellRate = num(COLS.sellRate, "sell_rate", "SELL");
    let sellTotal = num(COLS.sellTotal, "sell_total", "SELL TOTAL");
    const excelProfit = num(COLS.profit, "profit", "PROFIT");

    if (buyTotal == null && buyRate != null) {
      buyTotal = round2(buyRate * (qty.units ?? 1));
      issues.push({ level: "warning", field: "buy_total", message: `BUY TOTAL blank; calculated as ${buyTotal}` });
    }
    if (sellTotal == null && sellRate != null) {
      sellTotal = round2(sellRate * (qty.units ?? 1));
      issues.push({ level: "warning", field: "sell_total", message: `SELL TOTAL blank; calculated as ${sellTotal}` });
    }
    const computedProfit = sellTotal == null && buyTotal == null ? null : (sellTotal ?? 0) - (buyTotal ?? 0);
    if (excelProfit != null && computedProfit != null && Math.abs(excelProfit - computedProfit) > 0.5) {
      issues.push({
        level: "warning",
        field: "profit",
        message: `PROFIT in sheet is ${excelProfit} but SELL TOTAL − BUY TOTAL is ${round2(computedProfit)}; the app uses ${round2(computedProfit)}`,
      });
    }

    if (enquiryDate && quotedDate && quotedDate < enquiryDate) {
      issues.push({ level: "warning", field: "quoted_date", message: "QUOTED DATE is before ENQUIRY DATE" });
    }
    if (enquiryDate && confirmedDate && confirmedDate < enquiryDate) {
      issues.push({ level: "warning", field: "confirmed_date", message: "CONFIRMATION DATE is before ENQUIRY DATE" });
    }
    if (confirmedDate && sellTotal == null) {
      issues.push({ level: "warning", field: "sell_total", message: "Confirmed but no SELL amount" });
    }
    if (!confirmedDate && sellTotal != null) {
      issues.push({ level: "warning", field: "confirmed_date", message: "Has a SELL amount but no CONFIRMATION DATE" });
    }
    const salesPerson = cleanText(at(COLS.salesPerson));
    if (!salesPerson) issues.push({ level: "warning", field: "sales_person_name", message: "SALES PERSON is blank" });

    out.push({
      sheet: info.name,
      rowNumber: r + 1,
      reference,
      enquiry_date: enquiryDate,
      enquiry_date_inferred: enquiryDateInferred,
      quoted_date: quotedDate,
      confirmed_date: confirmedDate,
      customer_name: customer.toUpperCase(),
      subject: cleanText(at(COLS.subject)),
      trade_type: tradeType,
      qty_text: qtyText,
      shipment_mode: qty.mode,
      units: qty.units,
      container_type: qty.containerType,
      buy_rate: buyRate,
      buy_total: buyTotal,
      sell_rate: sellRate,
      sell_total: sellTotal,
      excel_profit: excelProfit,
      pol: cleanText(at(COLS.pol)),
      pod: cleanText(at(COLS.pod)),
      agent_name: cleanText(at(COLS.agent)),
      sales_person_name: salesPerson?.toUpperCase() ?? null,
      remarks: cleanText(at(COLS.remarks)),
      issues,
    });
  }
  return { rows: out, skipped };
}

const MERGE_FIELDS = [
  "quoted_date", "confirmed_date", "subject", "trade_type", "qty_text", "shipment_mode",
  "units", "container_type", "buy_rate", "buy_total", "sell_rate", "sell_total", "excel_profit",
  "pol", "pod", "agent_name", "sales_person_name", "remarks",
] as const satisfies readonly (keyof ParsedRow)[];

/**
 * The same reference can appear in several sheets (e.g. a month sheet and DATA1, or the daily report's
 * "PREVIOUS DAY'S CONFIRMATION" section). Same customer → one row, later non-blank values win.
 * Different customers → the reference was reused by mistake; every occurrence becomes an error.
 */
export function mergeDuplicates(rows: ParsedRow[]): ParsedRow[] {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const list = groups.get(row.reference);
    if (list) list.push(row);
    else groups.set(row.reference, [row]);
  }

  const out: ParsedRow[] = [];
  for (const [reference, list] of groups) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const where = list.map((r) => `${r.sheet}!R${r.rowNumber} (${r.customer_name})`).join(", ");
    const customers = new Set(list.map((r) => nameKey(r.customer_name)));
    if (customers.size > 1) {
      for (const r of list) {
        out.push({
          ...r,
          issues: [...r.issues, { level: "error", field: "reference", message: `${reference} is used for different customers: ${where}` }],
        });
      }
      continue;
    }
    const merged: ParsedRow = { ...list[0], issues: [...list[0].issues] };
    for (const next of list.slice(1)) {
      for (const field of MERGE_FIELDS) {
        if (next[field] != null) (merged as unknown as Record<string, unknown>)[field] = next[field];
      }
      // A real enquiry date always beats one carried forward from the row above.
      if (next.enquiry_date && (!next.enquiry_date_inferred || !merged.enquiry_date || merged.enquiry_date_inferred)) {
        merged.enquiry_date = next.enquiry_date;
        merged.enquiry_date_inferred = next.enquiry_date_inferred;
      }
      merged.sheet = next.sheet;
      merged.rowNumber = next.rowNumber;
      merged.issues.push(...next.issues);
    }
    merged.issues.push({ level: "warning", field: "reference", message: `Appears ${list.length} times (${where}); merged` });
    out.push(merged);
  }
  return out;
}

/** Parses the chosen sheets and merges repeated references. */
export function parseWorkbookSheets(wb: XLSX.WorkBook, sheets: SheetInfo[]): SheetParseResult {
  let skipped = 0;
  const all: ParsedRow[] = [];
  for (const info of sheets) {
    const res = parseRegisterSheet(wb, info);
    all.push(...res.rows);
    skipped += res.skipped;
  }
  return { rows: mergeDuplicates(all), skipped };
}

export const hasErrors = (row: ParsedRow) => row.issues.some((i) => i.level === "error");
