// One sync run: list new mail since the checkpoint, process it oldest first, store every message.
// All I/O is injected (SyncDeps) so the run can be tested without Gmail, Claude or a database.
import { attachmentsForAi, normaliseAiResult, type AiAttachment } from "./ai.ts";
import { decideWithAi, decideWithoutAi, planWithoutAi } from "./decide.ts";
import { decodeBase64Url, parseGmailMessage, storedBody } from "./parse.ts";
import type { AttachmentMeta, Decision, GmailMessage, MatchContext, NewDraft, Outcome, ParsedEmail } from "./types.ts";

export interface MatchInput {
  gmail_message_id: string;
  gmail_thread_id: string;
  in_reply_to: string | null;
  reference_ids: string[];
  sl_refs: string[];
  customer_email: string | null;
  participants: string[];
}

export interface IngestPayload {
  mailbox_email: string;
  email: Record<string, unknown>;
  decision: Decision;
  ai_result: Outcome["ai_result"];
  new_draft: NewDraft | null;
}

export interface SyncDb {
  beginSync(mailbox: string, leaseSeconds: number, defaultFrom: string): Promise<{ sync_from: string | null } | null>;
  endSync(mailbox: string, syncFrom: string | null, error: string | null, stats: SyncStats): Promise<void>;
  knownIds(ids: string[]): Promise<Set<string>>;
  matchContext(input: MatchInput): Promise<MatchContext>;
  ingest(payload: IngestPayload): Promise<{ status: string; duplicate?: boolean }>;
  /** Re-classify: stored e-mails waiting for review without Claude's classification, oldest first. */
  unclassified(limit: number): Promise<UnclassifiedEmail[]>;
  /** Re-classify: replaces stored row `emailId` with `payload`, only while it is still unclassified and untouched. */
  reingest(emailId: string, payload: IngestPayload): Promise<{ status?: string; skipped?: boolean }>;
}

export interface UnclassifiedEmail {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
}

export interface SyncGmail {
  listMessageIds(query: string, max: number): Promise<{ id: string; threadId: string }[]>;
  getMessage(id: string): Promise<GmailMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>;
}

export interface SyncStorage {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface ClassifierInput {
  email: ParsedEmail;
  ctx: MatchContext;
  attachments: AiAttachment[];
}
/** Returns Claude's raw JSON answer (normalised by the sync). */
export type Classifier = (input: ClassifierInput) => Promise<unknown>;

export interface SyncOptions {
  mailbox: string;
  internalDomains: string[];
  /** First run: how far back to read. */
  lookbackHours: number;
  /** Re-list this much before the checkpoint (Gmail search indexing lag). Known messages are skipped. */
  overlapMinutes: number;
  maxMessages: number;
  maxList: number;
  timeBudgetMs: number;
  leaseSeconds: number;
  concurrency: number;
  maxAttachmentBytes: number;
}

export const DEFAULT_OPTIONS: Omit<SyncOptions, "mailbox" | "internalDomains"> = {
  lookbackHours: 24,
  overlapMinutes: 60,
  maxMessages: 80,
  maxList: 2000,
  timeBudgetMs: 110_000,
  leaseSeconds: 240,
  concurrency: 3,
  maxAttachmentBytes: 15_000_000,
};

export interface SyncDeps {
  options: SyncOptions;
  gmail: SyncGmail;
  db: SyncDb;
  storage: SyncStorage;
  classify: Classifier | null;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface SyncStats {
  skipped?: string;
  listed: number;
  new: number;
  processed: number;
  linked: number;
  draft: number;
  awaiting_enquiry: number;
  review: number;
  ignored: number;
  ai_calls: number;
  deferred: number;
  errors: number;
  error_messages: string[];
}

const emptyStats = (): SyncStats => ({
  listed: 0,
  new: 0,
  processed: 0,
  linked: 0,
  draft: 0,
  awaiting_enquiry: 0,
  review: 0,
  ignored: 0,
  ai_calls: 0,
  deferred: 0,
  errors: 0,
  error_messages: [],
});

export interface ReclassifyStats {
  candidates: number;
  processed: number;
  linked: number;
  draft: number;
  awaiting_enquiry: number;
  review: number;
  ignored: number;
  /** Handled by staff (or replaced) while this run was working: left as it is. */
  skipped: number;
  ai_calls: number;
  deferred: number;
  errors: number;
  error_messages: string[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Counts a filed message under its status (linked, draft, review, ...). */
function countStatus(stats: { processed: number }, status: string) {
  stats.processed++;
  if (status in stats && status !== "processed") (stats as unknown as Record<string, number>)[status]++;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function safeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "file";
  const ext = dot > 0 ? name.slice(dot).replace(/[^A-Za-z0-9.]+/g, "").slice(0, 10) : "";
  return base + ext;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(runners);
}

type RawAttachment = AttachmentMeta & { data?: string };

export async function runSync(deps: SyncDeps): Promise<SyncStats> {
  const { options: o, gmail, db } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const stats = emptyStats();
  const processMessage = messageProcessor(deps, stats, log);
  const started = now();
  const deadline = started.getTime() + o.timeBudgetMs;

  const lease = await db.beginSync(o.mailbox, o.leaseSeconds, new Date(started.getTime() - o.lookbackHours * 3600_000).toISOString());
  if (!lease) return { ...stats, skipped: "Another sync is running or the mailbox is switched off" };

  let fatal: string | null = null;
  let newSyncFrom: string | null = null;
  try {
    const from = new Date(lease.sync_from ?? started.getTime() - o.lookbackHours * 3600_000).getTime() - o.overlapMinutes * 60_000;
    const listed = await gmail.listMessageIds(`after:${Math.floor(from / 1000)} -in:drafts -in:chats`, o.maxList);
    stats.listed = listed.length;
    const known = await db.knownIds(listed.map((m) => m.id));
    const pending = listed.filter((m) => !known.has(m.id)).reverse(); // Gmail lists newest first
    stats.new = pending.length;

    // Same conversation in order (replies need their original stored first); conversations in parallel.
    const threads = new Map<string, string[]>();
    for (const m of pending) threads.set(m.threadId, [...(threads.get(m.threadId) ?? []), m.id]);

    let startedCount = 0;
    await pool([...threads.values()], o.concurrency, async (ids) => {
      for (const id of ids) {
        if (now().getTime() > deadline || startedCount >= o.maxMessages) {
          stats.deferred++;
          continue;
        }
        startedCount++;
        try {
          const status = await processMessage(id);
          if (status) countStatus(stats, status);
        } catch (e) {
          stats.errors++;
          if (stats.error_messages.length < 5) stats.error_messages.push(`${id}: ${message(e)}`);
          log(`message ${id} failed: ${message(e)}`);
        }
      }
    });

    // Move the checkpoint only when everything listed was handled; otherwise the next run re-lists the
    // same window and skips what is already stored.
    if (stats.errors === 0 && stats.deferred === 0 && listed.length < o.maxList) newSyncFrom = started.toISOString();
  } catch (e) {
    fatal = message(e);
    log(`sync failed: ${fatal}`);
  } finally {
    const error = fatal ?? (stats.errors ? `${stats.errors} message(s) failed: ${stats.error_messages.join(" | ")}` : null);
    await db.endSync(o.mailbox, newSyncFrom, error, stats);
  }
  if (fatal) throw new Error(fatal);
  return stats;
}

/**
 * Re-classifies stored e-mails that went to review without Claude's classification ("Not classified: ..."),
 * oldest first: fetches each from Gmail again, classifies it like new mail and replaces the stored row via
 * db.reingest. A message Claude still cannot classify is left as it is (counted in errors). Does not take
 * the mailbox lease or touch the checkpoint, so it can run next to the scheduled sync; reingest only
 * replaces a row that is still unclassified, so a row handled meanwhile is skipped.
 */
export async function runReclassify(deps: SyncDeps, limit: number): Promise<ReclassifyStats> {
  const { options: o, db, classify } = deps;
  if (!classify) throw new Error("Claude is not configured (ANTHROPIC_API_KEY): nothing can be re-classified");
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const stats: ReclassifyStats = {
    candidates: 0,
    processed: 0,
    linked: 0,
    draft: 0,
    awaiting_enquiry: 0,
    review: 0,
    ignored: 0,
    skipped: 0,
    ai_calls: 0,
    deferred: 0,
    errors: 0,
    error_messages: [],
  };
  const deadline = now().getTime() + o.timeBudgetMs;

  const rows = await db.unclassified(Math.max(1, Math.min(Math.floor(limit) || 1, o.maxMessages)));
  stats.candidates = rows.length;

  // Same conversation in order (oldest first, as returned); conversations in parallel.
  const threads = new Map<string, UnclassifiedEmail[]>();
  for (const r of rows) threads.set(r.gmail_thread_id, [...(threads.get(r.gmail_thread_id) ?? []), r]);

  const processMessage = messageProcessor(deps, stats, log);
  await pool([...threads.values()], o.concurrency, async (items) => {
    for (const r of items) {
      if (now().getTime() > deadline) {
        stats.deferred++;
        continue;
      }
      try {
        const status = await processMessage(r.gmail_message_id, r.id);
        if (status === "skipped") stats.skipped++;
        else if (status) countStatus(stats, status);
      } catch (e) {
        stats.errors++;
        if (stats.error_messages.length < 5) stats.error_messages.push(`${r.gmail_message_id}: ${message(e)}`);
        log(`re-classifying ${r.gmail_message_id} failed: ${message(e)}`);
      }
    }
  });
  return stats;
}

/**
 * Fetches, classifies and stores one Gmail message; returns the stored status, or null when there was
 * nothing to store. With `replace` (the id of the stored row) the message is re-classified instead: the
 * "already stored" check is skipped, a failed classification throws (the stored row stays as it is) and
 * the row is replaced through db.reingest, which returns "skipped" when staff handled it meanwhile.
 */
function messageProcessor(deps: SyncDeps, counters: { ai_calls: number }, log: (m: string) => void) {
  const { options: o, gmail, db, storage, classify } = deps;

  return async function processMessage(id: string, replace?: string): Promise<string | null> {
    const raw = await gmail.getMessage(id);
    if (raw.labelIds?.includes("DRAFT")) return null;
    const email = parseGmailMessage(raw, { mailbox: o.mailbox, internalDomains: o.internalDomains });
    const ctx = await db.matchContext({
      gmail_message_id: email.gmail_message_id,
      gmail_thread_id: email.gmail_thread_id,
      in_reply_to: email.in_reply_to,
      reference_ids: email.reference_ids,
      sl_refs: email.sl_refs,
      customer_email: email.sender_type === "external" ? email.from_email : null,
      participants: [email.from_email, ...email.to_emails, ...email.cc_emails].filter((x): x is string => !!x),
    });
    if (ctx.already_ingested && !replace) return null;

    const downloaded = new Map<RawAttachment, Uint8Array>();
    const download = async (a: RawAttachment): Promise<Uint8Array> => {
      let bytes = downloaded.get(a);
      if (!bytes) {
        if (a.attachment_id) bytes = await gmail.getAttachment(email.gmail_message_id, a.attachment_id);
        else if (a.data) bytes = decodeBase64Url(a.data);
        else throw new Error("no content");
        downloaded.set(a, bytes);
      }
      return bytes;
    };

    const plan = planWithoutAi(email, ctx);
    let outcome: Outcome;
    if (plan.kind === "final") {
      outcome = plan.outcome;
    } else if (!classify) {
      if (replace) throw new Error("Claude is not configured (ANTHROPIC_API_KEY)");
      outcome = decideWithoutAi(plan.recheck, "Not classified: Claude is not configured (ANTHROPIC_API_KEY)");
    } else {
      try {
        const files: AiAttachment[] = [];
        for (const a of attachmentsForAi(email.attachments)) {
          try {
            files.push({ meta: a, base64: bytesToBase64(await download(a)) });
          } catch (e) {
            log(`attachment ${a.filename} of ${id} not read: ${message(e)}`);
          }
        }
        counters.ai_calls++;
        const answer = await classify({ email, ctx, attachments: files });
        outcome = decideWithAi(email, ctx, normaliseAiResult(answer, ctx), plan.recheck);
      } catch (e) {
        if (replace) throw new Error(`still not classified: ${message(e)}`.slice(0, 500));
        log(`classification of ${id} failed: ${message(e)}`);
        outcome = decideWithoutAi(plan.recheck, `Not classified: ${message(e)}`.slice(0, 500));
      }
    }

    const attachments = await keepAttachments(email, outcome.decision.status, download);
    const row: Record<string, unknown> = {
      gmail_message_id: email.gmail_message_id,
      gmail_thread_id: email.gmail_thread_id,
      rfc_message_id: email.rfc_message_id,
      in_reply_to: email.in_reply_to,
      reference_ids: email.reference_ids,
      sender_type: email.sender_type,
      from_email: email.from_email,
      from_name: email.from_name,
      to_emails: email.to_emails,
      cc_emails: email.cc_emails,
      subject: email.subject,
      received_at: email.received_at,
      snippet: email.snippet,
      body_text: storedBody(email),
      sl_refs: email.sl_refs,
      attachments,
      label_ids: email.label_ids,
    };
    const payload: IngestPayload = { mailbox_email: o.mailbox, email: row, ...outcome };
    if (replace) {
      // No fallback here: if the new version cannot be stored, the old row stays (one transaction).
      const result = await db.reingest(replace, payload);
      return result.skipped ? "skipped" : (result.status ?? null);
    }
    try {
      return (await db.ingest(payload)).status;
    } catch (e) {
      // Never lose a message: keep it for review without the classification.
      log(`ingest of ${id} failed, storing for review: ${message(e)}`);
      const fallback: Decision = {
        status: "review",
        classification: null,
        match_method: null,
        confidence: null,
        summary: outcome.decision.summary,
        note: `Could not be filed automatically: ${message(e)}`.slice(0, 500),
        enquiry_id: null,
        draft_id: null,
        suggested_enquiry_id: null,
      };
      return (await db.ingest({ ...payload, decision: fallback, new_draft: null })).status;
    }
  };

  async function keepAttachments(
    email: ParsedEmail,
    status: string,
    download: (a: RawAttachment) => Promise<Uint8Array>,
  ): Promise<AttachmentMeta[]> {
    const out: AttachmentMeta[] = [];
    const files = (email.attachments as RawAttachment[]).filter((a) => !a.inline);
    const month = email.received_at.slice(0, 7).replace("-", "/");
    for (const [i, a] of files.entries()) {
      const meta: AttachmentMeta = { filename: a.filename, mime_type: a.mime_type, size: a.size, inline: false, storage_path: null, skipped: null };
      if (status === "ignored") meta.skipped = "not kept for ignored e-mails";
      else if (a.size > o.maxAttachmentBytes) meta.skipped = `larger than ${Math.round(o.maxAttachmentBytes / 1_000_000)} MB`;
      else {
        const path = `${month}/${email.gmail_message_id}/${i + 1}-${safeName(a.filename)}`;
        try {
          await storage.upload(path, await download(a), a.mime_type);
          meta.storage_path = path;
        } catch (e) {
          meta.skipped = `not stored: ${message(e)}`.slice(0, 200);
        }
      }
      out.push(meta);
    }
    return out;
  }
}
