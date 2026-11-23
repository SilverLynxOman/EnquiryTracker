// The enquiry page's reading of an enquiry's e-mails: whose move it is, what was offered, what agents charge, where
// the shipment stands and who is who. Pure and synchronous; nothing is stored. The rules live in ./brief/*.
export * from "./brief/types";
export * from "./brief/constants";
export * from "./brief/read";
export * from "./brief/money";
export * from "./brief/shipment";
export * from "./brief/people";
export * from "./brief/view";

import { muscatDate } from "./emailDrafts";
import { buildStages } from "./enquiryDetails";
import {
  agentsSummaryOf,
  agreedBuy,
  assignMoney,
  currencyClash,
  laneBenchmark,
  marginOf,
  negotiationTrail,
  readAgentRates,
  readOffer,
  readTargets,
  registerMoneyOf,
} from "./brief/money";
import { cargoOf, driftOf, handlerOf, peopleOf, wonCues } from "./brief/people";
import { readMails, type ReadResult } from "./brief/read";
import { assignMilestones, datesOf, documentsOf, journeyOf, modeSetOf, refsOf } from "./brief/shipment";
import type {
  AgentsSummary,
  BriefInput,
  BriefStage,
  CargoCheck,
  CopyTexts,
  DateFacts,
  EnquiryBrief,
  HiddenCounts,
  Margin,
  Move,
  NowAction,
  RefChip,
  RegisterMoney,
  Side,
  SideState,
  Viewer,
} from "./brief/types";
import {
  assignCues,
  copyTextsOf,
  flagsOf,
  headlineMove,
  historyOf,
  lastToCustomerOf,
  mailFollowUpsOf,
  needsYouOf,
  noteReplyWarnings,
  planNow,
  sideStateOf,
  stagesOf,
  statusSentence,
  truthOf,
  type ViewContext,
} from "./brief/view";

/** One reading that fails gives its empty value; the rest of the page still renders. */
function attempt<T>(read: () => T, empty: T): T {
  try {
    return read();
  } catch {
    return empty;
  }
}

const CLOSED_STATUSES = new Set(["lost", "cancelled", "not_genuine"]);
const NO_RIGHTS: Viewer = { canEdit: false, canReply: false, me: null };
const NO_SUMMARY: AgentsSummary = { writtenTo: null, replied: 0, rates: 0, declined: 0, requestOnFile: false, noReplyOnFile: [], lowest: null, text: "" };
const NO_MARGIN: Margin = { figure: null, inputs: null, why: "Needs an offer and an agreed buy", notes: [], clash: null, source: "mail" };
const NO_REGISTER_MONEY: RegisterMoney = { hasRates: false, missingText: null, differs: null, slip: null, prefill: null };
const NO_DATES: DateFacts = { etd: null, eta: null, atd: null, cutoff: null, transit: { ours: null, agent: null }, freeDays: { asked: null, given: null }, validity: [], promises: [], headline: null };
const NO_CARGO: CargoCheck = { fields: [], gaps: [], warning: null, requestBlock: "", askText: "" };
const NO_HIDDEN: HiddenCounts = { autoReplies: 0, loopIns: 0, duplicates: 0, text: "", mails: [] };
const NEUTRAL: SideState = { kind: "nothing_pending", since: null, age: null, tone: "neutral", text: "", proof: null };
const QUIET_MOVE: Move = { kind: "nothing_pending", icon: "clock", tone: "neutral", word: "Nothing pending", why: [], clock: null, sideKey: null, proof: null };
const PLAIN_NOW: NowAction = { kind: "to_quote", tone: "neutral", title: "Read the e-mails below", said: null, lines: [], buttons: [], checkLine: null };

const isoOf = (ts: unknown): string | null => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** The register's steps alone, as the brief's stages. */
const plainStages = (input: BriefInput, today: string): BriefStage[] =>
  attempt(() => buildStages(input.row, Array.isArray(input.followUps) ? input.followUps : [], today), []).map((s) => ({ ...s, byMail: false, proof: null, registerNote: null }));

function referenceChip(reference: string | null | undefined): RefChip[] {
  const value = typeof reference === "string" ? reference.trim() : "";
  return value ? [{ kind: "reference", label: "Reference", value, copyLabel: `Copy reference ${value}`, proof: null }] : [];
}

/**
 * Everything the page shows that is read from the e-mails. Each group reads on its own: one that fails gives its
 * empty value and the page still renders. Never throws, also for an enquiry with no e-mail, a closed one, or a viewer
 * without rights.
 */
export function buildBrief(input: BriefInput): EnquiryBrief {
  try {
    return build(input);
  } catch {
    return emptyBrief(input);
  }
}

function build(input: BriefInput): EnquiryBrief {
  const row = input.row;
  const viewer = input.viewer ?? NO_RIGHTS;
  const dismissed = Array.isArray(input.overrides?.dismissed) ? input.overrides.dismissed : [];
  const read: ReadResult = readMails(input);
  const { mails, sides, today } = read;
  const now = isoOf(input.now) ?? mails[0]?.at ?? new Date(0).toISOString();
  const confirmed = row.status === "confirmed";
  // A closed enquiry owes no reply: a deadline its e-mails set is behind it, not overdue.
  if (CLOSED_STATUSES.has(row.status)) for (const side of sides) side.deadline = null;

  attempt(() => assignMoney(mails, row), undefined);
  attempt(() => assignMilestones(mails, modeSetOf(row, mails), confirmed), undefined);

  const offer = attempt(() => readOffer(mails, row), null);
  const won = attempt(() => wonCues(mails, row, offer), []);
  const agentRates = attempt(() => readAgentRates(sides, mails, row, now), []);
  for (const side of sides) side.agent = agentRates.find((q) => q.sideKey === side.key) ?? null;
  const agentsSummary = attempt(() => agentsSummaryOf(sides, agentRates, today), NO_SUMMARY);
  const buy = attempt(() => agreedBuy(mails, agentRates, row, offer?.basis ?? null), null);
  const targets = attempt(() => readTargets(mails), []);
  const clash = attempt(() => currencyClash(mails), null);
  const margin = attempt(() => marginOf(offer, buy, agentRates.find((q) => q.lowestOnFile) ?? null, row, clash), NO_MARGIN);
  const trail = attempt(() => negotiationTrail(mails, offer, buy), { points: [], sentence: null });
  // With two currencies written for the agent's rate, the buy is not known well enough to suggest it.
  const registerMoney = attempt(() => registerMoneyOf(row, offer, clash ? null : buy, dismissed), NO_REGISTER_MONEY);
  const lane = attempt(() => laneBenchmark(Array.isArray(input.laneHistory) ? input.laneHistory : [], row), null);
  // Only a job confirmed in the register has a sailing: before that no date counts down and none slipped.
  const dates = attempt(() => datesOf(mails, offer, agentRates, today, confirmed), NO_DATES);

  const started = confirmed || won.length > 0;
  const lastToCustomer = attempt(() => lastToCustomerOf(mails), null);
  for (const side of sides) side.state = attempt(() => sideStateOf(side, row, offer, now, { started, lastToCustomer, dates, dismissed }), { ...NEUTRAL });
  attempt(() => assignCues(mails, row, won), undefined);
  attempt(() => noteReplyWarnings(sides, mails, now), undefined);

  const move = attempt(() => headlineMove(sides, row, won, offer, now, dismissed), QUIET_MOVE);
  const stages = attempt(() => stagesOf(row, input.followUps ?? [], mails, offer, won, sides, today, dismissed), plainStages(input, today));
  const journey = started ? attempt(() => journeyOf(row, mails, won, today, agentRates), null) : null;
  const refs = attempt(() => refsOf(mails, row), referenceChip(row.reference));
  const cargo = attempt(() => cargoOf(row, mails), NO_CARGO);
  const drift = attempt(() => driftOf(row, mails, sides, offer, buy, won, dismissed, today), []);
  const handler = attempt(() => handlerOf(mails, row), null);
  const people = attempt(() => peopleOf(sides, mails, handler, row, now), []);
  const documents = attempt(() => documentsOf(mails), []);
  const statusText = attempt(() => statusSentence(row, journey, dates, offer, read.crossFiled, mails), null);
  const mailFollowUps = attempt(() => mailFollowUpsOf(mails, row, offer, won, today), []);

  const ctx: ViewContext = {
    row, mails, sides, crossFiled: read.crossFiled, offer, won, rates: agentRates, buy, clash, registerMoney, journey, dates, drift, handler,
    statusText, cargo, move, followUps: Array.isArray(input.followUps) ? input.followUps : [], mailFollowUps, viewer, mailbox: input.mailbox ?? null,
    now, today, dismissed, salesPersonNames: input.salesPersonNames,
  };
  const copy: CopyTexts = attempt(() => copyTextsOf(ctx), { status: statusText?.text ?? null, offer: null, chase: {}, requestBlock: cargo.requestBlock, houseSubject: "" });
  ctx.copy = copy;
  const truth = attempt(() => truthOf(ctx), null);
  const flags = attempt(() => flagsOf(ctx), []);
  const plan = attempt(() => planNow(ctx), { now: PLAIN_NOW, covers: [] });
  const needsYou = attempt(() => needsYouOf(ctx, plan.covers), []);
  const history = attempt(() => historyOf(ctx), []);

  return {
    mails, sides, hidden: read.hidden, crossFiled: read.crossFiled,
    move, now: plan.now, needsYou, flags, truth,
    offer, agentRates, agentsSummary, buy, targets, margin, trail: trail.points, trailSentence: trail.sentence, registerMoney, laneBenchmark: lane,
    stages, journey, dates, refs, cargo, drift, people, handler, documents,
    statusText, copy, mailFollowUps, history,
  };
}

/** The brief with nothing read: the register's own steps and no e-mail. */
function emptyBrief(input: BriefInput): EnquiryBrief {
  const row = input?.row;
  const now = isoOf(input?.now) ?? new Date(0).toISOString();
  const today = muscatDate(now);
  const customer: Side = {
    key: "customer", kind: "customer", name: row?.customer_name ?? "Customer", domain: null, agentName: null, mails: [], threads: [], lastFromThem: null,
    lastFromUs: null, currentWriter: null, state: { ...NEUTRAL }, questions: [], chase: null, deadline: null, promise: null, replyWindow: null, holiday: null,
    agent: null, pausedByUs: null, fileCount: 0, hiddenCount: 0,
  };
  return {
    mails: [], sides: [customer], hidden: NO_HIDDEN, crossFiled: [],
    move: { ...QUIET_MOVE, kind: "no_mail", word: "No e-mails on file" }, now: PLAIN_NOW, needsYou: [], flags: [], truth: null,
    offer: null, agentRates: [], agentsSummary: NO_SUMMARY, buy: null, targets: [], margin: NO_MARGIN, trail: [], trailSentence: null,
    registerMoney: NO_REGISTER_MONEY, laneBenchmark: null, stages: row ? plainStages(input, today) : [], journey: null, dates: NO_DATES,
    refs: referenceChip(row?.reference), cargo: NO_CARGO, drift: [], people: [], handler: null, documents: [], statusText: null,
    copy: { status: null, offer: null, chase: {}, requestBlock: "", houseSubject: row?.subject ?? "" }, mailFollowUps: [], history: [],
  };
}
