import { supabase } from "./supabase";
import type {
  AuditEntry,
  BreakdownDimension,
  AgentSummary,
  BreakdownRow,
  CustomerSummary,
  CustomerSuggestion,
  DuplicateCandidate,
  EmailListItem,
  EmailMessage,
  EmailStatus,
  Enquiry,
  EnquiryDraft,
  EnquiryPayload,
  EnquiryRow,
  FollowUpRecord,
  HistoryRow,
  HomePrefs,
  ImportBatch,
  ImportPayload,
  InboxCounts,
  MergeResult,
  MonthlyTrendRow,
  NamedRef,
  NotDuplicatePair,
  PortSummary,
  PeriodStats,
  Profile,
  QuoteTime,
  SalespersonSummaryRow,
  ShipmentMode,
  Status,
  SyncResult,
  TeamWin,
  UserAccount,
  WindowEnquiry,
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

// --- Users (admins) --------------------------------------------------------

/** Every login with its e-mail address and last sign-in. The function refuses anyone but admins. */
export async function fetchUsers(): Promise<UserAccount[]> {
  return unwrap(await supabase.rpc("admin_list_users"));
}

/**
 * Changes a login's role or linked sales person. Row Level Security lets only admins update profiles, and for
 * anyone else the update matches no row instead of failing, hence the check.
 */
export async function updateUser(id: string, changes: Partial<Pick<Profile, "role" | "sales_person_id">>): Promise<void> {
  const rows = unwrap<{ id: string }[]>(await supabase.from("profiles").update(changes).eq("id", id).select("id"));
  if (!rows.length) throw new Error("Only administrators can change users, and this login may have been removed.");
}

/** Unlinks every login but `keepUserId` from this sales person. Returns how many were unlinked. */
export async function unlinkSalesPerson(salesPersonId: string, keepUserId: string): Promise<number> {
  const rows = unwrap<{ id: string }[]>(
    await supabase.from("profiles").update({ sales_person_id: null }).eq("sales_person_id", salesPersonId).neq("id", keepUserId).select("id"),
  );
  return rows.length;
}

// --- Master data: customers, agents, ports ----------------------------------

/** The "not the same" pairs of one list, with the stored column names mapped to a / b. */
async function fetchPairs(table: string, a: string, b: string): Promise<NotDuplicatePair[]> {
  const rows = await fetchAllPages<Record<string, string>>((from, to) =>
    supabase.from(table).select(`${a}, ${b}, created_at`).order("created_at", { ascending: false }).range(from, to),
  );
  return rows.map((r) => ({ a: r[a], b: r[b], created_at: r.created_at }));
}

async function deletePair(table: string, a: string, b: string, pair: Pick<NotDuplicatePair, "a" | "b">): Promise<void> {
  unwrap(await supabase.from(table).delete().eq(a, pair.a).eq(b, pair.b));
}

export function fetchCustomerSummaries(): Promise<CustomerSummary[]> {
  return fetchAllPages<CustomerSummary>((from, to) =>
    supabase.from("customer_summary").select("*").order("name").order("id").range(from, to),
  );
}

export const fetchCustomerNotDuplicates = () => fetchPairs("customer_not_duplicates", "customer_a", "customer_b");
export const undoCustomerNotDuplicate = (pair: Pick<NotDuplicatePair, "a" | "b">) =>
  deletePair("customer_not_duplicates", "customer_a", "customer_b", pair);

/** Marks every pair among the customers as different companies, so they are no longer suggested as duplicates. */
export async function markCustomersDistinct(ids: string[]): Promise<number> {
  return unwrap(await supabase.rpc("mark_customers_distinct", { p_ids: ids }));
}

/** Admin only. Moves everything of `merge` onto `keep`, remembers their names, deletes them; optionally renames `keep`. */
export async function mergeCustomers(keep: string, merge: string[], name: string | null): Promise<MergeResult> {
  const r = unwrap<{ name: string; customers: number; enquiries: number }>(
    await supabase.rpc("merge_customers", { p_keep: keep, p_merge: merge, p_name: name }),
  );
  return { name: r.name, merged: r.customers, enquiries: r.enquiries };
}

/** Renames a customer; the old name stays a former name, so imports and e-mails that use it still match. */
export async function renameCustomer(id: string, name: string): Promise<void> {
  unwrap(await supabase.rpc("rename_customer", { p_id: id, p_name: name }));
}

export function fetchAgentSummaries(): Promise<AgentSummary[]> {
  return fetchAllPages<AgentSummary>((from, to) => supabase.from("agent_summary").select("*").order("name").order("id").range(from, to));
}

export const fetchAgentNotDuplicates = () => fetchPairs("agent_not_duplicates", "agent_a", "agent_b");
export const undoAgentNotDuplicate = (pair: Pick<NotDuplicatePair, "a" | "b">) => deletePair("agent_not_duplicates", "agent_a", "agent_b", pair);

export async function markAgentsDistinct(ids: string[]): Promise<number> {
  return unwrap(await supabase.rpc("mark_agents_distinct", { p_ids: ids }));
}

/** Admin only, like mergeCustomers. */
export async function mergeAgents(keep: string, merge: string[], name: string | null): Promise<MergeResult> {
  return unwrap(await supabase.rpc("merge_agents", { p_keep: keep, p_merge: merge, p_name: name }));
}

export async function renameAgent(id: string, name: string): Promise<void> {
  unwrap(await supabase.rpc("rename_agent", { p_id: id, p_name: name }));
}

/** Every port spelling used as POL or POD, with counts (id is the spelling's name key). */
export function fetchPortSummaries(): Promise<PortSummary[]> {
  return fetchAllPages<PortSummary>((from, to) => supabase.from("port_summary").select("*").order("name").order("id").range(from, to));
}

export const fetchPortNotDuplicates = () => fetchPairs("port_not_duplicates", "key_a", "key_b");
export const undoPortNotDuplicate = (pair: Pick<NotDuplicatePair, "a" | "b">) => deletePair("port_not_duplicates", "key_a", "key_b", pair);

export async function markPortsDistinct(keys: string[]): Promise<number> {
  return unwrap(await supabase.rpc("mark_ports_distinct", { p_keys: keys }));
}

/**
 * Admin only. Makes `name` the standard name of these spellings (name keys): rewrites POL / POD on the enquiries
 * and remembers each spelling, so it becomes `name` whenever it is typed or imported again.
 */
export async function mergePorts(keys: string[], name: string): Promise<MergeResult> {
  return unwrap(await supabase.rpc("merge_ports", { p_keys: keys, p_name: name }));
}

/**
 * Standard port name for each known spelling (name key): remembered spellings and the standard names themselves.
 * The import preview uses it so that a known spelling in Excel does not count as a change.
 */
export async function fetchPortNameMap(): Promise<Map<string, string>> {
  const [standard, aliases] = await Promise.all([
    supabase.from("ports").select("name, name_key").then((r) => unwrap<{ name: string; name_key: string }[]>(r)),
    supabase.from("port_aliases").select("alias_key, ports(name)").then((r) => unwrap<{ alias_key: string; ports: { name: string } | null }[]>(r)),
  ]);
  const map = new Map<string, string>(standard.map((p) => [p.name_key, p.name]));
  for (const a of aliases) if (a.ports) map.set(a.alias_key, a.ports.name);
  return map;
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

// --- Follow-ups ------------------------------------------------------------

/** One page of a follow-up band, ordered by its date (the quote, or the enquiry when never quoted). */
export async function queryFollowUps(f: RegisterFilters, page: number, pageSize: number, sort: SortDirection = "desc") {
  const from = page * pageSize;
  const ascending = sort === "asc";
  const { data, error, count } = await filtered(f, "*", { count: "exact" })
    .order(f.basis, { ascending })
    .order("reference", { ascending })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as EnquiryRow[], count: count ?? 0 };
}

/** Number of enquiries under the filters (no rows fetched). */
export async function countRegister(f: RegisterFilters): Promise<number> {
  const { count, error } = await filtered(f, "id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Ids of every enquiry under the filters, for "select all". */
export async function fetchRegisterIds(f: RegisterFilters): Promise<string[]> {
  const rows = await fetchAllPages<{ id: string }>((from, to) => filtered(f, "id").order("reference").range(from, to));
  return rows.map((r) => r.id);
}

/** Closes open enquiries as lost. Returns the ids actually closed (confirmed or closed ones are skipped). */
export async function closeEnquiriesAsLost(ids: string[], reason: string): Promise<string[]> {
  return unwrap(await supabase.rpc("close_enquiries_as_lost", { p_ids: ids, p_reason: reason }));
}

/** Undo for closeEnquiriesAsLost. Returns how many were reopened. */
export async function reopenEnquiries(ids: string[]): Promise<number> {
  return unwrap(await supabase.rpc("reopen_enquiries", { p_ids: ids }));
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

const HISTORY_COLUMNS =
  "id, reference, enquiry_date, quoted_date, confirmed_date, status, shipment_mode, qty_text, pol, pod, customer_name, agent_name, " +
  "buy_total, sell_total, profit";

/** A customer's enquiries raised since a date: the customer's record on the enquiry page. */
export function fetchCustomerHistory(customerId: string, from: string): Promise<HistoryRow[]> {
  return fetchAllPages<HistoryRow>((a, b) =>
    supabase
      .from("enquiry_register")
      .select(HISTORY_COLUMNS)
      .eq("customer_id", customerId)
      .gte("enquiry_date", from)
      .order("enquiry_date", { ascending: false })
      .order("id")
      .range(a, b),
  );
}

/** Enquiries raised since a date with the same POL and POD in any letter case, as the reports' lanes: the lane's history. */
export function fetchLaneHistory(pol: string, pod: string, from: string): Promise<HistoryRow[]> {
  // ilike without wildcards compares ignoring case; a port name's own % or _ must not act as one.
  const exactly = (v: string) => v.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return fetchAllPages<HistoryRow>((a, b) =>
    supabase
      .from("enquiry_register")
      .select(HISTORY_COLUMNS)
      .ilike("pol", exactly(pol))
      .ilike("pod", exactly(pod))
      .gte("enquiry_date", from)
      .order("enquiry_date", { ascending: false })
      .order("id")
      .range(a, b),
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

// --- The Window (a sales person's home page) and the team voyage ----------------

export async function fetchSalesPerson(id: string): Promise<NamedRef | null> {
  return unwrap(await supabase.from("sales_persons").select("id, name").eq("id", id).maybeSingle());
}

const WINDOW_COLUMNS = "id, reference, enquiry_date, quoted_date, confirmed_date, status, customer_id, customer_name, shipment_mode, pol, pod";

/** One sales person's enquiries raised, quoted or confirmed since `from`: their open quotes, wins and customers. */
export function fetchWindowEnquiries(salesPersonId: string, from: string): Promise<WindowEnquiry[]> {
  return fetchAllPages<WindowEnquiry>((a, b) =>
    supabase
      .from("enquiry_register")
      .select(WINDOW_COLUMNS)
      .eq("sales_person_id", salesPersonId)
      .or(`enquiry_date.gte.${from},quoted_date.gte.${from},confirmed_date.gte.${from}`)
      .order("enquiry_date")
      .order("reference")
      .range(a, b),
  );
}

const WIN_COLUMNS = "id, reference, confirmed_date, sales_person_id, sales_person_name, shipment_mode, pol, pod";

/** Jobs confirmed in the range, in the order they were confirmed: the containers on the team ship. */
export function fetchTeamWins(from: string, to: string): Promise<TeamWin[]> {
  return fetchAllPages<TeamWin>((a, b) =>
    supabase
      .from("enquiry_register")
      .select(WIN_COLUMNS)
      .eq("status", "confirmed")
      .gte("confirmed_date", from)
      .lte("confirmed_date", to)
      .order("confirmed_date")
      .order("reference")
      .range(a, b),
  );
}

/** The month's team goal set by an admin, in confirmed jobs; null when none is set. */
export async function fetchTeamGoal(month: string): Promise<number | null> {
  const row = unwrap<{ confirmed_jobs: number } | null>(
    await supabase.from("team_goals").select("confirmed_jobs").eq("month", month).maybeSingle(),
  );
  return row?.confirmed_jobs ?? null;
}

export async function saveTeamGoal(month: string, confirmedJobs: number): Promise<void> {
  unwrap(await supabase.from("team_goals").upsert({ month, confirmed_jobs: confirmedJobs, updated_at: new Date().toISOString() }));
}

/** Every quoted enquiry received since `from`, and whose it is: how quickly each person, and the team, quotes. */
export function fetchQuoteTimes(from: string): Promise<QuoteTime[]> {
  return fetchAllPages<QuoteTime>((a, b) =>
    supabase
      .from("enquiry_register")
      .select("enquiry_date, quoted_date, sales_person_id")
      .gte("enquiry_date", from)
      .not("quoted_date", "is", null)
      .order("enquiry_date")
      .order("id")
      .range(a, b),
  );
}

/** The signed-in user's own home page settings (Row Level Security keeps them private). */
export async function fetchHomePrefs(userId: string): Promise<HomePrefs> {
  const row = unwrap<{ game_plan: HomePrefs | null } | null>(
    await supabase.from("user_prefs").select("game_plan").eq("user_id", userId).maybeSingle(),
  );
  return row?.game_plan ?? {};
}

export async function saveHomePrefs(userId: string, prefs: HomePrefs): Promise<void> {
  unwrap(await supabase.from("user_prefs").upsert({ user_id: userId, game_plan: prefs, updated_at: new Date().toISOString() }));
}

/** Every follow-up logged on these enquiries (by anyone), newest first: the Follow-ups page's rows and The Window's quotes. */
export async function fetchFollowUpHistory(enquiryIds: string[]): Promise<FollowUpRecord[]> {
  if (!enquiryIds.length) return [];
  return unwrap(
    await supabase
      .from("follow_ups")
      .select("enquiry_id, followed_up_on, sales_person_id")
      .in("enquiry_id", enquiryIds)
      .order("followed_up_on", { ascending: false }),
  );
}

export async function logFollowUp(enquiryId: string, salesPersonId: string, day: string): Promise<void> {
  unwrap(await supabase.from("follow_ups").insert({ enquiry_id: enquiryId, sales_person_id: salesPersonId, followed_up_on: day }));
}

export async function undoFollowUp(enquiryId: string, salesPersonId: string, day: string): Promise<void> {
  unwrap(
    await supabase.from("follow_ups").delete().eq("enquiry_id", enquiryId).eq("sales_person_id", salesPersonId).eq("followed_up_on", day),
  );
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
      .order("received_at", { ascending: true }) // a work queue: oldest first
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
