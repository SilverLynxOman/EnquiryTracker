// What to do with one e-mail. Deterministic rules first (references, reply headers), Claude only for the
// rest. Every path ends in a stored row: an e-mail is never dropped, at worst it goes to "review".
import { buildRequirements, buildSubject, enquiryDateOf } from "./ai.ts";
import type { AiResult, Decision, MatchContext, NewDraft, Outcome, ParsedEmail } from "./types.ts";

/** A customer writing about an enquiry older than this is checked by Claude: it may be a new request. */
export const STALE_DAYS = 45;
/** Below these confidences Claude's answer goes to review instead of being applied. */
export const LINK_CONFIDENCE = 0.75;
export const DRAFT_LINK_CONFIDENCE = 0.6;
export const IGNORE_CONFIDENCE = 0.7;
export const RENEWED_ENQUIRY_CONFIDENCE = 0.7;

/**
 * Notes for a follow-up Claude could not tie to a candidate. The first is what answers without
 * about_pricing get (and what every such e-mail got before the field existed); the database treats it
 * as re-classifiable (public.email_is_reclassifiable), so keep the text in step with that function.
 * The others are final: re-classifying never picks them up again.
 */
export const UNMATCHED_FOLLOW_UP_NOTE = "Looks like a follow-up, but the enquiry could not be identified";
export const UNMATCHED_PRICING_NOTE = "Pricing follow-up, but the enquiry could not be identified";
export const OPERATIONS_NOTE = "Operations e-mail – not linked to an enquiry";
export const PROBABLY_OPERATIONS_NOTE = "Probably an operations e-mail, not about pricing";

/** A deterministic match that Claude is asked to double-check. */
export interface Recheck {
  enquiry_id: string;
  reference: string | null;
  enquiry_date: string | null;
  method: "reference" | "reply";
}

export type Plan = { kind: "final"; outcome: Outcome } | { kind: "ai"; recheck: Recheck | null };

function decision(partial: Partial<Decision> & Pick<Decision, "status">): Decision {
  return {
    classification: null,
    match_method: null,
    confidence: null,
    summary: null,
    note: null,
    enquiry_id: null,
    draft_id: null,
    suggested_enquiry_id: null,
    ...partial,
  };
}

const final = (d: Decision): Plan => ({ kind: "final", outcome: { decision: d, new_draft: null, ai_result: null } });

function daysBetween(fromIsoDate: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(`${fromIsoDate}T00:00:00Z`).getTime()) / 86_400_000;
}

function isStale(email: ParsedEmail, enquiryDate: string | null): boolean {
  return email.sender_type === "external" && !!enquiryDate && daysBetween(enquiryDate, email.received_at) > STALE_DAYS;
}

export function planWithoutAi(email: ParsedEmail, ctx: MatchContext): Plan {
  const ref = ctx.ref_matches[0];
  if (ref) {
    if (isStale(email, ref.enquiry_date)) {
      return { kind: "ai", recheck: { enquiry_id: ref.enquiry_id, reference: ref.reference, enquiry_date: ref.enquiry_date, method: "reference" } };
    }
    return final(decision({ status: "linked", classification: "follow_up", match_method: "reference", confidence: 1, enquiry_id: ref.enquiry_id }));
  }

  const reply = ctx.reply_match;
  if (reply?.enquiry_id) {
    if (isStale(email, reply.enquiry_date)) {
      return { kind: "ai", recheck: { enquiry_id: reply.enquiry_id, reference: reply.reference, enquiry_date: reply.enquiry_date, method: "reply" } };
    }
    return final(decision({ status: "linked", classification: "follow_up", match_method: "reply", confidence: 1, enquiry_id: reply.enquiry_id }));
  }
  if (reply?.draft_id) {
    return final(decision({ status: "draft", classification: "follow_up", match_method: "reply", confidence: 1, draft_id: reply.draft_id }));
  }

  if (ctx.unknown_refs.length) {
    return final(
      decision({
        status: "awaiting_enquiry",
        classification: "follow_up",
        match_method: "reference",
        note: `Mentions ${ctx.unknown_refs.join(", ")}, which is not in the register yet. Linked automatically once it is entered or imported.`,
      }),
    );
  }
  if (email.is_bulk) {
    return final(decision({ status: "ignored", classification: "not_enquiry", match_method: "rule", note: "Newsletter, mailing list or automatic reply" }));
  }
  if (email.sender_type === "self") {
    return final(decision({ status: "ignored", match_method: "rule", note: "Sent from the mailbox and not part of a known enquiry" }));
  }
  return { kind: "ai", recheck: null };
}

export function buildDraft(email: ParsedEmail, ctx: MatchContext, ai: AiResult): NewDraft {
  const external = email.sender_type === "external";
  const salesPerson = ctx.sales_person ?? ai.sales_person ?? ctx.customer_sales_person;
  return {
    customer_name: ctx.customer?.name ?? ai.customer.company_name?.toUpperCase() ?? null,
    customer_id: ctx.customer?.id ?? null,
    contact_name: ai.customer.contact_name ?? (external ? email.from_name : null),
    contact_email: (external ? email.from_email : null) ?? ai.customer.contact_email,
    contact_phone: ai.customer.phone,
    contact_designation: ai.customer.designation,
    sales_person_name: salesPerson,
    fields: {
      enquiry_date: enquiryDateOf(email),
      subject: buildSubject(ai.shipment),
      trade_type: ai.shipment.trade_type,
      qty_text: ai.shipment.qty_text,
      shipment_mode: ai.shipment.shipment_mode,
      pol: ai.shipment.pol,
      pod: ai.shipment.pod,
      incoterm: ai.shipment.incoterm,
    },
    requirements: buildRequirements(ai.shipment),
    summary: ai.summary || null,
    confidence: ai.confidence,
  };
}

export function decideWithAi(email: ParsedEmail, ctx: MatchContext, ai: AiResult, recheck: Recheck | null): Outcome {
  const draft = buildDraft(email, ctx, ai);
  const base = { classification: ai.classification, match_method: "ai" as const, confidence: ai.confidence, summary: ai.summary || null };
  const aiResult = { ...ai, draft };
  const out = (d: Decision, newDraft: NewDraft | null = null): Outcome => ({ decision: d, new_draft: newDraft, ai_result: aiResult });

  if (recheck) {
    if (ai.classification === "new_enquiry" && ai.confidence >= RENEWED_ENQUIRY_CONFIDENCE) {
      return out(
        decision({
          ...base,
          status: "draft",
          suggested_enquiry_id: recheck.enquiry_id,
          note: `Refers to ${recheck.reference ?? "an earlier enquiry"}${recheck.enquiry_date ? ` of ${recheck.enquiry_date}` : ""}, but asks for a new quotation`,
        }),
        draft,
      );
    }
    return out(
      decision({ ...base, status: "linked", classification: "follow_up", match_method: recheck.method, confidence: 1, enquiry_id: recheck.enquiry_id }),
    );
  }

  const candidate = ai.related_candidate_id ? ctx.candidates.find((c) => c.id === ai.related_candidate_id) : undefined;
  switch (ai.classification) {
    case "new_enquiry":
      return out(decision({ ...base, status: "draft" }), draft);

    case "follow_up":
      if (candidate?.kind === "enquiry") {
        return ai.confidence >= LINK_CONFIDENCE
          ? out(decision({ ...base, status: "linked", enquiry_id: candidate.id }))
          : out(decision({ ...base, status: "review", suggested_enquiry_id: candidate.id, note: `Probably a follow-up of ${candidate.reference}` }));
      }
      if (candidate?.kind === "draft") {
        return ai.confidence >= DRAFT_LINK_CONFIDENCE
          ? out(decision({ ...base, status: "draft", draft_id: candidate.id }))
          : out(decision({ ...base, status: "review", note: "Probably belongs to a pending e-mail enquiry" }));
      }
      // Not tied to any enquiry. The mailbox is copied on all operational mail: running jobs that never
      // were enquiries here are not for review. Pricing follow-ups are, so someone can link them.
      if (ai.about_pricing === false) {
        return ai.confidence >= IGNORE_CONFIDENCE
          ? out(decision({ ...base, status: "ignored", note: OPERATIONS_NOTE }))
          : out(decision({ ...base, status: "review", note: PROBABLY_OPERATIONS_NOTE }));
      }
      return out(decision({ ...base, status: "review", note: ai.about_pricing ? UNMATCHED_PRICING_NOTE : UNMATCHED_FOLLOW_UP_NOTE }));

    case "not_enquiry":
      return ai.confidence >= IGNORE_CONFIDENCE
        ? out(decision({ ...base, status: "ignored" }))
        : out(decision({ ...base, status: "review", note: "Probably not an enquiry" }));
  }
}

/** Claude unavailable or failed: keep deterministic matches, send the rest to review. */
export function decideWithoutAi(recheck: Recheck | null, reason: string): Outcome {
  if (recheck) {
    return {
      decision: decision({ status: "linked", classification: "follow_up", match_method: recheck.method, confidence: 1, enquiry_id: recheck.enquiry_id }),
      new_draft: null,
      ai_result: null,
    };
  }
  return { decision: decision({ status: "review", note: reason }), new_draft: null, ai_result: null };
}
