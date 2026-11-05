import { describe, expect, it } from "vitest";
import {
  type BatchClassifier,
  type BatchDb,
  type BatchItem,
  DEFAULT_OPTIONS,
  type PendingBatch,
  runReclassify,
  runReclassifyBatch,
  runSync,
  type IngestPayload,
  type MatchInput,
  type SyncDeps,
  type SyncStats,
  type UnclassifiedEmail,
} from "./sync.ts";
import { aiAnswer, emptyContext, gmailMessage } from "./testFixtures.ts";
import type { GmailMessage, MatchContext } from "./types.ts";

interface Harness {
  deps: SyncDeps;
  ingested: IngestPayload[];
  reingested: { emailId: string; payload: IngestPayload }[];
  uploads: string[];
  matchInputs: MatchInput[];
  ended: { syncFrom: string | null; error: string | null; stats: SyncStats }[];
  listQueries: string[];
  unclassifiedLimits: number[];
}

function harness(
  messages: GmailMessage[],
  opts: {
    known?: string[];
    context?: (input: MatchInput) => Partial<MatchContext>;
    classify?: SyncDeps["classify"];
    ingestFails?: (p: IngestPayload) => boolean;
    lease?: { sync_from: string | null } | null;
    options?: Partial<SyncDeps["options"]>;
    /** Stored unclassified e-mails, oldest first (what db.unclassified returns). */
    unclassified?: UnclassifiedEmail[];
    /** Rows reingest reports as handled meanwhile. */
    handled?: string[];
  } = {},
): Harness {
  const h: Harness = {
    ingested: [],
    reingested: [],
    uploads: [],
    matchInputs: [],
    ended: [],
    listQueries: [],
    unclassifiedLimits: [],
  } as unknown as Harness;
  const byId = new Map(messages.map((m) => [m.id, m]));
  h.deps = {
    options: { ...DEFAULT_OPTIONS, mailbox: "pricing@silverlynx.test", internalDomains: ["silverlynx.test"], ...opts.options },
    now: () => new Date("2026-11-04T12:00:00Z"),
    gmail: {
      async listMessageIds(q) {
        h.listQueries.push(q);
        // newest first, like Gmail
        return [...messages].sort((a, b) => Number(b.internalDate) - Number(a.internalDate)).map((m) => ({ id: m.id, threadId: m.threadId }));
      },
      async getMessage(id) {
        return byId.get(id)!;
      },
      async getAttachment(_m, attachmentId) {
        return new TextEncoder().encode(`bytes of ${attachmentId}`);
      },
    },
    db: {
      async beginSync() {
        return opts.lease === undefined ? { sync_from: "2026-11-04T10:00:00Z" } : opts.lease;
      },
      async endSync(_mb, syncFrom, error, stats) {
        h.ended.push({ syncFrom, error, stats });
      },
      async knownIds(ids) {
        return new Set(ids.filter((id) => opts.known?.includes(id)));
      },
      async matchContext(input) {
        h.matchInputs.push(input);
        return emptyContext(opts.context?.(input));
      },
      async ingest(p) {
        if (opts.ingestFails?.(p)) throw new Error("check constraint");
        h.ingested.push(p);
        return { status: p.new_draft ? "draft" : p.decision.status };
      },
      async unclassified(limit) {
        h.unclassifiedLimits.push(limit);
        return (opts.unclassified ?? []).slice(0, limit);
      },
      async reingest(emailId, p) {
        if (opts.handled?.includes(emailId)) return { email_id: emailId, skipped: true } as { skipped: boolean };
        h.reingested.push({ emailId, payload: p });
        return { status: p.new_draft ? "draft" : p.decision.status };
      },
    },
    storage: {
      async upload(path) {
        h.uploads.push(path);
      },
    },
    classify: opts.classify === undefined ? async () => aiAnswer() : opts.classify,
  };
  return h;
}

const at = (iso: string) => ({ date: iso });

describe("runSync", () => {
  it("processes new mail oldest first, skips known messages and drafts, and advances the checkpoint", async () => {
    const h = harness(
      [
        gmailMessage({ id: "a", threadId: "t1", ...at("2026-11-04T10:30:00Z") }),
        gmailMessage({ id: "b", threadId: "t1", subject: "RE: SL262700", ...at("2026-11-04T11:00:00Z") }),
        gmailMessage({ id: "c", threadId: "t2", ...at("2026-11-04T10:45:00Z") }),
        gmailMessage({ id: "d", threadId: "t3", labels: ["DRAFT"], ...at("2026-11-04T11:10:00Z") }),
      ],
      {
        known: ["c"],
        context: (input) => (input.sl_refs.includes("SL262700") ? { ref_matches: [{ reference: "SL262700", enquiry_id: "e1", enquiry_date: "2026-11-01", status: "new" }] } : {}),
      },
    );
    const stats = await runSync(h.deps);
    expect(h.listQueries[0]).toBe(`after:${Date.parse("2026-11-04T09:00:00Z") / 1000} -in:drafts -in:chats`);
    expect(h.ingested.map((p) => p.email.gmail_message_id)).toEqual(["a", "b"]);
    expect(h.ingested[0]).toMatchObject({ decision: { status: "draft", classification: "new_enquiry" }, new_draft: { customer_name: "EXAMPLE TRADING LLC" } });
    expect(h.ingested[1]).toMatchObject({ decision: { status: "linked", enquiry_id: "e1" }, new_draft: null, ai_result: null });
    expect(h.matchInputs[0]).toMatchObject({ customer_email: "ahmed@example-trading.com", participants: ["ahmed@example-trading.com", "pricing@silverlynx.test"] });
    expect(stats).toMatchObject({ listed: 4, new: 3, processed: 2, draft: 1, linked: 1, ai_calls: 1, errors: 0, deferred: 0 });
    expect(h.ended).toEqual([{ syncFrom: "2026-11-04T12:00:00.000Z", error: null, stats }]);
  });

  it("stores real attachments, not signature images, and none for ignored mail", async () => {
    const files = [
      { filename: "image001.png", mimeType: "image/png", size: 3_000, contentId: "<i1>", disposition: "inline" },
      { filename: "RFQ 12/2026.pdf", mimeType: "application/pdf", size: 40_000 },
    ];
    const h = harness([
      gmailMessage({ id: "keep", attachments: files, ...at("2026-11-04T10:30:00Z") }),
      gmailMessage({ id: "promo", labels: ["CATEGORY_PROMOTIONS"], attachments: files, ...at("2026-11-04T10:40:00Z") }),
    ]);
    await runSync(h.deps);
    const stored = (id: string) => h.ingested.find((p) => p.email.gmail_message_id === id)!.email.attachments;
    expect(h.uploads).toEqual(["2026/11/keep/1-RFQ_12_2026.pdf"]);
    expect(stored("keep")).toEqual([
      { filename: "RFQ 12/2026.pdf", mime_type: "application/pdf", size: 40_000, inline: false, storage_path: "2026/11/keep/1-RFQ_12_2026.pdf", skipped: null },
    ]);
    expect(stored("promo")).toMatchObject([{ storage_path: null, skipped: "not kept for ignored e-mails" }]);
  });

  it("sends the e-mail to review when Claude fails or is not configured", async () => {
    const failing = harness([gmailMessage({ id: "x" })], {
      classify: async () => {
        throw new Error("overloaded");
      },
    });
    await runSync(failing.deps);
    expect(failing.ingested[0].decision).toMatchObject({ status: "review", note: "Not classified: overloaded" });

    const none = harness([gmailMessage({ id: "y" })], { classify: null });
    await runSync(none.deps);
    expect(none.ingested[0].decision.note).toMatch(/not configured/);
  });

  it("keeps a message that cannot be stored as classified, for review", async () => {
    const h = harness([gmailMessage({ id: "x" })], { ingestFails: (p) => p.new_draft !== null });
    const stats = await runSync(h.deps);
    expect(h.ingested).toHaveLength(1);
    expect(h.ingested[0]).toMatchObject({ new_draft: null, decision: { status: "review", note: expect.stringContaining("check constraint") } });
    expect(stats.review).toBe(1);
  });

  it("does not move the checkpoint while messages are deferred", async () => {
    const h = harness(
      [gmailMessage({ id: "m1", threadId: "t1", ...at("2026-11-04T10:30:00Z") }), gmailMessage({ id: "m2", threadId: "t2", ...at("2026-11-04T10:31:00Z") })],
      { options: { maxMessages: 1, concurrency: 1 } },
    );
    const stats = await runSync(h.deps);
    expect(h.ingested.map((p) => p.email.gmail_message_id)).toEqual(["m1"]);
    expect(stats).toMatchObject({ processed: 1, deferred: 1 });
    expect(h.ended[0].syncFrom).toBeNull();
  });

  it("does nothing while another run holds the lease", async () => {
    const h = harness([gmailMessage()], { lease: null });
    expect((await runSync(h.deps)).skipped).toMatch(/Another sync/);
    expect(h.ended).toEqual([]);
  });

  it("records a failed run and rethrows", async () => {
    const h = harness([]);
    h.deps.gmail.listMessageIds = async () => {
      throw new Error("Google sign-in failed (400)");
    };
    await expect(runSync(h.deps)).rejects.toThrow("Google sign-in failed");
    expect(h.ended[0]).toMatchObject({ syncFrom: null, error: "Google sign-in failed (400)" });
  });
});

describe("runReclassify", () => {
  const stored = (id: string, threadId: string): UnclassifiedEmail => ({ id: `row-${id}`, gmail_message_id: id, gmail_thread_id: threadId });
  const messages = () => [
    gmailMessage({ id: "a", threadId: "t1", ...at("2026-11-04T10:30:00Z") }),
    gmailMessage({ id: "b", threadId: "t1", subject: "RE: SL262700", ...at("2026-11-04T11:00:00Z") }),
    gmailMessage({ id: "c", threadId: "t2", ...at("2026-11-04T10:45:00Z") }),
  ];
  // Every message is already stored: that must not stop a re-classification.
  const storedContext = (input: MatchInput): Partial<MatchContext> => ({
    already_ingested: true,
    ...(input.sl_refs.includes("SL262700")
      ? { ref_matches: [{ reference: "SL262700", enquiry_id: "e1", enquiry_date: "2026-11-01", status: "new" }] }
      : {}),
  });

  it("re-files stored e-mails with Claude through reingest, oldest first per conversation, without touching the mailbox", async () => {
    const h = harness(messages(), {
      context: storedContext,
      unclassified: [stored("a", "t1"), stored("c", "t2"), stored("b", "t1")],
    });
    const stats = await runReclassify(h.deps, 40);
    const order = h.reingested.map((r) => r.emailId);
    expect([...order].sort()).toEqual(["row-a", "row-b", "row-c"]);
    expect(order.indexOf("row-a")).toBeLessThan(order.indexOf("row-b"));
    const byRow = (id: string) => h.reingested.find((r) => r.emailId === id)!.payload;
    expect(byRow("row-a")).toMatchObject({ decision: { status: "draft", classification: "new_enquiry" }, new_draft: { customer_name: "EXAMPLE TRADING LLC" } });
    expect(byRow("row-b")).toMatchObject({ decision: { status: "linked", enquiry_id: "e1" }, new_draft: null });
    expect(h.ingested).toEqual([]);
    expect(h.ended).toEqual([]); // no lease, checkpoint or last-sync change
    expect(stats).toMatchObject({ candidates: 3, processed: 3, draft: 2, linked: 1, ai_calls: 2, skipped: 0, errors: 0, deferred: 0 });
  });

  it("leaves the stored e-mail as it is when Claude still fails", async () => {
    const h = harness([gmailMessage({ id: "x" })], {
      context: () => ({ already_ingested: true }),
      unclassified: [stored("x", "t1")],
      classify: async () => {
        throw new Error("overloaded");
      },
    });
    const stats = await runReclassify(h.deps, 40);
    expect(h.reingested).toEqual([]);
    expect(h.ingested).toEqual([]);
    expect(stats).toMatchObject({ candidates: 1, processed: 0, errors: 1 });
    expect(stats.error_messages[0]).toBe("x: still not classified: overloaded");
  });

  it("refuses to run without Claude", async () => {
    const h = harness([gmailMessage({ id: "x" })], { unclassified: [stored("x", "t1")], classify: null });
    await expect(runReclassify(h.deps, 40)).rejects.toThrow(/not configured/);
    expect(h.reingested).toEqual([]);
  });

  it("counts e-mails handled meanwhile as skipped and caps the batch size", async () => {
    const h = harness(messages(), {
      context: storedContext,
      unclassified: [stored("a", "t1"), stored("c", "t2"), stored("b", "t1")],
      handled: ["row-c"],
    });
    const stats = await runReclassify(h.deps, 5000);
    expect(h.unclassifiedLimits).toEqual([DEFAULT_OPTIONS.maxMessages]);
    expect(stats).toMatchObject({ candidates: 3, processed: 2, skipped: 1, errors: 0 });
  });

  it("defers what does not fit in the time budget", async () => {
    const h = harness(messages(), {
      context: storedContext,
      unclassified: [stored("a", "t1"), stored("c", "t2")],
      options: { timeBudgetMs: -1 },
    });
    const stats = await runReclassify(h.deps, 40);
    expect(h.reingested).toEqual([]);
    expect(stats).toMatchObject({ candidates: 2, processed: 0, deferred: 2 });
  });
});

describe("runReclassifyBatch", () => {
  const stored = (id: string, threadId: string): UnclassifiedEmail => ({ id: `row-${id}`, gmail_message_id: id, gmail_thread_id: threadId });
  const messages = () => [
    gmailMessage({ id: "a", threadId: "t1", ...at("2026-11-04T10:30:00Z") }),
    gmailMessage({ id: "b", threadId: "t1", subject: "RE: SL262700", ...at("2026-11-04T11:00:00Z") }),
    gmailMessage({ id: "c", threadId: "t2", ...at("2026-11-04T10:45:00Z") }),
  ];
  const storedContext = (input: MatchInput): Partial<MatchContext> => ({
    already_ingested: true,
    ...(input.sl_refs.includes("SL262700")
      ? { ref_matches: [{ reference: "SL262700", enquiry_id: "e1", enquiry_date: "2026-11-01", status: "new" }] }
      : {}),
  });
  // The live classifier must never run in batch mode.
  const noLiveCalls: SyncDeps["classify"] = async () => {
    throw new Error("live classifier called");
  };

  function fakeBatch(opts: { pending?: PendingBatch | null; ended?: boolean; results?: Map<string, { answer: unknown } | { error: string }>; open?: string[] } = {}) {
    const state = {
      submitted: [] as BatchItem[][],
      saved: [] as { batchId: string; items: UnclassifiedEmail[] }[],
      finished: [] as { id: string; state: string }[],
    };
    const client: BatchClassifier = {
      async submit(items) {
        state.submitted.push(items);
        return "msgbatch_1";
      },
      async isEnded() {
        return opts.ended ?? true;
      },
      async results() {
        return opts.results ?? new Map();
      },
    };
    const db: BatchDb = {
      async pendingBatch() {
        return opts.pending ?? null;
      },
      async saveBatch(batchId, items) {
        state.saved.push({ batchId, items });
      },
      async finishBatch(id, stats) {
        state.finished.push({ id, state: stats.state });
      },
      async stillUnclassified(ids) {
        return new Set(ids.filter((id) => !opts.open || opts.open.includes(id)));
      },
    };
    return { client, db, state };
  }

  it("files what the rules decide at once and submits the rest as one batch", async () => {
    const h = harness(messages(), {
      context: storedContext,
      classify: noLiveCalls,
      unclassified: [stored("a", "t1"), stored("c", "t2"), stored("b", "t1")],
    });
    const b = fakeBatch();
    const stats = await runReclassifyBatch(h.deps, b, 200);
    expect(h.reingested.map((r) => r.emailId)).toEqual(["row-b"]);
    expect(h.reingested[0].payload).toMatchObject({ decision: { status: "linked", enquiry_id: "e1" } });
    expect(b.state.submitted).toHaveLength(1);
    expect(b.state.submitted[0].map((i) => i.customId).sort()).toEqual(["row-a", "row-c"]);
    expect(b.state.submitted[0][0].input.email.gmail_message_id).toMatch(/^[ac]$/);
    expect(b.state.saved).toEqual([{ batchId: "msgbatch_1", items: expect.arrayContaining([stored("a", "t1"), stored("c", "t2")]) }]);
    expect(h.ended).toEqual([]);
    expect(stats).toMatchObject({ state: "submitted", batch_id: "msgbatch_1", submitted: 2, candidates: 3, processed: 1, linked: 1, errors: 0 });
  });

  it("waits while the batch is still running", async () => {
    const h = harness(messages(), { context: storedContext, classify: noLiveCalls });
    const b = fakeBatch({ pending: { id: "b1", batch_id: "msgbatch_1", items: [stored("a", "t1")] }, ended: false });
    const stats = await runReclassifyBatch(h.deps, b, 200);
    expect(stats).toMatchObject({ state: "waiting", batch_id: "msgbatch_1" });
    expect(h.reingested).toEqual([]);
    expect(b.state.finished).toEqual([]);
    expect(b.state.submitted).toEqual([]);
  });

  it("files each answer once the batch has ended, leaves failed ones and skips rows handled meanwhile", async () => {
    const h = harness(messages(), { context: storedContext, classify: noLiveCalls });
    const b = fakeBatch({
      pending: { id: "b1", batch_id: "msgbatch_1", items: [stored("a", "t1"), stored("c", "t2"), stored("x", "t3")] },
      results: new Map<string, { answer: unknown } | { error: string }>([
        ["row-a", { answer: aiAnswer() }],
        ["row-c", { error: "overloaded" }],
      ]),
      open: ["row-a", "row-c"], // row-x was handled by staff meanwhile
    });
    const stats = await runReclassifyBatch(h.deps, b, 200);
    expect(h.reingested.map((r) => r.emailId)).toEqual(["row-a"]);
    expect(h.reingested[0].payload).toMatchObject({ decision: { status: "draft", classification: "new_enquiry" } });
    expect(stats).toMatchObject({ state: "collected", candidates: 2, processed: 1, draft: 1, skipped: 1, errors: 1 });
    expect(stats.error_messages[0]).toBe("c: still not classified: overloaded");
    expect(b.state.finished).toEqual([{ id: "b1", state: "collected" }]);
    expect(b.state.submitted).toEqual([]);
  });

  it("keeps the batch open when collecting runs out of time", async () => {
    const h = harness(messages(), { context: storedContext, classify: noLiveCalls, options: { timeBudgetMs: -1 } });
    const b = fakeBatch({
      pending: { id: "b1", batch_id: "msgbatch_1", items: [stored("a", "t1")] },
      results: new Map([["row-a", { answer: aiAnswer() }]]),
    });
    const stats = await runReclassifyBatch(h.deps, b, 200);
    expect(stats).toMatchObject({ state: "collecting", deferred: 1 });
    expect(b.state.finished).toEqual([]);
  });

  it("does nothing when there is nothing to re-classify", async () => {
    const h = harness([], { classify: noLiveCalls });
    const b = fakeBatch();
    const stats = await runReclassifyBatch(h.deps, b, 200);
    expect(stats).toMatchObject({ state: "nothing_to_do", candidates: 0, submitted: 0 });
    expect(b.state.submitted).toEqual([]);
  });
});
