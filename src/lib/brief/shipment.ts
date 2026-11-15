import { daysBetween, fmtDayMonth } from "../display";
import { muscatDate } from "../emailDrafts";
import { dayWithWeekday } from "../enquiryDetails";
import { addDays } from "../format";
import { parseHouseSubject, type HouseSubject } from "../houseSubject";
import type { EnquiryRow } from "../types";
import {
  AGENT_BLOCK,
  AGENT_JOB_PAREN,
  AGENT_JOB_PREFIX,
  AWB_NO,
  BL_NO,
  BOOKING_NO,
  CANCELLED,
  CARRIER,
  CONTAINER,
  CUSTOMS_CODE,
  CUTOFF,
  DOC_KINDS,
  FREE_TIME,
  MILESTONES,
  OFFER_CUE,
  OUR_PRICE_LINE,
  PO,
  RATE_REQUEST,
  SHIPPER_BLOCK,
  SHIP_DATE,
  VESSEL,
} from "./patterns";
import { isRequest, isSignatureImage, proofOf, sentencesOf, shortWhen } from "./read";
import type {
  AgentQuote,
  DateFacts,
  DatedValue,
  DocFile,
  DocGroup,
  DocKind,
  DocSubKind,
  Journey,
  Milestone,
  MilestoneHit,
  MilestoneKey,
  ModeSet,
  Offer,
  PromiseMade,
  Proof,
  ReadMail,
  RefChip,
  RefKind,
  Sourced,
  SubStep,
  SubStepKey,
  Tone,
  ValidityFact,
  WonCue,
} from "./types";

// The shipment after the yes: which steps the e-mails prove (booking, SO, sailing, BL, arrival, CAN and DO, Bayan),
// the dates and numbers they state, and the files they carry. Pure and synchronous. A step is proven only by an
// outside e-mail or by a file; our own words are a request or a pass-on and never prove one.

const M = MILESTONES;

const timeOf = (ts: unknown): number => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const isDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
/** Runs of spaces and tabs as one space, ends trimmed. */
const flat = (text: string) => text.replace(/[ \t]+/g, " ").trim();
/** A copy of a pattern that finds every match. */
const every = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);

/** Text on one line, cut at a word to at most max characters. */
function clip(text: string, max = 200): string {
  const body = text.replace(/\s+/g, " ").trim();
  return body.length <= max ? body : `${body.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** The line of a text around a position. */
function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const end = text.indexOf("\n", index);
  return clip(text.slice(start, end < 0 ? text.length : end));
}

/** The e-mails that feed the rules, oldest first. */
function scoped(mails: ReadMail[] | null | undefined): ReadMail[] {
  return (Array.isArray(mails) ? mails : []).filter((m) => !!m && m.scope === "in").sort((a, b) => timeOf(a.at) - timeOf(b.at));
}

// --- Which set of steps ---------------------------------------------------------------------------------------

const NODES: Record<ModeSet, MilestoneKey[]> = {
  sea_import: ["booked", "so", "sailed", "bl", "arrived", "can_do", "bayan", "delivered"],
  sea_export: ["booked", "so", "gate_in", "sailed", "bl", "arrived"],
  air: ["booked", "collected", "awb", "departed", "arrived", "bayan", "delivered"],
  courier: ["booked", "waybill", "picked_up", "in_transit", "delivered"],
};

const NODE_LABEL: Record<MilestoneKey, string> = {
  booked: "Booked", so: "SO released", gate_in: "Gate-in", collected: "Collected", awb: "AWB", waybill: "Waybill",
  picked_up: "Picked up", in_transit: "In transit", sailed: "Sailed", departed: "Departed", bl: "BL", arrived: "Arrived",
  can_do: "CAN / DO", bayan: "Bayan", delivered: "Delivered",
};

/** What an e-mail about a step is about, for "now: …". */
const NODE_TOPIC: Record<MilestoneKey, string> = {
  booked: "Booking", so: "SO", gate_in: "Gate-in", collected: "Collection", awb: "AWB", waybill: "Waybill",
  picked_up: "Pick-up", in_transit: "In transit", sailed: "Sailing", departed: "Flight", bl: "BL", arrived: "Arrival",
  can_do: "CAN / DO", bayan: "Bayan", delivered: "Delivery",
};

const OMAN_PLACE = /\b(?:OMAN|MUSCAT|MCT|SOHAR|SALALAH|DUQM)\b/i;

/** The house subject in a subject line, also when it follows an agent's own numbers ("ENQ1020…//ABSOH…// LCL FOB …"). */
function houseOf(subject: string | null | undefined): HouseSubject | null {
  const whole = parseHouseSubject(subject);
  if (whole || !subject || !subject.includes("//")) return whole;
  for (const part of subject.split("//")) {
    const parsed = parseHouseSubject(part);
    if (parsed) return parsed;
  }
  return null;
}

/** The set of steps a shipment goes through: courier, air, sea export (also cross trade) or sea import. */
export function modeSetOf(row: Pick<EnquiryRow, "shipment_mode" | "trade_type" | "pod">, mails: ReadMail[]): ModeSet {
  try {
    if (row?.shipment_mode === "COURIER") return "courier";
    if (row?.shipment_mode === "AIR") return "air";
    if (row?.trade_type === "EXP") return "sea_export";
    if (row?.trade_type === "IMP") return "sea_import";
    const list = scoped(mails);
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.party !== "agent" && !(m.party === "us" && m.toParty === "agent")) continue;
      const direction = houseOf(m.email?.subject)?.trade_type;
      if (direction === "EXP") return "sea_export";
      if (direction === "IMP") return "sea_import";
      if (direction) break;
    }
    const pod = typeof row?.pod === "string" ? row.pod.trim() : "";
    return pod && !OMAN_PLACE.test(pod) ? "sea_export" : "sea_import";
  } catch {
    return "sea_import";
  }
}

// --- ETD, ETA and ATD -----------------------------------------------------------------------------------------

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "nov", "Sept", "October" → the month's number; null for any other word. */
function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return null;
  const i = MONTH_NAMES.findIndex((name) => name.startsWith(w));
  return i < 0 ? null : i + 1;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? date.toISOString().slice(0, 10) : null;
}

/** The date nearest to the mail's day among the given ones. */
function nearest(dates: (string | null)[], mailDay: string): string | null {
  let best: string | null = null;
  let gap = Infinity;
  for (const date of dates) {
    if (!date) continue;
    const apart = Math.abs(daysBetween(mailDay, date));
    if (apart <= gap) {
      best = date;
      gap = apart;
    }
  }
  return best;
}

/** A year as written ("26", "2026"), when it is within a year of the mail's. */
function yearOf(raw: string | undefined, mailDay: string | null): number | null {
  if (!raw || (raw.length !== 2 && raw.length !== 4)) return null;
  const year = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
  return mailDay && Math.abs(year - Number(mailDay.slice(0, 4))) > 1 ? null : year;
}

/** A day and a month as a date: in the year written, else in the year that brings it nearest to the mail. */
function dated(year: number | null, month: number, day: number, mailDay: string | null): string | null {
  if (year != null) return isoDate(year, month, day);
  if (!mailDay) return null;
  const y = Number(mailDay.slice(0, 4));
  return nearest([isoDate(y - 1, month, day), isoDate(y, month, day), isoDate(y + 1, month, day)], mailDay);
}

const ISO_VALUE = /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/;
const MONTH_FIRST = /^([a-z]+)\b[ .\/-]{0,2}(\d{1,2})(?:st|nd|rd|th)?(?:,? ?(\d{4}))?$/i;
const DAY_FIRST = /^(\d{1,2})(st|nd|rd|th)?([ .\/-]{0,3})(\d{1,2}|[a-z]{3,9})(?:[ .\/-]?(\d{2,4}))?$/i;
const YEAR_MONTH = /^\d{4}[.\/-]\d{1,2}$/;
const DAY_ONLY = /^(\d{1,2})(?:st|nd|rd|th)$/i;
const RELATIVE_DAY = /^(?:today|tomorrow|tmrw)$/i;

/** The day of that number nearest to the mail's day: "the 16th" written on the 5th is the 16th of the same month. */
function nearestDay(day: number, mailDay: string): string | null {
  const [y, mo] = mailDay.split("-").map(Number);
  return nearest([isoDate(mo === 1 ? y - 1 : y, mo === 1 ? 12 : mo - 1, day), isoDate(y, mo, day), isoDate(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, day)], mailDay);
}

/**
 * A date value as written, read day first. Month first when the day-first reading is no date ("11.21"), or lies more
 * than 45 days before the mail while the other reading is nearer ("ETA 11.08" written in November). "Today" and
 * "tomorrow" count from the mail's day. Null when the value is not a date at all ("14 days").
 */
function readDate(raw: string, mailDay: string | null): { date: string | null; text: string } | null {
  const value = raw.trim();
  const iso = ISO_VALUE.exec(value);
  if (iso) {
    const date = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? { date, text: value } : null;
  }
  if (RELATIVE_DAY.test(value)) return mailDay ? { date: /^today$/i.test(value) ? mailDay : addDays(mailDay, 1), text: value.toLowerCase() } : null;
  const alone = DAY_ONLY.exec(value);
  if (alone) {
    const date = mailDay ? nearestDay(Number(alone[1]), mailDay) : null;
    return date ? { date, text: value } : null;
  }
  const named = MONTH_FIRST.exec(value);
  if (named) {
    const month = monthOf(named[1]);
    const date = month ? dated(yearOf(named[3], mailDay), month, Number(named[2]), mailDay) : null;
    return date ? { date, text: value } : null;
  }
  const m = DAY_FIRST.exec(value);
  if (!m) return null;
  const first = Number(m[1]);
  const year = yearOf(m[5], mailDay);
  const text = m[5] && year == null ? value.slice(0, value.length - m[5].length).replace(/[ .\/-]+$/, "") : value;
  if (/^[a-z]/i.test(m[4])) {
    const month = monthOf(m[4]);
    if (month) {
      const date = dated(year, month, first, mailDay);
      return date ? { date, text } : null;
    }
    // "ETD 6TH sailing": a day without its month is the nearest such day; "14 days" and "1st week" are no dates.
    if (!m[2] || !mailDay || /^(?:week|wk|half|quarter|fortnight)/i.test(m[4])) return null;
    const date = nearestDay(first, mailDay);
    return date ? { date, text: `${m[1]}${m[2]}` } : null;
  }
  const second = Number(m[4]);
  const dayFirst = m[3] ? dated(year, second, first, mailDay) : null;
  const monthFirst = m[3] ? dated(year, first, second, mailDay) : null;
  if (!dayFirst && !monthFirst) return YEAR_MONTH.test(value) ? { date: null, text: value } : null;
  let date = dayFirst ?? monthFirst;
  if (dayFirst && monthFirst && mailDay) {
    const behind = daysBetween(dayFirst, mailDay);
    if (behind > 45 && Math.abs(daysBetween(mailDay, monthFirst)) < behind) date = monthFirst;
  }
  return { date, text };
}

/** Words that may stand between "ETA" and its date without naming a port. */
const LINK_WORDS = new Set([
  "is", "at", "from", "to", "of", "for", "on", "in", "as", "the", "this", "that", "our", "your", "shipment", "vessel", "vsl",
  "will", "be", "been", "has", "have", "had", "was", "now", "revised", "updated", "update", "changed", "delayed", "until",
  "till", "by", "date", "dated", "tentative", "tentatively", "expected", "approx", "around", "about", "final", "new",
  "current", "currently", "latest", "still", "remains", "remain", "same", "and", "planned", "schedule", "scheduled",
  "per", "port", "terminal", "airport", "pod", "pol", "confirmed", "are", "it", "dt", "again", "only", "earliest", "first",
  "next", "available", "shows", "show", "showing", "showed", "expect", "expecting", "arrive", "arriving", "arrival", "already",
  "moved", "postponed", "extended", "rescheduled", "pushed", "estimated", "approximately", "likely", "would", "should",
  "given", "advised",
]);

/** What stands between the keyword and the date: a port ("Sohar"), nothing, or words that make it no date of ours (null). */
function bridgeOf(raw: string): { port: string | null } | null {
  const inner = raw.replace(/^[\s.:：=>~*\-–]+|[\s:：=>~*(\-–]+$/g, "");
  if (!inner) return { port: null };
  if (/[.?!;|]/.test(inner)) return null;
  const words = inner.split(/[\s,()[\]:：\-–\/]+/).filter(Boolean);
  if (words.length > 7) return null;
  const named = words.filter((w) => !LINK_WORDS.has(w.toLowerCase()));
  if (named.length > 3 || named.some((w) => !/^[A-Z][A-Za-z'’]*$/.test(w))) return null;
  const places = named.filter((w, i) => !CARRIER.test(w) && (i === 0 || !/^oman$/i.test(w)));
  // "MCT" stays a code; the words of a name are written as a name ("NHAVA SHEVA" → "Nhava Sheva").
  const port = places.map((w) => (places.length === 1 && /^[A-Z]{2,3}$/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(" ");
  return { port: port || null };
}

/** After a value: what makes it a span, not a date ("ETA 10-12 days"). */
const SPAN_AFTER = /^\s*(?:working\s+)?(?:days?|hrs?|hours?|weeks?|nights?)\b/i;
/** Between the word and "today" or "tomorrow": the date itself is still to come ("ETA will be updated by tomorrow"). */
const TO_COME = /\b(?:updat|revis|confirm|advis|shar|inform|chang|check|revert)\w*/i;

interface ShipDate { kind: "ETD" | "ETA" | "ATD"; date: string | null; text: string; port: string | null }
/** Between the word and the date: a value that was, not one that is ("our originally booked ETD was August 21st"). */
const PAST_VALUE = /\b(?:was|were|originally|original|previous(?:ly)?|earlier|old)\b/i;
/** In the clause before the word: a date that will not hold ("not possible to make ETD 06-NOV"), kept only as an earlier value. */
const NEGATED_LEAD = /\b(?:not|cannot|can['’]t|unable|impossible|no longer)\b/i;

/** The clause a date stands in, up to it: back to the last comma, semicolon or full stop. */
function leadOf(text: string, index: number): string {
  const before = text.slice(0, index);
  return before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), before.search(/[.!?]\s[^.!?]*$/)) + 1);
}
/** Whether the sentence a date stands in asks something: an option offered ("ETD 16-Nov, do we change?") is not the date. */
function inQuestion(text: string, index: number): boolean {
  const rest = text.slice(index);
  const stop = rest.search(/[.!?](?=\s|$)/);
  return stop >= 0 && rest[stop] === "?";
}

/** One "ETD/ETA/ATD" value in a text, resolved relative to the mail's date; null date when it has no day. */
export function parseShipDate(text: string, receivedAt: string): ShipDate[] {
  return shipDates(text, receivedAt).map(({ kind, date, text: said, port }) => ({ kind, date, text: said, port }));
}

/** The dates of a text as parseShipDate reads them, each marked when it is a value that was (past). */
function shipDates(text: string, receivedAt: string): (ShipDate & { past: boolean })[] {
  const out: (ShipDate & { past: boolean })[] = [];
  try {
    if (typeof text !== "string" || !text) return out;
    const t = typeof receivedAt === "string" ? Date.parse(receivedAt) : NaN;
    const mailDay = Number.isFinite(t) ? muscatDate(new Date(t).toISOString()) : null;
    const re = every(SHIP_DATE);
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const between = m[0].slice(m[1].length, m[0].length - m[2].length);
      // "ETD/ETA Muscat 12 Nov": the date belongs to the keyword nearest to it.
      const inner = between.search(/\b(?:ETD|ETA|ATD)\b/i);
      if (inner >= 0) {
        re.lastIndex = m.index + m[1].length + inner;
        continue;
      }
      if (SPAN_AFTER.test(text.slice(m.index + m[0].length))) continue;
      if (RELATIVE_DAY.test(m[2])) {
        // "Please confirm ETA MCT today" asks for the date; it does not give one.
        const line = text.slice(text.lastIndexOf("\n", m.index) + 1, m.index);
        if (TO_COME.test(between) || isRequest(line)) continue;
      }
      if (inQuestion(text, m.index)) continue;
      const bridge = bridgeOf(between);
      const read = bridge ? readDate(m[2], mailDay) : null;
      const past = PAST_VALUE.test(between) || NEGATED_LEAD.test(leadOf(text, m.index));
      if (bridge && read) out.push({ kind: m[1].toUpperCase() as ShipDate["kind"], date: read.date, text: read.text, port: bridge.port, past });
    }
  } catch {
    // an odd text gives what was read so far
  }
  return out;
}

interface Stated extends ShipDate { past: boolean; mail: ReadMail; sentence: string; plan: boolean }

/** The dates one text states, line by line. A port given both an ETA and an ETD on one line is a port of call on the way: left out. */
function statedIn(text: string, mail: ReadMail, plan: boolean, out: Stated[]): void {
  for (const line of text.split("\n")) {
    if (!/ET[AD]|ATD/i.test(line)) continue;
    const found = shipDates(line, mail.at);
    for (const f of found) {
      const call = f.port && f.kind !== "ATD" && found.some((o) => o.kind !== f.kind && o.kind !== "ATD" && o.port === f.port);
      if (!call) out.push({ ...f, mail, sentence: clip(line), plan });
    }
  }
}

/**
 * The latest value of one kind with the earlier distinct ones, newest first. A value written as one that was ("ETA
 * was 28 Sep") is never the latest while a current one exists; it is listed with the earlier ones after them.
 */
function datedValue(list: Stated[], today: string): DatedValue | null {
  if (!list.length) return null;
  let at = list.length - 1;
  while (at > 0 && list[at].past) at--;
  const latest = list[at];
  const keyOf = (s: Stated) => s.date ?? s.text.toLowerCase();
  const seen = new Set([keyOf(latest)]);
  const earlier: DatedValue["earlier"] = [];
  const push = (s: Stated) => {
    if (seen.has(keyOf(s))) return;
    seen.add(keyOf(s));
    earlier.push({ date: s.date, text: s.text, proof: proofOf(s.mail, today, s.sentence) });
  };
  // The current values before it first, newest first: the one just before is what it moved from.
  for (let i = at - 1; i >= 0; i--) if (!list[i].past) push(list[i]);
  const before = earlier[0];
  for (let i = at - 1; i >= 0; i--) if (list[i].past) push(list[i]);
  for (let i = list.length - 1; i > at; i--) push(list[i]);
  // Without an earlier current value, one the same mail writes as past ("ETD is 21-NOV … not possible to make ETD
  // 06-NOV") is what it moved from; a past value in another mail may be about anything.
  const from = before ?? (earlier[0]?.proof.emailId === latest.mail.id ? earlier[0] : undefined);
  const slipDays = !latest.plan && latest.date && from?.date ? daysBetween(from.date, latest.date) : null;
  return { date: latest.date, text: latest.text, port: latest.port, proof: proofOf(latest.mail, today, latest.sentence), earlier, slipDays, plan: latest.plan };
}

/** A value of a cut-off line that is a day or a time, not a span ("2 days"). */
const CUTOFF_VALUE = /^\d{1,2}(?:st|nd|rd|th)?(?:[ .\/-]{0,2}(?:\d{1,2}|[a-z]{3,9})|$|[ ,]+(?:at )?\d)/i;
const CUTOFF_ALL = every(CUTOFF);

function cutoffOf(list: ReadMail[], today: string): Sourced<string> | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const text = list[i].clean;
    for (const m of text.matchAll(CUTOFF_ALL)) {
      const value = flat(m[1]).replace(/[\s(,]+$/, "");
      if (!CUTOFF_VALUE.test(value) || /^\d+\s*(?:days?|hours?|hrs?|weeks?)\b/i.test(value)) continue;
      return { value, proof: proofOf(list[i], today, lineAt(text, m.index ?? 0)) };
    }
  }
  return null;
}

/** The free days a text states: "14 days free detention at destination" → 14. */
function freeDaysIn(text: string): { days: number; index: number } | null {
  const m = FREE_TIME.exec(text);
  const days = m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : NaN;
  return m && days > 0 && days < 100 ? { days, index: m.index } : null;
}

/** The port of discharge of the newest house subject, in capitals ("SOHAR OMAN"). */
function podOf(list: ReadMail[]): string | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const pod = houseOf(list[i].email?.subject)?.pod;
    if (pod) return pod.toUpperCase();
  }
  return null;
}

/** Whether a port named with a date is the port of discharge: no port or no known POD counts as yes; Oman places match each other. */
function atPod(port: string | null, pod: string | null): boolean {
  if (!port || !pod) return true;
  const words = port.toUpperCase().split(/\s+/);
  return pod.split(/\s+/).some((w) => w.length >= 3 && words.includes(w)) || (OMAN_PLACE.test(pod) && OMAN_PLACE.test(port));
}

const toAgents = (m: ReadMail) => m.party === "us" && (m.toParty === "agent" || m.toParty === "carrier");
const fromAgents = (m: ReadMail) => m.party === "agent" || m.party === "carrier";

/** A mail of ours that carries our price: its dates are a plan. */
function isOurQuote(mail: ReadMail, offer: Offer | null): boolean {
  if (mail.party !== "us") return false;
  return mail.id === offer?.proof?.emailId || mail.moneyRole === "offer" || OUR_PRICE_LINE.test(mail.clean) || OFFER_CUE.test(mail.clean);
}

function validityLines(offer: Offer | null, rates: AgentQuote[], today: string): ValidityFact[] {
  const out: ValidityFact[] = [];
  for (const rate of rates) {
    if (!rate || (rate.state !== "rated" && rate.state !== "agreed" && !rate.validity)) continue;
    const who = rate.name || rate.domain || "Agent";
    const fact = rate.validity;
    const name = fact?.who || who;
    // "no validity can be provided" reads like no validity given at all.
    const said = fact?.none ? "none given" : (fact?.text ?? "");
    if (fact) out.push({ ...fact, who: name, text: said.startsWith(name) ? said : `${name}: ${said}` });
    else out.push({ who, until: null, daysLeft: null, ended: false, none: false, boilerplate: false, text: `${who}: none given`, proof: rate.latest?.proof ?? null });
  }
  if (offer) {
    const until = isDay(offer.validUntil) ? offer.validUntil : null;
    const daysLeft = until && isDay(today) ? daysBetween(today, until) : null;
    const ended = daysLeft != null && daysLeft < 0;
    const text = until ? `Our offer: ${ended ? "ended" : "valid until"} ${dayWithWeekday(until, today || until)}` : "Our offer: none stated";
    out.push({ who: "Our offer", until, daysLeft, ended, none: false, boilerplate: false, text, proof: offer.proof ?? null });
  }
  return out;
}

const noDates = (): DateFacts => ({
  etd: null, eta: null, atd: null, cutoff: null, transit: { ours: null, agent: null }, freeDays: { asked: null, given: null },
  validity: [], promises: [], headline: null,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Sub-steps that come only once a shipment has arrived: the CAN, the DO, the freight certificate, "manifest done". */
const ARRIVAL_PAPERS = new Set<SubStepKey>(["can", "do", "freight_certificate", "manifest"]);
/** Sub-steps of the BL that come only once a ship has sailed: the pre-alert, the release, the originals, the final BL. */
const SAILING_PAPERS = new Set<SubStepKey>(["pre_alert", "telex", "seaway", "originals", "bl_final"]);
const ARRIVAL_STEPS: MilestoneKey[] = ["arrived", "can_do", "bayan", "delivered"];
const SAILING_STEPS: MilestoneKey[] = ["sailed", "departed", "bl", "in_transit"];

/**
 * Whether the e-mails show the sailing and the arrival: a step that proves it, or the papers that come after it
 * (whoever wrote them). An origin's flight manifest (a file) is no arrival paper; "manifest done" is.
 */
function shownOf(list: ReadMail[]): { sailed: boolean; arrived: boolean } {
  let sailed = false;
  let arrived = false;
  for (const mail of list) {
    for (const h of Array.isArray(mail?.milestones) ? mail.milestones : []) {
      if (!h?.key) continue;
      if (h.proves ? ARRIVAL_STEPS.includes(h.key) : !!h.sub && ARRIVAL_PAPERS.has(h.sub) && !(h.sub === "manifest" && h.file)) arrived = true;
      if (h.proves ? SAILING_STEPS.includes(h.key) : h.sub === "pre_alert" || (h.key === "bl" && !!h.sub && SAILING_PAPERS.has(h.sub))) sailed = true;
    }
  }
  return { sailed: sailed || arrived, arrived };
}

/** The top line of the dates: a date within three days, or one that passed with nothing to show for it. */
function headlineOf(etd: DatedValue | null, eta: DatedValue | null, sailed: boolean, arrived: boolean, today: string): DateFacts["headline"] {
  if (!isDay(today)) return null;
  const line = (label: string, value: DatedValue | null, done: boolean, missing: string): DateFacts["headline"] => {
    if (!value?.date || value.plan || done) return null;
    const left = daysBetween(today, value.date);
    if (left < 0) return { text: `${label} ${fmtDayMonth(value.date, today)} passed — ${missing}`, tone: "bad" };
    if (left > 3) return null;
    return { text: left === 0 ? `${label} today` : `${label} in ${plural(left, "day")}`, tone: "warn" };
  };
  return line("ETD", etd, sailed || arrived, "no sailing confirmed") ?? line("ETA", eta, arrived, "no arrival confirmed");
}

/** A rate an agent or a line offers: its sailing date is an option, not a booking. */
const isRateOffer = (m: ReadMail) => m.moneyRole === "agent_rate";

/** The agents whose own e-mails prove a step of this shipment: its booking note, the SO, the sailing, the BL… */
function agentsOnTheShipment(list: ReadMail[]): Set<string> {
  const out = new Set<string>();
  for (const m of list) {
    if (m.party === "agent" && (Array.isArray(m.milestones) ? m.milestones : []).some((h) => !!h?.key && h.proves)) out.add(m.sideKey);
  }
  return out;
}

/**
 * The dates that speak of this booking. Ours, the customer's, a shipper's and a line's count: a line writes of the
 * vessel, whoever booked it (its own rate offer excepted). Among the agents, the one whose rate was agreed counts,
 * and so does one whose own e-mails prove a step of the shipment (an agent the shipper booked with, on the same PO).
 * Another agent's rate offer is an option, never this booking's date. With no agent known to carry the booking, a
 * lone agent's dates count; with two or more writing dates which one carries it is not known, so none counts.
 */
function aboutThisBooking(stated: Stated[], list: ReadMail[], rates: AgentQuote[]): Stated[] {
  const agreed = rates.find((r) => r?.state === "agreed")?.sideKey ?? null;
  const proven = agentsOnTheShipment(list);
  const carries = (key: string) => key === agreed || proven.has(key);
  // An agent known to carry the booking makes every other agent's date an option.
  const known = agreed != null || proven.size > 0;
  const kept = new Set<Stated>();
  const unknown: Stated[] = [];
  for (const s of stated) {
    const m = s.mail;
    if (m.party === "carrier") {
      if (!isRateOffer(m)) kept.add(s);
    } else if (m.party !== "agent" || m.sideKey === agreed) kept.add(s);
    else if (isRateOffer(m)) continue;
    else if (carries(m.sideKey)) kept.add(s);
    else if (!known) unknown.push(s);
  }
  if (new Set(unknown.map((s) => s.mail.sideKey)).size === 1) for (const s of unknown) kept.add(s);
  // In the order they were written: the newest is the date.
  return stated.filter((s) => kept.has(s));
}

/** A date that moved, without the move: before the job is booked a new date is no slip. */
const unmoved = (value: DatedValue | null): DatedValue | null => (value ? { ...value, slipDays: null } : null);

/**
 * The dates the e-mails state: ETD, ETA and ATD with their earlier values, the cut-off, transit, free days, each
 * rate's validity, and the promises (the open ones newest first, then the last three kept). A date in our own quote
 * is a plan: it never counts as a slip. Only dates about this booking count (see aboutThisBooking). Until the job
 * is booked (booked false: not confirmed in the register) no date counts down and none slipped: there is no sailing.
 */
export function datesOf(mails: ReadMail[], offer: Offer | null, rates: AgentQuote[], today: string, booked = true): DateFacts {
  try {
    const list = scoped(mails);
    const quotes = (Array.isArray(rates) ? rates : []).filter(Boolean);
    const ours = offer ?? null;
    const all: Stated[] = [];
    const subjects = new Set<string>();
    for (const mail of list) {
      const plan = isOurQuote(mail, ours);
      // A subject is read once per conversation: the same subject goes to every agent asked.
      const subject = (mail.email?.subject ?? "").trim();
      const subjectKey = `${mail.sideKey}|${subject.toLowerCase()}`;
      if (subject && !subjects.has(subjectKey)) {
        subjects.add(subjectKey);
        statedIn(subject, mail, plan, all);
      }
      statedIn(mail.clean ?? "", mail, plan, all);
    }
    const stated = aboutThisBooking(all, list, quotes);
    // An ETA at a port that is not the port of discharge is the ship's at a stop on the way ("ETA Nhava Sheva" on the way to Sohar).
    const pod = podOf(list);
    const readEtd = datedValue(stated.filter((s) => s.kind === "ETD"), today);
    const readEta = datedValue(stated.filter((s) => s.kind === "ETA" && atPod(s.port, pod)), today);
    const etd = booked ? readEtd : unmoved(readEtd);
    const eta = booked ? readEta : unmoved(readEta);
    const atd = datedValue(stated.filter((s) => s.kind === "ATD"), today);

    const newestFirst = [...list].reverse();
    // Free days we ask for come in a request; our pass-on of a line's free days ("ESL free days @ POD 10 days") asks nothing.
    const asking = newestFirst.find((m) => toAgents(m) && m.isRequest && freeDaysIn(m.clean));
    const stating = newestFirst.find((m) => fromAgents(m) && freeDaysIn(m.clean));
    const agreed = quotes.find((r) => r.state === "agreed");
    const byNewest = [...quotes].sort((a, b) => timeOf(b.lastAt) - timeOf(a.lastAt));
    const withFree = (agreed?.latest?.freeDays != null ? agreed : byNewest.find((r) => r.latest?.freeDays != null))?.latest;
    const withTransit = (agreed?.latest?.transit ? agreed : byNewest.find((r) => r.latest?.transit))?.latest;
    const free = stating ? freeDaysIn(stating.clean) : null;
    const given: Sourced<number> | null =
      withFree?.freeDays != null
        ? { value: withFree.freeDays, proof: withFree.proof }
        : stating && free
          ? { value: free.days, proof: proofOf(stating, today, lineAt(stating.clean, free.index)) }
          : null;

    const shown = shownOf(list);
    const withPromise = newestFirst.filter((m) => !!m.promise).map((m) => m.promise as PromiseMade);
    const promises = [...withPromise.filter((p) => !p.kept).slice(0, 6), ...withPromise.filter((p) => p.kept).slice(0, 3)];

    return {
      etd, eta, atd,
      cutoff: cutoffOf(list, today),
      transit: {
        ours: ours?.transit ? { value: ours.transit, proof: ours.proof } : null,
        agent: withTransit?.transit ? { value: withTransit.transit, proof: withTransit.proof } : null,
      },
      freeDays: { asked: asking ? (freeDaysIn(asking.clean)?.days ?? null) : null, given },
      validity: validityLines(ours, quotes, today),
      promises,
      headline: booked ? headlineOf(etd, eta, !!atd || shown.sailed, shown.arrived, today) : null,
    };
  } catch {
    return noDates();
  }
}

// --- Files ----------------------------------------------------------------------------------------------------

interface Doc { kind: DocKind; subKind: DocSubKind; label: string }

/** Words with which a sentence hands something over: "attached", "PFA", "please find", "as below". */
const SENDS = /\battach\w*|\benclosed\b|\bPFA\b|\bherewith\b|\b(?:please|pls|plz|kindly)\s+(?:kindly\s+)?(?:find|see|refer)\b|\bfind (?:below|here)\b|\bas below\b|\bcan find\b/i;
/** Words that make a sentence a wish, a plan, a condition or a question rather than a statement of what happened. */
const UNSURE =
  /\b(?:not|never|yet|once|if|unless|whether|when|until|till|will|shall|would|should|must|might|can only|need(?:s|ed)?|requir(?:e|es|ed|ing|ements?)|await(?:ing|ed)?|waiting|pending|expect(?:s|ed|ing)?|(?<!\bas )plan(?:s|ned|ning)?|tentative(?:ly)?|subject to|to be|going to|hope|soon|shortly|tomorrow|cannot|unable|(?:under|in) process(?:ing)?|in progress|applying|pushing|chasing|following up|urging)\b|n['’]t\b|\?/i;
/** What is still to be done, when it stands before the thing named: "in order to send him the OBL". */
const TO_DO = /\bto (?:send|share|release|issue|provide|arrange|get|obtain|receive|collect|submit|surrender|prepare|deliver|dispatch|courier|have)\b/i;
/** A sentence that opens with its condition: "If …", "Once …". */
const CONDITION = /^\W*(?:if|once|when|unless|until|till|as soon as|whether|in case)\b/i;
/** Where the clause after a statement ends: a comma, a semicolon, or "and", "but", "so" starting something new. */
const CLAUSE_END = /[,;，；]|\s(?:and|but|so)\s/i;

/** Whether a sentence states that something happened or hands it over: no wish, no plan, no bare request. */
const states = (s: string) => !UNSURE.test(s) && (!isRequest(s) || SENDS.test(s));

/**
 * The clause around what was found in a sentence: back to the last comma (lead), then on to the next comma, or only
 * as far as an "and" that starts something new (clause).
 */
function clauseAt(s: string, at: number, length: number): { lead: string; clause: string; toComma: string } {
  const before = s.slice(0, at);
  const lead = before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("，"), before.lastIndexOf("；")) + 1);
  const found = s.slice(at, at + length);
  const after = s.slice(at + length);
  const end = after.search(CLAUSE_END);
  const comma = after.search(/[,;，；]/);
  return { lead, clause: lead + found + (end < 0 ? after : after.slice(0, end)), toComma: lead + found + (comma < 0 ? after : after.slice(0, comma)) };
}

/**
 * Whether a sentence states what was found in it at that place: it happened, or it is handed over. Not a wish, a
 * plan or a condition in its own clause ("will share the BL once received"), not a question, and not something asked
 * for ("please confirm the shipment arrived"). What the rest of the sentence promises does not take it back
 * ("Shipment has arrived, we will share the CAN tomorrow").
 */
function stated(s: string, at: number, length: number): boolean {
  if (CONDITION.test(s) || s.slice(at + length).includes("?")) return false;
  const { lead, clause } = clauseAt(s, at, length);
  if (UNSURE.test(clause) || TO_DO.test(lead)) return false;
  return !isRequest(s.slice(0, at)) || SENDS.test(clause);
}

/** Whether a sentence states what a pattern found in it. */
const says = (s: string, m: RegExpExecArray | null): m is RegExpExecArray => !!m && stated(s, m.index, m[0].length);

/** Words a wrapped line may end with: its sentence goes on below. */
const HANGS = /(?:\b(?:the|a|an|to|of|and|or|for|in|on|at|with|from|by|is|are|was|were|be|been|as|that|this|our|your|their|has|have|had|will|not|if|whether|please|kindly)|,)$/i;

/**
 * A text with its hard-wrapped lines joined again, so that a sentence broken across lines is read as one. A line
 * was wrapped when the first word of the next line would not have fitted on it (e-mail programs wrap at 72 to 78).
 */
function unwrapped(text: string): string {
  const out: string[] = [];
  let width = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const next = line.trimStart();
    const first = /^\S+/.exec(next)?.[0] ?? "";
    const last = out[out.length - 1] ?? "";
    const wrapped = !!first && width >= 50 && width <= 80 && width + 1 + first.length > 74 && (/^[a-z0-9(]/.test(next) || HANGS.test(last));
    if (wrapped) out[out.length - 1] = `${last} ${next}`;
    else out.push(line);
    width = line.length;
  }
  return out.join("\n");
}

const BL_DRAFT_WORDS = /\b(?:bl|b\/l|hbl|mbl)s? ?drafts?\b|\bdrafts? (?:of )?(?:bl|b\/l|hbl|mbl)s?\b/i;
const ORIGINAL_WORDS = /\boriginal (?:bl|b\/l|hbl|mbl)\b|\b(?:bl|b\/l|hbl|mbl)\b[^.\n]{0,12}\boriginals?\b|\bobl\b|\bohbl\b/i;

/** What a sentence says is attached, for a file whose name says nothing ("KMTCTAO8748592.pdf", a scanner's name). */
const ATTACHED: [RegExp, Doc][] = [
  [/\b(?:SO|S\/O)\b|\bshipping order\b/, { kind: "booking_so", subKind: "so", label: "SO" }],
  [/\bbayan\b/i, { kind: "customs_do", subKind: "bayan", label: "Bayan" }],
  [/\b[Cc]argo [Aa]rrival [Nn]otice\b|\bCARGO ARRIVAL NOTICE\b|\bCAN\b/, { kind: "pre_alert_can", subKind: "can", label: "CAN" }],
  [/\b[Dd]elivery [Oo]rder\b|\bDELIVERY ORDER\b|\bD\/O\b|\bDO\b/, { kind: "customs_do", subKind: "do", label: "DO" }],
  [BL_DRAFT_WORDS, { kind: "bl_awb", subKind: "draft", label: "BL draft" }],
  [/\btelex\b|\bsurrender(?:ed)?\b/i, { kind: "bl_awb", subKind: "telex_seaway", label: "Telex release" }],
  [/\bsea ?way ?bill\b|\bswb\b/i, { kind: "bl_awb", subKind: "telex_seaway", label: "Seaway bill" }],
  [ORIGINAL_WORDS, { kind: "bl_awb", subKind: "original", label: "Original BL" }],
  [/\b(?:final )?[hm]?awbl?\b/i, { kind: "bl_awb", subKind: "final", label: "AWB" }],
  [/\bdebit note\b|\bDN\b/, { kind: "invoice_payment", subKind: "debit_note", label: "Debit note" }],
  [/\bpre.?alert\b/i, { kind: "pre_alert_can", subKind: null, label: "Pre-alert" }],
  [/\bpacking list\b/i, { kind: "packing", subKind: null, label: "Packing list" }],
];

/** The kind of document the mail's own words give a file: the first sentence that hands something over and names it. */
function cueKind(text: string): Doc | null {
  if (typeof text !== "string" || !text.trim()) return null;
  for (const raw of sentencesOf(unwrapped(text))) {
    const s = flat(raw);
    if (says(s, M.so_released.t.exec(s))) return { ...ATTACHED[0][1] };
    const sends = SENDS.exec(s);
    // "as per your attached invoice" speaks of a file the other side sent earlier.
    if (!sends || CONDITION.test(s) || /\byour\s+$/i.test(s.slice(0, sends.index))) continue;
    const { clause, toComma } = clauseAt(s, sends.index, sends[0].length);
    if (UNSURE.test(clause)) continue;
    for (const [re, doc] of ATTACHED) if (re.test(toComma)) return { ...doc };
  }
  return null;
}

const DOC_RE = new Map(DOC_KINDS);

/** The finer kind and the label of a file whose name gave its kind. */
function detailOf(kind: DocKind, name: string, spaced: string): Doc {
  const has = (re: RegExp) => re.test(name) || re.test(spaced);
  switch (kind) {
    case "bl_awb": {
      const word = /awb/i.test(name) || AWB_NO.test(name) ? "AWB" : "BL";
      if (/instruction/i.test(name)) return { kind, subKind: null, label: `${/\bbl\b|b\/l|hbl|mbl/i.test(spaced) ? "BL" : word} instructions` };
      if (/draft/i.test(name)) return { kind, subKind: "draft", label: `${word} draft` };
      if (/telex|tlx|surrender|swb|sea ?way|express/i.test(name)) {
        return { kind, subKind: "telex_seaway", label: /swb|sea ?way/i.test(name) ? "Seaway bill" : /express/i.test(name) ? "Express BL" : "Telex release" };
      }
      if (has(/\bobl\b|ohbl|^org-|obd(?![a-z])|original|正本/i)) return { kind, subKind: "original", label: `Original ${word}` };
      return { kind, subKind: "final", label: word };
    }
    case "customs_do":
      // The origin's export declaration is not the Bayan.
      if (/export/i.test(name) && /declaration/i.test(name)) return { kind, subKind: null, label: "Export declaration" };
      if (/declarationprint|bayan|declaration/i.test(name)) return { kind, subKind: "bayan", label: "Bayan" };
      if (has(/delivery ?order|\bdo\b|[ -]do\.|mdo|hdo|slmdo/i)) return { kind, subKind: "do", label: "DO" };
      if (has(/\bcoo\b|certificate of origin/i)) return { kind, subKind: "coo", label: "Certificate of origin" };
      return { kind, subKind: null, label: /msds/i.test(name) ? "MSDS" : has(/cert|\bcoa\b/i) ? "Certificate" : "Customs document" };
    case "pre_alert_can":
      if (/freight cert|^fc\./i.test(name)) return { kind, subKind: null, label: "Freight certificate" };
      if (/manifest/i.test(name)) return { kind, subKind: null, label: "Manifest" };
      if (has(/pre.?alert|\bpa\b/i)) return { kind, subKind: null, label: "Pre-alert" };
      if (has(/\bcan\b|^can[ (]|cancb|arrival|notice/i)) return { kind, subKind: "can", label: "CAN" };
      return { kind, subKind: null, label: "Pre-alert" };
    case "invoice_payment":
      if (has(/debit|\bdn\b|^dn\d|dbnote|credit note/i)) return { kind, subKind: "debit_note", label: "Debit note" };
      if (has(/rec(?:ei|ie)pt|payment|voucher|cheque|\bpdc\b|\bsoa\b|statement|bank details|remittance/i)) return { kind, subKind: "payment", label: "Payment" };
      return { kind, subKind: "invoice", label: "Invoice" };
    case "booking_so":
      return has(/\bso\b|s\/o|shipping order|release|\brls\b/i) ? { kind, subKind: "so", label: "SO" } : { kind, subKind: "booking", label: "Booking" };
    case "packing":
      return { kind, subKind: null, label: "Packing list" };
    case "quote":
      return { kind, subKind: null, label: "Quote" };
    case "photo":
      return { kind, subKind: null, label: "Photo" };
    default:
      return { kind: "other", subKind: null, label: "Other" };
  }
}

/** Files a person edits: a BL in Word or Excel is a draft or an instruction, never the issued BL. */
const EDITABLE = /\.(?:docx?|xlsx?|rtf|odt)$/i;
/** Words with which a mail sends BL drafts: "HBL draft", "draft MBL", "check bls", "final mbl draft". */
const DRAFT_TALK = /\b(?:bl|b\/l|hbl|mbl|awb|awbl)s? ?drafts?\b|\bdrafts? (?:of )?(?:the )?(?:bl|b\/l|hbl|mbl|awb|awbl)s?\b|\bcheck (?:the )?(?:bls|bl|b\/l|hbl|mbl)\b/i;
/** Words with which a mail sends the issued BL or its release. */
const ISSUED_TALK = /\btelex|\btlx\b|surrender|sea ?way|\bswb\b|express (?:bl|b\/l|release)|\boriginals?\b|\bo[hm]?bl\b|\bfinal (?:bl|b\/l|hbl|mbl|awb|awbl|copy)\b(?! ?drafts?)/i;

/** Whether a mail's words make its BL files drafts: it speaks of a draft or asks for approval, and not of the issued BL. */
const sendsDrafts = (text: string) => (DRAFT_TALK.test(text) || M.bl_approval_asked.t.test(text)) && !ISSUED_TALK.test(text);

/** The same BL or AWB file as a draft. */
const asDraft = (doc: Doc): Doc => ({ kind: "bl_awb", subKind: "draft", label: `${doc.label.startsWith("AWB") ? "AWB" : "BL"} draft` });

/**
 * The kind of a file, from its name: invoice before BL ("Draft invoice"), packing before BL ("CI&PL"). A carrier's
 * "_POD.PDF" is a port-of-discharge paper, never proof of delivery. A name that says nothing takes its kind from
 * what the mail says is attached (textCue: the mail's text). A BL named as issued is a draft when it is a Word or
 * Excel file, or when the mail sends it as a draft ("Attached BL draft", "pls check bls").
 */
export function documentKind(filename: string, mime: string, size: number, textCue: string): { kind: DocKind; subKind: DocSubKind; label: string } {
  try {
    const name = typeof filename === "string" ? filename.trim() : "";
    const spaced = name.replace(/_+/g, " ");
    if (/_pod\.pdf$/i.test(name)) return detailOf("other", name, spaced);
    let kind: DocKind | null = /packing|commercial|pro.?forma/i.test(name) ? "packing" : /freight cert|^fc\./i.test(name) ? "pre_alert_can" : null;
    if (!kind) {
      for (const [k, re] of DOC_KINDS) {
        if (re.test(name) || re.test(spaced)) {
          kind = k;
          break;
        }
      }
    }
    // "MBL telex release.pdf" is a release of the BL, not of the SO.
    const booking = DOC_RE.get("booking_so");
    const bl = DOC_RE.get("bl_awb");
    if (kind === "booking_so" && booking && bl && (bl.test(name) || bl.test(spaced)) && !booking.test(spaced.replace(/released?/gi, " "))) kind = "bl_awb";
    if (kind) {
      const doc = detailOf(kind, name, spaced);
      if (doc.kind !== "bl_awb") return doc;
      const said = typeof textCue === "string" ? textCue : "";
      const draft = (doc.subKind === "final" && EDITABLE.test(name)) || ((doc.subKind === "final" || doc.subKind === "telex_seaway") && sendsDrafts(said));
      return draft ? asDraft(doc) : doc;
    }
    const image = /^image\//i.test(typeof mime === "string" ? mime : "") || /\.(?:png|jpe?g|gif|bmp|webp|heic)$/i.test(name);
    if (image) return detailOf(typeof size === "number" && size >= 30 * 1024 ? "photo" : "other", name, spaced);
    return cueKind(textCue) ?? detailOf("other", name, spaced);
  } catch {
    return { kind: "other", subKind: null, label: "Other" };
  }
}

/**
 * A file name as one name whatever copy it is: lower case, any run of spaces (a non-breaking one too) as one space,
 * without " (1)", " - copy" or a "_1" at the end.
 */
function normalName(filename: string): string {
  const name = filename.replace(/\s+/g, " ").trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  let base = ext ? name.slice(0, dot) : name;
  for (let prev = ""; prev !== base; ) {
    prev = base;
    base = base.replace(/\s*\(\d{1,3}\)\s*$|\s*-\s*copy$|(?<=[a-z])[_-]\d$/, "").trim();
  }
  return `${base}${ext}`;
}

const KIND_ORDER: DocKind[] = ["booking_so", "bl_awb", "pre_alert_can", "customs_do", "invoice_payment", "packing", "quote", "photo", "other"];
const SUB_ORDER: DocSubKind[] = ["booking", "so", "draft", "final", "telex_seaway", "original", "can", "do", "bayan", "coo", "invoice", "debit_note", "payment", null];

/**
 * The files of one mail with their kinds. A BL named as issued is a draft when the same mail sends a draft with it
 * ("_BL_DRAFT.pdf" and "_MBL.pdf" together), or when a file of that name went out as a draft before (drafts: the
 * names of earlier drafts, which this adds the mail's drafts to).
 */
function filedDocs(mail: ReadMail, drafts: Set<string>): { file: DocFile; doc: Doc }[] {
  const files = (Array.isArray(mail?.files) ? mail.files : []).filter((f) => !!f && typeof f.filename === "string");
  const docs = files.map((file) => ({ file, doc: documentKind(file.filename, file.mime, file.size, mail.clean ?? "") }));
  const withDraft = docs.some((d) => d.doc.kind === "bl_awb" && d.doc.subKind === "draft");
  for (const d of docs) {
    if (d.doc.kind === "bl_awb" && d.doc.subKind === "final" && (withDraft || drafts.has(normalName(d.file.filename)))) d.doc = asDraft(d.doc);
  }
  for (const d of docs) if (d.doc.kind === "bl_awb" && d.doc.subKind === "draft") drafts.add(normalName(d.file.filename));
  return docs;
}

/**
 * The documents on the e-mails, without signature images: one group per file name, with its versions (distinct
 * sizes) and how many times it was sent. A group takes the first kind its files show that is not "other" (a bare
 * number named by one mail's words). Files on e-mails that look like another enquiry's are kept and marked.
 */
export function documentsOf(mails: ReadMail[]): DocGroup[] {
  try {
    const groups = new Map<string, { group: DocGroup; sizes: Set<number> }>();
    const drafts = new Set<string>();
    const list = (Array.isArray(mails) ? mails : []).filter((m) => !!m && m.scope !== "noise").sort((a, b) => timeOf(a.at) - timeOf(b.at));
    for (const mail of list) {
      for (const { file, doc } of filedDocs(mail, drafts)) {
        if (isSignatureImage({ filename: file.filename, mime_type: file.mime, size: file.size })) continue;
        const key = normalName(file.filename);
        const known = groups.get(key);
        if (known) {
          known.group.files.unshift(file);
          known.group.latest = file;
          known.sizes.add(file.size);
          if (known.group.kind === "other" && doc.kind !== "other") Object.assign(known.group, doc);
        } else {
          groups.set(key, { group: { ...doc, latest: file, version: 1, sentTimes: 1, files: [file] }, sizes: new Set([file.size]) });
        }
      }
    }
    const rank = (g: DocGroup) => KIND_ORDER.indexOf(g.kind) * 100 + Math.max(0, SUB_ORDER.indexOf(g.subKind));
    return [...groups.values()]
      .map(({ group, sizes }) => ({ ...group, version: sizes.size, sentTimes: group.files.length }))
      .sort((a, b) => rank(a) - rank(b) || timeOf(b.latest.at) - timeOf(a.latest.at));
  } catch {
    return [];
  }
}

// --- What one e-mail says about the steps ---------------------------------------------------------------------

/** The things an e-mail can be about; each set of steps maps them to its own step, or to none. */
type Family =
  | "booked" | "so" | "gate_in" | "loading" | "sailing" | "bl" | "awb" | "waybill" | "collected" | "arrived" | "can_do"
  | "customs" | "delivery" | "closing" | "picked_up" | "in_transit";

const NODE_OF: Record<ModeSet, Partial<Record<Family, MilestoneKey>>> = {
  sea_import: { booked: "booked", so: "so", loading: "sailed", sailing: "sailed", bl: "bl", arrived: "arrived", can_do: "can_do", customs: "bayan", delivery: "delivered", closing: "delivered" },
  sea_export: { booked: "booked", so: "so", gate_in: "gate_in", loading: "gate_in", sailing: "sailed", bl: "bl", arrived: "arrived", can_do: "arrived", closing: "arrived" },
  air: { booked: "booked", collected: "collected", loading: "collected", bl: "awb", awb: "awb", sailing: "departed", arrived: "arrived", can_do: "arrived", customs: "bayan", delivery: "delivered", closing: "delivered" },
  courier: { booked: "booked", awb: "waybill", waybill: "waybill", collected: "picked_up", loading: "picked_up", picked_up: "picked_up", in_transit: "in_transit", delivery: "delivered", closing: "delivered" },
};

/** What the earlier e-mails established, for the rules that need it. */
interface HitContext {
  /** Arrival, CAN or Bayan is proven: customs and delivery words now mean the Oman side. */
  arrived: boolean;
  /** A BL draft is with this conversation for approval: a bare "Approved" answers it. */
  blPending: boolean;
  /** Whether a stage tag in the subject is new: "proof" on the first outside mail carrying it, "mention" on ours, null on a repeat. */
  freshSubject: (tag: string, external: boolean) => "proof" | "mention" | null;
  /** The names of the BL files that went out as drafts so far. */
  draftFiles: Set<string>;
}

/** The context of a mail read on its own. */
const noContext = (): HitContext => ({ arrived: false, blPending: false, freshSubject: (_tag, external) => (external ? "proof" : "mention"), draftFiles: new Set() });

type Add = (family: Family, sub: SubStepKey | null, proves: boolean, sentence: string, file?: string | null) => void;

/** A line of prices or of a quote's riders ("CUSTOM DUTY : AT ACTUALS"): never news about the shipment. */
const RIDER = /(?:\b(?:OMR|USD|EUR|RO|INR|AED|GBP|CNY|RMB|SAR)\b|[$€£])\s*:?\s*\d|\d\s*(?:OMR|USD|EUR|\/-)|\bat act[au]als?\b|\bas per actuals?\b|\bif (?:applicable|any|required)\b|\brates? (?:are |is )?subject to\b|^\s*(?:transit(?: time)?|t\/t|tt)\s*[:\-]/i;
/** A tag line of a signature: "Freight Forwarder | NVOCC | Customs Broker | …". */
const TAG_LINE = /\|[^|]*\|/;
const BL_WORD = /\b(?:bl|b\/l|hbl|mbl|awb|awbl|bill of lading|drafts?)\b/i;
/** Places on the way: something that "arrived" there has not arrived. */
const ON_THE_WAY = /\b(?:warehouse|w\/h|factory|cfs|icd|depot|yard|shipper|supplier|vendor|origin|pol|port of loading|loading port|trans.?ship\w*|t\/s|hub|feeder)\b/i;
const CUSTOMS_WORD = /\bbayan\b|authori[sz]ation/i;
const NOT_THE_BL = /\boriginals?\s+(?:message|e-?mails?|mail|quote|quotation|rates?|offer|schedule|plan|vessel|etd|eta|booking|request|invoice|packing)\b/i;
const AWB_IN_SUBJECT = /\b[HM]?AWB\b[^0-9\n]{0,12}\d{3}-\d{8}\b/i;
/** Our own word that a draft is in order: "… is OK from our side", "drafts are fine", "Approved". */
const OK_OURS = /\bok(?:ay)? from our side\b|\b(?:is|are|looks?) (?:ok|okay|fine|in order)\b|^\s*(?:ok|okay|approved|confirmed)\b|\bapproved\b/i;
/** A step written as a condition is a plan, not news: "Once cargo is loaded share us the BL draft". */
const PLAN_AHEAD = /^\W*(?:once(?!\s+again)|as soon as|if)\b/i;
/** "BL confirm, kindly proceed": the customer's short approval. */
const BL_CONFIRM = /\b(?:bl|b\/l|hbl|mbl|awb|drafts?)s?\s+(?:is\s+|are\s+)?confirm(?:ed)?\b/i;
/** Papers of the Oman side however they are capitalised ("Cargo Arrival Notice attached"). */
const PAPER_WORDS = /\bcargo arrival notice\b|\bdelivery order\b|\bfreight certificate\b|\bmanifest (?:is )?(?:done|updated|processing)\b/i;
const ASKS_FOR = /\b(?:please|pls|plz|kindly|can you|could you)\s+(?:share|send|provide|advise|give|confirm|forward)\b|\?\s*$/i;
const OTHER_LINE = /\b(?:other|another|any other) (?:carrier|line)\b/i;
/** A BL named in a sentence: a bare "original" means the BL only beside one. */
const BL_NAMED = /\b(?:o?[mh]?bl|[mh]?b\/l|bill of lading)\b/i;
/** A line that names the kind of BL a shipment has, not its release: "HBL type telex release", "HBL : original". */
const BL_KIND = /\btype\b|^\W*(?:[mh]?b\/?l|bill of lading)\s*[:：]/i;
const AUTHORIZATION = /authori[sz]ation/i;
/** A sentence that says the Bayan is there: issued, attached, received, paid, or thanked for. */
const BAYAN_THERE =
  /\bbayan\b[^.\n]{0,40}\b(?:issued|done|completed|attached|received|cleared|paid|processed|filed|generated|ready|shared|sent)\b|\b(?:attached|enclosed|received|processed|filed|issued|generated|shared|sent|find|thank(?:s| you) for (?:processing|sharing|sending|issuing|filing|arranging))\b[^.\n]{0,30}\bbayan\b|\b(?:BOE|bill of entry)\b[^.\n]{0,30}\b(?:paid|issued|attached|done|completed|filed)\b/i;

/** The first word after "arrived": "at Ningbo" → Ningbo, "and discharged at Salalah" → Salalah, "MCT" → MCT. */
const ARRIVED_WHERE = /^(?:\s+(?:and|&)\s+\w+)?\s+(?:(?:at|in|to|into)\s+)?(?:the\s+)?([A-Za-z][\w'’-]*)/;
const NO_PLACE = /^(?:today|yesterday|on|at|in|and|as|now|already|this|last|safely|there|here|well|late|early|pod|destination|dest|discharge|final|port|consignee|door|site)$/i;

/**
 * Whether what follows "arrived" can be the end of the journey: no place at all, the port of discharge in the mail's
 * subject, or an Oman place on a shipment coming in. Any other place by name is a stop on the way ("reached Ningbo").
 */
function atDestination(after: string, set: ModeSet, mail: ReadMail): boolean {
  const word = ARRIVED_WHERE.exec(after)?.[1];
  if (!word || NO_PLACE.test(word)) return true;
  const pod = (houseOf(mail.email?.subject)?.pod ?? "").toUpperCase();
  if (word.length >= 3 && pod.split(/\s+/).includes(word.toUpperCase())) return true;
  if (OMAN_PLACE.test(word)) return set !== "sea_export" && (!pod || OMAN_PLACE.test(pod));
  return !/^[A-Z]/.test(word);
}

/** What the files of a mail show, whoever sent them. */
function readFiles(mail: ReadMail, ctx: HitContext, add: Add): void {
  for (const { file, doc } of filedDocs(mail, ctx.draftFiles)) {
    const said = mail.excerpt || file.filename;
    const name = file.filename;
    if (doc.kind === "booking_so") {
      if (doc.subKind === "so") add("so", null, true, said, name);
      else add("booked", "booking_note", true, said, name);
    } else if (doc.kind === "bl_awb") {
      const family: Family = /awb/i.test(name) || doc.label.startsWith("AWB") ? "awb" : "bl";
      // Our instructions for the BL are a step towards it, not the BL.
      if (!doc.subKind) add(family, null, false, said, name);
      else if (doc.subKind === "draft") add(family, "bl_draft", false, said, name);
      else if (doc.subKind === "telex_seaway") add(family, doc.label === "Seaway bill" ? "seaway" : "telex", true, said, name);
      else if (doc.subKind === "original") add(family, "originals", true, said, name);
      else add(family, "bl_final", true, said, name);
    } else if (doc.kind === "pre_alert_can") {
      if (doc.subKind === "can") add("can_do", "can", true, said, name);
      else if (doc.label === "Manifest") add("can_do", "manifest", false, said, name);
      else if (doc.label === "Freight certificate") add("can_do", "freight_certificate", false, said, name);
      else add("bl", "pre_alert", false, said, name);
    } else if (doc.kind === "customs_do") {
      if (doc.subKind === "bayan") add("customs", null, true, said, name);
      else if (doc.subKind === "do") add("can_do", "do", true, said, name);
    } else if (doc.kind === "invoice_payment") {
      add("closing", doc.subKind === "debit_note" ? "dn" : doc.subKind === "payment" ? "payment" : "invoice", false, said, name);
    }
  }
}

/** The stage tags an agent puts in front of a subject ("so release Re: …", "BL draft： …", "PA//SO#…"), counted once each. */
function readSubject(mail: ReadMail, set: ModeSet, ctx: HitContext, add: Add): void {
  const subject = flat(mail.email?.subject ?? "");
  if (!subject) return;
  const external = mail.party !== "us";
  const tag = (name: string, family: Family, sub: SubStepKey | null, mayProve: boolean) => {
    const fresh = ctx.freshSubject(name, external);
    if (fresh) add(family, sub, mayProve && fresh === "proof", subject);
  };
  if (M.booked.t.test(subject)) tag("booked", "booked", null, true);
  if (M.so_released.s.test(subject)) tag("so", "so", null, true);
  if (M.bl_draft.t.test(subject)) tag("bl_draft", "bl", "bl_draft", false);
  if (M.bl_final.s.test(subject)) tag("bl_final", "bl", "bl_final", true);
  const telex = M.telex.t.exec(subject);
  if (telex) tag("telex", "bl", /sea ?way|swb/i.test(telex[0]) ? "seaway" : "telex", true);
  if (M.pre_alert.s.test(subject)) tag("pre_alert", "bl", "pre_alert", false);
  if (set === "air" && AWB_IN_SUBJECT.test(subject)) tag("awb", "awb", null, true);
  if (set === "courier" && M.waybill.t.test(subject)) tag("waybill", "waybill", null, true);
}

/** What the sentences of a mail say. Only an outside sender's statement proves a step. */
function readText(mail: ReadMail, set: ModeSet, confirmed: boolean, ctx: HitContext, add: Add): void {
  const text = mail.clean ?? "";
  const ours = mail.party === "us";
  if (!text.trim() || (ours && OUR_PRICE_LINE.test(text))) return;
  const customs = ctx.arrived || CUSTOMS_WORD.test(text);
  // A bare "Approved" answers a BL draft only when one is waiting, or once the job runs and the mail speaks of the BL.
  const blTalk = ctx.blPending || (confirmed && BL_WORD.test(`${text} ${mail.email?.subject ?? ""}`));

  if (ours && mail.toParty === "customer") {
    const block = AGENT_BLOCK.exec(text);
    if (block) add("booked", "agent_details_sent", false, lineAt(text, block.index));
  }
  // A rate request carries the pick-up address too: it asks for a price, it hands nothing over for a booking.
  if (ours && (mail.toParty === "agent" || mail.toParty === "carrier") && !RATE_REQUEST.test(text)) {
    const block = SHIPPER_BLOCK.exec(text);
    const line = block ? lineAt(text, block.index) : "";
    if (block && /shipper|vendor|supplier|contact person|pick ?-?up|collection/i.test(block[0]) && !ASKS_FOR.test(line)) add("booked", "shipper_details_sent", false, line);
  }

  // The port of loading of the house subject: a ship that arrived there has not arrived (a shipment going out starts in Oman).
  const pol = set === "sea_export" ? null : (/^[A-Za-z]{4,}/.exec(houseOf(mail.email?.subject)?.pol ?? "")?.[0] ?? null);
  const atPol = pol ? new RegExp(`\\b${pol}\\b`, "i") : null;

  for (const raw of sentencesOf(unwrapped(text))) {
    const s = flat(raw);
    if (!s || RIDER.test(s) || TAG_LINE.test(s) || PLAN_AHEAD.test(s)) continue;
    const said = states(s);
    /** What the pattern found is stated here, by someone outside. */
    const proves = (m: RegExpExecArray | null) => !ours && says(s, m);

    const booked = M.booked.t.exec(s);
    if (booked) add("booked", null, proves(booked), s);
    else if (M.booking_hold.t.test(s)) add("booked", null, false, s);

    // An SO that was released or issued, or its number given.
    const released = M.so_released.t.exec(s) ?? M.so_number.t.exec(s);
    if (proves(released)) add("so", null, true, s);
    else if (released || M.so.t.test(s)) {
      // "Please hold and do not release the SO" asks for the opposite of a release.
      const holding = /\b(?:hold|do not|don['’]t|not to)\b/i.test(s);
      const asked = ours && !released && !holding && mail.toParty !== "customer" && mail.toParty !== "internal" && (isRequest(s) || /\b(?:awaiting|pending|status)\b/i.test(s));
      add("so", asked ? "so_requested" : null, false, s);
    }

    const gate = M.gate_in.t.exec(s);
    if (gate) add("gate_in", null, proves(gate), s);
    const loaded = M.stuffed.t.exec(s);
    // Loading is done when the words say so: "stuffing" alone is a plan or a licence ("factory stuffing licence").
    const loadedDone = !!loaded && (/stuffed|loaded|finished|completed|done/i.test(loaded[0]) || /\bstuffing (?:is |was |has been )?(?:done|completed|finished|over)\b/i.test(s));
    if (M.cargo_not_ready.t.test(s)) add("loading", /\?|^\s*(?:if|whether)\b/i.test(s) ? null : "cargo_not_ready", false, s);
    else if (loaded) add("loading", loadedDone && says(s, loaded) ? "stuffed" : null, false, s);
    const collected = M.collected.t.exec(s);
    if (collected) add("collected", null, proves(collected), s);

    const flight = set === "air" ? M.flight.t.exec(s) : null;
    const sailed = M.sailed.t.exec(s);
    const otherLine = sailed ? null : OTHER_LINE.exec(s);
    if (sailed) add("sailing", null, proves(sailed), s);
    else if (otherLine) add("sailing", says(s, otherLine) ? "carrier_change" : null, false, s);
    else if (M.space_etd.t.test(s) || (flight && !/^mct$/i.test(flight[0]))) add("sailing", "space_etd", false, s);

    if (set !== "courier") {
      const draft = M.bl_draft.t.exec(s);
      if (draft) add("bl", SENDS.test(s) && says(s, draft) ? "bl_draft" : null, false, s);
      // Approval given, not asked: ours covers the consignee and notify details only, theirs approves the draft.
      if (ours) {
        if (OK_OURS.test(s) && (BL_WORD.test(s) || blTalk)) add("bl", "bl_ok_ours", false, s);
      } else if ((BL_CONFIRM.test(s) || (M.bl_approved.t.test(s) && (BL_WORD.test(s) || blTalk))) && !M.bl_approval_asked.t.test(s) && !UNSURE.test(s)) {
        add("bl", "bl_approved", false, s);
      }
      // "final BL draft" is still a draft.
      const final = M.bl_final.t.exec(s);
      if (final && !/^\s*drafts?\b/i.test(s.slice(final.index + final[0].length))) add("bl", says(s, final) ? "bl_final" : null, proves(final), s);
      // The release itself, not the kind of BL the shipment will have.
      const kindOnly = BL_KIND.test(s);
      const telex = M.telex.t.exec(s);
      if (telex) add("bl", !kindOnly && says(s, telex) ? (/sea ?way|swb/i.test(telex[0]) ? "seaway" : "telex") : null, !kindOnly && proves(telex), s);
      const originals = BL_NAMED.test(s) && !NOT_THE_BL.test(s) ? M.originals.t.exec(s) : null;
      if (originals) add("bl", !kindOnly && says(s, originals) ? "originals" : null, !kindOnly && proves(originals), s);
      const preAlert = M.pre_alert.t.exec(s);
      if (preAlert) add("bl", says(s, preAlert) ? "pre_alert" : null, false, s);
    }
    const awb = set === "air" ? M.awb.t.exec(s) : null;
    if (awb) add("awb", null, proves(awb) && (AWB_NO.test(s) || SENDS.test(s)), s);
    if (set === "courier") {
      const waybill = M.waybill.t.exec(s);
      if (waybill) add("waybill", null, proves(waybill), s);
      // A pick-up window, a pick-up confirmation number or a label is a plan; "picked up" (collected) says it happened.
      if (M.picked_up.t.test(s)) add("picked_up", null, false, s);
      const moving = M.in_transit.t.exec(s);
      if (moving) add("in_transit", null, proves(moving), s);
    }

    const notice = /\bcargo arrival notice\b/i.test(s);
    if (!notice && !ON_THE_WAY.test(s)) {
      const arrived = M.arrived.t.exec(s);
      const after = arrived ? s.slice(arrived.index + arrived[0].length) : "";
      // "We have reached out to the carrier" is no arrival; a ship that berthed has not discharged yet.
      const reachedOut = !!arrived && /^reached$/i.test(arrived[0]) && /^\s+out\b/i.test(after);
      // A ship's arrival at the port of loading ("delay of the vessel arrival Shanghai") is not this step at all.
      if (arrived && !reachedOut) {
        const there = atDestination(after, set, mail);
        if (there || !atPol?.test(s)) add("arrived", null, proves(arrived) && !/^berth/i.test(arrived[0]) && there, s);
      } else if (!arrived && !atPol?.test(s) && (M.eta.t.test(s) || M.transshipment.t.test(s))) add("arrived", null, false, s);
    }
    const paper = M.can_do.t.exec(s) ?? PAPER_WORDS.exec(s);
    if (paper) {
      const word = paper[0];
      const sub: SubStepKey | null = /manifest/i.test(word) ? "manifest" : /^FC$|freight cert/i.test(word) ? "freight_certificate" : /delivery order|D\/O|^DO$/.test(word) ? "do" : /arrival notice|^CAN$/i.test(word) ? "can" : null;
      add("can_do", says(s, paper) ? sub : null, proves(paper) && (sub === "can" || sub === "do"), s);
    }

    if (customs) {
      const authorised = M.authorization_done.t.exec(s);
      if (authorised) add("customs", !ours && says(s, authorised) ? "authorization" : null, false, s);
      else if (M.authorization_asked.t.test(s)) add("customs", null, false, s);
      const papers = M.customs_docs.t.exec(s);
      if (papers) add("customs", says(s, papers) ? "docs_to_clearance" : null, false, s);
      // The Bayan is proven when a sentence says it is there; one about its authorization says no such thing.
      const issued = AUTHORIZATION.test(s) ? null : BAYAN_THERE.exec(s);
      if (issued || M.bayan.t.test(s)) add("customs", null, proves(issued), s);
      const duty = M.duty.t.exec(s);
      if (duty) add("customs", says(s, duty) ? "duty" : null, false, s);
      if (M.hs_brand.t.test(s)) add("customs", "hs_brand", false, s);
      if (set === "air" && M.air_customs.t.test(s)) add("customs", null, false, s);
    }

    // "has been delivered" is only ever a mention: the step stays unproven until someone confirms it by phone.
    const delivery = M.delivery_requested.t.exec(s);
    if (M.delivered.t.test(s) && !isRequest(s)) add("delivery", null, false, s);
    else if (delivery && (ctx.arrived || /deliver/i.test(delivery[0]))) add("delivery", "delivery_requested", false, s);

    if (said) {
      const closing = M.closing.t.exec(s);
      if (closing && /debit note|^DN$/.test(closing[0])) add("closing", "dn", false, s);
      else if (closing && /paid|payment|remittance|PDC|cheque/i.test(closing[0])) add("closing", "payment", false, s);
      if (M.cod.t.test(s)) add("closing", "cod", false, s);
      if (M.detention.t.test(s)) add("closing", "detention", false, s);
    }
  }
}

/** Sub-steps of a BL or an AWB. */
const BL_SUBS = new Set<SubStepKey>(["bl_draft", "bl_ok_ours", "bl_approved", "bl_final", "telex", "seaway", "originals", "pre_alert"]);

/** Every hit of one mail: one per step and sub-step, the proving one kept, in the order of the steps. */
function hitsOf(mail: ReadMail, set: ModeSet, confirmed: boolean, ctx: HitContext): MilestoneHit[] {
  if (!mail || mail.scope !== "in") return [];
  const keys = NODES[set] ?? NODES.sea_import;
  const nodes = NODE_OF[set] ?? NODE_OF.sea_import;
  const hits: MilestoneHit[] = [];
  const add: Add = (family, given, proves, sentence, file = null) => {
    const key = nodes[family];
    if (!key) return;
    // A courier's waybill has no drafts, releases or originals: its file only proves the waybill.
    const sub = set === "courier" && given && BL_SUBS.has(given) ? null : given;
    // A CAN shows the step "CAN / DO" only where the set has that step; elsewhere it is a detail of the arrival.
    const can = proves && (family !== "can_do" || key === "can_do");
    const same = hits.find((h) => h.key === key && h.sub === sub);
    if (!same) hits.push({ key, sub, proves: can, sentence: clip(sentence), file });
    else if (can && !same.proves) Object.assign(same, { proves: true, sentence: clip(sentence), file });
    else if (file && !same.file && same.proves === can) same.file = file;
  };
  readFiles(mail, ctx, add);
  readText(mail, set, confirmed, ctx, add);
  readSubject(mail, set, ctx, add);
  // A file and a sentence that prove the same step are one proof: the file's, with the sentence that says so.
  for (const h of hits) {
    const filed = h.proves && !h.sub && !h.file ? hits.find((o) => o !== h && o.key === h.key && o.proves && !!o.file) : undefined;
    if (!filed) continue;
    filed.sentence = h.sentence;
    h.proves = false;
  }
  // A bare mention says nothing more once the same mail proves the step or shows a sub-step of it.
  const kept = hits.filter((h) => h.proves || h.sub || !hits.some((o) => o !== h && o.key === h.key));
  return kept.sort((a, b) => keys.indexOf(a.key as MilestoneKey) - keys.indexOf(b.key as MilestoneKey) || Number(b.proves) - Number(a.proves));
}

/**
 * What one in-scope mail says about the shipment's steps, read on its own: files, sentences and the stage tag in its
 * subject. "confirmed" is the register's status: before it a bare "Approved" is never a BL approval.
 */
export function milestoneHits(mail: ReadMail, set: ModeSet, confirmed: boolean): MilestoneHit[] {
  try {
    return hitsOf(mail, set, !!confirmed, noContext());
  } catch {
    return [];
  }
}

/**
 * Fills milestones on every in-scope mail, in place, reading them oldest first: a pre-alert and a subject's stage tag
 * count once, customs words count after the arrival, and a bare "Approved" counts after a BL draft.
 */
export function assignMilestones(mails: ReadMail[], set: ModeSet, confirmed: boolean): void {
  try {
    const list = (Array.isArray(mails) ? mails : []).filter(Boolean);
    for (const mail of list) if (mail.scope !== "in") mail.milestones = [];
    const seen = new Set<string>();
    const seenOutside = new Set<string>();
    const freshSubject: HitContext["freshSubject"] = (tag, external) => {
      if (external && !seenOutside.has(tag)) {
        seenOutside.add(tag);
        seen.add(tag);
        return "proof";
      }
      if (seen.has(tag)) return null;
      seen.add(tag);
      return "mention";
    };
    const drafts = new Set<string>();
    const draftFiles = new Set<string>();
    let arrived = false;
    let preAlert = false;
    for (const mail of scoped(list)) {
      let hits: MilestoneHit[];
      try {
        hits = hitsOf(mail, set, !!confirmed, { arrived, blPending: drafts.has(mail.sideKey), freshSubject, draftFiles });
      } catch {
        hits = [];
      }
      if (preAlert) hits = hits.filter((h) => h.sub !== "pre_alert");
      else preAlert = hits.some((h) => h.sub === "pre_alert");
      mail.milestones = hits;
      if (hits.some((h) => h.proves && (h.key === "arrived" || h.key === "can_do" || h.key === "bayan"))) arrived = true;
      if (hits.some((h) => h.sub === "bl_approved" || h.sub === "bl_ok_ours")) drafts.delete(mail.sideKey);
      else if (hits.some((h) => h.sub === "bl_draft") || (M.bl_approval_asked.t.test(mail.clean ?? "") && BL_WORD.test(mail.clean ?? ""))) drafts.add(mail.sideKey);
    }
  } catch {
    // the mails keep what they had
  }
}

// --- The journey ----------------------------------------------------------------------------------------------

const SUB_STEP: Record<SubStepKey, { name: string; tone: Tone }> = {
  agent_details_sent: { name: "Agent details sent", tone: "neutral" },
  shipper_details_sent: { name: "Shipper details sent", tone: "neutral" },
  booking_note: { name: "Booking note", tone: "neutral" },
  so_requested: { name: "SO requested", tone: "warn" },
  space_etd: { name: "Space and ETD", tone: "neutral" },
  carrier_change: { name: "Carrier change", tone: "warn" },
  cargo_not_ready: { name: "Cargo not ready", tone: "warn" },
  stuffed: { name: "Loaded", tone: "good" },
  bl_draft: { name: "BL draft", tone: "neutral" },
  bl_ok_ours: { name: "OK from our side", tone: "neutral" },
  bl_approved: { name: "BL approved", tone: "good" },
  bl_final: { name: "Final BL", tone: "good" },
  telex: { name: "Telex release", tone: "good" },
  seaway: { name: "Seaway bill", tone: "good" },
  originals: { name: "Originals", tone: "neutral" },
  pre_alert: { name: "Pre-alert", tone: "neutral" },
  can: { name: "CAN", tone: "neutral" },
  do: { name: "DO", tone: "good" },
  manifest: { name: "Manifest", tone: "neutral" },
  freight_certificate: { name: "Freight certificate", tone: "neutral" },
  docs_to_clearance: { name: "Documents to clearance", tone: "neutral" },
  authorization: { name: "Authorization done", tone: "good" },
  hs_brand: { name: "HS code or brand", tone: "warn" },
  duty: { name: "Duty", tone: "neutral" },
  delivery_requested: { name: "Delivery requested", tone: "neutral" },
  dn: { name: "Debit note", tone: "neutral" },
  invoice: { name: "Invoice", tone: "neutral" },
  payment: { name: "Payment", tone: "neutral" },
  cod: { name: "Change of destination", tone: "warn" },
  detention: { name: "Detention or storage", tone: "warn" },
};

/** Sub-steps that say little about where the shipment stands: they never decide what the latest mail is about. */
const SIDE_TALK = new Set<SubStepKey>(["space_etd", "dn", "invoice", "payment"]);
/** Sub-steps that go on: the newest e-mail about them is the one to show. The others show the first. */
const ONGOING = new Set<SubStepKey>([
  "space_etd", "carrier_change", "cargo_not_ready", "stuffed", "bl_draft", "hs_brand", "duty", "delivery_requested", "dn", "invoice",
  "payment", "cod", "detention",
]);

interface Seen { mail: ReadMail; hit: MilestoneHit }

/**
 * The index of the step one mail is most about: a proof first, then a sub-step, then a mention; the furthest step
 * among equals. Side talk (space, invoices) never decides. -1 when it says nothing about the steps; mentions in a
 * mail before the job started (early) are quote talk.
 */
function topicOf(mail: ReadMail, at: Map<MilestoneKey, number>, early: boolean): number {
  let best = 0;
  let index = -1;
  for (const hit of Array.isArray(mail?.milestones) ? mail.milestones : []) {
    const i = hit?.key ? at.get(hit.key) : undefined;
    if (i === undefined || (early && !hit.proves)) continue;
    const weight = hit.proves ? 3 : hit.sub ? (SIDE_TALK.has(hit.sub) ? 0 : 2) : 1;
    const score = weight * 100 + i;
    if (weight > 0 && score > best) {
      best = score;
      index = i;
    }
  }
  return index;
}

const BOOKING_TALK = /\b(?:booking|shipment|vessel|sailing|space|container|cargo|job|S\/?O|nomination|order)\b/i;

/** The sentence that cancels or re-books a confirmed job, or null: not a condition, a question or a fee. */
function cancelSentence(text: string): string | null {
  for (const raw of sentencesOf(unwrapped(text ?? ""))) {
    const s = flat(raw);
    const m = CANCELLED.exec(s);
    if (!m) continue;
    if (/hold the cheque|tracking seems/i.test(s)) continue;
    if (/\b(?:not|never|if|once|unless|whether|avoid|without|any|in case|otherwise|should|would)\b|n['’]t\b|\?/i.test(s)) continue;
    if (/cancell?ation/i.test(m[0]) && /\b(?:charges?|fees?|costs?|polic\w+|terms?)\b/i.test(s)) continue;
    // What is cancelled is this booking, not something of the customer's own ("several orders have been cancelled").
    if (/^cancel/i.test(m[0]) && !BOOKING_TALK.test(s)) continue;
    if (/next vessel/i.test(m[0]) && !/\b(?:roll(?:ed|over)?|shift(?:ed)?|moved?|changed?|miss(?:ed)?|postponed?|transferr?ed|re-?book\w*)\b/i.test(s)) continue;
    return s;
  }
  return null;
}

/** When the job started: the first sign of the yes, else the register's confirmation day. Mentions before it are quote talk. */
function startOf(row: EnquiryRow, cues: WonCue[], list: ReadMail[], confirmed: boolean): number {
  const byId = new Map(list.map((m) => [m.id, m]));
  let first = Infinity;
  for (const cue of cues) {
    const mail = cue.proof?.emailId ? byId.get(cue.proof.emailId) : undefined;
    const t = mail ? timeOf(mail.at) : isDay(cue.day) ? Date.parse(`${cue.day}T00:00:00+04:00`) : NaN;
    if (Number.isFinite(t) && t < first) first = t;
  }
  if (first !== Infinity) return first;
  return confirmed && isDay(row?.confirmed_date) ? Date.parse(`${row.confirmed_date}T00:00:00+04:00`) : -Infinity;
}

/**
 * "ETD 21 Nov (was 06 Nov)", "ETA Sohar 30 Nov (was 12 Dec)", or that the date passed with nothing to show for it.
 * shown: papers that come only after the step are on file (a pre-alert, a CAN), so a passed date is no warning.
 * booked false (not confirmed in the register): there is no sailing yet, so a passed date is only a date.
 */
function expectation(label: "ETD" | "ETA", value: DatedValue | null, missing: string, today: string, shown: boolean, booked: boolean): { note: string; tone: Tone | null } {
  if (!value) return { note: `${label} not advised`, tone: null };
  const port = label === "ETA" && value.port ? ` ${value.port}` : "";
  if (!value.date) return { note: `${label}${port} ${value.text}`, tone: null };
  const day = fmtDayMonth(value.date, today);
  if (!value.plan && isDay(today) && value.date < today) return shown || !booked ? { note: `${label}${port} ${day}`, tone: null } : { note: `${label}${port} ${day} passed — ${missing}`, tone: "bad" };
  const before = value.earlier[0];
  const was = before ? ` (was ${before.date ? fmtDayMonth(before.date, today) : before.text})` : "";
  return { note: `${label}${port} ${day}${was}`, tone: value.slipDays != null && Math.abs(value.slipDays) > 3 ? "warn" : null };
}

/**
 * The shipment's steps as the e-mails prove them, or null before the job is won (not confirmed and no sign of a yes).
 * Reads the milestones assignMilestones put on the mails. Delivered is never proven: no e-mail says so. The agents'
 * rates tell whose sailing dates are this booking's (the agreed one's).
 */
export function journeyOf(row: EnquiryRow, mails: ReadMail[], won: WonCue[], today: string, rates: AgentQuote[] = []): Journey | null {
  try {
    return journey(row, mails, won, today, rates);
  } catch {
    return null;
  }
}

function journey(row: EnquiryRow, mails: ReadMail[], won: WonCue[], today: string, rates: AgentQuote[]): Journey | null {
  const confirmed = row?.status === "confirmed";
  const cues = (Array.isArray(won) ? won : []).filter(Boolean);
  if (!confirmed && !cues.length) return null;
  const list = scoped(mails);
  const set = modeSetOf(row, list);
  const keys = NODES[set];
  const at = new Map(keys.map((k, i) => [k, i] as const));
  const start = startOf(row, cues, list, confirmed);

  const proofs: (Seen | null)[] = keys.map(() => null);
  let deliveryMentioned = false;
  const emailIds: string[][] = keys.map(() => []);
  const subs: Map<SubStepKey, Seen[]>[] = keys.map(() => new Map());
  let cancel: { mail: ReadMail; sentence: string; cut: number } | null = null;

  // The step the e-mails were about when a cancel sentence came, for a job where nothing was proven yet.
  let currentAt = -1;
  for (const mail of list) {
    const early = timeOf(mail.at) < start;
    if (confirmed && !early && mail.kind === "substantive") {
      const sentence = cancelSentence(mail.clean);
      if (sentence) {
        const reachedSoFar = proofs.reduce((last, p, i) => (p ? i : last), -1);
        const cut = reachedSoFar >= 0 ? reachedSoFar : Math.max(0, currentAt);
        for (let i = cut; i < keys.length; i++) proofs[i] = null;
        cancel = { mail, sentence, cut };
      }
    }
    const topic = topicOf(mail, at, early);
    if (topic >= 0) currentAt = topic;
    for (const hit of Array.isArray(mail.milestones) ? mail.milestones : []) {
      const i = hit?.key ? at.get(hit.key) : undefined;
      if (i === undefined || (early && !hit.proves)) continue;
      if (!emailIds[i].includes(mail.id)) emailIds[i].push(mail.id);
      if (hit.key === "delivered" && !hit.sub) deliveryMentioned = true;
      if (hit.proves && hit.key !== "delivered") {
        proofs[i] ??= { mail, hit };
        if (cancel && i >= cancel.cut) cancel = null;
      }
      if (hit.sub) {
        const known = subs[i].get(hit.sub);
        if (known) known.push({ mail, hit });
        else subs[i].set(hit.sub, [{ mail, hit }]);
      }
    }
  }

  const reachedAt = proofs.reduce((last, p, i) => (p ? i : last), -1);
  const reached = reachedAt >= 0 ? keys[reachedAt] : null;

  // What the newest mail with something to say is about.
  let nowDiscussing: MilestoneKey | null = null;
  for (let m = list.length - 1; m >= 0 && !nowDiscussing; m--) {
    const i = topicOf(list[m], at, timeOf(list[m].at) < start);
    if (i >= 0) nowDiscussing = keys[i];
  }

  // Before the register confirms the job no date counts down: there is no sailing to miss.
  const dates = datesOf(list, null, Array.isArray(rates) ? rates : [], today, confirmed);
  const shown = shownOf(list);
  const toOman = row?.trade_type !== "EXP" && (!row?.pod || OMAN_PLACE.test(row.pod));
  const labelOf = (key: MilestoneKey) => (key === "arrived" && set === "air" && toOman ? "Arrived MCT" : NODE_LABEL[key]);
  const naming = (name: string) => (set === "air" ? name.replace(/\bBL\b/, "AWB") : name);

  let versions = 0;
  const sizes = new Map<string, Set<number>>();
  const draftNames = new Set<string>();
  for (const mail of list) {
    for (const { file, doc } of filedDocs(mail, draftNames)) {
      if (doc.kind !== "bl_awb" || doc.subKind !== "draft") continue;
      const name = normalName(file.filename);
      const known = sizes.get(name) ?? new Set<number>();
      sizes.set(name, known.add(file.size));
      versions = Math.max(versions, known.size);
    }
  }

  const subStepsOf = (i: number): { steps: SubStep[]; names: string[] } => {
    const proven = !!proofs[i];
    const approved = subs[i].has("bl_approved");
    const built = [...subs[i].entries()].map(([key, seen]) => {
      const first = seen[0];
      const last = seen[seen.length - 1];
      const name = naming(SUB_STEP[key].name);
      const shown = ONGOING.has(key) ? last : first;
      let label = `${name} ${shortWhen(shown.mail.at, today)}`;
      let tone = SUB_STEP[key].tone;
      if (key === "so_requested") {
        label = `${name} ${shortWhen(first.mail.at, today)}${seen.length > 1 ? ` · chased ${seen.length - 1}×` : ""}`;
        if (proven) tone = "neutral";
      } else if (key === "bl_draft") {
        const settled = approved || proven;
        label = `${name}${versions > 1 ? ` v${versions}` : ""}${settled ? ` ${shortWhen(last.mail.at, today)}` : " · not approved yet"}`;
        tone = settled ? "neutral" : "warn";
      }
      const step: SubStep = { key, label: label.trim(), tone, proof: proofOf(shown.mail, today, shown.hit.sentence, shown.hit.file ?? undefined) };
      return { step, name, t: timeOf(shown.mail.at) };
    });
    built.sort((a, b) => b.t - a.t);
    return { steps: built.map((b) => b.step), names: built.map((b) => b.name) };
  };

  const byId = new Map(list.map((m) => [m.id, m]));
  const topics = new Map<MilestoneKey, string>();
  const nodes: Milestone[] = keys.map((key, i) => {
    const seen = proofs[i];
    const { steps, names } = subStepsOf(i);
    if (key === "booked" && !steps.some((s) => s.key === "agent_details_sent")) {
      const cue = cues.find((c) => c.kind === "agent_details_sent" && c.proof);
      const mail = cue ? byId.get(cue.proof.emailId) : undefined;
      if (cue) {
        const when = mail ? shortWhen(mail.at, today) : isDay(cue.day) ? dayWithWeekday(cue.day, today || cue.day) : "";
        steps.push({ key: "agent_details_sent", label: `${SUB_STEP.agent_details_sent.name} ${when}`.trim(), tone: "neutral", proof: cue.proof });
        names.push(SUB_STEP.agent_details_sent.name);
      }
    }
    topics.set(key, names[0] ?? NODE_TOPIC[key]);

    const state: Milestone["state"] = seen ? "proven" : cancel && i >= cancel.cut ? "void" : i < reachedAt ? "unmarked" : key === nowDiscussing ? "current" : "todo";
    const proof: Proof | null = seen ? proofOf(seen.mail, today, seen.hit.sentence, seen.hit.file ?? undefined) : null;
    let note = "";
    let noteTone: Tone | null = null;
    if (proof) {
      const stated = (key === "sailed" || key === "departed") && dates.atd?.date ? `ATD ${fmtDayMonth(dates.atd.date, today)} · ` : "";
      note = `${stated}${proof.file ? `${proof.who} · ${proof.file}` : proof.who}`;
    } else if (state === "void") note = "Cancelled or changed";
    else if (state === "unmarked") note = "No e-mail marks this step";
    else if (key === "sailed" || key === "departed") {
      if (dates.atd?.date) note = `ATD ${fmtDayMonth(dates.atd.date, today)} (${dates.atd.proof.who})`;
      else ({ note, tone: noteTone } = expectation("ETD", dates.etd, key === "sailed" ? "no sailing confirmed" : "no departure confirmed", today, shown.sailed, confirmed));
    } else if (key === "arrived") ({ note, tone: noteTone } = expectation("ETA", dates.eta, "no arrival confirmed", today, shown.arrived, confirmed));
    else if (key === "delivered") note = deliveryMentioned ? "An e-mail mentions delivery — confirm by phone" : "Not written in any e-mail — confirm by phone";

    return { key, label: labelOf(key), state, date: seen ? seen.mail.day : null, note, noteTone, proof, subSteps: steps, emailIds: emailIds[i] };
  });

  const reachedNode = reachedAt >= 0 ? nodes[reachedAt] : null;
  const ahead = nowDiscussing && (at.get(nowDiscussing) ?? -1) > reachedAt ? (topics.get(nowDiscussing) ?? null) : null;
  const chip = reachedNode
    ? `${reachedNode.label} ${reachedNode.date ? dayWithWeekday(reachedNode.date, today || reachedNode.date) : ""}`.trim() + (ahead ? ` · now: ${ahead}` : "")
    : ahead
      ? `Now: ${ahead}`
      : null;

  return { set, nodes, reached, nowDiscussing, chip, cancelled: cancel ? proofOf(cancel.mail, today, cancel.sentence) : null };
}

// --- Numbers --------------------------------------------------------------------------------------------------

const REF_ORDER: RefKind[] = ["reference", "po", "agent_job", "so", "booking", "mbl", "hbl", "container", "vessel", "carrier", "awb", "waybill", "customs_code"];
const REF_LABEL: Record<RefKind, string> = {
  reference: "Reference", po: "PO", agent_job: "Agent job", so: "SO", booking: "Booking", mbl: "MBL", hbl: "HBL", container: "Container",
  vessel: "Vessel", carrier: "Carrier", awb: "AWB", waybill: "Waybill", customs_code: "Customs code",
};
/** How many numbers of one kind are shown. */
const REF_LIMIT: Partial<Record<RefKind, number>> = { po: 2, agent_job: 4, so: 2, booking: 2, mbl: 2, hbl: 2, container: 8, awb: 2, waybill: 2, customs_code: 1 };

/** The line a carrier's own booking, SO and BL numbers start with. */
const LINE_OF: Record<string, string> = {
  KMTC: "KMTC", MEDU: "MSC", MAEU: "Maersk", HLCU: "Hapag-Lloyd", ONEY: "ONE", COSU: "COSCO", OOLU: "OOCL", EGLV: "Evergreen", ESL: "ESL", ASD: "Asyad",
};

const PO_ALL = every(PO);
const JOB_PAREN_ALL = every(AGENT_JOB_PAREN);
const JOB_PREFIX_ALL = every(AGENT_JOB_PREFIX);
const SO_NUMBER_ALL = every(M.so_number.t);
const CARRIER_NUMBER_ALL = every(M.so_carrier_number.t);
const BOOKING_ALL = every(BOOKING_NO);
const BL_ALL = every(BL_NO);
const CONTAINER_ALL = every(CONTAINER);
const AWB_ALL = every(AWB_NO);
const CUSTOMS_ALL = every(CUSTOMS_CODE);
const SO_WORD = /\bS\/?O\b|\bshipping order\b/;

function copyLabel(kind: RefKind, label: string, value: string): string {
  if (kind === "reference") return `Copy reference ${value}`;
  const name = /[a-z]/.test(label) ? label.toLowerCase() : label;
  return kind === "vessel" || kind === "carrier" || kind === "customs_code" ? `Copy ${name} ${value}` : `Copy ${name} number ${value}`;
}

/**
 * The numbers people copy: the SL reference first, then PO, the agent's job numbers, SO, booking, MBL, HBL,
 * containers, vessel, carrier, AWB, waybill and the customs code, each with the e-mail it was read from.
 */
export function refsOf(mails: ReadMail[], row: EnquiryRow): RefChip[] {
  const reference = typeof row?.reference === "string" ? row.reference.trim() : "";
  const chips: RefChip[] = [{ kind: "reference", label: REF_LABEL.reference, value: reference, copyLabel: copyLabel("reference", "", reference), proof: null }];
  try {
    const taken = new Set<string>([reference.toUpperCase().replace(/[\s-]/g, "")]);
    const count = new Map<RefKind, number>();
    const put = (kind: RefKind, raw: string, mail: ReadMail, sentence: string, label = REF_LABEL[kind]) => {
      const value = raw.trim();
      const id = value.toUpperCase().replace(/\s+/g, " ");
      if (!value || taken.has(id) || /^SL\s?-?\d{6}$/i.test(value) || (count.get(kind) ?? 0) >= (REF_LIMIT[kind] ?? 1)) return;
      taken.add(id);
      count.set(kind, (count.get(kind) ?? 0) + 1);
      chips.push({ kind, label, value, copyLabel: copyLabel(kind, label, value), proof: proofOf(mail, "", sentence) });
    };
    let vessel: { value: string; mail: ReadMail; sentence: string } | null = null;
    let line: { value: string; mail: ReadMail; sentence: string } | null = null;
    const courier = row?.shipment_mode === "COURIER";

    for (const mail of scoped(mails)) {
      const subject = flat(mail.email?.subject ?? "");
      const text = mail.clean ?? "";
      for (const [source, whole] of [[subject, true], [text, false]] as const) {
        if (!source) continue;
        const said = (index: number) => (whole ? clip(source) : lineAt(source, index));
        for (const m of source.matchAll(PO_ALL)) {
          const value = m[1].split("//")[0].replace(/[\/-]+$/, "").toUpperCase();
          if (value.length >= 4 && /\d/.test(value)) put("po", value, mail, said(m.index ?? 0));
        }
        // A number the mail names ("MBL: …", "SO NO: …") is that, whatever it looks like.
        for (const m of source.matchAll(SO_NUMBER_ALL)) put("so", m[1], mail, said(m.index ?? 0));
        for (const m of source.matchAll(BOOKING_ALL)) put("booking", m[1].toUpperCase(), mail, said(m.index ?? 0));
        for (const m of source.matchAll(BL_ALL)) {
          const kind: RefKind = /^m/i.test(m[1]) ? "mbl" : "hbl";
          put(kind, m[2].toUpperCase(), mail, said(m.index ?? 0), /^[mh]/i.test(m[1]) ? REF_LABEL[kind] : "BL");
        }
        if (whole) for (const m of source.matchAll(JOB_PAREN_ALL)) if (!/^PO\d/i.test(m[1])) put("agent_job", m[1], mail, said(m.index ?? 0));
        for (const m of source.matchAll(JOB_PREFIX_ALL)) put("agent_job", m[1], mail, said(m.index ?? 0));
        for (const m of source.matchAll(CARRIER_NUMBER_ALL)) {
          const sentence = said(m.index ?? 0);
          put(SO_WORD.test(sentence) ? "so" : "booking", m[0], mail, sentence);
          line ??= { value: LINE_OF[m[1]] ?? m[1], mail, sentence };
        }
        for (const m of source.matchAll(CONTAINER_ALL)) put("container", m[0], mail, said(m.index ?? 0));
        for (const m of source.matchAll(AWB_ALL)) {
          const index = m.index ?? 0;
          if (/awb/i.test(source.slice(Math.max(0, index - 20), index))) put("awb", m[0], mail, said(index));
        }
        if (courier) {
          const m = M.waybill.t.exec(source);
          if (m?.[2]) put("waybill", m[2], mail, said(m.index));
        }
        for (const m of source.matchAll(CUSTOMS_ALL)) put("customs_code", m[0], mail, said(m.index ?? 0));
      }
      // A file named by the carrier's own number, when the mail says it is the SO.
      const cue = cueKind(text);
      for (const file of mail.files ?? []) {
        const m = M.so_carrier_number.t.exec(file.filename ?? "");
        if (!m) continue;
        put(cue?.subKind === "so" ? "so" : "booking", m[0], mail, mail.excerpt || file.filename);
        line ??= { value: LINE_OF[m[1]] ?? m[1], mail, sentence: file.filename };
      }
      const named = VESSEL.exec(text);
      if (named && !/^\d{1,2}(?:ST|ND|RD|TH)\b/.test(named[1])) {
        const rest = text.slice(named.index + named[0].length);
        const voyage = /^[ \t]*\/[ \t]*([A-Z0-9.]{3,12})\b/.exec(rest)?.[1] ?? /^[ \t]+(V\.[ \t]?[A-Z0-9]{3,8})\b/.exec(rest)?.[1];
        vessel = { value: voyage ? `${flat(named[1])} / ${voyage}` : flat(named[1]), mail, sentence: lineAt(text, named.index) };
      }
    }
    if (vessel) put("vessel", vessel.value, vessel.mail, vessel.sentence);
    // "MSC DAKAR", "KMTC LONG BEACH": the line's name opens its vessels' names.
    const owner = vessel ? CARRIER.exec(vessel.value) : null;
    if (line) put("carrier", line.value, line.mail, line.sentence);
    else if (vessel && owner && owner.index === 0) put("carrier", owner[1].toUpperCase(), vessel.mail, vessel.sentence);
  } catch {
    // the reference chip stays
  }
  const order = (chip: RefChip) => REF_ORDER.indexOf(chip.kind);
  return chips.map((chip, i) => ({ chip, i })).sort((a, b) => order(a.chip) - order(b.chip) || a.i - b.i).map((c) => c.chip);
}
