import { describe, expect, it } from "vitest";
import { normaliseAiResult } from "./ai.ts";
import {
  buildDraft,
  decideWithAi,
  decideWithoutAi,
  OPERATIONS_NOTE,
  planWithoutAi,
  PROBABLY_OPERATIONS_NOTE,
  UNMATCHED_FOLLOW_UP_NOTE,
  UNMATCHED_PRICING_NOTE,
} from "./decide.ts";
import { parseGmailMessage } from "./parse.ts";
import { aiAnswer, candidate, emptyContext, gmailMessage, type FakeMessage } from "./testFixtures.ts";
import type { MatchContext } from "./types.ts";

const opts = { mailbox: "pricing@silverlynx.test", internalDomains: ["silverlynx.test"] };
const email = (m: FakeMessage = {}) => parseGmailMessage(gmailMessage({ date: "2026-11-04T09:00:00Z", ...m }), opts);
const ai = (ctx: MatchContext, overrides: Record<string, unknown> = {}) => normaliseAiResult(aiAnswer(overrides), ctx);
const ref = (enquiry_date = "2026-11-01") => ({ reference: "SL262700", enquiry_id: "e1", enquiry_date, status: "quoted" });

describe("planWithoutAi", () => {
  it("links a known reference", () => {
    const plan = planWithoutAi(email(), emptyContext({ ref_matches: [ref()] }));
    expect(plan).toMatchObject({ kind: "final", outcome: { decision: { status: "linked", match_method: "reference", enquiry_id: "e1" } } });
  });

  it("asks Claude to double-check a customer writing about an old enquiry", () => {
    expect(planWithoutAi(email(), emptyContext({ ref_matches: [ref("2026-08-01")] }))).toEqual({
      kind: "ai",
      recheck: { enquiry_id: "e1", reference: "SL262700", enquiry_date: "2026-08-01", method: "reference" },
    });
    // Agents and colleagues writing about an old job are simply linked.
    expect(planWithoutAi(email({ from: "ops@silverlynx.test" }), emptyContext({ ref_matches: [ref("2026-08-01")] })).kind).toBe("final");
  });

  it("follows reply headers to an enquiry or a pending draft", () => {
    const reply = { email_id: "m0", enquiry_id: "e2", reference: "SL262701", enquiry_date: "2026-11-02", status: "new", draft_id: null };
    expect(planWithoutAi(email(), emptyContext({ reply_match: reply }))).toMatchObject({ outcome: { decision: { status: "linked", match_method: "reply", enquiry_id: "e2" } } });
    expect(planWithoutAi(email(), emptyContext({ reply_match: { ...reply, enquiry_id: null, reference: null, enquiry_date: null, draft_id: "d1" } }))).toMatchObject({
      outcome: { decision: { status: "draft", match_method: "reply", draft_id: "d1" } },
    });
  });

  it("parks unknown references, ignores bulk and own unmatched mail, and sends the rest to Claude", () => {
    expect(planWithoutAi(email(), emptyContext({ unknown_refs: ["SL262999"] }))).toMatchObject({
      outcome: { decision: { status: "awaiting_enquiry", note: expect.stringContaining("SL262999") } },
    });
    expect(planWithoutAi(email({ labels: ["CATEGORY_PROMOTIONS"] }), emptyContext())).toMatchObject({ outcome: { decision: { status: "ignored", match_method: "rule" } } });
    expect(planWithoutAi(email({ from: "pricing@silverlynx.test" }), emptyContext())).toMatchObject({ outcome: { decision: { status: "ignored" } } });
    expect(planWithoutAi(email(), emptyContext())).toEqual({ kind: "ai", recheck: null });
  });

  it("prefers references over bulk flags (a carrier notice about our job is history)", () => {
    expect(planWithoutAi(email({ labels: ["CATEGORY_PROMOTIONS"] }), emptyContext({ ref_matches: [ref()] }))).toMatchObject({ outcome: { decision: { status: "linked" } } });
  });
});

describe("decideWithAi", () => {
  it("creates a draft for a new enquiry, with the deterministic sales person first", () => {
    const ctx = emptyContext({ sales_person: "AMAL", customer: { id: "c1", name: "EXAMPLE TRADING LLC", via: "contact" } });
    const out = decideWithAi(email(), ctx, ai(ctx), null);
    expect(out.decision).toMatchObject({ status: "draft", classification: "new_enquiry", match_method: "ai" });
    expect(out.new_draft).toMatchObject({
      customer_name: "EXAMPLE TRADING LLC",
      customer_id: "c1",
      contact_email: "ahmed@example-trading.com",
      sales_person_name: "AMAL",
      fields: { enquiry_date: "2026-11-04", trade_type: "IMP", qty_text: "1X40' HC", subject: "1X40' HC EX-WORKS NINGBO CHINA TO SOHAR OMAN" },
    });
    expect(out.ai_result?.draft).toEqual(out.new_draft);
  });

  it("uses the forwarded customer's details when a colleague forwards a request", () => {
    const e = email({ from: "Sales <sales3@silverlynx.test>" });
    const draft = buildDraft(e, emptyContext(), ai(emptyContext()));
    expect(draft).toMatchObject({ customer_name: "EXAMPLE TRADING LLC", contact_email: "ahmed@example-trading.com", contact_name: "Ahmed Khan", sales_person_name: "VIVEK" });
  });

  it("links a confident follow-up and sends an unsure one to review with a suggestion", () => {
    const ctx = emptyContext({ candidates: [candidate()] });
    const sure = decideWithAi(email(), ctx, ai(ctx, { classification: "follow_up", related_candidate_id: candidate().id, confidence: 0.9 }), null);
    expect(sure.decision).toMatchObject({ status: "linked", enquiry_id: candidate().id });
    expect(sure.new_draft).toBeNull();
    const unsure = decideWithAi(email(), ctx, ai(ctx, { classification: "follow_up", related_candidate_id: candidate().id, confidence: 0.5 }), null);
    expect(unsure.decision).toMatchObject({ status: "review", suggested_enquiry_id: candidate().id, enquiry_id: null });
    const unknown = decideWithAi(email(), ctx, ai(ctx, { classification: "follow_up" }), null);
    expect(unknown.decision.status).toBe("review");
  });

  it("ignores operational follow-ups it cannot tie to an enquiry and keeps pricing ones for review", () => {
    const ctx = emptyContext({ candidates: [candidate()] });
    const decide = (o: Record<string, unknown>) => decideWithAi(email(), ctx, ai(ctx, { classification: "follow_up", confidence: 0.9, ...o }), null).decision;
    expect(decide({ about_pricing: false })).toMatchObject({ status: "ignored", note: OPERATIONS_NOTE, enquiry_id: null });
    expect(decide({ about_pricing: false, confidence: 0.5 })).toMatchObject({ status: "review", note: PROBABLY_OPERATIONS_NOTE });
    expect(decide({ about_pricing: true })).toMatchObject({ status: "review", note: UNMATCHED_PRICING_NOTE });
    // Answers from before the question (e.g. an older batch) keep the re-classifiable note.
    expect(decide({ about_pricing: undefined })).toMatchObject({ status: "review", note: UNMATCHED_FOLLOW_UP_NOTE });
    // A follow-up tied to an enquiry is linked whatever it is about.
    expect(decide({ about_pricing: false, related_candidate_id: candidate().id })).toMatchObject({ status: "linked", enquiry_id: candidate().id });
  });

  it("attaches a follow-up of a pending draft to that draft", () => {
    const ctx = emptyContext({ candidates: [candidate({ kind: "draft", id: "d1", reference: null })] });
    expect(decideWithAi(email(), ctx, ai(ctx, { classification: "follow_up", related_candidate_id: "d1", confidence: 0.7 }), null).decision).toMatchObject({
      status: "draft",
      draft_id: "d1",
    });
  });

  it("ignores confident non-enquiries only", () => {
    const ctx = emptyContext();
    expect(decideWithAi(email(), ctx, ai(ctx, { classification: "not_enquiry", confidence: 0.9 }), null).decision.status).toBe("ignored");
    expect(decideWithAi(email(), ctx, ai(ctx, { classification: "not_enquiry", confidence: 0.6 }), null).decision.status).toBe("review");
  });

  it("turns 'quote again' on an old enquiry into a new draft, otherwise keeps the link", () => {
    const ctx = emptyContext();
    const recheck = { enquiry_id: "e1", reference: "SL262100", enquiry_date: "2026-07-01", method: "reference" as const };
    const renewed = decideWithAi(email(), ctx, ai(ctx, { confidence: 0.85 }), recheck);
    expect(renewed.decision).toMatchObject({ status: "draft", suggested_enquiry_id: "e1", note: expect.stringContaining("SL262100") });
    expect(renewed.new_draft).not.toBeNull();
    const followUp = decideWithAi(email(), ctx, ai(ctx, { classification: "follow_up", confidence: 0.85 }), recheck);
    expect(followUp.decision).toMatchObject({ status: "linked", enquiry_id: "e1", match_method: "reference" });
  });
});

describe("decideWithoutAi", () => {
  it("keeps deterministic links and sends the rest to review", () => {
    expect(decideWithoutAi({ enquiry_id: "e1", reference: "SL262100", enquiry_date: "2026-07-01", method: "reply" }, "x").decision).toMatchObject({
      status: "linked",
      enquiry_id: "e1",
    });
    expect(decideWithoutAi(null, "Claude unavailable").decision).toMatchObject({ status: "review", note: "Claude unavailable" });
  });
});
