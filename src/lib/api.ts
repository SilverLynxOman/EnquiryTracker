import { supabase } from "./supabase";
import type {
  AuditEntry,
  CustomerSuggestion,
  DuplicateCandidate,
  EmailListItem,
  EmailMessage,
  EmailStatus,
  Enquiry,
  EnquiryDraft,
  EnquiryPayload,
  EnquiryRow,
  ImportBatch,
  ImportPayload,
  InboxCounts,
  NamedRef,
  PeriodStats,
  SalespersonSummaryRow,
  ShipmentMode,
  Status,
  SyncResult,
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

function registerQuery(f: RegisterFilters, withCount: boolean) {
  let q = supabase.from("enquiry_register").select("*", withCount ? { count: "exact" } : undefined);
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
  return q.order(f.basis, { ascending: false, nullsFirst: false }).order("reference", { ascending: false });
}

export async function queryRegister(f: RegisterFilters, page: number, pageSize: number) {
  const from = page * pageSize;
  const { data, error, count } = await registerQuery(f, true).range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as EnquiryRow[], count: count ?? 0 };
}

export function fetchRegisterAll(f: RegisterFilters): Promise<EnquiryRow[]> {
  return fetchAllPages<EnquiryRow>((from, to) => registerQuery(f, false).range(from, to));
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

export async function fetchExistingByReferences(references: string[]): Promise<Map<string, EnquiryRow>> {
  const out = new Map<string, EnquiryRow>();
  for (let i = 0; i < references.length; i += 200) {
    const chunk = references.slice(i, i + 200);
    const rows = unwrap<EnquiryRow[]>(await supabase.from("enquiry_register").select("*").in("reference", chunk));
    for (const row of rows) out.set(row.reference, row);
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
  return unwrap(await supabase.rpc("salesperson_summary", { p_from: from, p_to: to }));
}

// --- E-mail intake ---------------------------------------------------------

const EMAIL_COLUMNS =
  "id, mailbox_id, gmail_message_id, gmail_thread_id, sender_type, from_email, from_name, to_emails, cc_emails, subject, " +
  "received_at, snippet, body_text, sl_refs, attachments, status, classification, match_method, confidence, summary, note, " +
  "suggested_enquiry_id, enquiry_id, draft_id";

export async function fetchInboxCounts(): Promise<InboxCounts> {
  return unwrap(await supabase.rpc("email_inbox_counts"));
}

export async function fetchPendingDrafts(): Promise<EnquiryDraft[]> {
  const drafts = unwrap<EnquiryDraft[]>(
    await supabase
      .from("enquiry_drafts")
      .select(`*, emails:email_messages(${EMAIL_COLUMNS})`)
      .eq("status", "pending")
      .order("received_at", { ascending: false })
      .limit(200),
  );
  for (const d of drafts) d.emails.sort((a, b) => a.received_at.localeCompare(b.received_at));
  return drafts;
}

export async function fetchDraft(id: string): Promise<EnquiryDraft> {
  const d = unwrap<EnquiryDraft>(
    await supabase.from("enquiry_drafts").select(`*, emails:email_messages(${EMAIL_COLUMNS})`).eq("id", id).single(),
  );
  d.emails.sort((a, b) => a.received_at.localeCompare(b.received_at));
  return d;
}

export async function fetchEmails(status: EmailStatus, limit = 100): Promise<EmailListItem[]> {
  return unwrap(
    await supabase
      .from("email_messages")
      .select(
        `${EMAIL_COLUMNS}, enquiry:enquiries!email_messages_enquiry_id_fkey(id, reference), ` +
          "suggested:enquiries!email_messages_suggested_enquiry_id_fkey(id, reference)",
      )
      .eq("status", status)
      .order("received_at", { ascending: false })
      .limit(limit),
  );
}

export async function fetchEnquiryEmails(enquiryId: string): Promise<EmailMessage[]> {
  return unwrap(
    await supabase.from("email_messages").select(EMAIL_COLUMNS).eq("enquiry_id", enquiryId).order("received_at", { ascending: true }),
  );
}

export async function createEnquiryFromDraft(draftId: string, payload: EnquiryPayload): Promise<Enquiry> {
  return unwrap(await supabase.rpc("create_enquiry_from_draft", { p_draft_id: draftId, p: payload }));
}

export async function mergeDraft(draftId: string, reference: string): Promise<{ enquiry_id: string; reference: string }> {
  return unwrap(await supabase.rpc("merge_draft_into_enquiry", { p_draft_id: draftId, p_reference: reference }));
}

export async function dismissDraft(draftId: string, reason: string | null): Promise<void> {
  unwrap(await supabase.rpc("dismiss_draft", { p_draft_id: draftId, p_reason: reason }));
}

/** Links an e-mail to the enquiry with this reference; a null reference sends it back to review. */
export async function linkEmail(emailId: string, reference: string | null): Promise<{ enquiry_id: string | null; reference: string | null }> {
  return unwrap(await supabase.rpc("link_email", { p_email_id: emailId, p_reference: reference }));
}

export async function setEmailIgnored(emailId: string, ignored: boolean): Promise<void> {
  unwrap(await supabase.rpc("set_email_ignored", { p_email_id: emailId, p_ignored: ignored }));
}

export async function draftFromEmail(emailId: string): Promise<string> {
  return unwrap(await supabase.rpc("draft_from_email", { p_email_id: emailId }));
}

export async function fetchDraftDuplicates(draftId: string): Promise<DuplicateCandidate[]> {
  return unwrap(await supabase.rpc("draft_duplicates", { p_draft_id: draftId }));
}

export async function suggestCustomers(name: string | null, email: string | null): Promise<CustomerSuggestion[]> {
  const rows = unwrap<CustomerSuggestion[]>(await supabase.rpc("suggest_customers", { p_name: name ?? "", p_email: email ?? "" }));
  return rows.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Runs the gmail-sync Edge Function now (editors only). */
export async function checkMailNow(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke<SyncResult>("gmail-sync", { method: "POST", body: {} });
  if (error) {
    // The function answers errors as JSON {error}; show that rather than the generic HTTP message.
    const context = (error as { context?: Response }).context;
    const body = context && typeof context.json === "function" ? await context.json().catch(() => null) : null;
    throw new Error((body as { error?: string } | null)?.error ?? error.message);
  }
  return data ?? {};
}

/** A short-lived link to download a stored attachment under its original name. */
export async function attachmentUrl(path: string, filename: string): Promise<string> {
  const { data, error } = await supabase.storage.from("email-attachments").createSignedUrl(path, 300, { download: filename });
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
