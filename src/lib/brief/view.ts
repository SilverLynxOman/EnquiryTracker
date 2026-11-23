import { daysBetween, displayName, fmtDayMonth, shortPort } from "../display";
import { muscatDate } from "../emailDrafts";
import { buildStages, dayWithWeekday, muscatTime } from "../enquiryDetails";
import { addDays } from "../format";
import { chasedLabel, latestFollowUps, STALE_DAYS } from "../followUps";
import { parseHouseSubject } from "../houseSubject";
import { waitStatus } from "../quoteWindow";
import { replyRecipients, replySubject } from "../replies";
import type { EnquiryRow, FollowUpRecord } from "../types";
import { isWorkingDay, quoteDeadline } from "../workdays";
import { offerFigureOf, toOmr } from "./money";
import { AGENT_DECLINE, AGENT_QUESTION, BOUNCE_BODY, DELEGATE, FINAL, MAIN_LINE, NOISE_SUBJECT, NOISE_TEXT, RATE_REQUEST, REQUEST_BLOCK, SOFT_LOST } from "./patterns";
import { approvesAfterConfirmation, wonCues, wonDay } from "./people";
import { ageOf, bounceAddressOf, isEscalation, isRequest, proofOf, repairedText, sentencesOf, shortWhen, workingHoursBetween } from "./read";
import type {
  ActionButton,
  Age,
  AgentQuote,
  BriefStage,
  Buy,
  CargoCheck,
  CopyTexts,
  CrossFiledGroup,
  Cue,
  CueKey,
  CurrencyClash,
  DatedValue,
  DateFacts,
  Drift,
  Flag,
  FlagKind,
  FormPrefill,
  Handler,
  HistoryEvent,
  IconKey,
  Journey,
  MailFollowUp,
  MilestoneHit,
  MilestoneKey,
  MoneyToken,
  Move,
  MoveKind,
  NeedItem,
  NeedVerb,
  NowAction,
  NowKind,
  Offer,
  Proof,
  ReadMail,
  RegisterMoney,
  ReplyPrefill,
  Side,
  SideState,
  SideStateKind,
  Sourced,
  StatusText,
  SubStepKey,
  Tone,
  TruthTag,
  Viewer,
  WonCue,
} from "./types";

// What the page says: whose move it is in each conversation and for the enquiry, the one thing to do now, what
// else waits, the flags, the truth tag, the progress line, the status text for the customer, the cues on each
// e-mail, reply defaults, copy texts and the e-mail events of the history. Pure and synchronous; every button it
// gives follows the viewer's rights, and nothing here writes to the register.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OMAN_OFFSET = 4 * HOUR;
const OUR_DOMAIN = "silverlynxoman.com";
const OUR_GMAIL = "silverlynxco@gmail.com";

const lower = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
const timeOf = (ts: unknown): number | null => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : null;
};
const isDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
const isoOf = (ts: unknown): string | null => {
  const t = timeOf(ts);
  return t == null ? null : new Date(t).toISOString();
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const moneyText = (amount: number, currency: string, unit?: string | null) => `${currency} ${fmt(amount)}${unit ?? ""}`;
const flat = (text: string) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");
const listOf = <T>(v: readonly (T | null | undefined)[] | null | undefined): T[] => (Array.isArray(v) ? v.filter((x): x is T => x != null) : []);
const isOurAddress = (a: string) => a.endsWith(`@${OUR_DOMAIN}`) || a === OUR_GMAIL;

/** One reading that fails gives its empty value; the rest of the page still reads. */
function attempt<T>(read: () => T, empty: T): T {
  try {
    return read();
  } catch {
    return empty;
  }
}

/** Text on one line, cut at a word to at most max characters. */
function clip(text: string, max = 200): string {
  const body = flat(text);
  return body.length <= max ? body : `${body.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** The Oman calendar day of a timestamp, or "". */
const dayOf = (ts: string | null | undefined): string => {
  const iso = isoOf(ts);
  return iso ? muscatDate(iso) : "";
};
/** "Thu 05 Nov" against today's year. */
const dayText = (day: string, today: string): string => (isDay(day) ? dayWithWeekday(day, isDay(today) ? today : day) : "");
/** "Thu 05 Nov 15:11" (Oman clock). */
const dayTime = (ts: string, today: string): string => {
  const iso = isoOf(ts);
  return iso ? `${dayText(muscatDate(iso), today)} ${muscatTime(iso)}` : "";
};
/** Minutes since midnight on the Oman clock. */
const omanMinutes = (ts: string): number => {
  const t = timeOf(ts);
  if (t == null) return 0;
  const d = new Date(t + OMAN_OFFSET);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
/** "Thu 05 Nov, 16:04" → "Thu 05 Nov 16:04". */
const plainWhen = (when: string) => (typeof when === "string" ? when.replace(",", "") : "");
const firstWord = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
const capital = (text: string) => text.replace(/^./, (c) => c.toUpperCase());

/** In-scope mails, newest first, each once (a mail of ours to several agents sits on several sides). */
function inScopeNewest(mails: readonly ReadMail[] | null | undefined): ReadMail[] {
  const seen = new Set<string>();
  const out: ReadMail[] = [];
  for (const m of listOf(mails)) {
    if (m.scope !== "in" || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

const theirs = (m: ReadMail) => m.party !== "us";
const substantive = (m: ReadMail) => m.kind === "substantive";
const OPEN = new Set(["new", "quoted"]);
const CLOSED = new Set(["lost", "cancelled", "not_genuine"]);
const customerName = (row: EnquiryRow | null | undefined) => displayName(row?.customer_name) || "the customer";

/** The first moment our offer was on file: its mail, or an earlier option or amount of it. */
function offerStartAt(offer: Offer | null, mails: readonly ReadMail[]): string | null {
  if (!offer) return null;
  const byId = new Map(listOf(mails).map((m) => [m.id, m.at]));
  const times = [offer.sentAt, ...listOf(offer.earlier).map((e) => byId.get(e.proof?.emailId ?? "")), ...listOf(offer.options).map((o) => byId.get(o.proof?.emailId ?? ""))]
    .map(isoOf)
    .filter((t): t is string => !!t)
    .sort();
  return times[0] ?? null;
}

const BARE_REMINDER = /^\W*(?:(?:kind|gentle|friendly|2nd|second)\s+)?reminder(?:\s+on\s+(?:the\s+)?below)?\W*$/i;

/** The sentence of a mail that asks: its first unanswered question on the side, else its first request, else its excerpt. */
function askedIn(mail: ReadMail, side: Side | null): string {
  // "Kind reminder on the below." says only that they ask again: the question after it says what about.
  const own = listOf(side?.questions).filter((q) => q.proof.emailId === mail.id);
  const telling = own.filter((q) => !BARE_REMINDER.test(q.sentence));
  const asked = telling.find((q) => !q.answered) ?? telling[0] ?? own.find((q) => !q.answered) ?? own[0];
  if (asked) return asked.sentence;
  return clip(sentencesOf(mail.clean).find((s) => /\?|\b(?:please|pls|kindly|appreciate|awaiting|could you|can you)\b/i.test(s)) ?? mail.excerpt);
}

/** Their mails at the end of a side with no substantive mail of ours after them (newest first). */
function unansweredRun(newestFirst: ReadMail[]): ReadMail[] {
  const run: ReadMail[] = [];
  for (const m of newestFirst) {
    if (!substantive(m)) continue;
    if (!theirs(m)) break;
    run.push(m);
  }
  return run;
}

// --- Steps the e-mails prove (for pass-on, cues and topics) ---------------------------------------------------

const NODE_ORDER: MilestoneKey[] = ["booked", "so", "gate_in", "collected", "picked_up", "waybill", "awb", "in_transit", "sailed", "departed", "bl", "arrived", "can_do", "bayan", "delivered"];
const NODE_NEWS: Record<MilestoneKey, string> = {
  booked: "booked", so: "SO released", gate_in: "gated in", collected: "collected", picked_up: "picked up", waybill: "waybill issued", awb: "AWB issued",
  in_transit: "in transit", sailed: "sailed", departed: "departed", bl: "BL released", arrived: "arrived", can_do: "CAN / DO issued", bayan: "Bayan issued",
  delivered: "delivered",
};
/** What a wait is for: "the SO", "the BL". */
const NODE_TOPIC: Partial<Record<MilestoneKey, string>> = {
  booked: "the booking", so: "the SO", sailed: "the sailing", departed: "the flight", bl: "the BL", arrived: "the arrival", can_do: "the DO", bayan: "the Bayan",
  awb: "the AWB", waybill: "the waybill", collected: "the collection",
};
const SUB_TOPIC: Partial<Record<SubStepKey, string>> = {
  so_requested: "the SO", bl_draft: "the BL draft", bl_final: "the BL", telex: "the telex release", seaway: "the seaway bill", originals: "the originals",
  pre_alert: "the pre-alert", can: "the CAN", do: "the DO", authorization: "the authorization", dn: "the debit note",
};
const nodeAt = (key: MilestoneKey | null) => (key ? NODE_ORDER.indexOf(key) : -1);

/** The furthest step a mail proves (never Delivered), or null. */
function provenHit(mail: ReadMail): MilestoneHit | null {
  let best: MilestoneHit | null = null;
  for (const h of listOf(mail.milestones)) {
    if (!h.proves || !h.key || h.key === "delivered") continue;
    if (!best || nodeAt(h.key) > nodeAt(best.key)) best = h;
  }
  return best;
}

/** Sub-steps that say little about what someone waits for: space and sailing talk, invoices. */
const SIDE_TALK = new Set<SubStepKey>(["space_etd", "carrier_change", "dn", "invoice", "payment"]);

/** What a run of mails waits for, from their steps, newest mail first: "the SO", or null. */
function topicOf(mails: ReadMail[]): string | null {
  for (const m of mails) {
    // What our request itself names comes first: "Please share HS code" waits for the HS code, whatever step it serves.
    const named = m.party === "us" ? sentencesOf(m.clean).filter(isRequest).map(questionTopic).find(Boolean) : null;
    if (named) return named;
    const hits = listOf(m.milestones).filter((h) => !h.sub || !SIDE_TALK.has(h.sub));
    const sub = hits.find((h) => h.sub && SUB_TOPIC[h.sub]);
    if (sub?.sub) return SUB_TOPIC[sub.sub] ?? null;
    const node = [...hits].sort((a, b) => nodeAt(b.key) - nodeAt(a.key)).find((h) => h.key && NODE_TOPIC[h.key]);
    if (node?.key) return NODE_TOPIC[node.key] ?? null;
  }
  return null;
}

/** "ETD 21 Nov (was 06 Nov)" when this mail moved a date, else null. */
function dateChangeIn(mail: ReadMail, dates: DateFacts | null | undefined, today: string): string | null {
  for (const [label, value] of [["ETD", dates?.etd], ["ETA", dates?.eta]] as const) {
    const v = value as DatedValue | null | undefined;
    if (!v || v.plan || !v.earlier?.length || v.proof?.emailId !== mail.id) continue;
    const now = v.date ? fmtDayMonth(v.date, today || v.date) : v.text;
    const was = v.earlier[0].date ? fmtDayMonth(v.earlier[0].date, today || v.earlier[0].date) : v.earlier[0].text;
    return `${label}${label === "ETA" && v.port ? ` ${v.port}` : ""} ${now} (was ${was})`;
  }
  return null;
}

/** Facts beyond one conversation that decide whether an agent's news still has to reach the customer. */
export interface SideFacts {
  /** The job runs: confirmed in the register, or the e-mails show a yes. */
  started?: boolean;
  /** When we last wrote to the customer. */
  lastToCustomer?: string | null;
  /** The dates read from the e-mails: a moved ETD or ETA is news too. */
  dates?: DateFacts | null;
  /** What the reader put away in this browser: "pass_on:{id}" is news told by phone. */
  dismissed?: readonly string[] | null;
}

interface Relay { mail: ReadMail; what: string; sentence: string }

/**
 * The newest step or moved date an agent, carrier or shipper wrote that no mail of ours to the customer followed.
 * News put away with "Done by phone" was passed on: nothing is left to pass on from that conversation.
 */
function relayOf(side: Side, facts: SideFacts, today: string): Relay | null {
  if (!facts.started || !side || (side.kind !== "agent" && side.kind !== "carrier" && side.kind !== "shipper")) return null;
  const after = isoOf(facts.lastToCustomer) ?? "";
  const told = (r: Relay): Relay | null => (listOf(facts.dismissed).includes(`pass_on:${r.mail.id}`) ? null : r);
  for (const m of inScopeNewest(side.mails)) {
    if (!theirs(m)) continue;
    if (after && m.at <= after) break;
    const hit = provenHit(m);
    if (hit?.key) return told({ mail: m, what: NODE_NEWS[hit.key], sentence: hit.sentence || m.excerpt });
    const moved = dateChangeIn(m, facts.dates, today);
    if (moved) return told({ mail: m, what: moved, sentence: m.excerpt });
  }
  return null;
}

// --- Whose move, per side ---------------------------------------------------------------------------------------

const NOTHING: SideState = { kind: "nothing_pending", since: null, age: null, tone: "neutral", text: "", proof: null };

/** The tone of a wait on us: amber after 4 working hours, red from the next working morning for the customer; agents never red. */
function waitTone(customer: boolean, since: string, now: string, age: Age): Tone {
  if (!customer) return age.workingHours >= 24 ? "warn" : "neutral";
  const today = dayOf(now);
  if (today && isWorkingDay(today) && today > dayOf(since) && omanMinutes(now) >= 8 * 60) return "bad";
  return age.workingHours >= 4 ? "warn" : "primary";
}

/**
 * Whose move it is in one conversation, decided by its latest substantive in-scope e-mail (acknowledgements change
 * nothing): waiting for us, said yes, on hold, a rate in hand, news to pass on, they promised, waiting for them,
 * nothing pending, or no written word from the customer at all.
 */
export function sideStateOf(side: Side, row: EnquiryRow, offer: Offer | null, now: string, facts?: SideFacts): SideState {
  try {
    return stateOf(side, row ?? ({} as EnquiryRow), offer ?? null, now, facts ?? {});
  } catch {
    return { ...NOTHING };
  }
}

function stateOf(side: Side, row: EnquiryRow, offer: Offer | null, now: string, facts: SideFacts): SideState {
  if (!side || side.kind === "internal") return { ...NOTHING };
  const mails = inScopeNewest(side.mails);
  const nowIso = isoOf(now) ?? mails[0]?.at ?? "";
  const today = dayOf(nowIso);
  const at = (ts: string) => shortWhen(ts, today);
  const state = (kind: SideStateKind, since: string | null, tone: Tone, text: string, proof: Proof | null, withAge = true): SideState => ({
    kind, since, tone, text, proof, age: withAge && since && nowIso ? ageOf(since, nowIso) : null,
  });
  const customer = side.kind === "customer";

  if (customer && !mails.some(theirs)) {
    const since = offer?.sentAt ?? (isDay(row.quoted_date) ? row.quoted_date : null);
    return state("no_word", since, "neutral", "No written word from them on file", offer?.proof ?? null, false);
  }
  const subs = mails.filter(substantive);
  const latest = subs[0];
  const lastOurs = mails.find((m) => !theirs(m));
  const ourLast = lastOurs ? `our last e-mail ${at(lastOurs.at)}` : "";
  if (!latest) return state("nothing_pending", null, "neutral", ["Nothing pending", ourLast].filter(Boolean).join(" · "), null, false);
  // A closed enquiry waits on nobody: no running clock, no deadline, no news to pass on.
  if (CLOSED.has(row.status)) {
    const said = theirs(latest) ? `“${clip(latest.excerpt, 60)}” ${at(latest.at)}` : `our last e-mail ${at(latest.at)}`;
    return state("nothing_pending", null, "neutral", `Nothing pending · ${said}`, proofOf(latest, today), false);
  }
  const relay = () => relayOf(side, facts, today);
  const relayState = (r: Relay) =>
    state("pass_on", r.mail.at, "info", `Pass on to ${customerName(row)}: ${r.what} · ${at(r.mail.at)}`, proofOf(r.mail, today, r.sentence));

  if (theirs(latest)) {
    const open = OPEN.has(row.status);
    if (customer && latest.party === "customer" && open) {
      const yes = wonCues(side.mails, row, offer).find((c) => c.kind === "customer_yes" && c.proof.emailId === latest.id);
      if (yes) return state("said_yes", latest.at, "good", `Said yes ${at(latest.at)} · not confirmed`, yes.proof, false);
    }
    if (latest.hold) {
      const sentence = sentencesOf(latest.clean).find((s) => /hold|review|finali|postpon|defer|not ready|forwarder|planning via|quotation only|approval/i.test(s)) ?? latest.excerpt;
      return state("on_hold", latest.at, "neutral", `On hold since ${at(latest.at)}`, proofOf(latest, today, sentence), false);
    }
    const run = unansweredRun(mails);
    const ask = run.find((m) => m.isRequest);
    if (ask) {
      const since = run[run.length - 1].at;
      const age = ageOf(since, nowIso);
      const deadline = side.deadline && !side.deadline.cleared ? side.deadline : null;
      const due = deadline ? (deadline.passed ? ` · reply ${deadline.text} passed` : ` · wants a reply ${deadline.text}`) : "";
      return {
        kind: "waiting_on_us", since, age, tone: waitTone(customer, since, nowIso, age),
        text: `Waiting for us since ${at(since)} · ${age.label}${due}`,
        proof: proofOf(ask, today, askedIn(ask, side)),
      };
    }
    if (side.kind === "agent" && latest.moneyRole === "agent_rate" && row.status === "new" && !offer) {
      const age = ageOf(latest.at, nowIso);
      const tone: Tone = age.workingHours >= 20 ? "bad" : age.workingHours >= 10 ? "warn" : "neutral";
      return { kind: "rate_in_hand", since: latest.at, age, tone, text: `Rate in hand since ${at(latest.at)} · no quote on file · ${age.label}`, proof: proofOf(latest, today) };
    }
    const r = relay();
    if (r) return relayState(r);
    if (latest.promise && latest.promise.by === "them") {
      const late = isDay(latest.promise.due) && isDay(today) && latest.promise.due < today;
      const due = isDay(latest.promise.due) ? ` · ${late ? "was due" : "due"} ${dayText(latest.promise.due, today)}` : "";
      return state("they_promised", latest.at, late ? "warn" : "neutral", `They promised an update · ${at(latest.at)}${due}`, latest.promise.proof);
    }
    return state("nothing_pending", null, "neutral", `Nothing pending · “${clip(latest.excerpt, 60)}” ${at(latest.at)}`, proofOf(latest, today), false);
  }

  if (latest.isRequest) {
    return state("waiting_on_them", latest.at, "neutral", `Waiting for ${side.name} · we ${latest.isChase ? "chased" : "asked"} ${at(latest.at)}`, proofOf(latest, today, askedIn(latest, null)));
  }
  const r = relay();
  if (r) return relayState(r);
  // Their acknowledgement after our last word is what the reader sees last: "Noted with thanks".
  const noted = mails[0] && theirs(mails[0]) && mails[0].at > latest.at ? mails[0] : null;
  if (noted) return state("nothing_pending", null, "neutral", `Nothing pending · “${clip(noted.excerpt, 60)}” ${at(noted.at)}`, proofOf(noted, today), false);
  return state("nothing_pending", null, "neutral", ["Nothing pending", ourLast].filter(Boolean).join(" · "), lastOurs ? proofOf(lastOurs, today) : null, false);
}

// --- Whose move, for the enquiry ------------------------------------------------------------------------------

/** Only our own won cues (no yes from the customer), put away with "Not won yet" under won:{day}. */
function putAwayAsNotWon(won: readonly WonCue[] | null | undefined, dismissed: readonly string[] | null | undefined): boolean {
  const cues = listOf(won);
  const day = wonDay(cues);
  return !!day && !cues.some((c) => c.kind === "customer_yes") && listOf(dismissed).includes(`won:${day}`);
}

function closedMove(row: EnquiryRow): Move {
  const reason = row?.closure_reason?.trim();
  const look: Record<string, { word: string; icon: IconKey; tone: Tone }> = {
    lost: { word: "Closed as lost", icon: "close", tone: "bad" },
    not_genuine: { word: "Not a genuine enquiry", icon: "flag", tone: "flag" },
    cancelled: { word: "Cancelled", icon: "ban", tone: "neutral" },
  };
  const l = look[row?.status] ?? look.cancelled;
  return { kind: "closed", icon: l.icon, tone: l.tone, word: l.word, why: reason ? [reason] : [], clock: null, sideKey: null, proof: null };
}

/** The register's own wait, for an enquiry with no e-mail. */
function registerClock(row: EnquiryRow, today: string): string | null {
  if (!isDay(today)) return null;
  if (row?.status === "confirmed" && isDay(row.confirmed_date)) return `Confirmed ${fmtDayMonth(row.confirmed_date, today)}`;
  const quoted = row?.status === "quoted" && isDay(row.quoted_date);
  const from = quoted ? row.quoted_date : row?.enquiry_date;
  if (!isDay(from)) return null;
  const days = Math.max(0, daysBetween(from, today));
  return `${quoted ? "Quoted" : "Received"} ${fmtDayMonth(from, today)} · waiting ${plural(days, "day")} by the register`;
}

const moveOf = (kind: MoveKind, icon: IconKey, tone: Tone, word: string, why: string[], clock: string | null, sideKey: string | null, proof: Proof | null): Move => ({
  kind, icon, tone, word, why: why.filter(Boolean), clock, sideKey, proof,
});
const quoted = (proof: Proof | null) => (proof?.sentence ? `“${proof.sentence}” — ${proof.who}` : "");

/**
 * Whose move it is for the whole enquiry, first that exists: closed, no e-mail, someone waiting for us (the customer
 * before agents, as the Now card answers them; else the oldest),
 * the register behind the e-mails (a yes, our own won cues, a quote not marked), news to pass on, a rate in hand, on
 * hold, waiting for them, agents owing rates, then quiet or nothing pending.
 */
export function headlineMove(sides: Side[], row: EnquiryRow, won: WonCue[], offer: Offer | null, now: string, dismissed?: readonly string[] | null): Move {
  try {
    return headline(listOf(sides), row ?? ({} as EnquiryRow), listOf(won), offer ?? null, now, listOf(dismissed));
  } catch {
    return moveOf("nothing_pending", "clock", "neutral", "Nothing pending", [], null, null, null);
  }
}

function headline(sides: Side[], row: EnquiryRow, won: WonCue[], offer: Offer | null, now: string, dismissed: string[]): Move {
  if (CLOSED.has(row.status)) return closedMove(row);
  const all = inScopeNewest(sides.flatMap((s) => listOf(s.mails)));
  const nowIso = isoOf(now) ?? all[0]?.at ?? "";
  const today = dayOf(nowIso);
  if (!all.length) return moveOf("no_mail", "clock", "neutral", "No e-mails on file", [], registerClock(row, today), null, null);
  const at = (ts: string) => shortWhen(ts, today);
  const clock = (s: Side) => (s.state.since ? `since ${at(s.state.since)}${s.state.age ? ` · ${s.state.age.label}` : ""}` : null);
  const bySince = (a: Side, b: Side) => ((a.state.since ?? "") < (b.state.since ?? "") ? -1 : 1);
  const withState = (kind: SideStateKind) => sides.filter((s) => s.state?.kind === kind).sort(bySince);
  const lastOurs = all.find((m) => !theirs(m) && substantive(m));

  const waitingSides = withState("waiting_on_us");
  const waiting = waitingSides.find((s) => s.kind === "customer") ?? waitingSides[0];
  if (waiting) {
    const customer = waiting.kind === "customer";
    const deadline = waiting.deadline && !waiting.deadline.cleared && !waiting.deadline.passed ? waiting.deadline : null;
    const word = customer ? (deadline ? `Customer wants an answer ${deadline.text}` : "Customer is waiting for us") : `${waiting.name} is waiting for us`;
    const p = waiting.state.proof;
    return moveOf(customer ? "us_customer" : "us_agent", "clock", waiting.state.tone, word, [p ? `${p.who}: “${p.sentence}”` : "", waiting.chase?.text ?? ""], clock(waiting), waiting.key, p);
  }

  // Our own won cues put away with "Not won yet" say nothing about whose move it is.
  if (OPEN.has(row.status) && won.length && !putAwayAsNotWon(won, dismissed)) {
    const yes = won.find((c) => c.kind === "customer_yes");
    const toAgent = won.find((c) => c.kind === "confirmed_to_agent");
    const agentSide = toAgent ? sides.find((s) => s.mails.some((m) => m.id === toAgent.proof.emailId) && s.kind === "agent") : undefined;
    const sameDay = !!toAgent && !!yes && toAgent.day === yes.day;
    const toldAt = toAgent ? (sameDay ? (toAgent.proof.when.split(", ")[1] ?? plainWhen(toAgent.proof.when)) : plainWhen(toAgent.proof.when)) : "";
    const told = toAgent ? `we told ${agentSide?.name ?? "the agent"} to proceed ${toldAt}` : "";
    const nothing = lastOurs ? `Nothing waits on us: our last e-mail ${at(lastOurs.at)}.` : "";
    if (yes) {
      const verb = /nominat/i.test(yes.proof.sentence) ? "Nominated" : "Said yes";
      return moveOf("said_yes", "check", "good", "Said yes — not confirmed", [quoted(yes.proof), `${verb} ${plainWhen(yes.proof.when)}${told ? `; ${told}` : ""}. ${nothing}`.trim()], null, "customer", yes.proof);
    }
    const first = [...won].sort((a, b) => (a.day < b.day ? -1 : 1))[0];
    return moveOf("looks_won", "check", "good", "Looks won", [quoted(first.proof), `${told ? `${capital(told)}. ` : ""}Not confirmed in the register.`], null, null, first.proof);
  }
  if (row.status === "new" && offer) {
    const sent = offer.fromQuotedHistory ? "Our offer is quoted in the customer's reply" : `${offer.sentBy?.name || "We"} sent ${offerFigureOf(offer).text} on ${plainWhen(offer.proof.when)}`;
    return moveOf("quoted_unmarked", "send", "primary", "Quoted by e-mail — not marked", [`${sent}.`, "The register still says awaiting quote."], null, "customer", offer.proof);
  }

  // News told by phone ("Done by phone") is no longer to pass on.
  const relay = withState("pass_on").find((s) => !dismissed.includes(`pass_on:${s.state.proof?.emailId ?? ""}`));
  if (relay) {
    const p = relay.state.proof;
    return moveOf("pass_on", "message", "info", "Pass on to the customer", [p ? `${relay.name}: “${p.sentence}”` : ""], clock(relay), relay.key, p);
  }
  const rate = withState("rate_in_hand")[0];
  if (rate) {
    return moveOf("rate_in_hand", "clock", rate.state.tone, "Rate in hand, no quote on file", [rate.agent?.summary ? `${rate.name}: ${rate.agent.summary}` : `${rate.name}'s rate is in`], clock(rate), rate.key, rate.state.proof);
  }
  const hold = withState("on_hold")[0];
  if (hold) {
    const p = hold.state.proof;
    return moveOf("on_hold", "pause", "neutral", "On hold", [quoted(p), p && SOFT_LOST.test(p.sentence) ? "Sounds lost." : ""], hold.state.since ? `since ${at(hold.state.since)}` : null, hold.key, p);
  }
  const owed = sides.filter((s) => s.state?.kind === "waiting_on_them" || s.state?.kind === "they_promised").sort(bySince).pop();
  if (owed) {
    const promised = owed.state.kind === "they_promised";
    const p = owed.state.proof;
    return moveOf(promised ? "they_promised" : "waiting_on_them", "arrowRight", owed.state.tone, promised ? `${owed.name} promised an update` : `Waiting for ${owed.name}`, [p ? (promised ? `“${p.sentence}”` : `We asked ${at(owed.state.since ?? "")}: “${p.sentence}”`) : ""], clock(owed), owed.key, p);
  }
  const agents = sides.filter((s) => s.kind === "agent" && s.agent);
  const asked = agents.filter((s) => s.agent && (s.agent.state === "written_to" || s.agent.state === "acknowledged" || s.agent.state === "question"));
  if (row.status === "new" && asked.length && !agents.some((s) => s.agent && (s.agent.state === "rated" || s.agent.state === "agreed"))) {
    return moveOf("agents_owe", "arrowRight", "neutral", "Waiting for agents' rates", [`${plural(asked.length, "agent")} asked or answering · no rate yet`], null, null, null);
  }
  const lastSaid = all.find(substantive) ?? all[0];
  const quiet = workingHoursBetween(lastSaid.at, nowIso).working >= 20;
  const lastLine = theirs(lastSaid) ? `Last e-mail: ${lastSaid.from.name}, ${at(lastSaid.at)}` : `Our last e-mail: ${at(lastSaid.at)}`;
  return quiet
    ? moveOf("quiet", "clock", "neutral", "Quiet", [`No e-mail on either side since ${at(lastSaid.at)}`], null, null, proofOf(lastSaid, today))
    : moveOf("nothing_pending", "clock", "neutral", "Nothing pending", [lastLine], null, null, proofOf(lastSaid, today));
}

// --- Progress -----------------------------------------------------------------------------------------------------

/** The e-mails of ours to the customer after the quote and before the yes, one per Oman day: follow-ups the register misses. */
export function mailFollowUpsOf(mails: ReadMail[], row: EnquiryRow, offer: Offer | null, won: WonCue[], today: string): MailFollowUp[] {
  try {
    const list = inScopeNewest(mails).reverse();
    const start = offer && !offer.fromQuotedHistory ? offerStartAt(offer, list) : isDay(row?.quoted_date) ? `${row.quoted_date}T00:00:00+04:00` : null;
    const startIso = isoOf(start);
    if (!startIso) return [];
    const byId = new Map(list.map((m) => [m.id, m.at]));
    const ends = listOf(won).map((c) => byId.get(c.proof?.emailId ?? "") ?? (isDay(c.day) ? isoOf(`${c.day}T00:00:00+04:00`) : null)).filter((t): t is string => !!t);
    if (row?.status === "confirmed" && isDay(row.confirmed_date)) ends.push(isoOf(`${row.confirmed_date}T00:00:00+04:00`) ?? "");
    const end = ends.filter(Boolean).sort()[0] ?? null;
    const out: MailFollowUp[] = [];
    // Our answer to something the customer asked is a reply, not a follow-up.
    let asked = false;
    for (const m of list) {
      if (m.party === "customer" && substantive(m)) asked = m.isRequest;
      if (m.party !== "us" || m.toParty !== "customer" || !substantive(m)) continue;
      const answer = asked;
      asked = false;
      if (answer || m.moneyRole === "offer" || m.at <= startIso || (end && m.at >= end)) continue;
      const known = out.find((f) => f.day === m.day);
      if (known) {
        known.withChaseWords ||= m.isChase;
        continue;
      }
      out.push({ day: m.day, by: m.from?.name ?? "", proof: proofOf(m, today), withChaseWords: m.isChase });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The register's four steps with what the e-mails add: who forwarded the enquiry, a quote the register does not
 * show (or shows on another day), the chasing by e-mail and the customer's own asking, a hold, and a won cue.
 */
export function stagesOf(row: EnquiryRow, followUps: FollowUpRecord[], mails: ReadMail[], offer: Offer | null, won: WonCue[], sides: Side[], today: string, dismissed?: readonly string[] | null): BriefStage[] {
  const base = attempt(() => buildStages(row, listOf(followUps), today), []).map((s): BriefStage => ({ ...s, byMail: false, proof: null, registerNote: null }));
  try {
    const list = inScopeNewest(mails).reverse();
    const stage = (key: BriefStage["key"]) => base.find((s) => s.key === key);
    const customer = listOf(sides).find((s) => s.kind === "customer") ?? null;

    const received = stage("received");
    const first = list[0];
    if (received && first && first.party === "us" && first.toParty === "internal" && (!first.clean.trim() || /^\s*(?:fwd?|fw)\s*:/i.test(first.email?.subject ?? ""))) {
      received.note = [received.note, `forwarded by ${first.from.name}`].filter(Boolean).join(" · ");
      received.proof = proofOf(first, today);
    }

    const offerAt = offerStartAt(offer, list);
    const offerDay = dayOf(offerAt);
    const quotedStage = stage("quoted");
    // A revised offer after the job was confirmed is not the quote the register dates.
    const afterWin = row.status === "confirmed" && isDay(row.confirmed_date) && offerDay > row.confirmed_date;
    if (offer && quotedStage && offerAt && !offer.fromQuotedHistory && !afterWin) {
      if (isDay(row.quoted_date) && offerDay !== row.quoted_date) {
        quotedStage.registerNote = `E-mail says ${dayTime(offerAt, today)}`;
        quotedStage.proof = offer.proof;
      } else if (row.status === "new") {
        Object.assign(quotedStage, { label: "Quoted by e-mail", date: offerDay, note: "Not marked in the register", byMail: true, tone: "warn", proof: offer.proof });
      }
    }

    const chased = stage("chased");
    if (chased && row.status === "quoted") {
      const from = [row.quoted_date, offerDay].filter(isDay).sort().pop() ?? row.enquiry_date;
      chased.label = `Waiting ${plural(Math.max(0, daysBetween(from, today)), "day")}`;
      const byMail = mailFollowUpsOf(mails, row, offer, won, today);
      const newest = byMail[byMail.length - 1];
      const newestAt = newest ? list.find((m) => m.id === newest.proof.emailId)?.at : undefined;
      const parts = [
        listOf(followUps).length ? chased.note : "",
        newestAt ? `chased by e-mail ${shortWhen(newestAt, today)}` : "",
        customer?.chase ? `customer asked ${customer.chase.count}×` : "",
      ].filter(Boolean);
      chased.note = parts.length ? parts.join(" · ") : chased.note;
      if (newest) chased.proof = newest.proof;
    }
    if (chased && OPEN.has(row.status) && customer) {
      if (customer.state.kind === "on_hold" && customer.state.since) {
        Object.assign(chased, { label: `On hold since ${dayText(dayOf(customer.state.since), today)}`, note: customer.state.proof?.sentence ?? chased.note, proof: customer.state.proof, state: "current" });
      } else if (customer.state.kind === "waiting_on_us" && row.status === "quoted") {
        Object.assign(chased, { label: "The customer is waiting for us", proof: customer.state.proof });
      }
    }

    const outcome = stage("outcome");
    const day = OPEN.has(row.status) && !putAwayAsNotWon(won, dismissed) ? wonDay(listOf(won)) : null;
    if (outcome && day) {
      const yes = listOf(won).find((c) => c.kind === "customer_yes");
      const cue = yes ?? listOf(won).find((c) => c.day === day) ?? listOf(won)[0];
      Object.assign(outcome, {
        label: "Looks won", date: day, byMail: true, tone: "good", proof: cue?.proof ?? null,
        note: yes ? `${/nominat/i.test(yes.proof.sentence) ? "Nominated" : "Said yes"} by e-mail — not confirmed in the register` : "We confirmed the agent — not confirmed in the register",
      });
    }
    return base;
  } catch {
    return base;
  }
}

// --- Status for the customer ----------------------------------------------------------------------------------

const KEEP_UPPER = new Set(["LCL", "FCL", "DO", "THC", "CFS", "BL", "AWB", "VGM", "EXW", "FOB", "CIF", "CFR", "DAP", "DDP", "OMR", "USD", "HBL", "MBL", "ISPS", "BAF", "CAF", "PSS", "GRI", "VAT", "COD", "AMS", "ENS"]);

/** "PORT TO PORT" → "port to port"; "LCL + DO" → "LCL and DO". */
function lineWords(label: string): string {
  return flat(label)
    .replace(/\s*[+&]\s*/g, " and ")
    .split(" ")
    .map((w) => (KEEP_UPPER.has(w.toUpperCase().replace(/[^A-Z]/g, "")) ? w.toUpperCase() : w.toLowerCase()))
    .join(" ")
    .replace(/\s*:\s*$/, "");
}

/** "OMR 339 port to port plus OMR 132 LCL and DO": the firm lines of our offer in words. */
function offerInWords(offer: Offer): string {
  const firm = listOf(offer.lines).filter((l) => !l.soft && typeof l.amount === "number");
  if (!firm.length) return offerFigureOf(offer).text;
  return firm.map((l) => `${moneyText(l.amount as number, l.currency ?? offer.currency, l.unit)}${l.label ? ` ${lineWords(l.label)}` : ""}`).join(" plus ");
}

/**
 * One or two sentences for the customer about where the shipment stands, from the furthest proven step, the dates
 * and our offer. Never a buy rate, an agent's price, a margin, a remark or a reference number. Null before an
 * offer exists (in the e-mails or the register) and on a closed enquiry.
 */
export function statusSentence(row: EnquiryRow, journey: Journey | null, dates: DateFacts, offer: Offer | null, crossFiled: CrossFiledGroup[], mails?: ReadMail[]): StatusText | null {
  try {
    if (!row || CLOSED.has(row.status)) return null;
    // Without an e-mail there is nothing to tell beyond what the register shows.
    if (Array.isArray(mails) && !mails.some((m) => m?.scope === "in")) return null;
    const facts: Sourced<string>[] = [];
    const fact = (value: string, proof: Proof | null | undefined) => {
      if (proof) facts.push({ value, proof });
    };
    const today = dayOf(listOf(mails)[0]?.at) || (isDay(row.enquiry_date) ? row.enquiry_date : "");
    const day = (iso: string | null | undefined) => (isDay(iso) ? dayText(iso, today) : "");
    const short = (iso: string | null | undefined) => (isDay(iso) ? fmtDayMonth(iso, today || iso) : "");
    const node = (key: MilestoneKey) => journey?.nodes.find((n) => n.key === key) ?? null;
    const subOf = (key: MilestoneKey, sub: SubStepKey) => node(key)?.subSteps.find((s) => s.key === sub) ?? null;
    const etd = dates?.etd ?? null;
    const eta = dates?.eta ?? null;
    const etdText = () => {
      if (!etd?.date) return "ETD not advised yet";
      fact(`ETD ${short(etd.date)}`, etd.proof);
      return `ETD ${short(etd.date)}`;
    };
    const etaText = () => {
      if (!eta?.date) return "ETA not advised yet";
      fact(`ETA ${short(eta.date)}`, eta.proof);
      const was = eta.earlier?.[0]?.date && !eta.plan ? `, revised from ${short(eta.earlier[0].date)}` : "";
      return `ETA ${eta.port || shortPort(row.pod) || ""} ${short(eta.date)}${was}`.replace(/\s+/g, " ");
    };

    let text = "";
    const reached = journey?.reached ?? null;
    if (!journey) {
      if (!offer || row.status === "confirmed") return null;
      const when = day(dayOf(offer.sentAt));
      fact(`Our offer of ${when}`, offer.proof);
      const transit = offer.transit ? `; transit about ${offer.transit.toLowerCase().replace(/\s+/g, " ")}` : "";
      text = `We offered ${offerInWords(offer)} on ${when}${transit}. We are waiting for your go-ahead.`;
    } else if (journey.set === "courier") {
      const waybill = node("waybill");
      if (waybill?.state === "proven") fact(`Waybill ${day(waybill.date)}`, waybill.proof);
      text = waybill?.state === "proven" ? `Booked; waybill issued ${day(waybill.date)}.` : "Your shipment is confirmed with the courier; the waybill is awaited.";
    } else if (journey.set === "air") {
      const awb = node("awb");
      const arrived = node("arrived");
      const departed = node("departed");
      if (awb?.state === "proven") {
        fact(`AWB ${day(awb.date)}`, awb.proof);
        const after = arrived?.state === "proven" ? (fact(`Arrived ${day(arrived.date)}`, arrived.proof), `the shipment arrived MCT on ${day(arrived.date)}`) : departed?.state === "proven" ? (fact(`Flight ${day(departed.date)}`, departed.proof), `flight ${day(departed.date)}`) : etd?.date ? `flight ${short(etd.date)}` : "flight not advised yet";
        text = `Final AWB received ${day(awb.date)}; ${after}.`;
      } else {
        const collected = node("collected");
        if (collected?.state === "proven") fact(`Collected ${day(collected.date)}`, collected.proof);
        text = collected?.state === "proven" ? `The cargo was collected on ${day(collected.date)}. Next: the flight; ${etdText().replace("ETD", "flight")}.` : "Your shipment is confirmed with our agent at origin; the collection is awaited.";
      }
    } else if (reached === "bayan" || reached === "delivered") {
      const bayan = node("bayan");
      fact(`Bayan ${day(bayan?.date)}`, bayan?.proof);
      const duty = subOf("bayan", "duty") ? "; duty is to be paid to customs" : "";
      text = `The Bayan was issued on ${day(bayan?.date)}${duty}. Delivery is being arranged.`;
    } else if (reached === "arrived" || reached === "can_do") {
      const arrived = node("arrived");
      const can = node("can_do");
      const when = arrived?.state === "proven" ? arrived.date : can?.date;
      fact(`Arrived ${day(when)}`, arrived?.state === "proven" ? arrived.proof : can?.proof);
      const authorised = subOf("bayan", "authorization") ? ": authorization done, Bayan awaited" : "";
      text = `Arrived ${shortPort(row.pod) || "at the port"} on ${day(when)}. ${can?.state === "proven" ? "CAN received; c" : "C"}learance is in progress${authorised}.`;
    } else if (reached === "sailed" || reached === "bl" || reached === "gate_in") {
      const sailed = node("sailed");
      const head = sailed?.state === "proven" ? (fact(`Sailed ${day(sailed.date)}`, sailed.proof), `Sailed from ${shortPort(row.pol) || "origin"} on ${day(sailed.date)}. ${etaText()}.`) : `Next: sailing; ${etdText()}.`;
      const bl = node("bl");
      const approved = subOf("bl", "bl_approved");
      const released = bl?.state === "proven" || subOf("bl", "telex") || subOf("bl", "seaway");
      const draft = subOf("bl", "bl_draft");
      const blText = released ? " The BL is released." : approved ? " BL approved; telex release requested." : draft ? " The BL draft is with you for approval." : "";
      if (released && bl?.proof) fact("BL released", bl.proof);
      text = `${head}${blText}`;
    } else if (reached === "so") {
      const so = node("so");
      fact(`SO released ${day(so?.date)}`, so?.proof);
      text = `The SO was issued to the shipper on ${day(so?.date)}. Next: sailing; ${etdText()}.`;
    } else {
      const booked = node("booked");
      if (booked?.state === "proven") fact(`Booked ${day(booked.date)}`, booked.proof);
      // "The booking is awaited" only while nothing later is spoken of: loading or a BL draft says otherwise.
      const later = nodeAt(journey.nowDiscussing) > nodeAt("booked");
      text = `Your shipment is confirmed with our agent at origin${booked?.state === "proven" || later ? "" : "; the shipper's booking is awaited"}.`;
    }

    const threadOf = new Map(listOf(mails).map((m) => [m.id, m.email?.gmail_thread_id ?? ""]));
    const threads = new Set(facts.map((f) => threadOf.get(f.proof.emailId)).filter(Boolean));
    const clash = listOf(crossFiled).find((g) => listOf(g.threadIds).some((t) => threads.has(t)));
    return {
      text,
      facts,
      builtFrom: new Set(facts.map((f) => f.proof.emailId)).size,
      warning: clash ? `Some e-mails here look like ${clash.looksLike ?? "another enquiry"} — check the dates.` : null,
    };
  } catch {
    return null;
  }
}

// --- Reply defaults ---------------------------------------------------------------------------------------------

interface ReplyWarning { address: string; text: string }
/** Warnings for a conversation's reply (bounced and away addresses), noted when the brief was built. */
const WARNINGS = new WeakMap<Side, ReplyWarning[]>();

/** The bounced and away addresses of each conversation, for the warnings above a reply. */
export function noteReplyWarnings(sides: Side[], mails: ReadMail[], now: string): void {
  try {
    const nowIso = isoOf(now) ?? "";
    const today = dayOf(nowIso);
    const since = nowIso ? new Date(Date.parse(nowIso) - 7 * DAY).toISOString() : "";
    for (const side of listOf(sides)) {
      const out: ReplyWarning[] = [];
      for (const m of listOf(mails)) {
        if (m.sideKey !== side.key || m.scope !== "noise" || (since && m.at < since)) continue;
        if (m.noise === "bounce") {
          const address = bounceAddressOf(m.email);
          if (address && !out.some((w) => w.address === address)) out.push({ address, text: `${address} bounced on ${dayText(m.day, today)} — check the address` });
        } else if (m.noise === "auto_reply") {
          const address = lower(m.from?.email);
          const delegate = DELEGATE.exec(repairedText(m.email?.body_text ?? m.clean ?? ""));
          if (!address || out.some((w) => w.address === address)) continue;
          const name = firstWord(m.from?.name) || address;
          out.push({ address, text: delegate ? `${name} is away — the auto-reply says write to ${[clip(delegate[1], 40), delegate[2]].filter(Boolean).join(" ")}` : `${name} is away — an auto-reply came on ${dayText(m.day, today)}` });
        }
      }
      WARNINGS.set(side, out);
    }
  } catch {
    // replies go on without warnings
  }
}

/** "Dear Basil," — the writer's first name, or "Sir" for a customer's shared desk and "Team" for others. */
function greetingFor(side: Side): string {
  const person = side?.currentWriter;
  const name = (person?.name ?? "").trim();
  const local = (person?.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const usable = !!name && !name.includes("@") && name.toLowerCase() !== local && !/[\d_]/.test(name);
  return `Dear ${usable ? firstWord(name) : side?.kind === "customer" ? "Sir" : "Team"},`;
}

/**
 * What a reply from a conversation starts with: to the side's current writer (everyone else on the answered e-mail
 * with Reply all), the handler's and the sales person's mailboxes copied, the subject with the reference kept, and
 * "Dear {first name},". Warnings name a bounced or away address among the recipients.
 */
export function replyDefaults(
  side: Side,
  handler: Handler | null,
  row: EnquiryRow,
  mailbox: string | null | undefined,
  opts?: { target?: ReadMail; all?: boolean; message?: string; warnings?: string[] },
): ReplyPrefill {
  const all = !!opts?.all;
  const empty: ReplyPrefill = { sideKey: side?.key ?? "customer", targetEmailId: "", all, to: [], cc: [], subject: replySubject(row?.subject ?? null, row?.reference ?? ""), message: "", warnings: [] };
  try {
    const mails = inScopeNewest(side.mails);
    const target = opts?.target ?? mails.find((m) => theirs(m) && substantive(m)) ?? mails.find(substantive) ?? mails[0] ?? null;
    const own = lower(mailbox);
    const email = target?.email;
    const addresses = email ? [email.from_email, ...listOf(email.to_emails), ...listOf(email.cc_emails)].map(lower).filter(Boolean) : [];
    const ours = [...new Set([...addresses.filter(isOurAddress), own].filter(Boolean))];
    const base = email ? replyRecipients(email, ours, all) : { to: [], cc: [] };
    const writer = lower(side.currentWriter?.email);
    const outside = (a: string) => !!a && !isOurAddress(a) && a !== own;
    const to = [...new Set([...(writer && outside(writer) ? [writer] : []), ...(all || !writer ? base.to : [])].filter(outside))];
    const copied = [lower(handler?.mailbox), lower(handler?.salesPerson?.mailbox)].filter((a) => !!a && a !== own);
    const cc = [...new Set([...base.cc.filter((a) => !to.includes(a)), ...copied])].filter((a) => !to.includes(a) && a !== own);
    const said = typeof opts?.message === "string" ? opts.message.trim() : "";
    const message = /^dear\b/i.test(said) ? said : `${greetingFor(side)}\n\n${said}${said ? "\n" : ""}`;
    const known = WARNINGS.get(side) ?? [];
    const warnings = [...listOf(opts?.warnings), ...known.filter((w) => to.includes(w.address) || cc.includes(w.address)).map((w) => w.text)];
    return {
      sideKey: side.key,
      targetEmailId: target?.id ?? "",
      all,
      to,
      cc,
      subject: replySubject(email?.subject ?? side.threads?.[0]?.subject ?? row?.subject ?? null, row?.reference ?? ""),
      message,
      warnings,
    };
  } catch {
    return empty;
  }
}

// --- Cues ------------------------------------------------------------------------------------------------------

const COMPLAINT = /not responding|no response|not acceptable|unacceptable|disappoint|complain|escalat|lose this business/i;

/** The main amount of a mail: the freight or door line, else the largest firm amount. */
function mainToken(tokens: readonly MoneyToken[] | null | undefined): MoneyToken | null {
  const firm = listOf(tokens).filter((t) => !t.soft && t.amount > 0);
  if (!firm.length) return null;
  return firm.find((t) => !!t.label && MAIN_LINE.test(t.label)) ?? firm.reduce((best, t) => (toOmr(t.amount, t.currency) > toOmr(best.amount, best.currency) ? t : best), firm[0]);
}

const SUB_CUE: Partial<Record<SubStepKey, [CueKey, string]>> = {
  so_requested: ["so", "SO"], agent_details_sent: ["booking", "Booking"], shipper_details_sent: ["booking", "Booking"], booking_note: ["booking", "Booking"],
  space_etd: ["space_etd", "ETD"], carrier_change: ["space_etd", "Carrier change"], cargo_not_ready: ["space_etd", "Cargo not ready"],
  bl_draft: ["bl_draft", "BL draft"], bl_ok_ours: ["bl_ok", "BL OK"], bl_approved: ["bl_ok", "BL OK"], bl_final: ["docs", "Final BL"],
  telex: ["telex", "Telex"], seaway: ["telex", "Seaway"], originals: ["originals", "Originals"], pre_alert: ["pre_alert", "Pre-alert"],
  can: ["can_do", "CAN"], do: ["can_do", "DO"], manifest: ["can_do", "Manifest"], freight_certificate: ["can_do", "Freight certificate"],
  docs_to_clearance: ["docs", "Customs"], authorization: ["docs", "Customs"], hs_brand: ["docs", "Customs"], duty: ["bayan", "Duty"],
  delivery_requested: ["delivery", "Delivery"], dn: ["dn", "Debit note"], invoice: ["paperwork", "Invoice"], payment: ["payment", "Payment"],
  cod: ["cod", "COD"], detention: ["detention", "Detention"],
};
const NODE_CUE: Record<MilestoneKey, [CueKey, string]> = {
  booked: ["booking", "Booking"], so: ["so", "SO"], gate_in: ["booking", "Gate-in"], collected: ["booking", "Collected"], picked_up: ["booking", "Pick-up"],
  waybill: ["waybill", "Waybill"], awb: ["awb", "AWB"], in_transit: ["sailed", "In transit"], sailed: ["sailed", "Sailed"], departed: ["sailed", "Departed"],
  bl: ["docs", "BL"], arrived: ["arrived", "Arrived"], can_do: ["can_do", "CAN / DO"], bayan: ["bayan", "Bayan"], delivered: ["delivery", "Delivery"],
};
/** A step a mail speaks of without proving it: the topic, never the event ("Sailing", not "Sailed"). */
const MENTION_CUE: Partial<Record<MilestoneKey, [CueKey, string]>> = {
  collected: ["booking", "Collection"], in_transit: ["sailed", "Tracking"], sailed: ["space_etd", "Sailing"], departed: ["space_etd", "Flight"], arrived: ["eta", "ETA"],
};

/** The step cues of a mail, the furthest step first. Before the job runs only proofs count. */
function stepCues(mail: ReadMail, early: boolean): [CueKey, string][] {
  const hits = listOf(mail.milestones)
    .filter((h) => !early || h.proves)
    .sort((a, b) => nodeAt(b.key) - nodeAt(a.key) || Number(b.proves) - Number(a.proves));
  const out: [CueKey, string][] = [];
  for (const h of hits) {
    const cue = h.sub ? SUB_CUE[h.sub] : h.key ? ((!h.proves && MENTION_CUE[h.key]) || NODE_CUE[h.key]) : undefined;
    if (cue && !out.some(([k, l]) => k === cue[0] && l === cue[1])) out.push(cue);
  }
  return out;
}

/** When the job started: the first won cue's e-mail, else the register's confirmation day; null while it has not. */
function jobStart(row: EnquiryRow, won: WonCue[], mails: readonly ReadMail[]): string | null {
  const byId = new Map(listOf(mails).map((m) => [m.id, m.at]));
  const times = listOf(won).map((c) => byId.get(c.proof?.emailId ?? "") ?? isoOf(`${c.day}T00:00:00+04:00`)).filter((t): t is string => !!t);
  if (row?.status === "confirmed" && isDay(row.confirmed_date)) times.push(isoOf(`${row.confirmed_date}T00:00:00+04:00`) ?? "");
  return times.filter(Boolean).sort()[0] ?? (row?.status === "confirmed" ? "" : null);
}

/**
 * The cues of one e-mail by priority (a row shows the first two, the first with its amount): bounced or auto-reply,
 * complaint or urgent, hold, the yes or "Approves", our offer, the agreed buy, an agent's rate, declined, a question,
 * targets, an extra charge, the shipment's steps, asks, reminders, promises, our rate request, paperwork, "Noted".
 */
export function cuesOf(mail: ReadMail, row: EnquiryRow, won: WonCue[], start: string | null = null): Cue[] {
  const out: Cue[] = [];
  try {
    const add = (key: CueKey, label: string, tone: Tone) => {
      if (!out.some((c) => c.key === key && c.label === label)) out.push({ key, label, tone });
    };
    if (!mail) return out;
    if (mail.noise === "bounce") add("bounce", "Bounced", "bad");
    if (mail.noise === "auto_reply") add("auto_reply", "Auto-reply", "neutral");
    if (mail.scope !== "in") return out;
    const ours = mail.party === "us";
    const text = flat(mail.clean);
    const agentSide = mail.party === "agent" || mail.party === "carrier";

    const complaint = !ours && mail.urgent && COMPLAINT.test(text);
    if (complaint) add("complaint", "Complaint", "bad");
    const yes = listOf(won).find((c) => c.kind === "customer_yes" && c.proof?.emailId === mail.id);
    if (yes) add(/nominat/i.test(yes.proof.sentence) ? "nominated" : "yes", "Says yes", "good");
    if (row?.status === "confirmed" && approvesAfterConfirmation(mail)) add("approves", "Approves", "good");
    if (!ours && mail.urgent && !complaint) add("urgent", "Urgent", "warn");
    if (mail.hold) add("hold", "Hold", "neutral");

    const main = mainToken(mail.money);
    const amount = main ? ` ${moneyText(main.amount, main.currency, main.unit)}` : "";
    switch (mail.moneyRole) {
      case "offer":
        if (FINAL.test(text)) add("final_offer", `Offer${amount} · final`, "primary");
        else add("offer", `Offer${amount}`, "primary");
        break;
      case "agreed_buy":
        add(main ? "agreed_buy" : "confirmed_to_agent", main ? `Agreed${amount}` : "Go-ahead", "good");
        break;
      case "agent_rate":
        add("rate", `Rate${amount}`, "neutral");
        break;
      case "target":
        add("target", `Target${amount}`, "neutral");
        break;
      case "push_to_agent":
        add("push", `Target${amount}`, "neutral");
        break;
      case "customer_echo":
        if (!yes) add("accepts", `Repeats${amount || " our price"}`, "neutral");
        break;
      case "customer_counter":
        add("target", `Counter${amount}`, "neutral");
        break;
      case "extra":
        add("extra_charge", `Extra charge${amount}`, "warn");
        break;
      default:
        break;
    }
    if (listOf(won).some((c) => c.kind === "confirmed_to_agent" && c.proof?.emailId === mail.id)) add("confirmed_to_agent", "Go-ahead", "good");
    if (agentSide && AGENT_DECLINE.test(text)) add("declined", "Declined", "neutral");
    if (agentSide && AGENT_QUESTION.test(text)) add("question", "Question", "neutral");

    const early = start == null || mail.at < start;
    for (const [key, label] of stepCues(mail, early)) add(key, label, "info");

    if (!ours && mail.isRequest) add("asks", "Asks", "neutral");
    if (mail.isChase) add(ours ? "chase" : agentSide ? "agent_chasing" : "chase", ours ? "Chase" : "Reminder", "neutral");
    if (mail.promise) add("promise", "Promise", "neutral");
    if (ours && (mail.toParty === "agent" || mail.toParty === "carrier") && !mail.moneyRole && (RATE_REQUEST.test(mail.clean) || REQUEST_BLOCK.test(mail.clean))) add("rate_request", "Rate request", "neutral");
    if (mail.moneyRole === "paperwork") add("paperwork", "Paperwork", "neutral");
    if (mail.kind === "ack") add("ack", "Noted", "neutral");
    return out;
  } catch {
    return out;
  }
}

/**
 * The customer's yes cues worth a "Says yes" pill: the first one, and a later one only when a new offer of ours came
 * between ("We nominated your agent…" days later says the yes again, it is not a new one).
 */
function freshYeses(won: WonCue[], mails: ReadMail[]): WonCue[] {
  const at = new Map(mails.map((m) => [m.id, m.at]));
  const offers = mails.filter((m) => m.scope === "in" && m.moneyRole === "offer").map((m) => m.at);
  const yeses = listOf(won).filter((c) => c.kind === "customer_yes").sort((a, b) => ((at.get(a.proof.emailId) ?? "") < (at.get(b.proof.emailId) ?? "") ? -1 : 1));
  const kept: WonCue[] = [];
  for (const c of yeses) {
    const t = at.get(c.proof.emailId) ?? "";
    const last = kept.length ? (at.get(kept[kept.length - 1].proof.emailId) ?? "") : null;
    if (last == null || offers.some((o) => o > last && o < t)) kept.push(c);
  }
  return [...listOf(won).filter((c) => c.kind !== "customer_yes"), ...kept];
}

/** Fills cues on every mail, in place. */
export function assignCues(mails: ReadMail[], row: EnquiryRow, won: WonCue[]): void {
  try {
    const list = listOf(mails);
    const start = jobStart(row, won, list);
    const shown = freshYeses(won, list);
    for (const mail of list) mail.cues = cuesOf(mail, row, shown, start);
  } catch {
    // the mails keep the cues they had
  }
}

// --- Everything the page says, built from the brief so far -----------------------------------------------------

/** What the view needs from the rest of the brief. */
export interface ViewContext {
  row: EnquiryRow;
  /** Every filed mail, newest first. */
  mails: ReadMail[];
  sides: Side[];
  crossFiled: CrossFiledGroup[];
  offer: Offer | null;
  won: WonCue[];
  rates: AgentQuote[];
  buy: Buy | null;
  clash: CurrencyClash | null;
  registerMoney: RegisterMoney;
  journey: Journey | null;
  dates: DateFacts;
  drift: Drift[];
  handler: Handler | null;
  statusText: StatusText | null;
  cargo: CargoCheck;
  move: Move;
  followUps: FollowUpRecord[];
  mailFollowUps: MailFollowUp[];
  /** Copy texts (chase texts per side) when already built. */
  copy?: CopyTexts;
  viewer: Viewer;
  mailbox: string | null;
  /** ISO timestamp. */
  now: string;
  today: string;
  dismissed: string[];
  /** Sales person id → name, for the follow-ups logged. */
  salesPersonNames?: Map<string, string>;
}

const facts = (ctx: ViewContext): SideFacts => ({
  started: ctx.row?.status === "confirmed" || listOf(ctx.won).length > 0,
  lastToCustomer: lastToCustomerOf(ctx.mails),
  dates: ctx.dates,
  dismissed: ctx.dismissed,
});

/** When we last wrote to the customer (any in-scope mail of ours to them). */
export function lastToCustomerOf(mails: ReadMail[]): string | null {
  return inScopeNewest(mails).find((m) => m.party === "us" && m.toParty === "customer")?.at ?? null;
}

const customerSide = (ctx: ViewContext) => listOf(ctx.sides).find((s) => s.kind === "customer") ?? null;
/** The id "Keep the register's" puts a rates slip away under: it changes when the register's figures do. */
const slipIdOf = (row: EnquiryRow) => `slip:${row?.id ?? ""}:${row?.sell_total ?? ""}:${row?.buy_total ?? ""}`;
const firstOfferDay = (ctx: ViewContext) => dayOf(offerStartAt(ctx.offer, ctx.mails));
const away = (ctx: ViewContext, id: string) => listOf(ctx.dismissed).includes(id);
/** Only our own won cues, put away with "Not won yet". */
const notWonYet = (ctx: ViewContext) => putAwayAsNotWon(ctx.won, ctx.dismissed);

// --- Truth tag ----------------------------------------------------------------------------------------------------

/** The register against the e-mails, the highest first: won, quoted, on hold. Null when they agree. */
export function truthOf(ctx: ViewContext): TruthTag | null {
  try {
    const row = ctx.row;
    const won = listOf(ctx.won);
    const day = wonDay(won);
    if (OPEN.has(row.status) && day && !notWonYet(ctx)) {
      const cue = won.find((c) => c.kind === "customer_yes") ?? [...won].sort((a, b) => (a.day < b.day ? -1 : 1))[0];
      return { kind: "won", text: `E-mails say: won ${dayText(day, ctx.today)}`, proof: cue.proof };
    }
    const offerDay = firstOfferDay(ctx);
    if (row.status === "new" && ctx.offer && offerDay) return { kind: "quoted", text: `E-mails say: quoted ${dayText(offerDay, ctx.today)}`, proof: ctx.offer.proof };
    const customer = customerSide(ctx);
    if (OPEN.has(row.status) && customer?.state.kind === "on_hold" && customer.state.proof && customer.state.since) {
      return { kind: "hold", text: `E-mails say: on hold since ${dayText(dayOf(customer.state.since), ctx.today)}`, proof: customer.state.proof };
    }
    return null;
  } catch {
    return null;
  }
}

// --- Buttons that follow the viewer -----------------------------------------------------------------------------

type Need = "reply" | "form" | "me" | "any";
type Want = ActionButton & { need: Need };

const NEEDS: Partial<Record<ActionButton["id"], Need>> = {
  reply: "reply", mark_quoted: "form", confirm_job: "form", edit_prefilled: "form", edit: "form", mark_lost: "form", not_genuine: "form", reopen: "form",
  // Putting a reading away ("Not won yet", "Keep the register's", "Done by phone") is an editor's call, as on the other cards.
  move_mails: "form", wrong_enquiry: "form", keep_thread: "form", treat_as: "form", log_follow_up: "me", undo_follow_up: "me", copy: "any", open_mail: "any", dismiss: "form",
};
const want = (button: ActionButton): Want => ({ ...button, need: NEEDS[button.id] ?? "form" });

/** Whether the viewer may do anything at all: viewers read and get no buttons. */
const acts = (viewer: Viewer | null | undefined) => !!viewer && (viewer.canEdit || viewer.canReply || !!viewer.me);

/** The buttons this viewer may use, with at most one primary. Moving e-mails also needs the mailbox. */
function allowed(buttons: Want[], viewer: Viewer): ActionButton[] {
  if (!acts(viewer)) return [];
  let primary = false;
  const out: ActionButton[] = [];
  for (const { need, ...button } of buttons) {
    const ok = need === "reply" ? viewer.canReply : need === "form" ? viewer.canEdit && (button.id !== "move_mails" && button.id !== "wrong_enquiry" ? true : viewer.canReply) : need === "me" ? !!viewer.me : true;
    if (!ok) continue;
    if (button.variant === "primary") {
      if (primary) button.variant = "secondary";
      primary = true;
    }
    out.push(button);
  }
  return out;
}

/** A reply on a conversation with its defaults filled. */
function replyButton(ctx: ViewContext, side: Side | null, label: string, variant: ActionButton["variant"], message?: string, target?: ReadMail): Want {
  const prefill = side ? replyDefaults(side, ctx.handler, ctx.row, ctx.mailbox, { message, target }) : null;
  // Without an e-mail to answer the page copies the text instead.
  return want({ id: "reply", label, variant, sideKey: side?.key ?? "customer", ...(prefill?.targetEmailId ? { replyPrefill: prefill } : {}), ...(message ? { copyText: message } : {}) });
}
const copyButton = (label: string, text: string | null | undefined, toast: string, variant: ActionButton["variant"] = "secondary"): Want[] =>
  text?.trim() ? [want({ id: "copy", label, variant, copyText: text.trim(), copiedToast: toast })] : [];
const markLost = (variant: ActionButton["variant"] = "ghost"): Want => want({ id: "mark_lost", label: "Mark lost…", variant });

/**
 * Confirm job with the form filled from the e-mails: the day, the quoted date, sell, agreed buy and agent. It fills
 * only what the register leaves empty and never replaces a figure already entered: changing the register's rates is
 * "Update rates", where the difference is shown. The notes speak only of what is filled.
 */
function confirmPrefill(ctx: ViewContext, day: string | null, cue: WonCue | null): FormPrefill {
  const row = ctx.row;
  const base = ctx.registerMoney?.prefill ?? null;
  const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (typeof v === "number" && !Number.isFinite(v));
  const prefill: FormPrefill = { notes: [] };
  const sell = base?.sell_total != null && blank(row?.sell_total);
  const buy = base?.buy_total != null && blank(row?.buy_total);
  const agent = !!base?.agent_name && blank(row?.agent_name);
  if (sell) prefill.sell_total = base?.sell_total;
  if (buy) prefill.buy_total = base?.buy_total;
  if (agent) prefill.agent_name = base?.agent_name;
  if (day) prefill.confirmed_date = day;
  const offerDay = firstOfferDay(ctx);
  if (blank(row?.quoted_date) && offerDay && !ctx.offer?.fromQuotedHistory) prefill.quoted_date = offerDay;
  // The money notes say "Sell …" and "Buy …": keep each only with its figure.
  const moneyNotes = listOf(base?.notes).filter((n) => (/^sell\b/i.test(n) ? sell : /^buy\b/i.test(n) ? buy : false));
  const agentNote = agent && !buy ? `Agent ${base?.agent_name}: the buy was agreed with them by e-mail` : "";
  prefill.notes = [cue ? `Won by e-mail: ${cue.proof.who}, ${cue.proof.when}` : "", ...moneyNotes, agentNote].filter(Boolean);
  return prefill;
}

// --- Flags ---------------------------------------------------------------------------------------------------------

/**
 * What changes how the enquiry reads: on hold, cancelled, urgent, a complaint, a bounce, an out-of-office reply, two
 * currencies for one amount, a deadline, e-mails of another enquiry, a closed origin. An answered one stays a day.
 */
export function flagsOf(ctx: ViewContext): Flag[] {
  try {
    const out: Flag[] = [];
    const { row, today, viewer } = ctx;
    const nowIso = isoOf(ctx.now) ?? "";
    const weekAgo = nowIso ? new Date(Date.parse(nowIso) - 7 * DAY).toISOString() : "";
    const yesterday = isDay(today) ? addDays(today, -1) : "";
    const sideOf = new Map(listOf(ctx.sides).map((s) => [s.key, s]));
    const at = (ts: string) => shortWhen(ts, today);
    const show = (m: ReadMail): ActionButton => ({ id: "open_mail", label: "Show e-mail", variant: "ghost", emailIds: [m.id] });
    /** Our first substantive mail to the mail's side after it, when the flag is answered. */
    const answerOf = (m: ReadMail): ReadMail | null => {
      const side = sideOf.get(m.sideKey);
      return inScopeNewest(side?.mails).filter((x) => !theirs(x) && substantive(x) && x.at > m.at).pop() ?? null;
    };
    const flag = (kind: FlagKind, m: ReadMail | null, f: Omit<Flag, "id" | "kind" | "buttons" | "cleared" | "clearedText"> & { buttons: Want[]; answered?: ReadMail | null }) => {
      const id = `flag:${kind}:${m?.id ?? f.label}`;
      if (kind !== "wrong_enquiry" && kind !== "bounced" && away(ctx, id)) return;
      const answered = f.answered ?? null;
      if (answered && yesterday && answered.day < yesterday) return;
      const { buttons, answered: _a, ...rest } = f;
      out.push({ id, kind, ...rest, cleared: !!answered, clearedText: answered ? `answered ${at(answered.at)}` : null, buttons: allowed(buttons, viewer) });
    };
    const dismiss = (kind: FlagKind, m: ReadMail | null, label: string): Want => want({ id: "dismiss", label: "Dismiss", variant: "ghost", dismissId: `flag:${kind}:${m?.id ?? label}` });

    const customer = customerSide(ctx);
    if (OPEN.has(row.status) && customer?.state.kind === "on_hold" && customer.state.proof) {
      const m = ctx.mails.find((x) => x.id === customer.state.proof?.emailId) ?? null;
      const p = customer.state.proof;
      flag("hold", m, { tone: "neutral", icon: "pause", label: "On hold", sentence: p.sentence, who: p.who, when: m ? at(m.at) : plainWhen(p.when), proof: p, buttons: m ? [want(show(m)), dismiss("hold", m, "On hold")] : [] });
    }

    if (row.status === "confirmed" && ctx.journey?.cancelled) {
      const p = ctx.journey.cancelled;
      const m = ctx.mails.find((x) => x.id === p.emailId) ?? null;
      if (m && theirs(m)) flag("cancelled", m, { tone: "bad", icon: "ban", label: "Cancelled or changed", sentence: p.sentence, who: p.who, when: at(m.at), proof: p, buttons: [want(show(m)), dismiss("cancelled", m, "Cancelled")] });
    }

    const escalated = inScopeNewest(ctx.mails).filter((m) => theirs(m) && m.urgent && (!weekAgo || m.at >= weekAgo));
    const complaint = escalated.find((m) => COMPLAINT.test(flat(m.clean)));
    const urgent = escalated.find((m) => m !== complaint && !COMPLAINT.test(flat(m.clean)));
    for (const [kind, m] of [["complaint", complaint], ["urgent", urgent]] as const) {
      if (!m) continue;
      const sentence = sentencesOf(m.clean).find((s) => (kind === "complaint" ? COMPLAINT.test(s) : isEscalation(s))) ?? m.excerpt;
      const p = proofOf(m, today, sentence);
      flag(kind, m, {
        tone: "bad", icon: "alert", label: kind === "complaint" ? "Complaint" : "Urgent", sentence: p.sentence, who: p.who, when: at(m.at), proof: p,
        answered: answerOf(m), buttons: [want(show(m)), replyButton(ctx, sideOf.get(m.sideKey) ?? null, "Reply", "secondary", undefined, m), dismiss(kind, m, kind)],
      });
    }

    const bounced = new Set<string>();
    for (const m of listOf(ctx.mails).filter((x) => x.scope === "noise" && x.noise === "bounce" && (!weekAgo || x.at >= weekAgo))) {
      const address = bounceAddressOf(m.email);
      if (bounced.has(address ?? m.id)) continue;
      bounced.add(address ?? m.id);
      const blocked = BOUNCE_BODY.test(m.email?.body_text ?? "") && /blocked/i.test(m.email?.body_text ?? "");
      const p = proofOf(m, today, address ? `${address} ${blocked ? "was blocked" : "could not be reached"}` : m.excerpt);
      flag("bounced", m, { tone: "bad", icon: "alert", label: "Bounced", sentence: p.sentence, who: "", when: at(m.at), proof: p, buttons: [want(show(m)), replyButton(ctx, sideOf.get(m.sideKey) ?? null, "Reply", "secondary")] });
    }

    const seenAway = new Set<string>();
    for (const m of listOf(ctx.mails).filter((x) => x.scope === "noise" && x.noise === "auto_reply" && (!weekAgo || x.at >= weekAgo))) {
      const from = lower(m.from?.email);
      if (seenAway.has(from) || !(NOISE_TEXT.test(m.clean) || NOISE_SUBJECT.test(m.email?.subject ?? ""))) continue;
      seenAway.add(from);
      const delegate = DELEGATE.exec(repairedText(m.email?.body_text ?? m.clean ?? ""));
      const sentence = delegate ? `write to ${[clip(delegate[1], 40), delegate[2]].filter(Boolean).join(" ")}` : clip(m.excerpt, 140);
      const p = proofOf(m, today, sentence);
      flag("out_of_office", m, { tone: "neutral", icon: "clock", label: "Out of office", sentence, who: m.from?.name ?? "", when: at(m.at), proof: p, buttons: [want(show(m)), replyButton(ctx, sideOf.get(m.sideKey) ?? null, "Reply", "secondary"), dismiss("out_of_office", m, "Out of office")] });
    }

    if (ctx.clash) {
      const p = ctx.clash.proofs[1] ?? ctx.clash.proofs[0];
      const m = ctx.mails.find((x) => x.id === p?.emailId) ?? null;
      flag("currency_clash", m, { tone: "warn", icon: "alert", label: "Two currencies", sentence: ctx.clash.text, who: p?.who ?? "", when: m ? at(m.at) : plainWhen(p?.when ?? ""), proof: p ?? null, buttons: m ? [want(show(m)), dismiss("currency_clash", m, "Two currencies")] : [] });
    }

    // A closed enquiry owes nobody an answer: no deadline flag and no Reply for it.
    for (const side of CLOSED.has(row.status) ? [] : listOf(ctx.sides)) {
      const d = side.deadline;
      if (!d) continue;
      const m = ctx.mails.find((x) => x.id === d.proof.emailId) ?? null;
      if (!m || (d.cleared && !answerOf(m))) continue;
      flag("deadline", m, {
        tone: d.passed && !d.cleared ? "bad" : "warn", icon: "clock", label: "Deadline",
        sentence: d.passed ? `Reply ${d.text} passed` : `Wants a reply ${d.text}`, who: d.proof.who, when: at(m.at), proof: d.proof,
        answered: d.cleared ? answerOf(m) : null, buttons: [want(show(m)), replyButton(ctx, side, "Reply", "secondary", undefined, m)],
      });
    }

    for (const group of listOf(ctx.crossFiled)) {
      const m = group.mails[0] ?? null;
      const ids = group.mails.map((x) => x.id);
      const buttons: Want[] = [
        ...(group.looksLike ? [want({ id: "move_mails", label: `Move to ${group.looksLike}`, variant: "secondary", emailIds: ids, reference: group.looksLike })] : []),
        want({ id: "keep_thread", label: "Keep here", variant: "ghost", threadIds: group.threadIds }),
        want({ id: "wrong_enquiry", label: "Wrong enquiry", variant: "ghost", emailIds: ids }),
      ];
      const p = m ? proofOf(m, today, m.email?.subject ?? m.excerpt) : null;
      flag("wrong_enquiry", m, { tone: "warn", icon: "flag", label: "Another enquiry", sentence: group.text, who: p?.who ?? "", when: m ? at(m.at) : "", proof: p, buttons });
    }

    const closed = new Set<string>();
    for (const side of listOf(ctx.sides)) {
      const h = side.holiday;
      if (!h || closed.has(h.value)) continue;
      closed.add(h.value);
      const m = ctx.mails.find((x) => x.id === h.proof.emailId) ?? null;
      flag("holiday", m, { tone: "neutral", icon: "pause", label: side.kind === "customer" ? "Customer's office closed" : "Origin closed", sentence: h.value, who: h.proof.who, when: m ? at(m.at) : plainWhen(h.proof.when), proof: h.proof, buttons: m ? [want(show(m)), dismiss("holiday", m, "Origin closed")] : [] });
    }
    return out;
  } catch {
    return [];
  }
}

// --- Now ---------------------------------------------------------------------------------------------------------

const CHECK = "Read from the e-mails — check before you click.";
const MAILBOX_ONLY = "Pricing replies from the mailbox.";

interface Plan {
  kind: NowKind;
  tone: Tone;
  title: string;
  said?: Proof | null;
  lines?: ({ text: string; tone: Tone | null } | string | null | false | undefined)[];
  buttons: Want[];
  /** The buttons for a viewer without the mailbox; the same minus the replies when absent. */
  fallback?: Want[];
  check?: boolean;
  /** Need items this action covers. */
  covers?: string[];
}

/** The one thing to do now and the need items it covers. */
export interface NowPlan { now: NowAction; covers: string[] }

const AGENT_TOPIC = /\b(pick ?-?up address|collection address|zip ?code|postal code|dimensions?|dims|weight|gr\.?\s*wt|cbm|volume|commodity|hs ?code|cargo ready date|ready date|readiness|packing list|stackable|hazardous|msds|incoterm|second pick ?-?up)\b/i;
/** "the pick-up address" from an agent's question. */
function questionTopic(sentence: string): string | null {
  const m = AGENT_TOPIC.exec((sentence ?? "").replace(/\b(code)(?=\d)/gi, "$1 "));
  if (!m) return null;
  const word = m[1]
    .toLowerCase()
    .replace(/pick ?-?up/, "pick-up")
    .replace(/^dims$/, "dimensions")
    .replace(/^gr\.?\s*wt$/, "gross weight")
    .replace(/^zip ?code$/, "zip code")
    .replace(/^hs ?code$/, "HS code")
    .replace(/^msds$/, "MSDS");
  return `the ${word}`;
}

function finish(plan: Plan, ctx: ViewContext): NowPlan {
  const viewer = ctx.viewer;
  const mailbox = viewer?.canReply;
  const source = !mailbox && plan.fallback ? plan.fallback : plan.buttons;
  const buttons = allowed(source, viewer);
  const lostReply = !mailbox && acts(viewer) && plan.buttons.some((b) => b.id === "reply");
  const lines = listOf(plan.lines)
    .filter((l): l is { text: string; tone: Tone | null } | string => !!l)
    .map((l) => (typeof l === "string" ? { text: l, tone: null } : l))
    .filter((l) => !!l.text.trim());
  const said = plan.said && plan.said.sentence ? { text: plan.said.sentence, who: plan.said.who, when: plan.said.when, emailId: plan.said.emailId } : null;
  return {
    now: { kind: plan.kind, tone: plan.tone, title: plan.title, said, lines, buttons, checkLine: !acts(viewer) ? null : lostReply ? MAILBOX_ONLY : plan.check && buttons.length ? CHECK : null },
    covers: plan.covers ?? [],
  };
}

/** The Now card: the first of eighteen states that holds, its buttons gated by the viewer. */
export function nowOf(ctx: ViewContext): NowAction {
  return planNow(ctx).now;
}

/** The Now card and the need items its action covers, so the needs-you list leaves them out. */
export function planNow(ctx: ViewContext): NowPlan {
  try {
    return finish(nowPlan(ctx), ctx);
  } catch {
    return { now: { kind: "to_quote", tone: "neutral", title: "Read the e-mails below", said: null, lines: [], buttons: [], checkLine: null }, covers: [] };
  }
}

function nowPlan(ctx: ViewContext): Plan {
  const { row, today, offer } = ctx;
  const status = row.status;
  const won = listOf(ctx.won);
  const sides = listOf(ctx.sides);
  const customer = customerSide(ctx);
  const name = customerName(row);
  const at = (ts: string) => shortWhen(ts, today);
  const statusCopy = copyButton("Copy status", ctx.statusText?.text, "Status text copied.");
  const driftIds = (kind: string) => listOf(ctx.drift).filter((d) => d.kind === kind).map((d) => d.id);
  const questionIds = (side: Side | null) => listOf(side?.questions).map((q) => `question:${q.id}`);
  // One follow-up per sales person a day: once logged, the button undoes it instead of logging a second one.
  const mineToday = !!ctx.viewer?.me && listOf(ctx.followUps).some((c) => c.sales_person_id === ctx.viewer.me && c.followed_up_on === today);
  const follow: Want = mineToday
    ? want({ id: "undo_follow_up", label: "Followed up today", variant: "secondary" })
    : want({ id: "log_follow_up", label: "Log a follow-up", variant: "primary" });

  // 0. Closed.
  if (CLOSED.has(status)) {
    const reason = row.closure_reason?.trim() || "No reason recorded.";
    if (status === "not_genuine") return { kind: "closed", tone: "flag", title: "Not a genuine enquiry", lines: [reason, "Not counted in enquiries, conversion, quote speed or reports."], buttons: [want({ id: "reopen", label: "Reopen", variant: "secondary" })] };
    if (status === "lost") return { kind: "closed", tone: "bad", title: "Closed as lost", lines: [reason], buttons: [want({ id: "reopen", label: "Reopen", variant: "secondary" })] };
    return { kind: "closed", tone: "neutral", title: "Cancelled", lines: [reason], buttons: [want({ id: "edit", label: "Edit", variant: "secondary" })] };
  }
  const open = OPEN.has(status);

  // 1. The customer is waiting for us.
  if (customer?.state.kind === "waiting_on_us") {
    const run = unansweredRun(inScopeNewest(customer.mails));
    const writer = run[0]?.from?.name ?? name;
    const chase = customer.chase;
    const deadline = customer.deadline && !customer.deadline.cleared ? customer.deadline : null;
    const topic = topicOf(run);
    const title =
      deadline && !deadline.passed
        ? `${name} wants an answer ${deadline.text}`
        : chase && chase.count >= 3 && topic
          ? `${writer} is waiting for ${topic} — asked ${chase.count} times`
          : `${name} is waiting for us`;
    const message = status === "confirmed" ? ctx.statusText?.text : undefined;
    const confirm = status === "quoted" ? [want({ id: "confirm_job", label: "Confirm job", variant: "secondary", formPrefill: confirmPrefill(ctx, null, null) })] : [];
    const lost = open ? [markLost()] : [];
    return {
      kind: "customer_waiting", tone: customer.state.tone, title, said: customer.state.proof,
      lines: [chase?.text, deadline?.passed ? { text: `Their deadline ${deadline.text} has passed`, tone: "bad" } : null, customer.state.text],
      buttons: [replyButton(ctx, customer, "Reply", "primary", message), ...confirm, ...lost],
      fallback: [...(status === "quoted" ? [follow] : []), ...statusCopy, ...confirm, ...lost],
      check: true, covers: ["answer:customer", ...questionIds(customer)],
    };
  }

  const day = wonDay(won);
  const yes = won.find((c) => c.kind === "customer_yes") ?? null;
  const ours = !yes && won.length ? [...won].sort((a, b) => (a.day < b.day ? -1 : 1))[0] : null;
  const winLines = (): Plan["lines"] => {
    const lines: Plan["lines"] = [];
    if (yes?.betterRate) lines.push({ text: "They also ask for a better rate.", tone: "warn" });
    if (yes?.amountMismatch) {
      const mail = ctx.mails.find((m) => m.id === yes.proof.emailId);
      const known = offer ? [offer.total, ...listOf(offer.lines).map((l) => l.amount)] : [];
      const other = listOf(mail?.money).find((t) => !known.some((k) => typeof k === "number" && Math.abs(k - t.amount) < 0.01));
      lines.push({ text: other ? `They quote ${moneyText(other.amount, other.currency)}, which is not this offer — check it is this enquiry` : "The amount in their yes is not this offer's — check it is this enquiry", tone: "warn" });
    }
    return lines;
  };
  const confirmButton = (label: string): Want => {
    const cue = yes ?? ours;
    return want({ id: "confirm_job", label, variant: "primary", ...(day ? { date: day } : {}), ...(yes?.amountMismatch ? {} : { formPrefill: confirmPrefill(ctx, day, cue) }) });
  };
  const offerDay = firstOfferDay(ctx);

  // 2–4. The register is behind a yes.
  if (status === "new" && offer && day && !notWonYet(ctx)) {
    return {
      kind: "won_unmarked", tone: "good", title: `Won by e-mail on ${dayText(day, today)} — the register says awaiting quote`, said: (yes ?? ours)?.proof,
      lines: winLines(),
      buttons: [confirmButton(`Confirm job on ${dayText(day, today)}`), ...(offerDay ? [want({ id: "mark_quoted", label: "Mark quoted only", variant: "secondary", date: offerDay })] : []), markLost()],
      check: true, covers: driftIds("status"),
    };
  }
  // A yes with no offer of ours on file (quoted by phone, or the offer went from another mailbox).
  if (status === "new" && !offer && yes && day) {
    return {
      kind: "won_unmarked", tone: "good", title: `Won by e-mail on ${dayText(day, today)} — the register says awaiting quote`, said: yes.proof,
      lines: [...listOf(winLines()), "No offer of ours is on file: enter the rates when you confirm."],
      buttons: [confirmButton(`Confirm job on ${dayText(day, today)}`), markLost()],
      check: true, covers: driftIds("status"),
    };
  }
  if (status === "quoted" && yes && day) {
    return { kind: "said_yes", tone: "good", title: `${name} said yes on ${dayText(yes.day, today)}`, said: yes.proof, lines: winLines(), buttons: [confirmButton("Confirm job"), markLost()], check: true, covers: driftIds("status") };
  }
  if (status === "quoted" && ours && day && !notWonYet(ctx)) {
    return {
      kind: "looks_won", tone: "good", title: `Looks won on ${dayText(day, today)}`, said: ours.proof, lines: ["Not confirmed in the register."],
      buttons: [confirmButton("Confirm job"), want({ id: "dismiss", label: "Not won yet", variant: "secondary", dismissId: `won:${day}` })],
      check: true, covers: driftIds("status"),
    };
  }

  // 5. A quote went out that the register does not show.
  if (status === "new" && offer && offerDay) {
    const title = offer.fromQuotedHistory
      ? `A quote went out on ${dayText(offerDay, today)} — the customer's reply quotes it`
      : `${offer.sentBy?.name || "We"} e-mailed a quote on ${dayText(offerDay, today)}`;
    return {
      kind: "quoted_unmarked", tone: "primary", title,
      said: offer.proof, lines: [`${offerFigureOf(offer).text} · ${offer.linesText}`, "The register still says awaiting quote."],
      buttons: [want({ id: "mark_quoted", label: `Mark quoted on ${dayText(offerDay, today)}`, variant: "primary", date: offerDay }), markLost()],
      check: true, covers: driftIds("status"),
    };
  }

  // 6. An agent's question waits on us.
  const agentWait = sides.filter((s) => s.kind !== "customer" && s.kind !== "internal" && s.state.kind === "waiting_on_us").sort((a, b) => ((a.state.since ?? "") < (b.state.since ?? "") ? -1 : 1))[0];
  if (agentWait) {
    const p = agentWait.state.proof;
    const topic = questionTopic(p?.sentence ?? "");
    const quotedQuestion = p?.sentence ? `> ${p.sentence}` : undefined;
    return {
      kind: "agent_question", tone: agentWait.state.tone === "bad" ? "warn" : agentWait.state.tone, title: `Answer ${agentWait.name}${topic ? `: ${topic}` : ""}`, said: p,
      lines: [agentWait.state.text],
      buttons: [
        replyButton(ctx, agentWait, "Reply", "primary", quotedQuestion),
        ...(customer && p?.sentence ? [replyButton(ctx, customer, "Ask the customer", "secondary", `Our agent asks: “${p.sentence}” Please advise.`)] : []),
      ],
      fallback: copyButton("Copy the question", p?.sentence, "Question copied."),
      check: true, covers: [`answer:${agentWait.key}`, ...questionIds(agentWait)],
    };
  }

  // 7. An agent's news not passed on.
  const sideFacts = facts(ctx);
  const relaySide = sides.find((s) => s.state.kind === "pass_on");
  const relay = relaySide ? relayOf(relaySide, sideFacts, today) : null;
  if (relaySide && relay && !away(ctx, `pass_on:${relay.mail.id}`)) {
    const text = ctx.statusText?.text ?? `${capital(relay.what)}.`;
    const done = want({ id: "dismiss", label: "Done by phone", variant: "secondary", dismissId: `pass_on:${relay.mail.id}` });
    return {
      kind: "pass_on", tone: "info", title: `Pass on to ${name}: ${relay.what}`, said: proofOf(relay.mail, today, relay.sentence),
      lines: [`${relaySide.name} wrote ${at(relay.mail.at)}; no e-mail of ours to ${name} since.`],
      buttons: [replyButton(ctx, customer, "Reply", "primary", text), done],
      fallback: [...copyButton("Copy status", text, "Status text copied."), done],
      check: true, covers: [`pass_on:${relay.mail.id}`],
    };
  }

  // 8. A rate in hand, no quote.
  const rateSide = status === "new" && !offer ? sides.find((s) => s.state.kind === "rate_in_hand") : undefined;
  if (rateSide) {
    const since = rateSide.state.since ?? "";
    return {
      kind: "rate_in_hand", tone: rateSide.state.tone, title: `${rateSide.name}'s rate is in since ${at(since)} — no quote on file`, said: rateSide.state.proof,
      lines: [rateSide.agent?.summary, rateSide.state.age ? `Waiting ${rateSide.state.age.label}` : null],
      buttons: [want({ id: "mark_quoted", label: "Mark quoted today", variant: "primary", date: today }), replyButton(ctx, customer, "Reply to the customer", "secondary")],
      fallback: [want({ id: "mark_quoted", label: "Mark quoted today", variant: "primary", date: today })],
      check: true,
    };
  }

  // 9. On hold.
  if (open && customer?.state.kind === "on_hold") {
    const p = customer.state.proof;
    return {
      kind: "on_hold", tone: "neutral", title: `On hold since ${at(customer.state.since ?? "")}`, said: p,
      lines: [p && SOFT_LOST.test(p.sentence) ? { text: "Sounds lost.", tone: "warn" } : null],
      buttons: [follow, markLost("secondary")],
      check: true,
    };
  }

  // 10. An agent's stated validity ran out and the customer has not written since.
  if (status === "quoted") {
    const ended = listOf(ctx.rates).filter((q) => q.validity?.ended && !q.validity.boilerplate && q.validity.until).sort((a, b) => ((a.validity?.until ?? "") < (b.validity?.until ?? "") ? 1 : -1))[0];
    const until = ended?.validity?.until ?? "";
    const quietSince = !inScopeNewest(customer?.mails).some((m) => theirs(m) && m.day >= until);
    const side = ended ? sides.find((s) => s.key === ended.sideKey) ?? null : null;
    if (ended && side && quietSince) {
      return {
        kind: "validity_ended", tone: "warn", title: `${ended.name}'s rate ran out on ${dayText(until, today)}`, said: ended.validity?.proof ?? null,
        lines: ["No written word from the customer since."],
        buttons: [replyButton(ctx, side, "Reply to the agent", "primary", "Please reconfirm your rate for this shipment."), markLost()],
        fallback: [follow, markLost()],
        check: true, covers: [`reconfirm:${side.key}`],
      };
    }
  }

  // 11–12. Waiting for a quote.
  if (status === "new") {
    const wait = isDay(row.enquiry_date) && isDay(today) ? waitStatus(row.enquiry_date, today) : "new";
    const deadline = isDay(row.enquiry_date) ? quoteDeadline(row.enquiry_date) : today;
    const tone: Tone = wait === "overdue" ? "bad" : wait === "due_today" ? "warn" : "primary";
    const quoteTitle = wait === "overdue" ? "The quote is overdue" : wait === "due_today" ? "Quote it today" : `Quote by the end of ${dayText(deadline, today)}`;
    const markToday = want({ id: "mark_quoted", label: "Mark quoted today", variant: "primary", date: today });
    const asked = sides.filter((s) => s.kind === "agent" && s.agent && (s.agent.state === "written_to" || s.agent.state === "acknowledged" || s.agent.state === "question"));
    const rated = sides.some((s) => s.agent && (s.agent.state === "rated" || s.agent.state === "agreed"));
    if (asked.length && !rated) {
      const oldest = [...asked].sort((a, b) => ((a.agent?.askedAt ?? a.agent?.lastAt ?? "") < (b.agent?.askedAt ?? b.agent?.lastAt ?? "") ? -1 : 1))[0];
      const chaseText = ctx.copy?.chase?.[oldest.key];
      return {
        kind: "waiting_rates", tone, title: `${quoteTitle} — waiting for agents' rates`,
        lines: [asked.map((s) => s.agent?.summary ? `${s.name}: ${s.agent.summary}` : s.name).slice(0, 3).join(" · ")],
        buttons: [markToday, replyButton(ctx, oldest, `Chase ${oldest.name}`, "secondary", chaseText)],
        fallback: [markToday, ...copyButton("Copy chase text", chaseText, "Chase text copied.")],
        check: true, covers: [`chase:${oldest.key}`],
      };
    }
    const age = isDay(row.enquiry_date) && isDay(today) ? daysBetween(row.enquiry_date, today) : 0;
    const noMail = !inScopeNewest(ctx.mails).length;
    if (noMail && isDay(today) && daysBetween(deadline, today) >= STALE_DAYS) {
      return {
        kind: "to_quote", tone: "neutral", title: `Nothing on file for ${plural(age, "day")}`,
        lines: ["No e-mail is filed here and the register shows no quote. If it is dead, close it."],
        buttons: [markToday, markLost("secondary"), want({ id: "not_genuine", label: "Not genuine…", variant: "secondary" })],
      };
    }
    return {
      kind: "to_quote", tone, title: quoteTitle,
      lines: [`${age <= 0 ? "The enquiry came in today." : `The enquiry came in ${plural(age, "day")} ago.`} A quick quote goes out by the end of the next working day.`],
      buttons: [markToday, markLost()],
    };
  }

  // 13. Quoted: waiting for the customer.
  if (status === "quoted") {
    const from = [row.quoted_date, offerDay].filter(isDay).sort().pop() ?? row.enquiry_date;
    const waited = isDay(from) && isDay(today) ? Math.max(0, daysBetween(from, today)) : 0;
    const last = latestFollowUps(listOf(ctx.followUps)).get(row.id);
    const byMail = listOf(ctx.mailFollowUps)[listOf(ctx.mailFollowUps).length - 1];
    const spoke = inScopeNewest(customer?.mails).some((m) => theirs(m) && (!offer || m.at > offer.sentAt));
    const promised = customer?.state.kind === "they_promised" ? customer.state.proof : null;
    return {
      kind: "waiting_customer", tone: waited >= STALE_DAYS ? "warn" : "neutral",
      title: waited === 0 ? `Quoted today: waiting for ${name}` : `Waiting ${plural(waited, "day")} for ${name}'s answer`,
      said: promised,
      lines: [
        last ? `${chasedLabel(last.followed_up_on, today)} by ${ctx.salesPersonNames?.get(last.sales_person_id) ?? "a colleague"}.` : "No follow-ups logged yet.",
        byMail ? `Chased by e-mail ${dayText(byMail.day, today)} (${byMail.by}).` : null,
        offer && !spoke ? `No written word from them on file since our offer of ${dayText(dayOf(offer.sentAt), today)}.` : null,
        waited >= STALE_DAYS ? { text: `After ${STALE_DAYS} days few quotes are won. If this one is dead, close it as lost.`, tone: "warn" } : null,
      ],
      buttons: [follow, want({ id: "confirm_job", label: "Confirm job", variant: ctx.viewer?.me ? "secondary" : "primary", formPrefill: confirmPrefill(ctx, null, null) }), markLost()],
    };
  }

  // 14–17. Confirmed.
  const money = ctx.registerMoney;
  if (row.sell_total == null) {
    const figure = offer ? offerFigureOf(offer) : null;
    const said = figure
      ? `The e-mails say sell ${figure.text}${figure.whole ? "" : ` (total depends on ${figure.dependsOn})`}${ctx.buy?.total != null ? `, buy ${moneyText(ctx.buy.total, ctx.buy.currency)}` : ""}.`
      : "The reports miss this job's profit until it is entered.";
    return {
      kind: "confirmed_no_sell", tone: "warn", title: "No sell amount yet", lines: [said],
      buttons: [money?.prefill ? want({ id: "edit_prefilled", label: "Add the rates", variant: "primary", formPrefill: money.prefill }) : want({ id: "edit", label: "Add the rates", variant: "primary" })],
      check: !!money?.prefill,
    };
  }
  const slipId = slipIdOf(row);
  if (money?.slip && !away(ctx, slipId)) {
    const [title, ...rest] = money.slip.text.split(": ");
    const prefill = money.slip.prefill ?? money.prefill;
    return {
      kind: "confirmed_rates", tone: "warn", title, lines: [rest.join(": ") ? capital(rest.join(": ")) + "." : null],
      buttons: [prefill ? want({ id: "edit_prefilled", label: "Update rates", variant: "primary", formPrefill: prefill }) : want({ id: "edit", label: "Update rates", variant: "primary" }), want({ id: "dismiss", label: "Keep the register's", variant: "ghost", dismissId: slipId })],
      check: !!prefill, covers: [slipId],
    };
  }
  if (money?.differs) {
    return {
      kind: "confirmed_rates", tone: "warn", title: "The register's rates differ from the e-mails", lines: [money.differs.text],
      buttons: [want({ id: "edit_prefilled", label: "Update rates", variant: "primary", formPrefill: money.differs.prefill }), want({ id: "dismiss", label: "Keep the register's", variant: "ghost", dismissId: money.differs.dismissId })],
      check: true, covers: [money.differs.dismissId],
    };
  }
  const waitingAgent = sides.filter((s) => s.kind !== "customer" && s.kind !== "internal" && s.state.kind === "waiting_on_them").sort((a, b) => ((a.state.since ?? "") < (b.state.since ?? "") ? -1 : 1))[0];
  if (waitingAgent) {
    const since = waitingAgent.state.since ?? "";
    const topic = topicOf(inScopeNewest(waitingAgent.mails).filter((m) => !theirs(m)).slice(0, 1));
    const chaseText = ctx.copy?.chase?.[waitingAgent.key];
    const edit = want({ id: "edit", label: "Edit", variant: "ghost" });
    return {
      kind: "confirmed_waiting_agent", tone: (waitingAgent.state.age?.workingHours ?? 0) >= 24 ? "warn" : "neutral",
      title: `Waiting on ${waitingAgent.name}${topic ? ` for ${topic}` : ""} since ${at(since)}`, said: waitingAgent.state.proof,
      lines: [waitingAgent.state.age ? `${waitingAgent.state.age.label} so far` : null],
      buttons: [replyButton(ctx, waitingAgent, `Chase ${waitingAgent.name}`, "secondary", chaseText), edit],
      fallback: [...copyButton("Copy chase text", chaseText, "Chase text copied."), edit],
      check: true, covers: [`chase:${waitingAgent.key}`],
    };
  }
  const sell = row.sell_total;
  const profit = row.profit;
  const pct = profit != null && sell ? ` (${Math.round((profit / sell) * 100)}%)` : "";
  return {
    kind: "confirmed", tone: "good", title: isDay(row.confirmed_date) ? `Job confirmed on ${dayText(row.confirmed_date, today)}` : "Job confirmed",
    lines: [`Sell ${fmt(sell)} ${row.currency?.trim() || "USD"}${profit != null ? `, profit ${fmt(profit)}${pct}` : ""}.`],
    buttons: [want({ id: "edit", label: "Edit", variant: "secondary" })],
  };
}

// --- Needs you ---------------------------------------------------------------------------------------------------

/**
 * What else waits on the reader, oldest first: conversations waiting for us, old questions, news to pass on, chases,
 * our promises due, the register's drift and rates, the agent and contact to save, e-mails of another enquiry, rates
 * to reconfirm, dates to tell the customer. The Now card's own item and put-away items are left out; what was
 * answered or passed on since yesterday stays, struck.
 */
export function needsYouOf(ctx: ViewContext, covers?: string[]): NeedItem[] {
  try {
    const row = ctx.row;
    if (CLOSED.has(row.status)) return [];
    const covered = new Set(covers ?? planNow(ctx).covers);
    const { today, viewer } = ctx;
    const nowIso = isoOf(ctx.now) ?? "";
    const yesterday = isDay(today) ? addDays(today, -1) : "";
    const at = (ts: string) => shortWhen(ts, today);
    const customer = customerSide(ctx);
    const name = customerName(row);
    const sides = listOf(ctx.sides);
    const open: (NeedItem & { t: string })[] = [];
    const done: (NeedItem & { t: string })[] = [];
    const item = (id: string, verb: NeedVerb, text: string, f: { t?: string | null; age?: Age | null; tone?: Tone; proof?: Proof | null; button?: Want[]; done?: boolean }) => {
      if (covered.has(id) || away(ctx, id)) return;
      const button = f.done ? null : (allowed(f.button ?? [], viewer)[0] ?? null);
      const need: NeedItem & { t: string } = { id, verb, text, age: f.age ?? null, tone: f.tone ?? "neutral", proof: f.proof ?? null, button: button ? { ...button, variant: button.variant === "primary" ? "secondary" : button.variant } : null, done: !!f.done, t: f.t ?? "" };
      (f.done ? done : open).push(need);
    };
    const replyOr = (side: Side | null, label: string, message: string | undefined, copyLabel: string, copyText: string | null | undefined): Want[] => [
      replyButton(ctx, side, label, "secondary", message),
      ...copyButton(copyLabel, copyText, "Copied."),
    ];

    // Conversations waiting for us, other than the headline's, and their old questions.
    const listed = new Set<string>();
    for (const side of sides) {
      if (side.kind === "internal") continue;
      if (side.state.kind === "waiting_on_us" && side.key !== ctx.move?.sideKey) {
        listed.add(side.key);
        const p = side.state.proof;
        item(`answer:${side.key}`, "answer", `Answer ${side.name}${p?.sentence ? `: “${clip(p.sentence, 120)}”` : ""}`, {
          t: side.state.since, age: side.state.age, tone: side.state.tone === "primary" ? "neutral" : side.state.tone, proof: p,
          button: replyOr(side, "Reply", undefined, "Copy the question", p?.sentence),
        });
      }
      for (const q of listOf(side.questions)) {
        if (q.answered || listed.has(side.key) || side.key === ctx.move?.sideKey || q.age.workingHours < 4) continue;
        item(`question:${q.id}`, "answer", `Answer ${side.name}: “${clip(q.sentence, 120)}”`, { t: q.proof ? ctx.mails.find((m) => m.id === q.proof.emailId)?.at : null, age: q.age, tone: side.kind === "customer" ? "warn" : "neutral", proof: q.proof, button: replyOr(side, "Reply", `> ${q.sentence}`, "Copy the question", q.sentence) });
      }
      // Answered since yesterday: the last run of theirs that asked, and our answer.
      const mails = inScopeNewest(side.mails);
      const answer = mails.find((m) => !theirs(m) && substantive(m));
      if (answer && yesterday && answer.day >= yesterday) {
        const run = unansweredRun(mails.filter((m) => m.at < answer.at));
        const ask = run.find((m) => m.isRequest);
        if (ask) {
          const complaint = run.find((m) => m.urgent && COMPLAINT.test(flat(m.clean)));
          const text = complaint
            ? `Complaint ${at(complaint.at)} answered by ${firstWord(answer.from?.name)} at ${answer.time}`
            : `Answered ${side.name}: “${clip(askedIn(ask, side), 100)}” · ${at(answer.at)}`;
          item(`done:answer:${side.key}:${answer.id}`, "answer", text, { t: answer.at, proof: proofOf(complaint ?? ask, today), done: true });
        }
      }
    }

    // News to pass on to the customer.
    const sideFacts = facts(ctx);
    for (const side of sides) {
      if (side.kind !== "agent" && side.kind !== "carrier" && side.kind !== "shipper") continue;
      const relay = relayOf(side, sideFacts, today);
      if (relay) {
        const text = ctx.statusText?.text ?? `${capital(relay.what)}.`;
        item(`pass_on:${relay.mail.id}`, "pass_on", `Pass on to ${name}: ${relay.what} (${side.name}, ${at(relay.mail.at)})`, {
          t: relay.mail.at, age: nowIso ? ageOf(relay.mail.at, nowIso) : null, tone: "info", proof: proofOf(relay.mail, today, relay.sentence),
          button: [replyButton(ctx, customer, "Reply", "secondary", text), ...copyButton("Copy status", text, "Status text copied."), want({ id: "dismiss", label: "Done by phone", variant: "ghost", dismissId: `pass_on:${relay.mail.id}` })],
        });
      } else if (sideFacts.started && sideFacts.lastToCustomer && yesterday && dayOf(sideFacts.lastToCustomer) >= yesterday) {
        const news = inScopeNewest(side.mails).find((m) => theirs(m) && m.at < (sideFacts.lastToCustomer ?? "") && !!provenHit(m));
        const hit = news ? provenHit(news) : null;
        if (news && hit?.key && dayOf(news.at) >= yesterday) item(`done:pass_on:${news.id}`, "pass_on", `Passed on to ${name}: ${NODE_NEWS[hit.key]} · ${at(sideFacts.lastToCustomer)}`, { t: sideFacts.lastToCustomer, proof: proofOf(news, today, hit.sentence), done: true });
      }
    }

    // Chases: our request waiting a working day and more, or their promise past due. A rate request to an agent who
    // never answered is not chased once the rate is no longer needed: quoted after it, a buy agreed, or the job won.
    const rateDone = row.status === "confirmed" || listOf(ctx.won).length > 0 || !!ctx.buy?.agreed;
    const unneeded = (side: Side) => {
      const q = side.agent;
      if (!q || (q.state !== "written_to" && q.state !== "acknowledged")) return false;
      return rateDone || (!!ctx.offer && !ctx.offer.fromQuotedHistory && (!q.askedAt || ctx.offer.sentAt > q.askedAt));
    };
    for (const side of sides) {
      if (side.kind === "internal" || side.key === ctx.move?.sideKey || unneeded(side)) continue;
      const s = side.state;
      const chaseText = ctx.copy?.chase?.[side.key];
      if ((s.kind === "waiting_on_them" && (s.age?.workingHours ?? 0) >= 24) || (s.kind === "they_promised" && s.tone === "warn")) {
        item(`chase:${side.key}`, "chase", s.kind === "they_promised" ? `Chase ${side.name}: they promised an update ${at(s.since ?? "")}` : `Chase ${side.name}: we asked ${at(s.since ?? "")}`, {
          t: s.since, age: s.age, tone: "neutral", proof: s.proof, button: replyOr(side, `Chase ${side.name}`, chaseText, "Copy chase text", chaseText),
        });
      }
    }

    // Our promises due today or earlier, not kept; kept since yesterday, struck.
    const promised = new Set<string>();
    for (const m of inScopeNewest(ctx.mails)) {
      const p = m.promise;
      if (!p || p.by !== "us" || promised.has(m.sideKey)) continue;
      promised.add(m.sideKey);
      const side = sides.find((s) => s.key === m.sideKey) ?? null;
      if (!p.kept && isDay(p.due) && isDay(today) && p.due <= today) {
        // The status text is for the customer: it carries our sell price, so a reply to an agent never starts with it.
        const toCustomer = side?.kind === "customer";
        const status = toCustomer ? ctx.statusText?.text : undefined;
        item(`promise:${m.id}`, "promise_due", `We said “${clip(p.sentence, 100)}” ${at(m.at)} — ${p.due === today ? "due today" : `was due ${dayText(p.due, today)}`}`, {
          t: m.at, age: nowIso ? ageOf(m.at, nowIso) : null, tone: p.due < today ? "warn" : "neutral", proof: p.proof,
          button: replyOr(side, "Reply", status, toCustomer ? "Copy status" : "Copy what we said", toCustomer ? status : p.sentence),
        });
      }
    }

    // The register: drift, rates, agent, contact.
    for (const d of listOf(ctx.drift)) {
      const formButton = d.prefill ? [want({ id: "edit_prefilled", label: d.buttonLabel || "Update…", variant: "secondary", formPrefill: d.prefill })] : [];
      const t = d.proof ? ctx.mails.find((m) => m.id === d.proof?.emailId)?.at : null;
      if (d.kind === "agent") {
        const text = d.register ? d.text : `Agent not in the register: the e-mails are with ${d.mail}`;
        item(d.id, "set_agent", text, { t, tone: "neutral", proof: d.proof, button: d.prefill ? [want({ id: "edit_prefilled", label: "Update agent", variant: "secondary", formPrefill: d.prefill })] : [] });
      } else if (d.kind === "contact") {
        item(d.id, "save_contact", `${d.mail} is not a saved contact of ${name}`, { t, tone: "neutral", proof: d.proof, button: d.prefill ? [want({ id: "edit_prefilled", label: "Save contact", variant: "secondary", formPrefill: d.prefill })] : [] });
      } else {
        item(d.id, "update", d.text, { t, tone: d.kind === "date_order" ? "warn" : "neutral", proof: d.proof, button: formButton });
      }
    }
    const money = ctx.registerMoney;
    if (money?.slip) item(slipIdOf(row), "update", money.slip.text, { tone: "warn", button: money.slip.prefill ? [want({ id: "edit_prefilled", label: "Update rates…", variant: "secondary", formPrefill: money.slip.prefill })] : [want({ id: "edit", label: "Update rates…", variant: "secondary" })] });
    // The slip's own update already carries the agreed figures: one item about the register's rates is enough.
    const slipCarries = !!money?.slip?.prefill && !away(ctx, slipIdOf(row)) && money.differs?.prefill.sell_total == null;
    if (money?.differs && !slipCarries) item(money.differs.dismissId, "update", money.differs.text, { tone: "neutral", button: [want({ id: "edit_prefilled", label: "Update rates…", variant: "secondary", formPrefill: money.differs.prefill })] });

    // E-mails that look like another enquiry's.
    for (const group of listOf(ctx.crossFiled)) {
      const first = group.mails[0];
      item(`move:${group.looksLike ?? `${group.why}:${group.about ?? ""}`}`, "move", group.text, {
        t: first?.at, tone: "warn", proof: first ? proofOf(first, today, first.email?.subject ?? first.excerpt) : null,
        button: [
          ...(group.looksLike ? [want({ id: "move_mails", label: `Move to ${group.looksLike}`, variant: "secondary", emailIds: group.mails.map((m) => m.id), reference: group.looksLike })] : []),
          want({ id: "keep_thread", label: "Keep here", variant: "secondary", threadIds: group.threadIds }),
        ],
      });
    }

    // Agents' rates that run out, on an open enquiry.
    if (OPEN.has(row.status)) {
      for (const q of listOf(ctx.rates)) {
        const v = q.validity;
        if (!v?.until || v.boilerplate || v.none || v.daysLeft == null || v.daysLeft > 1) continue;
        const side = sides.find((s) => s.key === q.sideKey) ?? null;
        item(`reconfirm:${q.sideKey}`, "reconfirm", `Reconfirm ${q.name}'s rate: ${v.text}`, { t: v.proof ? ctx.mails.find((m) => m.id === v.proof?.emailId)?.at : null, tone: v.ended ? "warn" : "neutral", proof: v.proof, button: replyOr(side, "Reply", "Please reconfirm your rate for this shipment.", "Copy the text", "Please reconfirm your rate for this shipment.") });
      }
    }

    // A date that slipped and has not been told to the customer: only for a booked job, where a date is a sailing.
    for (const [label, value] of row.status === "confirmed" ? ([["ETD", ctx.dates?.etd], ["ETA", ctx.dates?.eta]] as const) : []) {
      const v = value as DatedValue | null | undefined;
      if (!v || v.plan || v.slipDays == null || Math.abs(v.slipDays) <= 3) continue;
      const m = ctx.mails.find((x) => x.id === v.proof.emailId);
      // Told when we wrote to the customer after it, or it is our own e-mail to them.
      const told = !!m && ((m.party === "us" && m.toParty === "customer") || (!!sideFacts.lastToCustomer && sideFacts.lastToCustomer > m.at));
      if (told || !m) continue;
      const now = v.date ? fmtDayMonth(v.date, today) : v.text;
      const was = v.earlier[0]?.date ? fmtDayMonth(v.earlier[0].date, today) : (v.earlier[0]?.text ?? "");
      const text = `${label} ${now}${was ? ` (was ${was})` : ""}`;
      item(`tell:${label}:${v.date ?? v.text}`, "tell_customer", `Tell the customer: ${text}`, {
        t: m.at, tone: "warn", proof: v.proof, button: replyOr(customer, "Reply", ctx.statusText?.text ?? `${text}.`, "Copy status", ctx.statusText?.text ?? `${text}.`),
      });
    }

    const byTime = (a: { t: string }, b: { t: string }) => (a.t && b.t ? (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) : a.t ? -1 : b.t ? 1 : 0);
    return [...open.sort(byTime), ...done.sort(byTime).reverse().slice(0, 3)].map(({ t: _t, ...need }) => need);
  } catch {
    return [];
  }
}

// --- Copy texts -------------------------------------------------------------------------------------------------

/** "SL262784 LCL FOB NINGBO CHINA TO SOHAR OMAN" from the register. */
function houseSubjectOf(row: EnquiryRow): string {
  const reference = row?.reference?.trim() ?? "";
  const subject = row?.subject?.trim() ?? "";
  if (subject && parseHouseSubject(subject)) return subject.toUpperCase().includes(reference.toUpperCase()) ? subject : `${reference} ${subject}`.trim();
  const route = [row?.pol, row?.pod].every(Boolean) ? `${row.pol} TO ${row.pod}` : "";
  return [reference, row?.qty_text || row?.shipment_mode, route].filter(Boolean).join(" ").toUpperCase();
}

/** Our offer as the lines a person pastes: one per line, soft ones with their words, then transit and free days. */
function offerCopy(offer: Offer | null): string | null {
  if (!offer) return null;
  const lines = listOf(offer.lines).map((l) => `${l.label || "Charge"} : ${typeof l.amount === "number" ? moneyText(l.amount, l.currency ?? offer.currency, l.unit) : (l.softText ?? "at actuals")}${l.soft && typeof l.amount === "number" && l.softText ? ` (${l.softText})` : ""}`);
  if (offer.transit) lines.push(`Transit time : ${offer.transit}`);
  if (offer.freeDays != null) lines.push(`Free days : ${offer.freeDays}`);
  if (offer.validUntil) lines.push(`Valid until : ${isDay(offer.validUntil) ? fullDate(offer.validUntil) : offer.validUntil}`);
  return lines.join("\n") || null;
}

/** "18 Nov 2026": a day as a text pasted to someone outside reads it. */
function fullDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The status text, our offer, a chase text per conversation, the request block and the house subject. */
export function copyTextsOf(ctx: ViewContext): CopyTexts {
  const row = ctx.row;
  const empty: CopyTexts = { status: null, offer: null, chase: {}, requestBlock: ctx.cargo?.requestBlock ?? "", houseSubject: attempt(() => houseSubjectOf(row), "") };
  try {
    const today = ctx.today;
    const chase: Record<string, string> = {};
    // The register's shipment, unless the e-mails say it changed: then the reminder names no shipment rather than a wrong one.
    const changed = listOf(ctx.drift).some((d) => d.kind === "mode" || d.kind === "route" || d.kind === "quantity");
    const route = !changed && [shortPort(row.pol), shortPort(row.pod)].every(Boolean) ? `${shortPort(row.pol)} to ${shortPort(row.pod)}` : "";
    for (const side of listOf(ctx.sides)) {
      if (side.kind === "internal" || !side.mails.length) continue;
      const s = side.state;
      if (side.kind === "customer") {
        if (OPEN.has(row.status) && ctx.offer) {
          chase[side.key] = `Kind reminder on our offer of ${dayText(dayOf(ctx.offer.sentAt), today)}${route ? ` for ${row.qty_text ? `${row.qty_text} ` : ""}${route}` : ""}. Please let us know if we may proceed.`;
        } else chase[side.key] = "Kind reminder on the below. Please update us.";
        continue;
      }
      const asked = s.kind === "waiting_on_them" ? inScopeNewest(side.mails).find((m) => !theirs(m) && m.isRequest) : null;
      const topic = asked ? topicOf([asked]) : null;
      const noRate = side.agent && (side.agent.state === "written_to" || side.agent.state === "acknowledged");
      chase[side.key] = noRate
        ? `Kind reminder on our request${side.agent?.askedAt ? ` of ${shortWhen(side.agent.askedAt, today)}` : ""}. Please share your best rates.`
        : topic
          ? `Kind reminder on the below. Please share ${topic} at the earliest.`
          : asked
            ? `Kind reminder on our e-mail of ${shortWhen(asked.at, today)}. Please update.`
            : "Kind reminder on the below. Please update.";
    }
    return { status: ctx.statusText?.text ?? null, offer: offerCopy(ctx.offer), chase, requestBlock: ctx.cargo?.requestBlock ?? "", houseSubject: houseSubjectOf(row) };
  } catch {
    return empty;
  }
}

// --- History -------------------------------------------------------------------------------------------------------

/** What the e-mails show that the register's history misses: chasing by e-mail, the customer asking again, hand-overs, replies sent from the app. */
export function historyOf(ctx: ViewContext): HistoryEvent[] {
  try {
    const out: HistoryEvent[] = [];
    for (const f of listOf(ctx.mailFollowUps)) {
      const m = ctx.mails.find((x) => x.id === f.proof.emailId);
      out.push({ at: m?.at ?? f.day, kind: "chased_by_email", text: `${f.withChaseWords ? "Chased" : "Followed up"} by e-mail · ${f.by}`, proof: f.proof });
    }
    const customer = customerSide(ctx);
    if (customer?.chase) {
      const last = inScopeNewest(customer.mails).find((m) => m.at === customer.chase?.last);
      out.push({ at: customer.chase.last, kind: "customer_chased", text: `The customer asked again (${customer.chase.count} times)`, proof: last ? proofOf(last, ctx.today) : null });
    }
    const h = ctx.handler;
    if (h && h.previous.length) {
      const chain = [...h.previous.map((p) => ({ name: p.name, from: p.from })), { name: h.name, from: h.since }];
      for (let i = 1; i < chain.length; i++) {
        if (chain[i].name === chain[i - 1].name) continue;
        const m = ctx.mails.find((x) => x.at === chain[i].from);
        out.push({ at: chain[i].from, kind: "hand_over", text: `${chain[i].name} took over from ${chain[i - 1].name}`, proof: m ? proofOf(m, ctx.today) : null });
      }
    }
    for (const m of listOf(ctx.mails)) {
      if (m.sentFromApp) out.push({ at: m.at, kind: "sent_from_app", text: `Reply sent from the app by ${m.sentFromApp}`, proof: proofOf(m, ctx.today) });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  } catch {
    return [];
  }
}
