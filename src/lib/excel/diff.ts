import { fmtDate, fmtMoney } from "../format";
import { nameKey } from "../normalize";
import type { EnquiryRow, ImportPayload } from "../types";
import { hasErrors, type ParsedRow } from "./register";

type Kind = "date" | "text" | "name" | "number";

const FIELDS: { key: keyof ImportPayload & keyof EnquiryRow; label: string; kind: Kind }[] = [
  { key: "enquiry_date", label: "Enquiry date", kind: "date" },
  { key: "quoted_date", label: "Quoted date", kind: "date" },
  { key: "confirmed_date", label: "Confirmation date", kind: "date" },
  { key: "customer_name", label: "Customer", kind: "name" },
  { key: "subject", label: "Subject", kind: "text" },
  { key: "trade_type", label: "Mode", kind: "text" },
  { key: "qty_text", label: "Qty", kind: "text" },
  { key: "shipment_mode", label: "Shipment", kind: "text" },
  { key: "units", label: "Units", kind: "number" },
  { key: "container_type", label: "Container", kind: "text" },
  { key: "buy_rate", label: "Buy rate", kind: "number" },
  { key: "buy_total", label: "Buy total", kind: "number" },
  { key: "sell_rate", label: "Sell rate", kind: "number" },
  { key: "sell_total", label: "Sell total", kind: "number" },
  { key: "pol", label: "POL", kind: "text" },
  { key: "pod", label: "POD", kind: "text" },
  { key: "agent_name", label: "Agent", kind: "name" },
  { key: "sales_person_name", label: "Sales person", kind: "name" },
  { key: "remarks", label: "Remarks", kind: "text" },
];

export interface FieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface DiffItem {
  row: ParsedRow;
  kind: "new" | "changed" | "unchanged";
  changes: FieldChange[];
  /** Differences the import will not apply, because the field was changed in the app. */
  kept: FieldChange[];
  payload: ImportPayload;
}

/** Database column behind each import field, as listed in enquiries.app_edited_fields. */
const COLUMN: Partial<Record<keyof ImportPayload, string>> = {
  customer_name: "customer_id",
  agent_name: "agent_id",
  sales_person_name: "sales_person_id",
};

export interface ImportAnalysis {
  items: DiffItem[];
  /** Rows with errors; they are not imported. */
  invalid: ParsedRow[];
  skipped: number;
  sheetNames: string[];
  rowsInFile: number;
}

const normText = (v: unknown) => String(v).replace(/\s+/g, " ").trim().toUpperCase();

function same(kind: Kind, a: unknown, b: unknown): boolean {
  if (kind === "number") return Math.abs(Number(a) - Number(b)) < 0.0005;
  if (kind === "name") return nameKey(String(a)) === nameKey(String(b));
  if (kind === "text") return normText(a) === normText(b);
  return String(a) === String(b);
}

function display(kind: Kind, v: unknown): string {
  if (v == null || v === "") return "—";
  if (kind === "date") return fmtDate(String(v));
  if (kind === "number") return fmtMoney(Number(v));
  return String(v);
}

export function toPayload(row: ParsedRow, existing?: EnquiryRow): ImportPayload {
  return {
    reference: row.reference,
    // A carried-forward date must not replace a real one already in the database.
    enquiry_date: row.enquiry_date_inferred && existing ? existing.enquiry_date : (row.enquiry_date ?? ""),
    quoted_date: row.quoted_date,
    confirmed_date: row.confirmed_date,
    customer_name: row.customer_name,
    subject: row.subject,
    trade_type: row.trade_type,
    qty_text: row.qty_text,
    shipment_mode: row.shipment_mode,
    units: row.units,
    container_type: row.container_type,
    buy_rate: row.buy_rate,
    buy_total: row.buy_total,
    sell_rate: row.sell_rate,
    sell_total: row.sell_total,
    pol: row.pol,
    pod: row.pod,
    agent_name: row.agent_name,
    sales_person_name: row.sales_person_name,
    remarks: row.remarks,
  };
}

/**
 * Compares an uploaded row with the stored enquiry. Blank uploaded values never count as changes, and fields changed
 * in the app are kept (the database's import_enquiries does the same), so they are listed apart.
 */
export function diffRow(row: ParsedRow, existing?: EnquiryRow): DiffItem {
  const payload = toPayload(row, existing);
  if (!existing) return { row, kind: "new", changes: [], kept: [], payload };

  const appEdited = new Set(existing.app_edited_fields ?? []);
  const changes: FieldChange[] = [];
  const kept: FieldChange[] = [];
  for (const f of FIELDS) {
    const incoming = payload[f.key];
    const current = existing[f.key];
    if (incoming == null || incoming === "") continue;
    if (current != null && current !== "" && same(f.kind, incoming, current)) continue;
    const change = { field: f.key, label: f.label, from: display(f.kind, current), to: display(f.kind, incoming) };
    (appEdited.has(COLUMN[f.key] ?? f.key) ? kept : changes).push(change);
  }
  return { row, kind: changes.length ? "changed" : "unchanged", changes, kept, payload };
}

export function buildAnalysis(
  rows: ParsedRow[],
  existing: Map<string, EnquiryRow>,
  skipped: number,
  sheetNames: string[],
): ImportAnalysis {
  return {
    items: rows.filter((r) => !hasErrors(r)).map((r) => diffRow(r, existing.get(r.reference))),
    invalid: rows.filter(hasErrors),
    skipped,
    sheetNames,
    rowsInFile: rows.length + skipped,
  };
}
