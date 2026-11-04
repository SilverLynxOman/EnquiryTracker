import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, runSync, type IngestPayload, type MatchInput, type SyncDeps, type SyncStats } from "./sync.ts";
import { aiAnswer, emptyContext, gmailMessage } from "./testFixtures.ts";
import type { GmailMessage, MatchContext } from "./types.ts";

interface Harness {
  deps: SyncDeps;
  ingested: IngestPayload[];
  uploads: string[];
  matchInputs: MatchInput[];
  ended: { syncFrom: string | null; error: string | null; stats: SyncStats }[];
  listQueries: string[];
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
  } = {},
): Harness {
  const h: Harness = { ingested: [], uploads: [], matchInputs: [], ended: [], listQueries: [] } as unknown as Harness;
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
