import { supabase } from "./supabase";
import type {
  AuditEntry,
  BreakdownDimension,
  BreakdownRow,
  Enquiry,
  EnquiryPayload,
  EnquiryRow,
  ImportBatch,
  ImportPayload,
  MonthlyTrendRow,
  NamedRef,
  PeriodStats,
  SalespersonSummaryRow,
  ShipmentMode,
  Status,
} from "./types";

type Page = { data: unknown; error: { message: string } | null };

/** PostgREST returns at most 1000 rows per request; this pages through everything. */
async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<Page>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

function unwrap<T>({ data, error }: Page): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// --- Master data -----------------------------------------------------------

export async function fetchSalesPersons(): Promise<NamedRef[]> {
  return unwrap(await supabase.from("sales_persons").select("id, name").eq("active", true).order("name"));
}

export async function fetchNames(table: "customers" | "agents"): Promise<string[]> {
  const rows = await fetchAllPages<{ name: string }>((from, to) =>
    supabase.from(table).select("name").order("name").range(from, to),
  );
  return rows.map((r) => r.name);
}

export async function fetchProfileNames(): Promise<Map<string, string>> {
  const rows = unwrap<{ id: string; full_name: string | null }[]>(
    await supabase.from("profiles").select("id, full_name"),
  );
  return new Map(rows.map((r) => [r.id, r.full_name ?? "Unknown user"]));
}

// --- Register --------------------------------------------------------------

export type DateBasis = "enquiry_date" | "quoted_date" | "confirmed_date";

export interface RegisterFilters {
  basis: DateBasis;
  from: string;
  to: string;
  status: Status | "";
  salesPersonId: string;
  mode: ShipmentMode | "";
  q: string;
}

export type SortDirection = "asc" | "desc";

/** The register's filters on one select. Counts and pages share it, so tab counts always match the table. */
function filtered(f: RegisterFilters, columns: string, options?: { count: "exact"; head?: boolean }) {
  let q = supabase.from("enquiry_register").select(columns, options);
  if (f.from) q = q.gte(f.basis, f.from);
  if (f.to) q = q.lte(f.basis, f.to);
  if (f.status) q = q.eq("status", f.status);
  if (f.salesPersonId) q = q.eq("sales_person_id", f.salesPersonId);
  if (f.mode) q = q.eq("shipment_mode", f.mode);
  const term = f.q.replace(/["\\%*(),]/g, " ").trim();
  if (term) {
    q = q.or(
      ["reference", "customer_name", "subject", "pol", "pod", "agent_name"]
        .map((col) => `${col}.ilike."%${term}%"`)
        .join(","),
    );
  }
  return q;
}

/** Newest enquiry first by default; the reference breaks ties within a day. */
function registerQuery(f: RegisterFilters, withCount: boolean, sort: SortDirection = "desc") {
  const ascending = sort === "asc";
  return filtered(f, "*", withCount ? { count: "exact" } : undefined)
    .order("enquiry_date", { ascending })
    .order("reference", { ascending });
}

export async function queryRegister(f: RegisterFilters, page: number, pageSize: number, sort: SortDirection = "desc") {
  const from = page * pageSize;
  const { data, error, count } = await registerQuery(f, true, sort).range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as EnquiryRow[], count: count ?? 0 };
}

export function fetchRegisterAll(f: RegisterFilters, sort: SortDirection = "desc"): Promise<EnquiryRow[]> {
  return fetchAllPages<EnquiryRow>((from, to) => registerQuery(f, false, sort).range(from, to));
}

export type StatusCounts = Record<Status | "all", number>;

/** Number of enquiries per status under the other filters (the status filter itself is ignored). */
export async function fetchStatusCounts(f: RegisterFilters): Promise<StatusCounts> {
  const keys = ["all", "new", "quoted", "confirmed", "lost", "cancelled"] as const;
  const results = await Promise.all(
    keys.map((k) => filtered({ ...f, status: k === "all" ? "" : k }, "id", { count: "exact", head: true })),
  );
  const out = {} as StatusCounts;
  results.forEach(({ count, error }, i) => {
    if (error) throw new Error(error.message);
    out[keys[i]] = count ?? 0;
  });
  return out;
}

export async function fetchFollowUps(status: "new" | "quoted", since: string, limit = 10) {
  const dateCol = status === "new" ? "enquiry_date" : "quoted_date";
  const { data, error, count } = await supabase
    .from("enquiry_register")
    .select("*", { count: "exact" })
    .eq("status", status)
    .gte(dateCol, since)
    .order(dateCol, { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as EnquiryRow[], count: count ?? 0 };
}

// --- Single enquiry --------------------------------------------------------

export async function fetchEnquiry(id: string): Promise<EnquiryRow> {
  return unwrap(await supabase.from("enquiry_register").select("*").eq("id", id).single());
}

export async function saveEnquiry(id: string | null, payload: EnquiryPayload): Promise<Enquiry> {
  return unwrap(await supabase.rpc("upsert_enquiry", { p_id: id, p: payload }));
}

export async function markQuoted(id: string, date: string): Promise<void> {
  unwrap(await supabase.from("enquiries").update({ quoted_date: date }).eq("id", id));
}

export async function deleteEnquiry(id: string): Promise<void> {
  unwrap(await supabase.from("enquiries").delete().eq("id", id));
}

export async function fetchAudit(enquiryId: string): Promise<AuditEntry[]> {
  return unwrap(
    await supabase
      .from("enquiry_audit")
      .select("*")
      .eq("enquiry_id", enquiryId)
      .order("changed_at", { ascending: false })
      .limit(100),
  );
}

// --- Import ----------------------------------------------------------------

/** Stored enquiries for the given references, with the fields protected from imports (edited in the app). */
export async function fetchExistingByReferences(references: string[]): Promise<Map<string, EnquiryRow>> {
  const out = new Map<string, EnquiryRow>();
  for (let i = 0; i < references.length; i += 200) {
    const chunk = references.slice(i, i + 200);
    const [rows, edited] = await Promise.all([
      supabase.from("enquiry_register").select("*").in("reference", chunk).then((r) => unwrap<EnquiryRow[]>(r)),
      supabase.from("enquiries").select("reference, app_edited_fields").in("reference", chunk).then((r) => unwrap<{ reference: string; app_edited_fields: string[] | null }[]>(r)),
    ]);
    const protectedBy = new Map(edited.map((e) => [e.reference, e.app_edited_fields ?? []]));
    for (const row of rows) out.set(row.reference, { ...row, app_edited_fields: protectedBy.get(row.reference) ?? [] });
  }
  return out;
}

export async function uploadImportFile(file: File): Promise<string> {
  const now = new Date();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getTime()}-${safeName}`;
  const { error } = await supabase.storage.from("imports").upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function createImportBatch(batch: {
  file_name: string;
  sheet_names: string[];
  rows_in_file: number;
  unchanged: number;
  skipped: number;
  warnings: unknown[];
  storage_path: string | null;
}): Promise<ImportBatch> {
  return unwrap(await supabase.from("import_batches").insert(batch).select().single());
}

export async function runImportChunk(batchId: string, rows: ImportPayload[]): Promise<{ inserted: number; updated: number }> {
  return unwrap(await supabase.rpc("import_enquiries", { p_batch_id: batchId, p_rows: rows }));
}

export async function fetchImportBatches(): Promise<ImportBatch[]> {
  return unwrap(await supabase.from("import_batches").select("*").order("created_at", { ascending: false }).limit(20));
}

// --- Reports ---------------------------------------------------------------

export async function fetchPeriodStats(from: string, to: string): Promise<PeriodStats> {
  return unwrap(await supabase.rpc("dashboard_stats", { p_from: from, p_to: to }));
}

export async function fetchSalespersonSummary(from: string, to: string): Promise<SalespersonSummaryRow[]> {
  const rows = unwrap<SalespersonSummaryRow[]>(await supabase.rpc("salesperson_summary", { p_from: from, p_to: to }));
  return rows.map((r) => ({ ...r, profit: Number(r.profit) }));
}

const ALL: Omit<RegisterFilters, "basis" | "from" | "to"> = { status: "", salesPersonId: "", mode: "", q: "" };

/** For the daily / weekly / monthly reports: enquiries raised in the range, and jobs confirmed in it. */
export async function fetchPeriodRows(from: string, to: string): Promise<{ raised: EnquiryRow[]; confirmed: EnquiryRow[] }> {
  const [raised, confirmed] = await Promise.all([
    fetchRegisterAll({ ...ALL, basis: "enquiry_date", from, to }),
    fetchRegisterAll({ ...ALL, basis: "confirmed_date", from, to, status: "confirmed" }),
  ]);
  return { raised, confirmed };
}

export async function fetchBreakdown(from: string, to: string, dimension: BreakdownDimension): Promise<BreakdownRow[]> {
  const rows = unwrap<BreakdownRow[]>(await supabase.rpc("enquiry_breakdown", { p_from: from, p_to: to, p_dimension: dimension }));
  return rows.map((r) => ({ ...r, sell_total: Number(r.sell_total), profit: Number(r.profit) }));
}

export async function fetchMonthlyTrend(from: string, to: string): Promise<MonthlyTrendRow[]> {
  const rows = unwrap<MonthlyTrendRow[]>(await supabase.rpc("monthly_trend", { p_from: from, p_to: to }));
  return rows.map((r) => ({
    ...r,
    converted_profit: Number(r.converted_profit),
    confirmed_sell: Number(r.confirmed_sell),
    confirmed_profit: Number(r.confirmed_profit),
  }));
}
