import { commissionTotal, parseCommission } from "../commission";
import { daysBetween, displayName } from "../display";
import { muscatDate, splitBody } from "../emailDrafts";
import { dayWithWeekday } from "../enquiryDetails";
import { addDays } from "../format";
import { nameKey } from "../normalize";
import type { EnquiryRow, HistoryRow } from "../types";
import { USD_PER, USD_PER_OMR } from "./constants";
import {
  AGENT_ACK,
  AGENT_DECLINE,
  AGENT_QUESTION,
  AGENT_RATE_EXCLUDE,
  AGREED,
  BARE_LINE,
  BASIS,
  BOILERPLATE,
  CARRIER,
  CARRIER_CODE,
  CARRIER_OPTION_LINE,
  CW,
  EQUIPMENT_A,
  EQUIPMENT_B,
  EXCLUDED,
  FINAL,
  FREE_TIME,
  LINE_LABEL,
  MAIN_LINE,
  NOT_YES,
  OFFER_CUE,
  OPTION_SPLIT,
  OUR_PRICE_LINE,
  PAPERWORK,
  POST_BOOKING,
  PUSH,
  QUOTED_HEADER_LEAK,
  RATE_REQUEST,
  REQUEST_BLOCK,
  REVISED,
  SHIP_DATE,
  SOFT,
  TARGET,
  TARGET_NEG,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
  TRANSIT,
  UNIT_SUFFIX,
  VALIDITY,
  VALIDITY_NEG,
  WEIGHT_BREAK,
  WON_OURS,
  YES,
  YES_EXTRA,
} from "./patterns";
import { ageOf, agentNameForDomain, cleanText, proofOf, sentencesOf, shortWhen, staffOf } from "./read";
import type {
  AgentOption,
  AgentQuote,
  AgentState,
  AgentsSummary,
  Basis,
  Buy,
  Currency,
  CurrencyClash,
  FormPrefill,
  LaneBenchmark,
  Margin,
  MissingBasis,
  MoneyRole,
  MoneyToken,
  Offer,
  OfferFigure,
  PersonRef,
  PriceLine,
  Proof,
  Question,
  ReadMail,
  RegisterMoney,
  Side,
  Target,
  TrailPoint,
  ValidityFact,
} from "./types";

// What the e-mails say about money: every amount with its unit and its label, who it was meant for (our offer, an
// agent's rate, a target, the agreed buy) and what follows from them (the margin, the trail, the register check).
// Pure and synchronous. assignMoney runs first; the readers after it work from each mail's money and moneyRole.

const HOUR = 3_600_000;
const OMAN_OFFSET = 4 * HOUR;

const timeOf = (ts: unknown): number | null => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : null;
};
const isDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
/** One reading that fails gives its empty value; the rest of the page still reads. */
function attempt<T>(read: () => T, empty: T): T {
  try {
    return read();
  } catch {
    return empty;
  }
}
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
function clip(text: string, max = 200): string {
  const body = oneLine(text);
  return body.length <= max ? body : `${body.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A register figure as a number, whatever the database sent. */
const numeric = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** In-scope mails, oldest first. */
const inScope = (mails: ReadMail[]): ReadMail[] =>
  (Array.isArray(mails) ? mails : []).filter((m) => !!m && m.scope === "in").sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
/** The day the newest mail was written: the year proofs are read against when no clock is given. */
const todayOf = (chron: ReadMail[]): string => (chron.length ? chron[chron.length - 1].day : "");
/** "Thu 05 Nov, 16:04" → "Thu 05 Nov 16:04". */
const plainWhen = (when: string): string => when.replace(",", "");

// --- Figures and currencies -----------------------------------------------------------------------------------

/** A figure as written: "1,225", "58.346", "5.4". */
const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
/** A converted or worked-out figure: whole from 10, two decimals below. */
const rounded = (n: number): string =>
  (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const tidy = (n: number): number => Math.round(n * 1000) / 1000;
const moneyText = (amount: number, currency: Currency, unit?: string | null): string => `${currency} ${fmt(amount)}${unit ?? ""}`;

const CURRENCIES: Record<string, Currency> = {
  OMR: "OMR", RO: "OMR", USD: "USD", US$: "USD", $: "USD", EUR: "EUR", EURO: "EUR", EUROS: "EUR", EURS: "EUR", "€": "EUR",
  INR: "INR", RS: "INR", "₹": "INR", AED: "AED", GBP: "GBP", "£": "GBP", CNY: "CNY", RMB: "CNY", SEK: "SEK", ZAR: "ZAR",
  SAR: "SAR", QAR: "QAR",
};
function currencyOf(raw: string | null | undefined): Currency | null {
  const key = (raw ?? "").trim().toUpperCase().replace(/\.$/, "");
  return Object.hasOwn(CURRENCIES, key) ? CURRENCIES[key] : null;
}

/** An amount in US dollars at the page's rates. */
export function toUsd(amount: number, currency: Currency): number {
  const rate = Object.hasOwn(USD_PER, currency) ? USD_PER[currency] : NaN;
  return Number.isFinite(amount) && Number.isFinite(rate) ? amount * rate : 0;
}

/** An amount in Omani rials, through the dollar as the register does. */
export function toOmr(amount: number, currency: Currency): number {
  return toUsd(amount, currency) / USD_PER_OMR;
}

const APPROXIMATE = new Set<Currency>(["EUR", "GBP", "INR", "CNY", "SEK", "ZAR"]);
/** Whether a currency converts at a rate that moves: its figures are labelled "about". */
export function isApproximate(currency: Currency): boolean {
  return APPROXIMATE.has(currency);
}

const convert = (amount: number, from: Currency, to: Currency): number => (from === to ? amount : toUsd(amount, from) / USD_PER[to]);

/** The same amount in the other currency the office thinks in: "≈ USD 1,225 at 2.6", "≈ OMR 2,692". */
function twinOf(amount: number, currency: Currency): string {
  if (currency === "OMR") return `≈ USD ${rounded(amount * USD_PER_OMR)} at ${USD_PER_OMR}`;
  if (currency === "USD") return `≈ OMR ${rounded(amount / USD_PER_OMR)}`;
  return `≈ USD ${rounded(toUsd(amount, currency))} at ${isApproximate(currency) ? "about " : ""}${USD_PER[currency]}`;
}

/**
 * A written figure as a number. Rials with three decimals are baisa (359.000 = 359); other currencies write
 * thousands with a dot (13.700 = 13,700) unless the price is per kilo; a comma or a space before three digits is
 * thousands; a comma before one or two digits is a decimal.
 */
function amountOf(figure: string, currency: Currency, perKilo = false): number {
  const s = figure.replace(/\s+/g, " ").trim();
  let n: number;
  if (/^\d+\.\d{3}$/.test(s)) n = currency === "OMR" || perKilo || !/^[1-9]\d{0,2}\./.test(s) ? Number.parseFloat(s) : Number(s.replace(".", ""));
  else if (/^\d{1,3}(?:[ ,]\d{3})+(?:\.\d{1,3})?$/.test(s)) n = Number.parseFloat(s.replace(/[ ,]/g, ""));
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,3})?$/.test(s)) n = Number.parseFloat(s.replace(/\./g, "").replace(",", "."));
  else if (/^\d+,\d{1,2}$/.test(s)) n = Number.parseFloat(s.replace(",", "."));
  else n = Number.parseFloat(s.replace(/[ ,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// --- Money tokens ---------------------------------------------------------------------------------------------

const PRICE_LINES = new RegExp(OUR_PRICE_LINE.source, "gimd");
const BARE_LINES = new RegExp(BARE_LINE.source, "gmd");
const LABELS = new RegExp(`${LINE_LABEL.source}|${MAIN_LINE.source}`, "gi");
/** A label that names a period, not a charge: "Free time : 14", "Validity : 7". */
const NOT_A_CHARGE = /free\s?(?:time|days?)|transit|valid/i;
/** "USD 60 x 7 PALLET": the amount times a count. */
const MULTIPLIER =
  /^\s*(?:\/-)?\s*[x×*]\s*(\d{1,3})\s*(pallets?|plts?|pkgs?|packages?|cartons?|ctns?|boxes|box|cntrs?|containers?|sets?|trips?|trucks?|trailers?|days?|kgs?|cbm)\b/i;
const ALL_IN = /\ball[\s-]?in(?:clusive)?\b/i;
/** Costs that fall due only if something happens: listed, never summed. */
const CONDITIONAL = /\bfree\s?(?:time|days?)\b|\bdetention\b|\bdemurrage\b|\bstorage\b/i;
const TIMED_UNIT = /^\/(?:day|hour|month)$/;
/** Where the words about what a rate includes begin. */
const INCLUDED = /\bwith\b|\bincl(?:uding|udes|\.)?\b/i;
/** Container deposits ("20'/RO 300/- 40'/RO 600/-") are returned: never a price. */
const DEPOSIT = /\bdeposits?\b/i;
const ABBREVIATED =
  /\b(?:approx|appx|abt|no|nos|mr|mrs|ms|dr|etc|incl|excl|max|min|co|ltd|rs|usd|eur|omr|ro|qty|wt|gr|pkgs?|st|tel|ref|vs|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.\s+$/i;

interface Hit { start: number; end: number; currency: Currency; figure: string }

/** Where the amounts stand in a text, in order. A currency before the figure wins over one after it. */
function hitsIn(text: string, ourQuote: boolean): Hit[] {
  const hits: Hit[] = [];
  const add = (start: number, end: number, currency: Currency | null, figure: string) => {
    if (currency && !hits.some((h) => start < h.end && end > h.start)) hits.push({ start, end, currency, figure });
  };
  for (const m of text.matchAll(TOKEN_A)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, currencyOf(m[1]), m[2]);
  for (const m of text.matchAll(TOKEN_B)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, currencyOf(m[1]), m[2]);
  for (const m of text.matchAll(TOKEN_C)) {
    const end = (m.index ?? 0) + m[0].length;
    if (/^ro$/i.test(m[2]) && text[end] === "-") continue; // "2 RO-RO units"
    add(m.index ?? 0, end, currencyOf(m[2]), m[1]);
  }
  if (ourQuote) {
    // Our own quote may leave the currency out: "PORT TO PORT : 359.000", "Custom Clearance : 25".
    for (const m of text.matchAll(PRICE_LINES)) {
      const at = m.indices?.[2];
      if (at && Number.parseFloat(m[2]) < 10_000) add(at[0], at[1], "OMR", m[2].replace(/[.,]+$/, ""));
    }
    for (const m of text.matchAll(BARE_LINES)) {
      const at = m.indices?.[2];
      if (at && LINE_LABEL.test(m[1]) && !NOT_A_CHARGE.test(m[1]) && Number.parseFloat(m[2]) < 10_000) add(at[0], at[1], "OMR", m[2]);
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

interface Span { start: number; end: number; lineStart: number; lineEnd: number }

/** The sentence around a token, inside its line. A full stop after "approx." or inside the token does not end it. */
function sentenceSpan(text: string, from: number, to: number): Span {
  const lineStart = from > 0 ? text.lastIndexOf("\n", from - 1) + 1 : 0;
  const nl = text.indexOf("\n", to);
  const lineEnd = nl < 0 ? text.length : nl;
  let start = lineStart;
  let end = lineEnd;
  const stop = /[.?!]\s+(?=\S)/g;
  stop.lastIndex = lineStart;
  for (let m = stop.exec(text); m && m.index < lineEnd; m = stop.exec(text)) {
    const after = m.index + m[0].length;
    if (ABBREVIATED.test(text.slice(lineStart, after))) continue;
    if (after <= from) start = after;
    else if (m.index >= to) {
      end = m.index + 1;
      break;
    }
  }
  return { start, end, lineStart, lineEnd };
}

const RUNS_ON = /[.:;!?]\s*$/;

/** A sentence with the wrapped lines of its paragraph: what the exclusions are tested on when a token has no label. */
function contextOf(text: string, span: Span): string {
  let context = text.slice(span.start, span.end);
  if (span.start === span.lineStart && span.lineStart > 0) {
    const above = text.slice(text.lastIndexOf("\n", span.lineStart - 2) + 1, span.lineStart - 1);
    if (above.length >= 55 && !RUNS_ON.test(above)) context = `${above} ${context}`;
  }
  if (span.end === span.lineEnd && span.lineEnd < text.length && span.lineEnd - span.lineStart >= 55 && !RUNS_ON.test(text.slice(span.lineStart, span.lineEnd))) {
    const nl = text.indexOf("\n", span.lineEnd + 1);
    context = `${context} ${text.slice(span.lineEnd + 1, nl < 0 ? text.length : nl)}`;
  }
  return context;
}

/** "/kg", "/cbm", "/cntr", "/40 OT HC": one spelling per unit; null for the whole shipment. */
function unitName(raw: string): string | null {
  const text = oneLine(raw).replace(/\.$/, "");
  const box = /^(?:(\d{1,2})\s?[x×]\s?)?(20|40|45)\s?['’]?\s?(.*)$/.exec(text);
  if (box) {
    // "20FT" is the 20-foot box: the size says it already.
    const type = box[3].toUpperCase().replace(/[()]/g, " ").replace(/\bFT\b/g, " ").replace(/\s+/g, " ").trim();
    return `/${box[1] ? `${Number(box[1])}x` : ""}${box[2]}${type ? ` ${type}` : ""}`;
  }
  const word = text.toLowerCase();
  if (/^(?:kgs?|k|kilo|cw)$/.test(word)) return "/kg";
  if (/^(?:cbm|m3)$/.test(word)) return "/cbm";
  if (word === "w/m") return "/w/m";
  if (word === "rt") return "/rt";
  if (/^(?:tons?|mt)$/.test(word)) return "/ton";
  if (/^(?:cntrs?|cnt|containers?|cntnr|ctr|box|boxes)$/.test(word)) return "/cntr";
  if (/^(?:pallets?|plts?)$/.test(word)) return "/pallet";
  if (/^(?:pkgs?|packages?|cartons?|ctns?)$/.test(word)) return "/pkg";
  if (/^b\/?l$/.test(word)) return "/bl";
  if (/^(?:shpt|shipment)$/.test(word)) return null;
  if (/^(?:hour|hr)s?$/.test(word)) return "/hour";
  return `/${word.replace(/s$/, "")}`;
}

/** The unit written after an amount, and the count it is multiplied by ("x 7 PALLET"). */
function unitOf(after: string): { unit: string | null; multiplier: number | null } {
  // "/ PER KG" is "per kg"; in "all in per kg" the unit stands after the words.
  const text = after.replace(/^(\s*)\/\s*per\b/i, "$1per").replace(/^(\s*(?:\/-)?\s*)all[\s-]?in(?:clusive)?\s+(?=per\b|\/)/i, "$1");
  const times = MULTIPLIER.exec(text);
  if (times) return { unit: unitName(times[2]), multiplier: Number(times[1]) };
  if (/^\s*w\/m\b/i.test(text)) return { unit: "/w/m", multiplier: null };
  if (/^\s*(?:cntrs?|cntnr|containers?)\b/i.test(text)) return { unit: "/cntr", multiplier: null };
  const m = UNIT_SUFFIX.exec(text);
  const body = m ? m[0].replace(/^\s*(?:\/-)?\s*/, "") : "";
  const lead = /^(?:\/|per|x|×)\s*/i.exec(body);
  return { unit: lead ? unitName(body.slice(lead[0].length)) : null, multiplier: null };
}

/** The label of a line that adds the others up: "Total：USD6150". */
const TOTAL = "Total";
const TOTAL_LABEL = /(?:^|[\s,，;:：(])(?:grand\s+|sub-?\s?)?total(?:\s+(?:amount|cost|charges?|rate|price))?$/i;
/** A short name before a colon that the list of charges does not know: "Certificate of origin : USD 100". */
const PLAIN_LABEL = /^[A-Za-z][A-Za-z /&+().'-]{2,38}$/;
/** Words before a colon that never name a charge: a value, a payment, a limit, a target, a remark. */
const NOT_A_LABEL = /\b(?:value|worth|amount|invoice|payment|paid|balance|outstanding|limit|deposit|insur\w*|target|budget|note|remarks?)\b/i;
const CARRIER_ALONE = new RegExp(`^${CARRIER.source}$`, "i");
/** A carrier's name in front of a label: "MSC : O/F", "ASYAD O/F". */
const CARRIER_LEAD = new RegExp(`^(?:${CARRIER.source}|NVOCC|ONE)\\s*[:：-]?\\s*`, "i");
const SENTENCE_WORD = /\b(?:please|pls|kindly|the|is|are|we|you|our|your|for|with)\b/i;
/** A name that says it is a charge needs no colon: "LCL handing fee OMR 12 w/m". */
const FEE_WORD = /\b(?:fees?|charges?|costs?)$/i;
/** The last comma, semicolon or bar of a text: where the item before ends on a line that prices several. */
const ITEM_BREAK = /[,，;|](?=[^,，;|]*$)/;
/** Where the next item starts after an amount: "OMR 75.000 + admin fee at actuals". */
const ITEM_JOIN = /\+|;|\band\b|\bplus\b/i;
/** A unit alone on the line under an amount: "Per AWB", "per kg". */
const UNIT_BELOW = /^\n(?:[ \t]*\n)?[ \t]*(per\s+[A-Za-z/]{1,10})\.?[ \t]*(?:\n|$)/i;

/**
 * The label before an amount on its line, when it names a charge: "PORT TO PORT", "LCL + DO CHARGES", "Total". A
 * colon or a spaced dash ends a label the list of charges does not know ("Air Waybill Fee – US$40").
 */
function labelOf(before: string, follows = false): string | null {
  const colon = /(?:[:：=]|\s[-–])\s*$/.test(before);
  // After another amount on the line the label starts at the last comma: "…USD5450/20GP，Truck Fee：USD230".
  const own = follows && colon ? before.slice(before.search(ITEM_BREAK) + 1) : before;
  let text = oneLine(own.replace(/^[\s•*·>\-–,，;+]+|^\s*\d{1,2}[.)]\s+/, "")).replace(/[\s:：=\-–(]+$/, "");
  // "PORT CHARGES : AT ACTUALS (Approx." is a label and what is said of it; "Door To Door Charges OMR" ends in the currency.
  text = text.replace(/\s*[:：=\-–]\s*(?:at\s?act[au]als?|as per actuals?)\b.*$/i, "").replace(/\s+(?:OMR|RO|USD|EUR|INR|AED)$/i, "");
  if (!text) return null;
  if (TOTAL_LABEL.test(text)) return TOTAL;
  if (LINE_LABEL.test(text) || MAIN_LINE.test(text)) {
    const bare = text.replace(CARRIER_LEAD, "");
    if (bare && bare !== text && (LINE_LABEL.test(bare) || MAIN_LINE.test(bare))) text = bare;
    if (text.length <= 48) return text;
    let last: string | null = null;
    for (const m of text.matchAll(LABELS)) last = m[0];
    return last ? oneLine(last) : null;
  }
  const named =
    (colon || FEE_WORD.test(text)) &&
    PLAIN_LABEL.test(text) &&
    !NOT_A_LABEL.test(text) &&
    !SENTENCE_WORD.test(text) &&
    !CARRIER_ALONE.test(text) &&
    !CARRIER_OPTION_LINE.test(`${text}:`);
  return named ? text : null;
}

/**
 * The label above an amount that stands alone on its line, with the line it was read from: "DOOR TO DOOR" over
 * ": OMR 3180/40 HC", and "Thc" two lines over "INR 11500" when a pasted table stacks its headings.
 */
function labelAbove(text: string, lineStart: number): { label: string; line: string } | null {
  let end = lineStart - 1;
  for (let seen = 0, blank = 0; end > 0 && seen < 3 && blank < 2; ) {
    const start = text.lastIndexOf("\n", end - 1) + 1;
    const line = text.slice(start, end).trim();
    end = start - 1;
    if (!line) {
      if (seen) return null;
      blank++;
      continue;
    }
    if (line.length > 40 || /\d/.test(line) || SENTENCE_WORD.test(line)) return null;
    if (LINE_LABEL.test(line) || MAIN_LINE.test(line)) {
      const label = labelOf(line);
      return label ? { label, line } : null;
    }
    seen++;
  }
  return null;
}

/** Chinese or Japanese script: a notice in the agent's own language ("…收取MPCI申报费USD35/BL"), never this job's price. */
const NOTICE_SCRIPT = /[぀-ヿ㐀-鿿豈-﫿]/g;
const LATIN = /[A-Za-z]/g;
const isNotice = (sentence: string): boolean => (sentence.match(NOTICE_SCRIPT)?.length ?? 0) > (sentence.match(LATIN)?.length ?? 0);

function tokensOf(text: string, ourQuote: boolean): MoneyToken[] {
  const hits = hitsIn(text, ourQuote);
  const out: MoneyToken[] = [];
  hits.forEach((hit, i) => {
    const span = sentenceSpan(text, hit.start, hit.end);
    const follows = i > 0 && hits[i - 1].end > span.lineStart;
    const prev = follows ? hits[i - 1].end : span.lineStart;
    const next = i + 1 < hits.length ? Math.min(hits[i + 1].start, span.lineEnd) : span.lineEnd;
    // After another amount the unit written with it is not part of this one's label: "6100USD/20GP+PS 25USD".
    const between = text.slice(prev, hit.start);
    const unitBefore = follows ? (MULTIPLIER.exec(between) ?? UNIT_SUFFIX.exec(between))?.[0].length ?? 0 : 0;
    const before = between.slice(unitBefore);
    // "ZAR 1200 per shipment = US$74": the figure after the equals sign says the same amount again.
    if (follows && /=\s*$/.test(before)) return;
    const after = text.slice(hit.end, Math.min(next, hit.end + 40));
    // A pasted table puts the unit in the cell under the amount: "USD 45.0", then "Per AWB".
    const below = after.trim() ? null : UNIT_BELOW.exec(text.slice(span.lineEnd, span.lineEnd + 40));
    const { unit, multiplier } = unitOf(below ? below[1] : after);
    const amount = amountOf(hit.figure, hit.currency, unit === "/kg");
    if (!(amount > 0)) return;
    const above = !follows && /^[\s:：=\-–]*$/.test(before) ? labelAbove(text, span.lineStart) : null;
    const label = labelOf(before, follows) ?? above?.label ?? null;
    const written = clip(text.slice(span.start, span.end));
    const sentence = above && label === above.label ? clip(`${above.line} ${written}`) : written;
    const context = label ? sentence : contextOf(text, span);
    if (EXCLUDED.test(context) || DEPOSIT.test(context) || isNotice(written)) return;
    // A weight-break header carries bare figures; a rate with its own unit stays ("5.4 usd per KG (+100KG)").
    if (WEIGHT_BREAK.test(context) && !unit) return;
    // Soft words count beside the amount they stand with: before it (and in its label), or after it up to the next
    // item. What a rate includes is not a condition: "USD 8300/40hq with 14 days free time".
    const lead = `${above?.line ?? ""} ${before}`;
    const tail = text.slice(hit.end, Math.min(next, hit.end + 30));
    const own = tail.split(INCLUDED)[0];
    out.push({
      currency: hit.currency, amount, raw: oneLine(text.slice(hit.start, hit.end)), unit, multiplier, label,
      soft: SOFT.test(`${lead} ${own.split(ITEM_JOIN)[0]}`) || CONDITIONAL.test(`${lead} ${own}`) || TIMED_UNIT.test(unit ?? ""),
      allIn: ALL_IN.test(after), sentence, index: hit.start,
    });
  });
  return out;
}

/** Every amount in a text with its unit, label and softness; excluded sentences dropped. */
export function moneyTokens(text: string, opts?: { ourQuote?: boolean }): MoneyToken[] {
  return attempt(() => (typeof text === "string" && text ? tokensOf(text, !!opts?.ourQuote) : []), []);
}

// --- Validity, transit, free time, carrier, equipment, basis --------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (name: string): number => MONTHS.indexOf(name.slice(0, 3).toLowerCase());
const VALIDITY_ALL = new RegExp(VALIDITY.source, "gi");
const NO_VALIDITY = /\bno (?:rate )?validity(?: can(?:not| not)? be (?:provided|given|offered))?|\bvalidity can(?:'t| ?not) be provided/i;
/** Wording that stands in every quotation of a company: "All quotations are valid for 7 calendar days from issuance". */
const STANDARD_CLAUSE =
  /\b(?:all|our|any)\s+(?:of\s+)?(?:the\s+)?(?:quotations?|quotes?|offers?|rates)\s+(?:are|is|remain|shall)\b|\bquotations?\s+(?:are|is)\s+valid\b|\bunless otherwise\b|\bfrom\s+(?:the\s+)?(?:date\s+of\s+)?(?:issue|issuance|quotation)\b|\bstandard\s+(?:trading\s+)?(?:terms|conditions)\b/i;

function ymd(year: number, month: number, day: number): string | null {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year < 2100)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

/** A day and a month without a year: the year the mail was written, or the next when that day is long past. */
function inYearOf(received: string | null, month: number, day: number): string | null {
  if (!received) return null;
  const year = Number(received.slice(0, 4));
  const date = ymd(year, month, day);
  return date && daysBetween(date, received) > 180 ? ymd(year + 1, month, day) : date;
}

const yearOf = (raw: string | undefined): number | null => (!raw ? null : raw.length === 2 ? 2000 + Number(raw) : Number(raw));

/** The day a stated validity runs to, counted from the day the mail was written; null for "till sailing". */
function untilOf(value: string, tail: string, receivedAt: string): string | null {
  const t = timeOf(receivedAt);
  const received = t == null ? null : new Date(t + OMAN_OFFSET).toISOString().slice(0, 10);
  const v = value.trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s./-]*([a-z]{3})[a-z]*\.?(?:[ ./,-]*(\d{4}|\d{2})(?!\d))?/.exec(v);
  if (m && monthOf(m[2]) >= 0) {
    const year = yearOf(m[3]);
    return year ? ymd(year, monthOf(m[2]) + 1, Number(m[1])) : inYearOf(received, monthOf(m[2]) + 1, Number(m[1]));
  }
  m = /^([a-z]{3})[a-z]*\.?\s*-?\s*(\d{1,2})(?:st|nd|rd|th)?(?:[\s,-]*(\d{4}))?/.exec(v);
  if (m && monthOf(m[1]) >= 0) {
    const year = yearOf(m[3] ?? /^[.\s,/-]{0,3}(\d{4})\b/.exec(tail)?.[1]);
    return year ? ymd(year, monthOf(m[1]) + 1, Number(m[2])) : inYearOf(received, monthOf(m[1]) + 1, Number(m[2]));
  }
  m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?$/.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = yearOf(m[3]);
    // With a year the house writes day.month.year; without one "11.15" is month.day.
    if (year) return a <= 12 && b > 12 ? ymd(year, a, b) : ymd(year, b, a);
    return a > 12 && b <= 12 ? inYearOf(received, b, a) : inYearOf(received, a, b);
  }
  m = /^(\d+)\s*(?:calendar\s*)?(day|week|wk|hour|hr)s?$/.exec(v);
  if (m && t != null) {
    const n = Number(m[1]);
    const hours = m[2] === "day" ? 24 : m[2] === "hour" || m[2] === "hr" ? 1 : 168;
    return n > 0 && n < 1000 ? new Date(t + n * hours * HOUR + OMAN_OFFSET).toISOString().slice(0, 10) : null;
  }
  if (/^end of (?:the )?month$/.test(v) && received) return addDays(`${addDays(`${received.slice(0, 8)}01`, 31).slice(0, 8)}01`, -1);
  if (/^end of (?:the )?week$/.test(v) && received) return addDays(received, (6 - new Date(`${received}T00:00:00Z`).getUTCDay() + 7) % 7);
  return null;
}

/**
 * How long a rate holds, as the mail states it: a day, "no validity", or the company's standard wording (dated from
 * the mail, never said to have ended). Only read on a mail that carries a rate.
 */
export function validityOf(text: string, receivedAt: string, hasRate: boolean): { until: string | null; none: boolean; boilerplate: boolean; text: string } | null {
  try {
    if (!hasRate || typeof text !== "string" || !text) return null;
    const flat = text.replace(/[ \t]+/g, " ");
    const never = NO_VALIDITY.exec(flat);
    if (never) return { until: null, none: true, boilerplate: false, text: oneLine(never[0]).toLowerCase() };
    const standing = flat.search(BOILERPLATE);
    for (const m of flat.matchAll(VALIDITY_ALL)) {
      const at = m.index ?? 0;
      if (/\bd\/?o\s+$/i.test(flat.slice(Math.max(0, at - 4), at))) continue; // "DO validity" is the delivery order's
      const span = sentenceSpan(flat, at, at + m[0].length);
      const boilerplate = (standing >= 0 && at >= standing) || STANDARD_CLAUSE.test(contextOf(flat, span));
      return { until: untilOf(m[1], flat.slice(at + m[0].length, at + m[0].length + 8), receivedAt), none: false, boilerplate, text: clip(m[0], 80) };
    }
    const loose = VALIDITY_NEG.exec(flat);
    return loose ? { until: null, none: true, boilerplate: false, text: oneLine(loose[0]).toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** The transit time a text states: "35 days", "25–35 days", "direct flight". A unit is required ("TT copy" is a bank slip). */
export function transitOf(text: string): string | null {
  const m = typeof text === "string" ? TRANSIT.exec(text) : null;
  if (!m) return null;
  if (m[4]) return oneLine(m[4]).toLowerCase();
  const range = (m[1] ?? m[3] ?? "").replace(/\s*(?:-|–|to|\/)\s*/i, "–");
  const unit = !m[1] || /^d/i.test(m[2]) ? "days" : /^w/i.test(m[2]) ? "weeks" : "hours";
  return range ? `${range} ${range === "1" ? unit.slice(0, -1) : unit}` : null;
}

/** Free days at destination a text states: "14 DAYS FREE AT POD" → 14. */
export function freeDaysOf(text: string): number | null {
  if (typeof text !== "string") return null;
  // Line by line: "TT:40-45 DAYS" above "FREE TIME AT POD:11 DAY" is not 45 days free.
  let first: number | null = null;
  for (const line of text.split("\n")) {
    const m = FREE_TIME.exec(line);
    const n = m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : NaN;
    if (!Number.isFinite(n) || n <= 0) continue;
    // "7 days free time in CFS" is the origin's: the line that names the destination wins.
    if (/\b(?:pod|dest\w*|discharge)\b/i.test(line)) return n;
    if (!/\b(?:pol|origin|cfs|loading)\b/i.test(line)) first ??= n;
  }
  return first;
}

const CARRIERS = new RegExp(CARRIER.source, "gi");
const CARRIER_CODES = new RegExp(CARRIER_CODE.source, "gi");
const CARRIER_NAMES: [RegExp, string][] = [
  [/^(?:maersk|mearsk|msk)$/i, "Maersk"], [/^(?:hapag.*|hpl|hl)$/i, "Hapag-Lloyd"], [/^cma/i, "CMA CGM"], [/^(?:evergreen|emc|eglv)$/i, "Evergreen"],
  [/^(?:yang\s?ming|yml)$/i, "Yang Ming"], [/^wan\s?hai$/i, "Wan Hai"], [/^emirates\s?(?:shipping|line)$/i, "Emirates Shipping Line"],
  [/^(?:emirates.*|ek)$/i, "Emirates"], [/^(?:turkish.*|tk)$/i, "Turkish Airlines"], [/^(?:oman\s?air.*|wy)$/i, "Oman Air"],
  [/^(?:air\s?india|ai)$/i, "Air India"], [/^(?:qatar.*|qr)$/i, "Qatar Airways"], [/^(?:etihad|ey)$/i, "Etihad"], [/^g9$/i, "Air Arabia"],
  [/^salam\s?air$/i, "Salam Air"], [/^asyad$/i, "Asyad"],
];
function carrierName(raw: string): string {
  const text = oneLine(raw);
  for (const [re, name] of CARRIER_NAMES) if (re.test(text)) return name;
  return text.length <= 5 ? text.toUpperCase() : displayName(text.toUpperCase());
}

/** The shipping line or airline a text names; short codes only as written in capitals after a cue word ("CARRIER: HL"). */
export function carrierOf(text: string): string | null {
  try {
    if (typeof text !== "string" || !text) return null;
    let named: { at: number; name: string } | null = null;
    for (const m of text.matchAll(CARRIERS)) {
      const raw = m[1];
      const at = m.index ?? 0;
      if (raw.length <= 4 ? raw !== raw.toUpperCase() : raw[0] !== raw[0].toUpperCase()) continue;
      if (/^emirates/i.test(raw) && /arab\s+$/i.test(text.slice(Math.max(0, at - 6), at))) continue;
      named = { at, name: carrierName(raw) };
      break;
    }
    for (const m of text.matchAll(CARRIER_CODES)) {
      if (m[1] !== m[1].toUpperCase()) continue;
      return !named || (m.index ?? 0) < named.at ? carrierName(m[1]) : named.name;
    }
    return named?.name ?? null;
  } catch {
    return null;
  }
}

function boxType(match: string, raw: string | undefined): string {
  const type = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  const name =
    type === "OPENTOP" ? "OT" : type === "FLATRACK" ? "FR" : type === "HIGHCUBE" || type === "HQ" || type === "HR" ? "HC" : type === "REEFER" ? "RF" : type === "OTHC" ? "OT HC" : type === "FT" ? "" : type;
  const high = /\(?HC\)?\s*$/i.test(match.slice(match.search(/[A-Za-z]/) < 0 ? match.length : match.search(/[A-Za-z]/)).replace(/^[A-Z]+/i, ""));
  return `${name ? ` ${name}` : ""}${high && !name.includes("HC") ? " HC" : ""}`;
}

/** The containers a text counts, in order: "1X40 HC" → one of size 40. Cargo dimensions ("80 x 40 x 20 cm") are not containers. */
function countedBoxes(text: string): { count: number; size: string; name: string }[] {
  const out: { count: number; size: string; name: string }[] = [];
  for (const m of text.matchAll(EQUIPMENT_A)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (/\d\s?[x×*]\s?$/.test(text.slice(Math.max(0, at - 4), at)) || /^\s?[x×*]\s?\d/.test(text.slice(end, end + 6))) continue;
    // Without a type the size needs a mark of a box: a foot sign, a word for it, or nothing else on the line ("1X40").
    const nl = text.indexOf("\n", at);
    const alone = !text.slice(at + m[0].trimEnd().length, nl < 0 ? text.length : nl).trim();
    if (!m[3] && !/['’]/.test(m[0]) && !alone && !/^\s?(?:cont|cntr|ctr|dry|std)/i.test(text.slice(end, end + 8))) continue;
    out.push({ count: Number(m[1]), size: m[2], name: `${Number(m[1])}x${m[2]}${boxType(m[0], m[3])}` });
  }
  return out;
}

/** How many containers a text says the shipment is, for a rate per box of the given size (any size when none): "UNIT : 1X40 HC" → 1. */
function statedCount(text: string, size: string | null): number | null {
  const stated = attempt(() => countedBoxes(text), []).find((b) => (!size || b.size === size) && b.count > 0);
  return stated ? stated.count : null;
}

/** The container a text names: "1x40 OT HC", "40 HC". */
export function equipmentOf(text: string): string | null {
  try {
    if (typeof text !== "string" || !text) return null;
    const counted = countedBoxes(text)[0];
    if (counted) return counted.name;
    for (const m of text.matchAll(EQUIPMENT_B)) {
      const end = (m.index ?? 0) + m[0].length;
      return `${m[1]}${boxType(`${m[0]}${/^\s?\(?HC\)?/i.exec(text.slice(end, end + 6))?.[0] ?? ""}`, m[2])}`;
    }
    return null;
  } catch {
    return null;
  }
}

const CW_ALL = new RegExp(CW.source, "gi");
/** The volume an agent's offer states by label: "Volume: 6.3 cbm ( stackable – non-DG )". */
const VOLUME_LINE = /\b(?:volume|vol\.?|total\s+cbm)\s*[:：-]\s*([\d.,]+)\s*(?:cbm|m3|m³)\b/i;
const measure = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(/,(?=\d{3}(?!\d))/g, "").replace(/,/g, ".").replace(/\.$/, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** What a rate was worked out on: the volume, the chargeable or gross weight, the number of packages. */
export function basisOf(text: string): Basis | null {
  try {
    if (typeof text !== "string" || !text) return null;
    const basis: Basis = { cbm: null, chargeableKg: null, grossKg: null, packages: null, text: "" };
    const m = BASIS.exec(text);
    if (m) {
      const first = measure(m[1]);
      if (/^(?:cbm|m3)$/i.test(m[2])) basis.cbm = first;
      else if (/gross/i.test(m[0])) basis.grossKg = first;
      else basis.chargeableKg = first;
      if (m[3]) basis.chargeableKg = measure(m[3]);
      if (m[4]) basis.packages = measure(m[4]);
    }
    for (const w of text.matchAll(CW_ALL)) {
      if (/^g/i.test(w[0])) basis.grossKg ??= measure(w[1]);
      else basis.chargeableKg ??= measure(w[1]);
    }
    basis.cbm ??= measure(VOLUME_LINE.exec(text)?.[1]);
    basis.text = [
      basis.cbm != null ? `${fmt(basis.cbm)} cbm` : "",
      basis.chargeableKg != null ? `${fmt(basis.chargeableKg)} kg chargeable` : "",
      basis.grossKg != null ? `${fmt(basis.grossKg)} kg gross` : "",
      basis.packages != null ? plural(basis.packages, "package") : "",
    ].filter(Boolean).join(" · ");
    return basis.text ? basis : null;
  } catch {
    return null;
  }
}

/** The first basis that knows each measure. */
function mergeBasis(...all: (Basis | null | undefined)[]): Basis | null {
  const known = all.filter((b): b is Basis => !!b);
  if (!known.length) return null;
  const pick = (key: "cbm" | "chargeableKg" | "grossKg" | "packages") => known.find((b) => b[key] != null)?.[key] ?? null;
  return { cbm: pick("cbm"), chargeableKg: pick("chargeableKg"), grossKg: pick("grossKg"), packages: pick("packages"), text: known[0].text };
}

// --- Price lines ----------------------------------------------------------------------------------------------

/** A price line with what the rules need beside what the page shows. */
interface Line extends PriceLine { allIn: boolean; index: number; sentence: string }

const KEPT_UPPER = /^(?:LCL|FCL|DO|D\/O|CFS|THC|OTHC|DTHC|VGM|BL|B\/L|AWB|HAWB|MAWB|VAT|EXW|FOB|CIF|CFR|DAP|DDP|O\/F|A\/F|BAF|BAS|EBS|CAF|PSS|GRI|WRS|AMS|COD|CED|BOE|POL|POD|DG)$/;

/** Everyday words of a label: no capital inside it ("Door To Door" → "Door to door"); a place keeps its own. */
const LABEL_WORD =
  /^(?:To|Of|And|At|For|In|Per|From|Door|Port|Airport|Charges?|Fees?|Clearance|Freight|Ocean|Air|Sea|Time|Rates?|Declaration|Handling|Commission|Origin|Destination|Delivery|Order|Up|Works?)$/;

function caseWord(word: string): string {
  if (KEPT_UPPER.test(word)) return word;
  return word.includes("/") ? word.split("/").map(caseWord).join("/") : word.toLowerCase();
}

/** A label as the page shows it: "PORT TO PORT" → "Port to port", "LCL + DO CHARGES" → "LCL & DO", "DUTY/VAT" → "Duty/VAT". */
function shortLabel(label: string | null): string {
  if (!label) return "";
  const text = oneLine(label)
    .replace(/\s*\((?:if\s+\w+|at\s?act[au]als?|approx\.?)\)/gi, "")
    .replace(/\s*\+\s*/g, " & ")
    .replace(/\s+charges?$/i, "")
    .replace(/[\s:：=\-–(]+$/, "");
  const words = /[a-z]/.test(text) ? text.replace(/(?<=\s)[A-Z][a-z]+/g, (w) => (LABEL_WORD.test(w) ? w.toLowerCase() : w)) : text.replace(/[A-Za-z/]+/g, caseWord);
  // "DOOR TO SOHAR PORT": the port keeps its capital.
  const named = words.replace(/^(door to )([a-z])(?=\w* port$)/i, (_, lead: string, initial: string) => `${lead}${initial.toUpperCase()}`);
  return named.charAt(0).toUpperCase() + named.slice(1);
}
/** A label inside a sentence: "339 port to port + 132 LCL & DO". */
const lowerFirst = (label: string): string => (/^[A-Z][A-Z/&]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

function softTextOf(text: string): string | null {
  if (/act[au]als?/i.test(text)) return "at actuals";
  const cond = /\bif (applicable|required|requested|any)\b/i.exec(text);
  if (cond) return `if ${cond[1].toLowerCase()}`;
  if (/\bapprox\.?|\bappx\.?|\baround\b|\babout\b|\bestimat|\btentative\b/i.test(text)) return "approx.";
  if (/\bsubject to\b/i.test(text)) return "subject to change";
  return CONDITIONAL.test(text) ? "if incurred" : null;
}

/** Whether a sentence names a charge anywhere: "All quotes will be subjected to Euro 15 Bank Commission Fee". */
const chargeIn = (sentence: string): string | null => LINE_LABEL.exec(sentence)?.[0] ?? null;

/** Where the words that belong to an amount end: the next item, or what is said of it ("with 14 days free time"). */
const AFTER_ITEM = /\+|;|,|，|\band\b|\bplus\b|\bwith\b|\bfor\b|\bat\b|\bper\b/i;

/** The charge named right after an amount that has no label before it: "Euro 15 Bank Commission Fee". Never a period ("free time"). */
function chargeAfter(token: MoneyToken): string | null {
  const at = token.sentence.indexOf(token.raw);
  if (at < 0) return null;
  const words = token.sentence.slice(at + token.raw.length).split(AFTER_ITEM)[0];
  const m = LINE_LABEL.exec(words);
  return m && !NOT_A_CHARGE.test(m[0]) ? m[0] : null;
}

function lineOf(token: MoneyToken, proof: Proof, main: boolean, fallback: string): Line {
  const times = token.multiplier && token.multiplier > 0 ? token.multiplier : null;
  const label = shortLabel(token.label ?? chargeAfter(token)) || fallback;
  return {
    label: times ? `${label} (${fmt(token.amount)} × ${times})` : label,
    amount: times ? tidy(token.amount * times) : token.amount,
    currency: token.currency,
    unit: times ? null : token.unit,
    soft: token.soft,
    softText: token.soft ? (softTextOf(`${token.label ?? ""} ${token.sentence}`) ?? "approx.") : null,
    main, proof, allIn: token.allIn, index: token.index, sentence: token.sentence,
  };
}

const plain = ({ label, amount, currency, unit, soft, softText, main, proof }: PriceLine): PriceLine => ({ label, amount, currency, unit, soft, softText, main, proof });

/** A second figure for the same charge in another currency: "USD 980.00/- (OMR 376.00/-)". */
function withoutTwins(tokens: MoneyToken[]): MoneyToken[] {
  return tokens.filter((t, i) => {
    const prev = tokens[i - 1];
    if (!prev || prev.sentence !== t.sentence || prev.currency === t.currency) return true;
    const a = toUsd(prev.amount, prev.currency);
    return !(a > 0 && Math.abs(a - toUsd(t.amount, t.currency)) / a < 0.05);
  });
}

const FREIGHT_UNIT = /^\/(?:kg|cbm|w\/m|rt|ton|cntr|teu|feu|\d)/;
/** A line that adds the others up: it is the price, and the lines it sums are not added again. */
const isTotal = (t: MoneyToken): boolean => t.label === TOTAL;
/** "20", "40" or "45" when a unit is a size of container. */
const boxSize = (unit: string | null): string | null => /^\/(?:\d+x)?(20|40|45)(?!\d)/.exec(unit ?? "")?.[1] ?? null;

/**
 * The main line among tokens: a freight label, else the largest rate per kilo, cbm or container that is not named as
 * another charge ("Screening & Handling Fee – US$0.06 per CW" is no freight rate), else the largest amount.
 */
function pickMain(tokens: MoneyToken[]): MoneyToken | null {
  const firm = tokens.filter((t) => !t.soft);
  const labelled = firm.find(isTotal) ?? firm.find((t) => t.label && MAIN_LINE.test(t.label));
  if (labelled) return labelled;
  const largest = (list: MoneyToken[]) => list.reduce<MoneyToken | null>((best, t) => (!best || toUsd(t.amount, t.currency) > toUsd(best.amount, best.currency) ? t : best), null);
  return largest(firm.filter((t) => FREIGHT_UNIT.test(t.unit ?? "") && !(t.label && LINE_LABEL.test(t.label)))) ?? largest(firm);
}

type Missing = MissingBasis;

/** How many times a line counts for the shipment; null when the basis it needs is not known. */
function quantityFor(unit: string | null, basis: Basis | null, units: number | null): { times: number | null; missing: Missing | null; word: string } {
  if (!unit || /^\/\d+x/.test(unit)) return { times: 1, missing: null, word: "" };
  if (unit === "/kg" || unit === "/ton") {
    const kg = unit === "/kg" ? (basis?.chargeableKg ?? basis?.grossKg ?? null) : (basis?.grossKg ?? null);
    return { times: kg == null ? null : unit === "/kg" ? kg : kg / 1000, missing: kg == null ? "kg" : null, word: unit === "/kg" ? "kg" : "t" };
  }
  if (unit === "/cbm") return { times: basis?.cbm ?? null, missing: basis?.cbm == null ? "cbm" : null, word: "cbm" };
  // Weight or measure: a revenue ton is the larger of the cbm and the gross weight in tonnes.
  if (unit === "/w/m" || unit === "/rt") {
    const cbm = basis?.cbm ?? null;
    return { times: cbm == null ? null : Math.max(cbm, (basis?.grossKg ?? 0) / 1000), missing: cbm == null ? "cbm" : null, word: unit === "/w/m" ? "w/m" : "rt" };
  }
  if (/^\/(?:20|40|45|cntr|teu|feu)/.test(unit)) {
    const n = units && units > 0 ? units : null;
    return { times: n, missing: n == null ? "containers" : null, word: n === 1 ? "container" : "containers" };
  }
  if (unit === "/pallet" || unit === "/pkg") {
    const n = basis?.packages ?? null;
    return { times: n, missing: n == null ? "packages" : null, word: n === 1 ? "package" : "packages" };
  }
  return { times: 1, missing: null, word: "" };
}

/** Main plus firm add-ons, multiplied out, in the main line's currency; null with what is missing when a basis is not known. */
function sumLines(lines: PriceLine[], basis: Basis | null, units: number | null): { total: number | null; missing: Missing | null } {
  const main = lines.find((l) => l.main) ?? lines[0];
  if (!main || main.amount == null || main.soft) return { total: null, missing: null };
  let total = 0;
  let missing: Missing | null = null;
  for (const line of lines) {
    if (line.soft || line.amount == null) continue;
    const q = quantityFor(line.unit, basis, units);
    if (q.times == null) missing ??= q.missing;
    else total += convert(line.amount * q.times, line.currency, main.currency);
  }
  return missing ? { total: null, missing } : { total: tidy(total), missing: null };
}

/** "298 ocean freight + 117 LCL & DO"; a rate per unit as "USD 5.4/kg × ? kg". */
function linesTextOf(lines: PriceLine[], basis: Basis | null, units: number | null): string {
  return lines
    .filter((l) => !l.soft && l.amount != null)
    .map((l) => {
      const q = quantityFor(l.unit, basis, units);
      if (q.word) return `${moneyText(l.amount ?? 0, l.currency, l.unit)} × ${q.times == null ? "?" : fmt(q.times)} ${q.word}`;
      return `${fmt(l.amount ?? 0)}${l.unit ?? ""} ${lowerFirst(l.label)}`.trim();
    })
    .join(" + ");
}

const MISSING_TEXT: Record<Missing, string> = {
  kg: "the weight is not known",
  cbm: "the volume is not known",
  containers: "the number of containers is not known",
  packages: "the number of packages is not known",
};

// --- Names ----------------------------------------------------------------------------------------------------

/** The name of the conversation a counterpart's mail belongs to, as the proofs show it. */
function sideNameFor(mail: ReadMail, today: string): string {
  const who = proofOf(mail, today).who;
  const side = /\(([^()]*)\)\s*$/.exec(who)?.[1];
  return side || who || mail.sideKey;
}

/** The name of a conversation from one of its counterpart's mails, else from its domain. */
function nameOfSide(chron: ReadMail[], sideKey: string, today: string): string {
  const theirs = chron.find((m) => m.sideKey === sideKey && m.party !== "us");
  return theirs ? sideNameFor(theirs, today) : displayName(agentNameForDomain(sideKey)) || sideKey;
}

/** The sentence in which a customer accepts, or null: "Please proceed with this shipment", "You are here by nominated". */
function yesSentenceOf(clean: string): string | null {
  for (const s of sentencesOf(clean)) {
    if (NOT_YES.test(s)) continue;
    if (YES_EXTRA.test(s) || YES.some((re) => re.test(s))) return s;
  }
  return null;
}

/**
 * A customer's yes to our offer: a yes sentence in a mail that names no firm figure of its own, or names one we
 * offered before it ("as per your quotation (OMR 768.000 …)"). A yes that names another figure is about another
 * shipment ("courier booking for PO04828 … OMR 75.000"); one that may be about another enquiry never counts.
 */
function yesToOffer(mail: ReadMail, offered: (key: string, at: number) => boolean): string | null {
  if (mail.party !== "customer" || mail.siblingHint) return null;
  const yes = yesSentenceOf(mail.clean);
  if (!yes) return null;
  const at = timeOf(mail.at) ?? 0;
  const said = mail.money.filter((t) => !isQuestion(t) && !t.soft);
  return !said.length || said.some((t) => offered(amountKey(t), at)) ? yes : null;
}

// --- Roles ----------------------------------------------------------------------------------------------------

/** Fees an agent states in every mail ("Euro 15 Bank Commission Fee"): kept on the first, counted once. */
const STANDING = new WeakSet<MoneyToken>();

/** A rate line: a unit or a freight label (or the total of such lines), and nothing about invoices, duty or payment in its sentence. */
const isRateToken = (t: MoneyToken): boolean =>
  (t.unit != null || (t.label != null && (isTotal(t) || LINE_LABEL.test(t.label) || MAIN_LINE.test(t.label)))) && !AGENT_RATE_EXCLUDE.test(t.sentence);
const isRateMail = (mail: ReadMail): boolean => mail.party === "agent" && mail.money.some(isRateToken);
const isQuestion = (t: MoneyToken): boolean => /\?\s*$/.test(t.sentence);
const amountKey = (t: Pick<MoneyToken, "currency" | "amount">): string => `${t.currency}|${t.amount}`;
const lineKey = (t: MoneyToken): string => `${amountKey(t)}|${oneLine(t.sentence).toLowerCase().replace(/^[\s•*·>\-–]+/, "")}`;

/** The sentence a pattern is found in, the wrapped lines of its paragraph joined. */
function sentenceWith(clean: string, pattern: RegExp): string | null {
  for (const paragraph of clean.split(/\n[ \t]*\n/)) {
    const flat = oneLine(paragraph);
    const m = pattern.exec(flat);
    if (!m) continue;
    const span = sentenceSpan(flat, m.index, m.index + m[0].length);
    return flat.slice(span.start, span.end).trim();
  }
  return null;
}

/** The sentence in which we tell an agent to go ahead: "Please proceed this shipment with below agreed rate :". */
const agreementIn = (clean: string): string | null => sentenceWith(clean, AGREED) ?? sentenceWith(clean, WON_OURS);

/** A go-ahead about a draft, a payment or the packing: it agrees no price. */
const OPERATIONAL = /\b(?:b\/?l|hbl|mbl|awb|drafts?|vgm|pay(?:ment)?|cheque|clearance|bayan|telex|palleti[sz]\w*)\b/i;
/** What a customer's own figure is about when it is not a price for the job: the goods' value, a duty, money already paid. */
const NOT_A_PRICE = /\b(?:value|worth|invoice|insur\w+|duty|vat|paid|due|balance|deposit|refund)\b/i;

/** Cargo papers are not payment papers. */
const CARGO_PAPERS = /\b(?:commercial|proforma|pro-forma)\s+invoices?\b|\binvoices?\s*(?:&|and|\/|,)\s*packing\b|\bpacking\s+lists?\s*(?:&|and|\/|,)\s*invoices?\b/gi;
const INVOICE_WORDS = /\b(?:invoices?|receipts?)\b/gi;

/** Invoices, cheques and payments in the text or a file name. An invoice before the job is confirmed is a cargo paper. */
function isPaperwork(mail: ReadMail, afterConfirmation: boolean): boolean {
  const strip = (text: string) => {
    const t = text.replace(CARGO_PAPERS, " ");
    return afterConfirmation ? t : t.replace(INVOICE_WORDS, " ");
  };
  return PAPERWORK.test(strip(mail.clean)) || mail.files.some((f) => PAPERWORK.test(strip(f.filename.replace(/[_.-]+/g, " "))));
}

function addressedTo(mail: ReadMail): string[] {
  const pick = (list: unknown): string[] =>
    (Array.isArray(list) ? list : []).map((a) => String(a ?? "").trim().toLowerCase()).filter((a) => a.includes("@") && !/@silverlynxoman\.com$|^silverlynxco@gmail\.com$/.test(a));
  const to = pick(mail.email?.to_emails);
  return to.length ? to : pick(mail.email?.cc_emails);
}

/**
 * Fills money and moneyRole on every in-scope mail, in place. Tokens come from the clean text (bare figures count in
 * our own quote to the customer); a line of ours that repeats an agent's line is a forward and is left out; a fee an
 * agent repeats in every mail stays on the first. Roles go by recipient for our mails and by party for theirs.
 */
export function assignMoney(mails: ReadMail[], row: EnquiryRow): void {
  try {
    assign(Array.isArray(mails) ? mails : [], row);
  } catch {
    // What was read so far stays; the other readings go on without the rest.
  }
}

function assign(all: ReadMail[], row: EnquiryRow): void {
  for (const mail of all) {
    if (!mail) continue;
    mail.money = [];
    mail.moneyRole = null;
  }
  const chron = inScope(all);
  const confirmed = row?.status === "confirmed" && isDay(row.confirmed_date) ? row.confirmed_date : null;
  const after = (mail: ReadMail) => !!confirmed && mail.day > confirmed;

  // Tokens, oldest mail first.
  const theirLines = new Set<string>();
  const ourLines = new Set<string>();
  const fees = new Map<string, MoneyToken>();
  for (const mail of chron) {
    const ours = mail.party === "us";
    let tokens = moneyTokens(mail.clean, { ourQuote: ours && mail.toParty === "customer" });
    if (ours) {
      tokens = tokens.filter((t) => !theirLines.has(lineKey(t)));
      for (const t of tokens) ourLines.add(lineKey(t));
    } else {
      const sender = mail.from?.email ?? mail.sideKey;
      tokens = tokens.filter((t) => {
        const key = lineKey(t);
        if (!ourLines.has(key)) theirLines.add(key);
        if (isRateToken(t) || !chargeIn(t.sentence)) return true;
        const first = fees.get(`${sender}|${key}`);
        if (!first) {
          fees.set(`${sender}|${key}`, t);
          return true;
        }
        STANDING.add(first);
        return false;
      });
    }
    mail.money = tokens;
  }

  // Our own mails and the agents': neither depends on the amounts the customer wrote.
  const rated = new Set<string>();
  /** Agents we already told to go ahead; true once they have sent a newer rate. */
  const agreedWith = new Map<string, boolean>();
  let offered = false;
  /** Every figure of our offer mails so far, and their sum per mail, with the time first written. */
  const offeredAt = new Map<string, number>();
  const noteOffer = (mail: ReadMail, firm: MoneyToken[]) => {
    const t = timeOf(mail.at) ?? 0;
    const sums = new Map<Currency, number>();
    for (const token of firm) {
      sums.set(token.currency, (sums.get(token.currency) ?? 0) + token.amount);
      if (!offeredAt.has(amountKey(token))) offeredAt.set(amountKey(token), t);
    }
    for (const [currency, amount] of sums) if (!offeredAt.has(`${currency}|${tidy(amount)}`)) offeredAt.set(`${currency}|${tidy(amount)}`, t);
  };
  /** The customer said yes to an offer: a charge named after that is not part of what they accepted. */
  let accepted = false;
  for (const mail of chron) {
    const tokens = mail.money;
    const extra = after(mail) && tokens.some((t) => POST_BOOKING.test(t.sentence) || POST_BOOKING.test(mail.clean.slice(Math.max(0, t.index - 120), t.index + 60)));
    const paperwork = (): MoneyRole | null => (isPaperwork(mail, after(mail)) ? "paperwork" : null);
    if (mail.party === "customer") {
      if (offered && yesToOffer(mail, (key, at) => (offeredAt.get(key) ?? Infinity) < at)) accepted = true;
      continue;
    }
    if (mail.party !== "us") {
      if (isRateMail(mail)) {
        mail.moneyRole = extra ? "extra" : "agent_rate";
        rated.add(mail.sideKey);
        if (agreedWith.has(mail.sideKey)) agreedWith.set(mail.sideKey, true);
      } else mail.moneyRole = extra ? "extra" : paperwork();
      continue;
    }
    const text = oneLine(mail.clean);
    if (mail.toParty === "customer") {
      const firm = tokens.filter((t) => !t.soft);
      // A named charge sent on its own ("LCL + DO: OMR 132.000") joins the offer until the customer accepts it; a
      // surcharge, a duty or an invoice line never does.
      const priced = firm.filter((t) => t.label != null && !POST_BOOKING.test(t.sentence) && !AGENT_RATE_EXCLUDE.test(t.sentence));
      const strict = firm.length > 0 && (OUR_PRICE_LINE.test(mail.clean) || (OFFER_CUE.test(text) && firm.some((t) => t.amount >= 100)));
      const addOn = !accepted && !after(mail) && priced.length > 0 && (offered || priced.some((t) => t.amount >= 100));
      if (extra) mail.moneyRole = "extra";
      else if (strict || addOn) {
        mail.moneyRole = "offer";
        offered = true;
        noteOffer(mail, firm);
      } else mail.moneyRole = paperwork();
    } else if (mail.toParty === "agent") {
      // "Please proceed" a second time agrees nothing new, unless it names amounts or answers a newer rate; nor does
      // one about a draft or a payment ("BL confirm, please proceed").
      const said = AGREED.test(text) || WON_OURS.test(text);
      const settled = rated.has(mail.sideKey) && agreedWith.get(mail.sideKey) !== false && !OPERATIONAL.test(agreementIn(mail.clean) ?? "");
      const goAhead = said && (tokens.length > 0 || settled);
      if (goAhead) {
        mail.moneyRole = "agreed_buy";
        agreedWith.set(mail.sideKey, false);
      } else if (TARGET.test(text)) mail.moneyRole = "target";
      else if (PUSH.test(text) && tokens.length > 0) mail.moneyRole = "push_to_agent";
      else mail.moneyRole = extra ? "extra" : paperwork();
    } else mail.moneyRole = extra ? "extra" : paperwork();
  }

  // The customer's amounts: ours repeated, a target, or a figure of their own.
  const { offer, amounts } = offerState(chron, row?.units ?? null);
  const offerUsd = offer ? toUsd(offer.total, offer.currency) : 0;
  for (const mail of chron) {
    if (mail.party !== "customer") continue;
    const text = oneLine(mail.clean);
    const at = timeOf(mail.at) ?? 0;
    const said = mail.money.filter((t) => !isQuestion(t));
    const echo = said.some((t) => (amounts.get(amountKey(t)) ?? Infinity) < at);
    const counter = said.some((t) => {
      const usd = toUsd(t.amount, t.currency);
      return !t.soft && offerUsd > 0 && usd >= offerUsd * 0.3 && usd <= offerUsd * 1.5 && !NOT_A_PRICE.test(t.sentence) && !PAPERWORK.test(t.sentence);
    });
    if (echo) mail.moneyRole = "customer_echo";
    else if (TARGET.test(text)) mail.moneyRole = "target";
    else if (counter) mail.moneyRole = "customer_counter";
    else if (after(mail) && mail.money.some((t) => POST_BOOKING.test(t.sentence))) mail.moneyRole = "extra";
    else mail.moneyRole = isPaperwork(mail, after(mail)) ? "paperwork" : null;
  }
}

// --- The offer ------------------------------------------------------------------------------------------------

/** One mail of ours that prices the job, or one quoted by the customer when ours is not filed. */
interface Source { mail: ReadMail; text: string; tokens: MoneyToken[]; at: string; from: PersonRef; to: string[]; quoted: boolean }
/** What one mail says of one thing offered; sum is the total the mail itself writes under its lines. */
interface Part { src: Source; main: Line | null; lines: Line[]; sum: number | null }
interface Option { key: string; mode: string | null; name: string }
/** One thing offered ("sea port to port", "air door to door") with every mail that priced it, oldest first. */
interface Draft { key: string; mode: string | null; name: string; unit: string | null; parts: Part[] }
interface OfferState { offer: Offer | null; drafts: Draft[]; amounts: Map<string, number> }

/** A unit priced per container: the shipment's count of boxes multiplies it. */
const PER_BOX = /^\/(?:20|40|45|cntr|teu|feu)/;

/** A pasted table puts a value under its label ("TT", then ": 25 DAYS"): the two as one line, for the terms read by label. */
const joinValues = (text: string): string => text.replace(/[ \t]*\n(?:[ \t]*\n)?[ \t]*(?=[:：][ \t]*\S)/g, " ");

const SCOPE_WORDS = /\b(?:air)?port\s?to\s?(?:air)?(?:port|door)\b|\bdoor\s?to\s?(?:door|port|\w+\s+port)\b/i;
/** The label of a line that prices the whole move, not an add-on ("Transportation from port to Ghala" is one). */
const OFFER_MAIN =
  /^(?:(?:air|lcl|sea|fcl|courier)\s+)?(?:(?:fob|exw|cif|cfr|dap|ddp|fca)\s+)?(?:door|port|airport)\s?to\b|(?:ocean|air|sea)\s?freight|\bo\/f\b|\ba\/f\b|\ball[\s-]?in\b/i;
const MODE_LINE = /^[ \t*_•-]*(SEA|AIR|LCL|FCL|COURIER|LAND|ROAD)\b[A-Z /&-]{0,24}[ \t*_:]*$/;
const SOFT_LINE = /^[ \t•*·>-]*([A-Za-z][A-Za-z /&+().-]{1,40}?)\s*[:：=]\s*([^\n]{2,40})$/gm;
const QUOTE_START = new RegExp(
  `${QUOTED_HEADER_LEAK.source}|(?:^|\\n)[ \\t>]*-{2,}\\s*On\\b[^\\n]{0,200}\\bwrote\\s*-{2,}|(?:^|\\n)[ \\t>]*On\\b[^\\n]{0,200}\\bwrote\\s*:`,
  "i",
);
const OUR_ADDRESS = /[\w.+-]+@silverlynxoman\.com|silverlynxco@gmail\.com/i;

/** The mode word on a short line of capitals above a price line: "SEA FOB", "AIR", "COURIER". */
function modeAbove(text: string, index: number): string | null {
  let end = index > 0 ? text.lastIndexOf("\n", index - 1) : -1;
  for (let seen = 0; end > 0 && seen < 2; ) {
    const start = text.lastIndexOf("\n", end - 1) + 1;
    const line = text.slice(start, end);
    end = start - 1;
    if (!line.trim()) continue;
    const m = MODE_LINE.exec(line);
    if (m) return m[1].toLowerCase();
    seen++;
  }
  return null;
}

function optionOf(text: string, token: MoneyToken): Option {
  const label = oneLine(token.label ?? "").toLowerCase();
  // "door to Sohar port": the port keeps its capital.
  const scope = (SCOPE_WORDS.exec(label)?.[0].replace(/\s+/g, " ") ?? "").replace(/^(door to )([a-z])(\w* port)$/, (_, a: string, b: string, c: string) => `${a}${b.toUpperCase()}${c}`);
  const mode =
    /^(air|lcl|sea|fcl|courier)\b/.exec(label)?.[1] ??
    modeAbove(text, token.index) ??
    (/\b(?:ocean|sea)\s?freight|\bo\/f\b/.test(label) ? "sea" : /\bair\s?freight|\ba\/f\b|airport/.test(label) ? "air" : null);
  const name = scope || label;
  return { key: [mode, name, token.unit].filter(Boolean).join(" "), mode, name };
}

const modeWord = (mode: string | null): string => (!mode ? "" : /^(?:lcl|fcl)$/.test(mode) ? mode.toUpperCase() : mode);

/** "CFS CHARGES : AT ACTUALS": a charge that is named and not priced; "AT ACTUALS (Approx. 160 OMR)" keeps its figure. */
function softLines(text: string, from: number, to: number, taken: Set<number>, tokens: MoneyToken[], currency: Currency, proofFor: (sentence: string) => Proof): Line[] {
  const out: Line[] = [];
  for (const m of text.slice(from, to).matchAll(SOFT_LINE)) {
    const at = from + (m.index ?? 0);
    if (taken.has(text.lastIndexOf("\n", at + m[0].search(/\S/)) + 1)) continue;
    const value = m[2];
    const softText = softTextOf(value);
    const actuals = /^\s*(?:at|as per)\s+act[au]als?/i.test(value);
    if (!softText || (/\d/.test(value) && !actuals) || !(LINE_LABEL.test(m[1]) || actuals)) continue;
    const beside = tokens.find((t) => t.soft && t.label == null && t.index >= at && t.index < at + m[0].length);
    out.push({
      label: shortLabel(m[1]), amount: beside?.amount ?? null, currency: beside?.currency ?? currency, unit: beside?.unit ?? null, soft: true, softText, main: false,
      proof: proofFor(oneLine(m[0])), allIn: false, index: at, sentence: oneLine(m[0]),
    });
  }
  return out;
}

/** The things one mail prices: usually one, two when it quotes sea and air side by side. */
function partsOf(src: Source, today: string): { part: Part; option: Option | null }[] {
  const text = src.text;
  const tokens = withoutTwins(src.tokens);
  const proofFor = (sentence: string) => proofOf(src.mail, today, sentence);
  const lineStart = (index: number) => (index > 0 ? text.lastIndexOf("\n", index - 1) + 1 : 0);
  const starts: MoneyToken[] = [];
  const keys = new Set<string>();
  for (const t of tokens) {
    if (t.soft || !OFFER_MAIN.test(t.label ?? "")) continue;
    const key = optionOf(text, t).key;
    if (!keys.has(key)) {
      keys.add(key);
      starts.push(t);
    }
  }
  // A later line for the whole move that equals the one before it plus the charges between them adds them up
  // ("Door to port 2510", "Clearance 25", "Transport 150", then "Door to door charges : 2685"): it is no second
  // option, it names what the price covers.
  const sums = new Map<MoneyToken, MoneyToken>();
  for (let j = starts.length - 1; j >= 1; j--) {
    const first = starts[j - 1];
    const total = starts[j];
    const between = tokens.filter((t) => t.index > first.index && t.index < total.index && !t.soft && t.label != null && !isTotal(t) && !OFFER_MAIN.test(t.label));
    const sum = [first, ...between].reduce((n, t) => n + (t.currency === total.currency ? t.amount * (t.multiplier ?? 1) : NaN), 0);
    if (between.length && Math.abs(sum - total.amount) < 0.5) {
      sums.set(first, total);
      starts.splice(j, 1);
    }
  }
  const taken = new Set(tokens.map((t) => lineStart(t.index)));
  const build = (main: MoneyToken | null, from: number, to: number) => {
    const lines: Line[] = [];
    for (const t of tokens) {
      if (t.index < from || t.index >= to) continue;
      if (t === main) lines.push(lineOf(t, proofFor(t.sentence), true, t.allIn ? "All in" : "Offer"));
      else if (t.label != null && !isTotal(t) && !OFFER_MAIN.test(t.label)) lines.push(lineOf(t, proofFor(t.sentence), false, "Charge"));
    }
    lines.push(...softLines(text, from, to, taken, tokens, main?.currency ?? tokens[0]?.currency ?? "OMR", proofFor));
    const total = main ? sums.get(main) : undefined;
    return { part: { src, main: lines.find((l) => l.main) ?? null, lines, sum: total?.amount ?? null }, option: main ? optionOf(text, total ?? main) : null };
  };
  if (starts.length <= 1) return [build(starts[0] ?? null, 0, text.length)];
  return starts.map((t, i) => build(t, i === 0 ? 0 : lineStart(t.index), i + 1 < starts.length ? lineStart(starts[i + 1].index) : text.length));
}

/** "Thursday, November 5, 2026 8:20 AM", "Wed, 04 Nov 2026 12:18:24 +04:00": the time in a quoted header (Oman clock without an offset). */
function headerTime(head: string): number | null {
  let m = /(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?(?:\s*([+-])(\d{2}):?(\d{2}))?/i.exec(head);
  let day = 0;
  let month = -1;
  let year = 0;
  let hour = 0;
  let minute = 0;
  let half = "";
  let offset = 240;
  if (m) {
    [day, month, year, hour, minute, half] = [Number(m[1]), monthOf(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), (m[6] ?? "").toLowerCase()];
    if (m[7]) offset = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  } else {
    m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(head);
    if (!m) return null;
    [month, day, year, hour, minute, half] = [monthOf(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), (m[6] ?? "").toLowerCase()];
  }
  if (month < 0 || hour > 23 || minute > 59) return null;
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  const t = Date.UTC(year, month, day, hour, minute) - offset * 60_000;
  return Number.isFinite(t) ? t : null;
}

/** Our offer as a customer's reply quotes it below their own words, when the quoted mail is ours and prices the job. */
function quotedOffer(mail: ReadMail): Source | null {
  const split = splitBody(typeof mail.email?.body_text === "string" ? mail.email.body_text : "");
  let history = split.earlier;
  if (!history) {
    const m = QUOTE_START.exec(split.text);
    history = m ? split.text.slice(m.index) : "";
  }
  history = history.replace(/\r\n?/g, "\n").replace(/^[ \t]*>+ ?/gm, "").trim();
  if (!history) return null;
  const gap = history.search(/\n[ \t]*\n/);
  const headEnd = gap >= 0 && gap < 1200 ? gap : Math.max(0, history.indexOf("\n"));
  const head = history.slice(0, headEnd);
  const rest = history.slice(headEnd);
  const next = QUOTE_START.exec(rest);
  const text = cleanText({ body_text: next ? rest.slice(0, next.index) : rest, snippet: null });
  if (/@/.test(head) ? !OUR_ADDRESS.test(head) : !OUR_PRICE_LINE.test(text)) return null;
  const tokens = moneyTokens(text, { ourQuote: true });
  const firm = tokens.filter((t) => !t.soft);
  if (!firm.length || !(OUR_PRICE_LINE.test(text) || (OFFER_CUE.test(oneLine(text)) && firm.some((t) => t.amount >= 100)))) return null;
  const replied = timeOf(mail.at) ?? 0;
  const sent = headerTime(head);
  const at = new Date(sent != null && sent < replied ? sent : replied - 60_000).toISOString();
  const address = OUR_ADDRESS.exec(head)?.[0].toLowerCase() ?? null;
  const staff = staffOf(address);
  const written = /(?:^|\n)[ \t*_]*(?:From|De|Von|Da)\s*[:：]\*?\s*([^<\n[]{2,60}?)\s*(?:<|\[|\n|$)/i.exec(head)?.[1] ?? /\d{2}:\d{2}(?::\d{2})?(?:\s*[+-]\d{2}:?\d{2})?\s+([^<\n]{2,40}?)\s*</.exec(head)?.[1];
  const to = (/(?:^|\n)[ \t*_]*(?:To|À|An|A)\s*[:：][^\n]*/i.exec(head)?.[0].match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((a) => a.toLowerCase()).filter((a) => !OUR_ADDRESS.test(a));
  return {
    mail, text, tokens, at, quoted: true,
    from: { name: staff?.name ?? (written ? oneLine(written.replace(/["']/g, "")) : "Silver Lynx"), email: address, staff },
    to: to.length ? to : mail.from?.email ? [mail.from.email] : [],
  };
}

/** The mails that price the job for the customer, oldest first: ours, else ours as the customer's replies quote them. */
function offerSources(chron: ReadMail[]): Source[] {
  const own = chron
    .filter((m) => m.party === "us" && m.toParty === "customer" && m.moneyRole === "offer")
    .map((m): Source => ({ mail: m, text: m.clean, tokens: m.money, at: m.at, from: m.from, to: addressedTo(m), quoted: false }));
  if (own.length) return own;
  const quoted: Source[] = [];
  const seen = new Set<string>();
  for (const mail of chron) {
    if (mail.party !== "customer") continue;
    const src = attempt(() => quotedOffer(mail), null);
    const key = src ? oneLine(src.text).slice(0, 200) : "";
    if (!src || seen.has(key)) continue;
    seen.add(key);
    quoted.push(src);
  }
  return quoted.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The lines of one thing offered as they stand now: per label the newest firm amount, the main line first. */
function standingLines(draft: Draft): Line[] {
  const byLabel = new Map<string, Line>();
  for (const part of draft.parts) {
    for (const line of part.lines) {
      const key = line.main ? "main" : `${line.label.toLowerCase()}|${line.unit ?? ""}`;
      const known = byLabel.get(key);
      if (line.soft && known && !known.soft) continue;
      byLabel.set(key, known && !line.main ? { ...line, main: false } : line);
    }
  }
  const lines = [...byLabel.values()];
  return [...lines.filter((l) => l.main), ...lines.filter((l) => !l.main && !l.soft), ...lines.filter((l) => !l.main && l.soft)];
}

/** The newest mail of a draft that states something, read by the given reader. */
function newestStating<T>(draft: Draft, read: (src: Source) => T | null): T | null {
  for (let i = draft.parts.length - 1; i >= 0; i--) {
    const found = attempt(() => read(draft.parts[i].src), null);
    if (found != null) return found;
  }
  return null;
}

const ROUTING = /^[ \t•*-]*(?:routing|route|via)\s*[:：-]\s*([^\n]{2,60})$/im;
const SHIP_DATES = new RegExp(SHIP_DATE.source, "gi");

function offerState(chron: ReadMail[], units: number | null): OfferState {
  const today = todayOf(chron);
  const sources = offerSources(chron);
  const drafts: Draft[] = [];
  let last: Draft | null = null;
  for (const src of sources) {
    for (const { part, option } of partsOf(src, today)) {
      let opt = option;
      if (!part.main) {
        if (last) {
          if (part.lines.length) last.parts.push(part);
          continue;
        }
        // No line prices the whole move: the largest firm amount is the offer.
        const top = pickMain(withoutTwins(src.tokens));
        if (!top) continue;
        const line = lineOf(top, proofOf(src.mail, today, top.sentence), true, top.allIn ? "All in" : "Offer");
        part.lines = [line, ...part.lines.filter((l) => l.index !== top.index)];
        part.main = line;
        opt = optionOf(src.text, top);
      }
      if (!opt) continue;
      const same = (d: Draft) => d.name === opt.name && d.unit === (part.main?.unit ?? null);
      let draft = drafts.find((d) => d.key === opt.key) ?? [...drafts].reverse().find((d) => same(d) && (!d.mode || !opt.mode));
      if (!draft) drafts.push((draft = { key: opt.key, mode: opt.mode, name: opt.name, unit: part.main?.unit ?? null, parts: [] }));
      draft.mode ??= opt.mode;
      draft.parts.push(part);
      last = draft;
    }
  }
  if (!drafts.length) return { offer: null, drafts, amounts: new Map() };

  const priced = (d: Draft) => d.parts.filter((p) => p.main);
  /** The lines of an option multiplied out: by the count the offer itself states ("UNIT : 1X40 HC"), else the register's. */
  const sumOf = (d: Draft) => {
    const lines = standingLines(d);
    const size = boxSize(lines[0]?.unit ?? null);
    const count = newestStating(d, (s) => statedCount(s.text, size)) ?? units;
    const basis = newestStating(d, (s) => basisOf(joinValues(s.text)));
    return { lines, basis, count, sum: sumLines(lines, basis, count).total };
  };
  /** What an option's total waits for: each basis a firm line needs and the e-mails do not give, once. */
  const missingOf = (d: Draft): Missing[] => {
    const { lines, basis, count } = sumOf(d);
    const out: Missing[] = [];
    for (const line of lines) {
      if (line.soft || line.amount == null) continue;
      const q = quantityFor(line.unit, basis, count);
      if (q.times == null && q.missing && !out.includes(q.missing)) out.push(q.missing);
    }
    return out;
  };
  /** The whole shipment's price; with the number of boxes unknown, one box and the charges beside it; else the main line. */
  const totalOf = (d: Draft) => {
    const { lines, basis, sum } = sumOf(d);
    const perBox = /^\/(?:\d+x)?(?:20|40|45|cntr|teu|feu)/.test(lines[0]?.unit ?? "");
    return sum ?? (perBox ? sumLines(lines, basis, 1).total : null) ?? lines[0]?.amount ?? 0;
  };

  // Every figure we offered, with the time it was first written: what a customer may repeat.
  const amounts = new Map<string, number>();
  const note = (currency: Currency, amount: number | null, at: string) => {
    const t = timeOf(at);
    if (amount == null || t == null) return;
    const key = `${currency}|${amount}`;
    if (!amounts.has(key) || (amounts.get(key) ?? 0) > t) amounts.set(key, t);
  };
  for (const d of drafts) {
    for (const p of d.parts) for (const l of p.lines) if (!l.soft) note(l.currency, l.amount, p.src.at);
    const newest = d.parts[d.parts.length - 1];
    note(standingLines(d)[0]?.currency ?? "OMR", totalOf(d), newest.src.at);
  }

  // The option the customer accepted, else the one priced last.
  let accepted: { draft: Draft; proof: Proof } | null = null;
  for (let i = chron.length - 1; i >= 0 && !accepted; i--) {
    const mail = chron[i];
    if (mail.party !== "customer" || mail.siblingHint) continue;
    const yes = yesSentenceOf(mail.clean);
    if (!yes) continue;
    const said = new Set(mail.money.filter((t) => !isQuestion(t)).map(amountKey));
    const hit = [...drafts].reverse().find((d) => {
      const lines = standingLines(d);
      const first = priced(d)[0];
      return !!first && first.src.at < mail.at && (said.has(`${lines[0].currency}|${totalOf(d)}`) || lines.some((l) => !l.soft && l.amount != null && said.has(amountKey({ currency: l.currency, amount: l.amount }))));
    });
    if (hit) accepted = { draft: hit, proof: proofOf(mail, today, yes) };
  }
  const newestAt = (d: Draft) => priced(d)[priced(d).length - 1]?.src.at ?? "";
  const current = accepted?.draft ?? drafts.reduce((best, d) => (newestAt(d) >= newestAt(best) ? d : best), drafts[0]);

  const lines = standingLines(current);
  const main = lines[0];
  const mains = priced(current);
  const head = mains[mains.length - 1];
  const basis = newestStating(current, (s) => basisOf(joinValues(s.text)));
  const validity = newestStating(current, (s) => validityOf(joinValues(s.text), s.at, true));
  const stated = !!validity && !validity.none && !validity.boilerplate;
  const total = totalOf(current);
  const firmLines = lines.filter((l) => !l.soft && l.amount != null);
  const { sum, count } = sumOf(current);

  // Each earlier amount keeps the currency it was written in: "USD 1000", then "OMR 370", is no drop from 1,000.
  const earlier: Offer["earlier"] = [];
  const sameFigure = (a: { amount: number | null; currency: Currency }, b: { amount: number | null; currency: Currency } | undefined) =>
    !!b && a.amount === b.amount && a.currency === b.currency;
  for (const { main: was } of mains.slice(0, -1)) {
    if (!was || was.amount == null) continue;
    const figure = { amount: was.amount, currency: was.currency, unit: was.unit, proof: was.proof };
    if (!sameFigure(figure, earlier[earlier.length - 1])) earlier.push(figure);
  }
  while (earlier.length && sameFigure(main, earlier[earlier.length - 1])) earlier.pop();

  const modes = new Set(drafts.map((d) => d.mode ?? ""));
  const names = new Set(drafts.map((d) => d.name));
  const labelOfDraft = (d: Draft) =>
    (modes.size === drafts.length && !modes.has("") ? modeWord(d.mode) : names.size === drafts.length ? d.name : [modeWord(d.mode), d.name, d.unit].filter(Boolean).join(" ")) || "offer";

  const scope = /\b(?:door|port|airport)\s?to\b/.test(current.name) ? current.name : modeWord(current.mode);
  const offer: Offer = {
    lines: lines.map(plain),
    total, currency: main.currency,
    whole: sum != null,
    missing: sum != null ? [] : missingOf(current),
    count: firmLines.some((l) => PER_BOX.test(l.unit ?? "")) ? count : null,
    twin: twinOf(total, main.currency),
    linesText: firmLines.map((l) => `${fmt(l.amount ?? 0)}${l.unit ?? ""} ${lowerFirst(l.label)}`.trim()).join(" + "),
    scope,
    final: FINAL.test(head.src.text), revised: REVISED.test(head.src.text),
    basis,
    transit: newestStating(current, (s) => transitOf(joinValues(s.text))),
    freeDays: newestStating(current, (s) => freeDaysOf(joinValues(s.text))),
    etd: newestStating(current, (s) => {
      // A pasted table pads the label: "ETD                    : 18 NOV".
      for (const m of joinValues(s.text).replace(/[ \t]{2,}/g, " ").matchAll(SHIP_DATES)) if (/^etd$/i.test(m[1])) return oneLine(m[2]);
      return null;
    }),
    routing: newestStating(current, (s) => {
      const m = ROUTING.exec(joinValues(s.text));
      return m ? oneLine(m[1]) : null;
    }),
    validUntil: stated ? (validity?.until ?? null) : null,
    validityStated: stated,
    sentAt: head.src.at, sentBy: head.src.from, sentTo: head.src.to,
    proof: main.proof,
    earlier,
    options: drafts.map((d) => {
      const first = standingLines(d)[0];
      return {
        label: labelOfDraft(d), total: totalOf(d), currency: first.currency, proof: first.proof, current: d === current,
        whole: sumOf(d).sum != null, rate: { amount: first.amount ?? 0, unit: first.unit },
      };
    }),
    acceptedBy: accepted && accepted.draft === current ? accepted.proof : null,
    fromQuotedHistory: head.src.quoted,
  };
  return { offer, drafts, amounts };
}

/**
 * What we offered the customer: the option priced last (or the one they accepted) with its lines, total, riders,
 * earlier amounts and the other options. Read from our own mails; from the customer's quoted history when ours are
 * not filed. Null when no mail prices the job.
 */
export function readOffer(mails: ReadMail[], row: EnquiryRow): Offer | null {
  return attempt(() => offerState(inScope(mails), row?.units ?? null).offer, null);
}

/**
 * Whether the offer's total is for the whole shipment: every firm line multiplied out, as offerState worked it.
 * The main line alone never decides it: "OMR 500/40" for three boxes beside "OMR 0.050/KG" with no weight is no total.
 */
const offerIsWhole = (offer: Offer): boolean => offer.whole === true;

/** What a total waits for, as the words after "depends on". */
const DEPENDS_ON: Record<Missing, string> = {
  kg: "the weight",
  cbm: "the volume",
  containers: "the number of containers",
  packages: "the number of packages",
};

/**
 * What an offer's total waits for when it is not for the whole shipment: "the weight", "the number of containers and
 * the weight". "the quantities" when the offer does not say.
 */
export function offerDependsOn(offer: Pick<Offer, "missing"> | null | undefined): string {
  const words = (Array.isArray(offer?.missing) ? offer.missing : []).map((key) => DEPENDS_ON[key]).filter(Boolean);
  return words.length ? words.join(" and ") : "the quantities";
}

/**
 * The figure to show wherever one figure stands for our offer ("We sent …", "The e-mails say sell …", the Offer
 * cell): its total when that is for the whole shipment, else the main line's rate with its unit ("OMR 2.1/kg"). The
 * stand-in total of an offer that is not whole (one box and the charges beside it, the rate per kilo with the DO left
 * out) is never shown as a total.
 */
export function offerFigureOf(offer: Offer): OfferFigure {
  const whole = offerIsWhole(offer);
  const lines = Array.isArray(offer.lines) ? offer.lines.filter((l): l is PriceLine => !!l && typeof l.amount === "number") : [];
  const main = whole ? null : (lines.find((l) => l.main) ?? lines.find((l) => !l.soft) ?? null);
  const amount = main ? (main.amount as number) : offer.total;
  const currency = main?.currency ?? offer.currency;
  const unit = main?.unit ?? null;
  return { amount, currency, unit, whole, dependsOn: whole ? null : offerDependsOn(offer), text: moneyText(amount, currency, unit) };
}

// --- Agents' rates --------------------------------------------------------------------------------------------

const TOPIC =
  /dimensions?|dims?|weight|gr\.?\s*wt|cbm|volume|commodity|hs ?code|cargo ready|ready date|readiness|pick ?-?up address|collection address|zip ?code|postal code|incoterm|no\.? of (?:boxes|pallets|packages|pieces|pcs|cartons)|packing list|stackable|hazardous|dg\b|msds|second pick ?up/i;

/** One option of an agent's mail: from where its tokens count, the line that opens it, where the next one starts. */
interface Block { from: number; start: number; to: number; lineEnd: number; carrier: string | null }

/** Where each paragraph between two points of a text ends. */
function paragraphEnds(text: string, from: number, to: number): number[] {
  const ends: number[] = [];
  for (const m of text.slice(from, to).matchAll(/[^\S\n]*\S[^\n]*(?:\n[^\S\n]*\S[^\n]*)*/g)) ends.push(from + (m.index ?? 0) + m[0].length);
  return ends;
}

/** "Carrier : Air India", "Airline: Oman Air": a line that names the carrier of the rates under it. */
const CARRIER_NAMED = /^\s*[*•-]?\s*(?:carrier|air\s?line|shipping\s?line|liner?)(?:\s+name)?\s*[:：-]\s*\S/i;

/** The carrier a line opens an option for: "MSC : O/F …", "Carrier : OMAN AIR", or the name alone on its line as a pasted table has it. */
function carrierAt(line: string): string | null {
  const option = CARRIER_OPTION_LINE.exec(line);
  if (option) return carrierName(option[1]);
  if (CARRIER_ALONE.test(line.trim())) return carrierOf(line);
  if (!CARRIER_NAMED.test(line)) return null;
  return carrierOf(line) ?? (/[:：-]\s*NVOCC\s*$/i.test(line) ? "NVOCC" : null);
}

/** "Option1", "Option 2:": a heading over one option of an agent's mail. */
const OPTION_HEADING = /^\s*[*•-]?\s*opt(?:ion)?\.?\s*[-#:]?\s*\d{1,2}\b/i;

/** Where an agent's mail splits into options: one per "Option N" heading, else per carrier line, else per freight line when there are several. */
function blocksOf(text: string): Block[] {
  const lines: { at: number; end: number; text: string }[] = [];
  for (const m of text.matchAll(/[^\n]+/g)) lines.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] });
  const start = (l: { at: number; end: number }, carrier: string | null) => ({ at: l.at, lineEnd: l.end, carrier });
  const byHeading = lines.filter((l) => OPTION_HEADING.test(l.text)).map((l) => start(l, carrierAt(l.text)));
  const byCarrier = lines.flatMap((l) => {
    const carrier = carrierAt(l.text);
    return carrier ? [start(l, carrier)] : [];
  });
  const byLabel = lines.filter((l) => OPTION_SPLIT.test(l.text)).map((l) => start(l, null));
  const starts = byHeading.length >= 2 ? byHeading : byCarrier.length >= 2 ? byCarrier : byLabel.length >= 2 ? byLabel : [];
  if (!starts.length) return [{ from: 0, start: 0, to: text.length, lineEnd: text.length, carrier: byCarrier[0]?.carrier ?? null }];
  return starts.map((s, i) => ({ from: i === 0 ? 0 : s.at, start: s.at, to: i + 1 < starts.length ? starts[i + 1].at : text.length, lineEnd: s.lineEnd, carrier: s.carrier }));
}

function declinedOption(mail: ReadMail, today: string, text: string, carrier: string | null, currency: Currency): AgentOption | null {
  const no = AGENT_DECLINE.exec(text);
  if (!no) return null;
  const span = sentenceSpan(text, no.index, no.index + no[0].length);
  const proof = proofOf(mail, today, text.slice(span.start, span.end));
  const name = carrier ?? carrierOf(text);
  return {
    carrier: name,
    main: { label: name ?? "Declined", amount: null, currency, unit: null, soft: false, softText: null, main: true, proof },
    extras: [], total: null, transit: null, freeDays: null, allIn: false, declined: true, declinedText: oneLine(no[0]).toLowerCase(), proof,
  };
}

/** The options one mail of an agent prices: per carrier when it names several; a carrier with no space is a declined option. */
function optionsOf(mail: ReadMail, today: string, units: number | null, standing: PriceLine[]): AgentOption[] {
  const text = mail.clean;
  const tokens = withoutTwins(mail.money.filter((t) => !STANDING.has(t)));
  const basis = basisOf(text);
  const blocks = blocksOf(text);
  const several = blocks.length >= 2;
  const inBlock = (b: Block) => tokens.filter((t) => t.index >= b.from && t.index < b.to);
  const lastBlock = blocks[blocks.length - 1];
  const paragraphEnd = (b: Block) => {
    const gap = /\n[ \t]*\n/.exec(text.slice(b.lineEnd, b.to));
    return gap ? b.lineEnd + gap.index : b.to;
  };
  // Charges that apply to every option: those above the first one, and those under the list. The list ends after
  // the last carrier's line when each carrier takes one line; after as many paragraphs as each option before it
  // takes ("Option2", its rates, then "By ASYAD, … TT 35 days"); else after its first paragraph.
  let tailFrom = text.length;
  if (several) {
    const within = (end: (b: Block) => number) => blocks.slice(0, -1).every((b) => inBlock(b).every((t) => t.index < end(b)));
    const counts = new Set(blocks.slice(0, -1).map((b) => paragraphEnds(text, b.start, b.to).length));
    const span = counts.size === 1 ? [...counts][0] : 0;
    tailFrom = within((b) => b.lineEnd)
      ? lastBlock.lineEnd
      : span > 0
        ? (paragraphEnds(text, lastBlock.start, text.length)[span - 1] ?? text.length)
        : within(paragraphEnd)
          ? paragraphEnd(lastBlock)
          : text.length;
  }
  const isShared = (t: MoneyToken) => several && (t.index < blocks[0].start || t.index >= tailFrom);
  const shared = tokens.filter(isShared);
  const sharedText = several ? `${text.slice(0, blocks[0].start)}\n${text.slice(tailFrom)}` : "";
  const anyRate = tokens.some(isRateToken);
  const out: AgentOption[] = [];
  for (const block of blocks) {
    const own = inBlock(block).filter((t) => !isShared(t));
    const part = text.slice(block.start, block === lastBlock ? tailFrom : block.to);
    const rates = own.filter(isRateToken);
    if (!rates.length) {
      const declined = several || !anyRate ? declinedOption(mail, today, part, block.carrier, tokens[0]?.currency ?? "USD") : null;
      if (declined) out.push(declined);
      continue;
    }
    const mainToken = pickMain(rates) ?? rates[0];
    const summed = isTotal(mainToken);
    // The same charge for another size of box is another option: "USD 5600/20'DV USD 7200/40'HQ".
    const size = boxSize(mainToken.unit);
    const sizes = summed || !size ? [] : rates.filter((t) => t !== mainToken && !t.soft && (t.label == null || t.label === mainToken.label) && boxSize(t.unit) != null && boxSize(t.unit) !== size);
    // A total stands for the lines it adds up; under lines priced per box it is per box too.
    const beside = summed ? [] : own.filter((t) => t !== mainToken && !sizes.includes(t));
    const boxes = own.filter((t) => boxSize(t.unit) != null);
    const perBox = summed && !mainToken.unit && new Set(boxes.map((t) => unitKey(t.unit))).size === 1 ? boxes[0].unit : null;
    const priced = [...beside, ...shared].filter((t) => t.label != null || t.unit != null || chargeIn(t.sentence) != null);
    const extras = [...priced.map((t) => plain(lineOf(t, proofOf(mail, today, t.sentence), false, "Charge"))), ...standing];
    for (const token of [mainToken, ...sizes]) {
      const main = lineOf({ ...token, label: token.label ?? mainToken.label, unit: token.unit ?? perBox }, proofOf(mail, today, token.sentence), true, token.allIn ? "All in" : "Rate");
      out.push({
        carrier: block.carrier ?? carrierOf(part) ?? carrierOf(several ? sharedText : text),
        main: plain(main),
        extras,
        total: sumLines([main, ...extras], basis, statedCount(text, boxSize(main.unit)) ?? units).total,
        transit: transitOf(part) ?? (several ? transitOf(sharedText) : null),
        freeDays: freeDaysOf(part) ?? (several ? freeDaysOf(sharedText) : null),
        allIn: main.allIn || summed || ALL_IN.test(main.sentence),
        declined: false, declinedText: null, proof: main.proof,
      });
    }
  }
  return out;
}

/** What an option costs, for telling the cheaper from the dearer: its total, else its main line, in dollars. */
const costOf = (option: AgentOption): number => {
  const amount = option.total ?? option.main.amount;
  return option.declined || amount == null ? Infinity : toUsd(amount, option.main.currency);
};
const cheapest = (options: AgentOption[]): AgentOption | null =>
  options.filter((o) => !o.declined && o.main.amount != null).reduce<AgentOption | null>((best, o) => (!best || costOf(o) < costOf(best) ? o : best), null);
/** The cheapest option, among those for the register's size of box when an agent priced several sizes. */
function preferred(options: AgentOption[], row: Pick<EnquiryRow, "container_type" | "qty_text"> | null | undefined): AgentOption | null {
  const size = /(20|40|45)/.exec(`${row?.container_type ?? ""} ${row?.qty_text ?? ""}`)?.[1] ?? null;
  const sized = size ? options.filter((o) => boxSize(o.main.unit) === size) : [];
  return cheapest(sized.length ? sized : options);
}
/** What tells one option of an agent from another: the carrier and the size of box. */
const optionKey = (option: AgentOption): string => `${(option.carrier ?? "").toLowerCase()}|${boxSize(option.main.unit) ?? ""}`;

/** The fees an agent states in every mail, as lines that join each of their options once. */
function standingOf(sideMails: ReadMail[], today: string): PriceLine[] {
  const out: PriceLine[] = [];
  for (const mail of sideMails) {
    if (mail.party === "us") continue;
    for (const t of mail.money) if (STANDING.has(t)) out.push(plain(lineOf(t, proofOf(mail, today, t.sentence), false, "Fee")));
  }
  return out;
}

/** The standing wording cut from an agent's mail: where "quotations are valid for 7 calendar days" lives. */
function standingWording(mail: ReadMail): string {
  const body = typeof mail.email?.body_text === "string" && mail.email.body_text ? mail.email.body_text : (mail.email?.snippet ?? "");
  let text = splitBody(typeof body === "string" ? body : "").text.replace(/\r\n?/g, "\n");
  const leak = text.search(QUOTED_HEADER_LEAK);
  if (leak >= 0) text = text.slice(0, leak);
  return BOILERPLATE.exec(text)?.[0] ?? "";
}

/** "/40 OT HC" and "/40 OTHC" are the same box; "/20", "/20 GP" and "/20 DV" are the standard one. */
const unitKey = (unit: string | null): string =>
  (unit ?? "").toUpperCase().replace(/[^A-Z0-9/]/g, "").replace(/HQ$/, "HC").replace(/(?<=\d)(?:GP|DV|DC|ST|STD)$/, "");
/** Whether a main line covers the move from the supplier's door. */
const fromDoor = (label: string): boolean => /door\s?to|\bexw\b|ex-?works/i.test(label);

function summaryOf(q: AgentQuote, side: Side, today: string, at: { ack: string | null; question: ReadMail | null; paused: string | null; agreed: string | null }): string {
  const latest = q.latest;
  if (!latest) {
    const declined = q.options.find((o) => o.declined);
    if (q.state === "agreed" && at.agreed) return `Agreed by our e-mail of ${shortWhen(at.agreed, today)} · their rate is not on file`;
    if (q.state === "declined" && declined) return `Declined — "${declined.declinedText ?? "declined"}"`;
    if (q.state === "question" && q.question && at.question) {
      const topic = TOPIC.exec(q.question.sentence)?.[0].toLowerCase() ?? "a question";
      return `Asked a question — ${topic}, ${shortWhen(at.question.at, today)}, ${q.question.answered ? "answered" : "unanswered"}`;
    }
    if (q.state === "acknowledged" && at.ack) return `Acknowledged ${shortWhen(at.ack, today)} · no rate yet`;
    if (q.state === "paused" && at.paused) return `Paused by us ${shortWhen(at.paused, today)} · no rate on file`;
    return q.askedAt ? `Written to ${shortWhen(q.askedAt, today)} · ${side.lastFromThem ? "no rate yet" : "no reply on file"}` : "No rate yet";
  }
  const main = latest.main;
  const firm = latest.extras.filter((e) => !e.soft && e.amount != null);
  const plus = firm.length === 1 ? ` + ${firm[0].currency === main.currency ? "" : `${firm[0].currency} `}${fmt(firm[0].amount ?? 0)}${firm[0].unit ?? ""}` : firm.length > 1 ? ` + ${firm.length} small items` : "";
  const price = `${main.currency} ${[...q.earlier, main.amount ?? 0].map(fmt).join(" → ")}${main.unit ?? ""}${plus}`;
  const refused = q.options.find((o) => o.declined);
  return [
    price,
    q.state === "agreed" ? "agreed" : q.state === "paused" && at.paused ? `paused by us ${shortWhen(at.paused, today)}` : "",
    latest.carrier ?? "",
    latest.transit ? `TT ${latest.transit}` : "",
    latest.freeDays != null ? plural(latest.freeDays, "free day") : "",
    refused ? `${refused.carrier ? `${refused.carrier}: ` : ""}${refused.declinedText ?? "declined"}` : "",
    !q.validity ? "" : q.validity.none ? "no validity given" : `${q.validity.text}${q.validity.boilerplate ? " (their standard wording)" : ""}`,
  ].filter(Boolean).join(" · ");
}

/**
 * One quote per agent conversation that asked, acknowledged, questioned, priced or declined: their options (per
 * carrier, the newest of each), the latest one, earlier amounts, validity, and where they stand. The lowest main line
 * is marked only when every agent's rate has the same unit and covers the same move.
 */
export function readAgentRates(sides: Side[], mails: ReadMail[], row: EnquiryRow, now: string): AgentQuote[] {
  try {
    const nowMs = timeOf(now);
    const today = nowMs != null ? muscatDate(new Date(nowMs).toISOString()) : todayOf(inScope(mails));
    const clock = nowMs != null ? new Date(nowMs).toISOString() : (inScope(mails).pop()?.at ?? "");
    const quotes: AgentQuote[] = [];
    for (const side of Array.isArray(sides) ? sides : []) {
      if (!side || side.kind !== "agent") continue;
      const quote = attempt(() => quoteOf(side, row, today, clock), null);
      if (quote) quotes.push(quote);
    }
    const rated = quotes.filter((q) => q.latest && q.latest.main.amount != null && !q.latest.main.soft);
    const kind = (q: AgentQuote) => `${unitKey(q.latest?.main.unit ?? null)}|${fromDoor(q.latest?.main.label ?? "") ? "door" : ""}`;
    if (rated.length && new Set(rated.map(kind)).size === 1) {
      const omr = (q: AgentQuote) => toOmr(q.latest?.main.amount ?? 0, q.latest?.main.currency ?? "USD");
      rated.reduce((best, q) => (omr(q) < omr(best) ? q : best), rated[0]).lowestOnFile = true;
    }
    return quotes;
  } catch {
    return [];
  }
}

function quoteOf(side: Side, row: EnquiryRow, today: string, now: string): AgentQuote | null {
  const chron = inScope(side.mails);
  if (!chron.length) return null;
  const theirs = chron.filter((m) => m.party !== "us");
  const ours = chron.filter((m) => m.party === "us");
  // The mail that books the job lists the shipment again ("POL : … UNIT : …"): it asks for no rate.
  const requests = ours.filter((m) => m.moneyRole !== "agreed_buy" && (RATE_REQUEST.test(m.clean) || REQUEST_BLOCK.test(m.clean)));
  const rateMails = theirs.filter((m) => m.moneyRole === "agent_rate");
  const firstRate = rateMails[0] ?? null;
  const agreed = ours.find((m) => m.moneyRole === "agreed_buy") ?? null;
  const last = <T,>(list: T[], test: (item: T) => boolean): T | null => [...list].reverse().find(test) ?? null;
  const declineMail = last(theirs, (m) => AGENT_DECLINE.test(m.clean));
  const questionMail = theirs.find((m) => (!firstRate || m.at < firstRate.at) && AGENT_QUESTION.test(oneLine(m.clean)) && !yesSentenceOf(m.clean)) ?? null;
  const ackMail = last(theirs, (m) => AGENT_ACK.test(oneLine(m.clean)));
  const paused = side.pausedByUs ? (chron.find((m) => m.id === side.pausedByUs?.emailId)?.at ?? null) : null;

  const state: AgentState | null = side.pausedByUs
    ? "paused"
    : agreed
      ? "agreed"
      : rateMails.length
        ? "rated"
        : declineMail
          ? "declined"
          : questionMail
            ? "question"
            : ackMail
              ? "acknowledged"
              : requests.length
                ? "written_to"
                : null;
  if (!state) return null;

  // Per carrier and size of box the newest option; an amount it replaced is kept as earlier.
  const units = row?.units ?? null;
  const standing = standingOf(chron, today);
  const byCarrier = new Map<string, { option: AgentOption; earlier: number[] }>();
  /** The key each option of the newest rate mail is kept under; two options of one mail never share one. */
  const keys = new Map<AgentOption, string>();
  let newest: AgentOption[] = [];
  for (const mail of rateMails) {
    newest = optionsOf(mail, today, units, standing);
    const seen = new Map<string, number>();
    for (const option of newest) {
      const base = optionKey(option);
      const nth = seen.get(base) ?? 0;
      seen.set(base, nth + 1);
      const key = `${base}#${nth}`;
      keys.set(option, key);
      const known = byCarrier.get(key);
      const earlier = known?.earlier ?? [];
      const before = known?.option.main;
      if (before?.amount != null && option.main.amount != null && before.amount !== option.main.amount && before.currency === option.main.currency && before.unit === option.main.unit) {
        earlier.push(before.amount);
      }
      // A revised amount keeps the terms the earlier mail stated.
      if (known && !option.declined) {
        option.transit ??= known.option.transit;
        option.freeDays ??= known.option.freeDays;
      }
      byCarrier.set(key, { option, earlier });
    }
  }
  if (!rateMails.length && declineMail) {
    const declined = declinedOption(declineMail, today, declineMail.clean, null, "USD");
    if (declined) byCarrier.set(`${optionKey(declined)}#0`, { option: declined, earlier: [] });
  }
  const latest = preferred(newest, row);
  const options = [...byCarrier.values()].map((v) => v.option).sort((a, b) => costOf(a) - costOf(b));

  let validity: ValidityFact | null = null;
  for (let i = rateMails.length - 1; i >= 0 && !validity; i--) {
    const mail = rateMails[i];
    const wording = standingWording(mail);
    const read = validityOf(mail.clean, mail.at, true) ?? (wording ? validityOf(wording, mail.at, true) : null);
    if (!read) continue;
    const ended = !!read.until && !read.boilerplate && isDay(today) && read.until < today;
    validity = {
      who: side.name, until: read.until, daysLeft: read.until && isDay(today) ? daysBetween(today, read.until) : null, ended,
      none: read.none, boilerplate: read.boilerplate,
      text: read.none ? "no validity given" : read.until ? `${ended ? "ended" : "valid until"} ${dayWithWeekday(read.until, today || read.until)}` : read.text.toLowerCase(),
      proof: proofOf(mail, today, read.text),
    };
  }

  let question: Question | null = null;
  if (questionMail) {
    const asked = side.questions.filter((q) => q.proof.emailId === questionMail.id);
    question = asked.find((q) => AGENT_QUESTION.test(q.sentence)) ?? asked[0] ?? null;
    if (!question) {
      const sentence = sentencesOf(questionMail.clean).find((s) => AGENT_QUESTION.test(s)) ?? questionMail.excerpt;
      const answer = ours.find((m) => m.at > questionMail.at && m.kind === "substantive");
      question = {
        id: `q:${questionMail.id}:rate`, sentence: clip(sentence), proof: proofOf(questionMail, today, sentence), age: ageOf(questionMail.at, now),
        answered: !!answer, answeredText: answer ? `answered ${shortWhen(answer.at, today)}` : null,
      };
    }
  }

  const askedAt = requests[0]?.at ?? null;
  const replied = askedAt && firstRate ? ((timeOf(firstRate.at) ?? 0) - (timeOf(askedAt) ?? 0)) / HOUR : null;
  const quote: AgentQuote = {
    sideKey: side.key, name: side.name, domain: side.domain ?? side.key,
    state, askedAt, requestOnFile: requests.length > 0,
    options, latest, lowestOnFile: false,
    earlier: latest ? (byCarrier.get(keys.get(latest) ?? "")?.earlier ?? []) : [],
    validity,
    repliedInHours: replied != null && replied >= 0 ? Math.round(replied) : null,
    question,
    summary: "",
    lastAt: chron[chron.length - 1].at,
  };
  quote.summary = summaryOf(quote, side, today, { ack: ackMail?.at ?? null, question: questionMail, paused, agreed: agreed?.at ?? null });
  return quote;
}

/**
 * The agents line of the conversation: how many we asked and when, who replied, how many rates, the best on file,
 * what we asked for, and who has not written. When none of our requests is filed it says so instead of counting.
 */
export function agentsSummaryOf(sides: Side[], rates: AgentQuote[], today: string): AgentsSummary {
  const empty: AgentsSummary = { writtenTo: null, replied: 0, rates: 0, declined: 0, requestOnFile: false, noReplyOnFile: [], lowest: null, text: "" };
  try {
    const agents = (Array.isArray(sides) ? sides : []).filter((s) => s && s.kind === "agent");
    const quotes = Array.isArray(rates) ? rates : [];
    if (!agents.length && !quotes.length) return empty;
    const bySide = new Map(agents.map((s) => [s.key, s]));
    const asked = quotes.filter((q) => q.requestOnFile);
    const replied = agents.filter((s) => s.lastFromThem).length;
    const rateCount = quotes.filter((q) => q.latest && !q.latest.declined).length;
    const declined = quotes.filter((q) => q.state === "declined").length;
    const noReply = asked.filter((q) => !bySide.get(q.sideKey)?.lastFromThem).map((q) => q.sideKey);
    const lowest = quotes.find((q) => q.lowestOnFile) ?? null;
    const day = isDay(today) ? today : todayOf(inScope(agents.flatMap((s) => s.mails)));

    const seen = new Set<ReadMail>();
    for (const s of agents) for (const m of s.mails) seen.add(m);
    const target = readTargets([...seen]).find((t) => t.who === "us_to_agent" && t.amount != null);
    const best = lowest?.latest ? `best on file ${moneyText(lowest.latest.main.amount ?? 0, lowest.latest.main.currency, lowest.latest.main.unit)} (${lowest.name})` : "";
    const wanted = target?.amount != null ? `we asked for ${target.currency ? `${target.currency} ` : ""}${fmt(target.amount)}` : "";
    const firstAsk = asked.map((q) => q.askedAt).filter((at): at is string => !!at).sort()[0];

    const parts = asked.length
      ? [
          `Asked ${plural(asked.length, "agent")}${firstAsk ? ` ${shortWhen(firstAsk, day)}` : ""}`,
          replied ? `${replied} replied` : "",
          rateCount ? plural(rateCount, "rate") : "",
          declined ? `${declined} declined` : "",
          best,
          wanted,
          noReply.length ? `no written reply on file from ${noReply.length}` : "",
        ]
      : replied
        ? [`Replies on file from ${plural(replied, "agent")}`, rateCount ? plural(rateCount, "rate") : "", best, "our request is not in the mailbox (copy pricing@ when you ask agents)"]
        : [];
    return { writtenTo: asked.length || null, replied, rates: rateCount, declined, requestOnFile: asked.length > 0, noReplyOnFile: noReply, lowest, text: parts.filter(Boolean).join(" · ") };
  } catch {
    return empty;
  }
}

// --- The agreed buy, targets, the currency clash --------------------------------------------------------------

/** A line of the buy that pays for more than the freight: trucking, pick-up, the destination's charges. */
const BEYOND_FREIGHT = /truck|transport|haulage|inland|pick\s?-?up|deliver|door|\bexw\b|ex-?works|destinat|clearance|local|\bdo\b|d\/o|handling|\bcfs\b|\bthc\b/i;
/** A main line that names the freight and nothing else. */
const FREIGHT_ALONE = /(?:ocean|air|sea)\s?freight|\bo\/f\b|\ba\/f\b/i;
const AGREED_RATE = /\b(?:agreed|confirmed|final)\s+(?:rate|price|buy|buying)\b[^\n]{0,40}$/i;
/** The work in Oman an offer charges on its own lines: customs clearance, the truck to the door, the DO. */
const OMAN_WORK: RegExp[] = [/clearan|customs/i, /transport|truck|haulage|deliver(?!y order)|inland/i, /\bdo\b|d\/o|delivery order/i];

/**
 * Whether an offer charges firm lines for work the agent's lines do not cover ("Transportation to Ghala 150" beside
 * a buy that is the freight alone): what is left of the offer is then not a margin.
 */
function chargesBeyond(offer: Offer | null, lines: readonly PriceLine[]): boolean {
  const extras = (offer?.lines ?? []).filter((l) => !l.main && !l.soft && typeof l.amount === "number");
  return OMAN_WORK.some((kind) => extras.some((l) => kind.test(l.label)) && !lines.some((l) => !l.main && kind.test(l.label)));
}

/**
 * The buy we agreed with an agent: our "please proceed" or "agreed rate" to them, with the amounts of that mail when
 * it has any, else their latest option before it. Rates per container, kilo or cbm are multiplied out when the count
 * is known; without it the total stays open. Null when no agreement is on file.
 */
export function agreedBuy(mails: ReadMail[], rates: AgentQuote[], row: EnquiryRow, basis: Basis | null): Buy | null {
  try {
    const chron = inScope(mails);
    const today = todayOf(chron);
    let chosen: { mail: ReadMail; lines: PriceLine[]; allIn: boolean; rateMail: ReadMail | null } | null = null;
    for (const mail of chron) {
      if (mail.party !== "us" || mail.moneyRole !== "agreed_buy") continue;
      // The amounts our own mail agrees: priced lines, or a figure right after "agreed rate"; never a value or an invoice.
      const priced = withoutTwins(mail.money).filter(
        (t) =>
          !NOT_A_LABEL.test(t.sentence) &&
          !AGENT_RATE_EXCLUDE.test(t.sentence) &&
          (t.unit != null || t.label != null || chargeIn(t.sentence) != null || AGREED_RATE.test(mail.clean.slice(Math.max(0, t.index - 80), t.index))),
      );
      const mainToken = pickMain(priced);
      if (mainToken) {
        const main = lineOf(mainToken, proofOf(mail, today, mainToken.sentence), true, mainToken.allIn ? "All in" : "Agreed rate");
        const beside = isTotal(mainToken) ? [] : priced.filter((t) => t !== mainToken);
        chosen = { mail, lines: [plain(main), ...beside.map((t) => plain(lineOf(t, proofOf(mail, today, t.sentence), false, "Charge")))], allIn: main.allIn || isTotal(mainToken), rateMail: null };
        continue;
      }
      const sideMails = chron.filter((m) => m.sideKey === mail.sideKey);
      const rateMail = [...sideMails].reverse().find((m) => m.moneyRole === "agent_rate" && m.at < mail.at) ?? null;
      if (!rateMail) continue;
      // The same agreement said again ("Please proceed") changes nothing.
      if (chosen && chosen.mail.sideKey === mail.sideKey && (chosen.rateMail === rateMail || (!chosen.rateMail && chosen.mail.at > rateMail.at))) continue;
      const option = preferred(optionsOf(rateMail, today, row?.units ?? null, standingOf(sideMails, today)), row);
      if (option) chosen = { mail, lines: [option.main, ...option.extras], allIn: option.allIn, rateMail };
    }
    if (!chosen) return null;

    const { mail, lines } = chosen;
    const main = lines[0];
    const known = mergeBasis(basisOf(mail.clean), basis, chosen.rateMail ? basisOf(chosen.rateMail.clean) : null);
    // How many boxes: what the mail that agrees the rate says ("UNIT : 1X40 HC"), else the register, else the agent's mail.
    const size = boxSize(main.unit);
    const units = statedCount(mail.clean, size) ?? (row?.units && row.units > 0 ? row.units : chosen.rateMail ? statedCount(chosen.rateMail.clean, size) : null);
    const { total } = sumLines(lines, known, units);
    const offer = attempt(() => offerState(chron, row?.units ?? null).offer, null);
    // Freight only when the buy says so: a freight line, not all in, and no line for the door or the destination.
    const covers = chosen.allIn || !FREIGHT_ALONE.test(main.label) || fromDoor(main.label) || lines.some((l) => !l.main && BEYOND_FREIGHT.test(l.label));
    const sentence = agreementIn(mail.clean) ?? sentencesOf(mail.clean).find((s) => AGREED.test(s) || WON_OURS.test(s));
    return {
      agreed: true,
      agentName: (Array.isArray(rates) ? rates : []).find((r) => r.sideKey === mail.sideKey)?.name ?? nameOfSide(chron, mail.sideKey, today),
      sideKey: mail.sideKey,
      total, currency: main.currency,
      twin: total == null ? null : twinOf(total, main.currency),
      linesText: linesTextOf(lines, known, units),
      freightOnly: (/door/i.test(offer?.scope ?? "") && !covers) || chargesBeyond(offer, lines),
      proof: proofOf(mail, today, sentence),
    };
  } catch {
    return null;
  }
}

/**
 * Targets on file, newest first: the customer's ("Target rate- OMR 105"), the one we gave an agent ("customer TARGET
 * is USD 10500 ALL IN"), and "we don't have a target".
 */
export function readTargets(mails: ReadMail[]): Target[] {
  try {
    const chron = inScope(mails);
    const today = todayOf(chron);
    const out: Target[] = [];
    const seen = new Set<string>();
    for (let i = chron.length - 1; i >= 0; i--) {
      const mail = chron[i];
      const ours = mail.party === "us";
      if (ours ? mail.toParty !== "agent" : mail.party !== "customer") continue;
      const text = oneLine(mail.clean);
      const m = TARGET.exec(text);
      const no = m ? null : TARGET_NEG.exec(text);
      const hit = m ?? no;
      if (!hit) continue;
      const span = sentenceSpan(text, hit.index, hit.index + hit[0].length);
      const proof = proofOf(mail, today, text.slice(span.start, span.end));
      const agentName = ours ? nameOfSide(chron, mail.sideKey, today) : null;
      let amount: number | null = null;
      let currency: Currency | null = null;
      if (m) {
        // The currency stands before the figure or right after it: "TARGET is USD 10500", "target of 6000 USD".
        const end = m.index + m[0].length;
        const token = moneyTokens(text.slice(m.index, end + 6))[0];
        amount = token?.amount ?? (amountOf(/(\d[\d,.]*?)[.,]*$/.exec(m[0])?.[1] ?? "", "USD") || null);
        currency = token?.currency ?? null;
        if (amount == null) continue;
      }
      const key = `${ours ? agentName : "customer"}|${amount}|${currency}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const figure = amount == null ? "" : `${currency ? `${currency} ` : ""}${fmt(amount)}`;
      const allIn = !!m && /^\s*(?:(?:OMR|RO|USD|US\$|EUR)\s*)?all[\s-]?in\b/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 18));
      out.push({
        who: ours ? "us_to_agent" : "customer", amount, currency, none: !m, agentName,
        text: !m
          ? ours ? `We told ${agentName} there is no target` : "The customer has no target"
          : ours ? `We asked ${agentName} for ${figure}${allIn ? " all in" : ""}` : `The customer's target: ${figure} (${dayWithWeekday(mail.day, today || mail.day)})`,
        proof,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** The same amount under two currencies: an agent's rate, and our mail to that agent (or among ourselves) about it. */
export function currencyClash(mails: ReadMail[]): CurrencyClash | null {
  try {
    const chron = inScope(mails);
    const today = todayOf(chron);
    // Agents' rate lines by amount, oldest first; the newest time we wrote each amount in each currency to each side.
    const rates = new Map<number, { mail: ReadMail; token: MoneyToken }[]>();
    const lastWritten = new Map<string, string>();
    for (const m of chron) {
      for (const t of m.money) {
        if (m.party === "agent" && isRateToken(t)) {
          const list = rates.get(t.amount);
          if (list) list.push({ mail: m, token: t });
          else rates.set(t.amount, [{ mail: m, token: t }]);
        }
        if (m.party === "us") lastWritten.set(`${m.sideKey}|${t.currency}|${t.amount}`, m.at);
      }
    }
    for (let i = chron.length - 1; i >= 0; i--) {
      const ours = chron[i];
      if (ours.party !== "us" || (ours.toParty !== "agent" && ours.toParty !== "internal")) continue;
      for (const token of ours.money) {
        if (token.amount < 100) continue;
        const found = [...(rates.get(token.amount) ?? [])].reverse().find(({ mail: m }) => m.at < ours.at && (ours.toParty === "internal" || m.sideKey === ours.sideKey));
        if (!found || found.token.currency === token.currency) continue;
        const { mail: theirs, token: rate } = found;
        // Put right when we wrote the amount in their currency afterwards.
        if ((lastWritten.get(`${ours.sideKey}|${rate.currency}|${token.amount}`) ?? "") > ours.at) continue;
        return {
          amount: token.amount,
          currencies: [rate.currency, token.currency],
          text: `Two currencies for ${fmt(token.amount)}: ${sideNameFor(theirs, today)} wrote ${rate.currency}, we wrote ${token.currency}`,
          proofs: [proofOf(theirs, today, rate.sentence), proofOf(ours, today, token.sentence)],
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// --- Margin, trail, register, lane ----------------------------------------------------------------------------

/**
 * What is left of the offer after the agreed buy, as a figure only when both are on file for the whole shipment, the
 * buy covers what the offer covers and no currency is in doubt; then the register's own profit on a confirmed job.
 * Otherwise no figure, and why.
 */
export function marginOf(offer: Offer | null, buy: Buy | null, lowest: AgentQuote | null, row: EnquiryRow, clash: CurrencyClash | null): Margin {
  const none: Margin = { figure: null, inputs: null, why: "Needs an offer and an agreed buy", notes: [], clash: clash ?? null, source: "mail" };
  try {
    const units = row?.units ?? null;
    const whole = !!offer && offerIsWhole(offer);
    const shown: "OMR" | "USD" = offer?.currency === "OMR" ? "OMR" : "USD";
    const inShown = (amount: number, currency: Currency) => convert(amount, currency, shown);

    if (offer && whole && buy?.agreed && buy.total != null && !buy.freightOnly && !clash) {
      const sell = inShown(offer.total, offer.currency);
      const amount = offer.currency === buy.currency && offer.currency === shown ? offer.total - buy.total : sell - inShown(buy.total, buy.currency);
      const notes: string[] = [];
      const pair = [offer.currency, buy.currency];
      if (pair.includes("OMR") && pair.some((c) => c !== "OMR")) notes.push(`converted at ${USD_PER_OMR}`);
      for (const c of new Set(pair)) if (isApproximate(c)) notes.push(`${c} converted at about ${USD_PER[c]} — check`);
      const commission = parseCommission(row?.remarks);
      if (commission) {
        const paid = convert(commissionTotal(commission, units), currencyOf(commission.currency) ?? shown, shown);
        notes.push(`after commission ${shown} ${amount - paid < 0 ? "−" : ""}${rounded(Math.abs(amount - paid))}`);
      }
      return {
        figure: { amount: tidy(amount), currency: shown, pct: sell > 0 ? Math.round((amount / sell) * 100) : 0, negative: amount < 0, text: `about ${shown} ${amount < 0 ? "−" : ""}${rounded(Math.abs(amount))}` },
        inputs: `buy ${moneyText(buy.total, buy.currency)}, ${buy.agentName}, agreed ${plainWhen(buy.proof.when)}`,
        why: null, notes, clash: null, source: "mail",
      };
    }

    const sold = numeric(row?.sell_total);
    const bought = numeric(row?.buy_total);
    if (row?.status === "confirmed" && sold != null && bought != null) {
      const profit = numeric(row.profit) ?? sold - bought;
      const currency: "OMR" | "USD" = row.currency === "OMR" ? "OMR" : "USD";
      return {
        figure: { amount: profit, currency, pct: sold > 0 ? Math.round((profit / sold) * 100) : 0, negative: profit < 0, text: `${currency} ${profit < 0 ? "−" : ""}${rounded(Math.abs(profit))}` },
        inputs: `register: sell ${currency} ${fmt(sold)}, buy ${currency} ${fmt(bought)}`,
        why: null, notes: [], clash: clash ?? null, source: "register",
      };
    }

    let why = none.why;
    const main = offer?.lines.find((l) => l.main) ?? offer?.lines[0];
    if (clash) why = "Two currencies for the same amount: settle that before a margin";
    else if (!offer) why = buy ? "No offer is in the e-mails yet" : none.why;
    else if (!whole && main) why = `The offer is ${moneyText(main.amount ?? 0, main.currency, main.unit)} — ${MISSING_TEXT[offer.missing?.[0] ?? quantityFor(main.unit, offer.basis, units).missing ?? "kg"]}`;
    else if (buy?.agreed && buy.total == null) {
      const open = /× \? (kg|cbm|containers?|packages?)/.exec(buy.linesText)?.[1] ?? "kg";
      why = `${buy.linesText.split(" + ").find((part) => part.includes("× ?")) ?? buy.linesText} — ${MISSING_TEXT[open.startsWith("container") ? "containers" : open.startsWith("package") ? "packages" : open === "cbm" ? "cbm" : "kg"]}`;
    } else if (buy?.freightOnly) why = `The agreed buy covers freight only; the offer is ${offer.scope || "for more than the freight"}`;
    else if (lowest?.latest && !lowest.latest.declined && lowest.latest.main.amount != null) {
      const option = lowest.latest;
      const lines = [option.main, ...option.extras];
      const sum = option.total != null ? { total: option.total, missing: null } : sumLines(lines, offer.basis, units);
      // A freight rate against a door-to-door offer leaves our own door and destination costs out: no figure.
      const covers = option.allIn || !FREIGHT_ALONE.test(option.main.label) || fromDoor(option.main.label) || option.extras.some((l) => BEYOND_FREIGHT.test(l.label));
      if ((/door/i.test(offer.scope ?? "") && !covers) || chargesBeyond(offer, lines)) why = `${lowest.name}'s rate on file covers the freight only; the offer is ${offer.scope || "for more than the freight"}`;
      else if (sum.total != null) {
        const left = inShown(offer.total, offer.currency) - inShown(sum.total, option.main.currency);
        why = `about ${shown} ${left < 0 ? "−" : ""}${rounded(Math.abs(left))} if bought at ${moneyText(sum.total, option.main.currency)} (${lowest.name}, not agreed)`;
      } else why = `${linesTextOf([option.main], offer.basis, units)} — ${MISSING_TEXT[sum.missing ?? "kg"]}`;
    }
    return { ...none, why };
  } catch {
    return none;
  }
}

interface RawPoint { at: string; party: TrailPoint["party"]; role: TrailPoint["role"]; who: string; tail: string; amount: number | null; currency: Currency | null; unit: string | null; marked: boolean; proof: Proof; group: string }

/**
 * The figures in the order they were written: agents' rates, our offers, what we pushed an agent to, targets, a
 * customer's own figure, the yes with the total it accepts, and the agreed buy marked. A sentence sums it up only
 * when one thing was offered in one currency and one agent priced it in one currency.
 */
export function negotiationTrail(mails: ReadMail[], offer: Offer | null, buy: Buy | null): { points: TrailPoint[]; sentence: string | null } {
  try {
    const chron = inScope(mails);
    const today = todayOf(chron);
    const raw: RawPoint[] = [];
    const { drafts, amounts } = offerState(chron, null);
    const several = (offer?.options.length ?? 0) > 1;
    const names = new Map<string, string>();
    const nameFor = (sideKey: string): string => {
      if (!names.has(sideKey)) names.set(sideKey, nameOfSide(chron, sideKey, today));
      return names.get(sideKey) ?? sideKey;
    };
    // An agent who priced several sizes of box: the size we offered.
    const size = boxSize(offer?.lines.find((l) => l.main)?.unit ?? null);
    const rateOf = (options: AgentOption[]) => {
      const sized = size ? options.filter((o) => boxSize(o.main.unit) === size) : [];
      return cheapest(sized.length ? sized : options);
    };
    drafts.forEach((draft, i) => {
      for (const part of draft.parts) {
        const main = part.main;
        if (!main || main.amount == null) continue;
        // The total the mail writes under its lines is the figure the customer was given.
        raw.push({
          at: part.src.at, party: "us", role: "offer", who: "Offer", amount: part.sum ?? main.amount, currency: main.currency, unit: part.sum != null ? null : main.unit,
          tail: `${several && offer?.options[i] ? ` ${offer.options[i].label}` : ""}${FINAL.test(part.src.text) ? " · final" : ""}`,
          marked: false, proof: main.proof, group: draft.key,
        });
      }
    });
    const firstOffer = raw.map((p) => p.at).sort()[0] ?? null;
    const agreedMail = buy?.agreed ? (chron.find((m) => m.id === buy.proof.emailId) ?? null) : null;
    const targets = readTargets(chron);
    let yes = false;
    for (const mail of chron) {
      const point = (role: RawPoint["role"], who: string, token: Pick<MoneyToken, "amount" | "currency" | "unit" | "sentence"> | null, marked = false): RawPoint => ({
        at: mail.at, party: mail.party === "us" ? "us" : mail.party === "customer" ? "customer" : "agent", role, who, tail: "",
        amount: token?.amount ?? null, currency: token?.currency ?? null, unit: token?.unit ?? null, marked,
        proof: proofOf(mail, today, token?.sentence), group: mail.sideKey,
      });
      if (mail.party === "us") {
        const name = mail.toParty === "agent" ? nameFor(mail.sideKey) : "";
        const main = pickMain(withoutTwins(mail.money));
        if (mail.moneyRole === "push_to_agent" && main) raw.push(point("push_to_agent", `→ ${name}`, main));
        else if (mail.moneyRole === "target") {
          const target = targets.find((t) => t.proof.emailId === mail.id && t.amount != null);
          if (target) raw.push({ ...point("target", `→ ${name} target`, null), amount: target.amount, currency: target.currency, proof: target.proof });
        } else if (mail === agreedMail && main) raw.push(point("agreed_buy", name, main, true));
      } else if (mail.party === "customer") {
        if (mail.moneyRole === "target") {
          const target = targets.find((t) => t.proof.emailId === mail.id && t.amount != null);
          if (target) raw.push({ ...point("target", "Target", null), amount: target.amount, currency: target.currency, proof: target.proof });
        } else if (mail.moneyRole === "customer_counter") {
          const own = mail.money.find((t) => !isQuestion(t) && !t.soft);
          if (own) raw.push(point("customer_counter", "Counter", own));
        }
        // The first yes that is about our offer: one about another shipment names a figure we never offered.
        const said = !yes && offer && firstOffer && mail.at > firstOffer ? yesToOffer(mail, (key, at) => (amounts.get(key) ?? Infinity) < at) : null;
        if (said && offer) {
          yes = true;
          // A total that is not the whole shipment's is never shown as one: the yes carries the main line's rate.
          const figure = offerFigureOf(offer);
          raw.push({
            ...point("yes", "Yes", null, true), amount: figure.amount, currency: figure.currency, unit: figure.unit,
            proof: proofOf(mail, today, said),
          });
        }
      } else if (mail.moneyRole === "agent_rate") {
        const best = rateOf(optionsOf(mail, today, null, []));
        if (best?.main.amount != null) raw.push({ ...point("agent_rate", sideNameFor(mail, today), null), amount: best.main.amount, currency: best.main.currency, unit: best.main.unit, proof: best.proof });
      }
    }
    raw.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    // The agreed buy without figures of its own marks the agent's last rate before it.
    if (agreedMail && buy && !raw.some((p) => p.role === "agreed_buy")) {
      const rate = [...raw].reverse().find((p) => p.role === "agent_rate" && p.group === buy.sideKey && p.at < agreedMail.at);
      if (rate) rate.marked = true;
    }

    const mixed = new Set(raw.map((p) => p.currency).filter(Boolean)).size > 1;
    const points: TrailPoint[] = raw.map((p) => ({
      at: p.at, party: p.party, role: p.role,
      label: `${p.who}${p.amount == null ? "" : ` ${mixed && p.currency ? `${p.currency} ` : ""}${fmt(p.amount)}${p.unit ?? ""}`}${p.tail}`,
      amount: p.amount, currency: p.currency, unit: p.unit, marked: p.marked, proof: p.proof,
    }));

    const offers = raw.filter((p) => p.role === "offer");
    const buys = raw.filter((p) => p.role === "agent_rate" || p.role === "agreed_buy");
    const one = (list: RawPoint[]) => new Set(list.map((p) => `${p.group}|${p.currency}|${p.unit ?? ""}`)).size <= 1;
    let sentence: string | null = null;
    if (offers.length && one(offers) && one(buys)) {
      const moved = (list: RawPoint[], whom: string): string => {
        const delta = list.length >= 2 ? (list[list.length - 1].amount ?? 0) - (list[0].amount ?? 0) : 0;
        return delta ? `${delta < 0 ? "down" : "up"} ${list[0].currency} ${fmt(Math.abs(tidy(delta)))}${list[0].unit ?? ""} ${whom}` : "";
      };
      const agent = buys.find((p) => p.role === "agent_rate")?.who ?? buys[0]?.who ?? "";
      const customer = offers.length === 1 && yes ? "first offer accepted" : moved(offers, "for the customer");
      const parts = [customer, moved(buys, `from ${agent}`)].filter(Boolean);
      if (parts.length) sentence = `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.`;
    }
    return { points, sentence };
  } catch {
    return { points: [], sentence: null };
  }
}

/**
 * The register's rates against the e-mails: what to enter when the register is empty, a difference of more than 5%
 * on the sell or the buy (until put away), and a profit that looks like a typing slip. Suggestions only.
 */
export function registerMoneyOf(row: EnquiryRow, offer: Offer | null, buy: Buy | null, dismissed: string[]): RegisterMoney {
  const none: RegisterMoney = { hasRates: false, missingText: null, differs: null, slip: null, prefill: null };
  try {
    const sold = numeric(row?.sell_total);
    const bought = numeric(row?.buy_total);
    // The register's figures are in the row's own currency: compared in dollars, labelled as the register holds them.
    const regCur = currencyOf(row?.currency) ?? "USD";
    const soldUsd = sold == null ? null : Math.round(toUsd(sold, regCur));
    const boughtUsd = bought == null ? null : Math.round(toUsd(bought, regCur));
    const whole = !!offer && offerIsWhole(offer);
    const sellUsd = offer && whole ? Math.round(toUsd(offer.total, offer.currency)) : null;
    const buyUsd = buy?.total != null ? Math.round(toUsd(buy.total, buy.currency)) : null;
    const worked = (currency: Currency, usd: number) => (currency === "USD" ? "" : currency === "OMR" ? ` × ${USD_PER_OMR} = USD ${fmt(usd)}` : ` ≈ USD ${fmt(usd)}`);
    const about = (currency: Currency, usd: number) => (currency === "USD" ? "" : ` (≈ USD ${fmt(usd)})`);
    /** "USD 1,565", or "OMR 359 (≈ USD 933)" on a row kept in rials. */
    const inRegister = (amount: number | null, usd: number | null) => `${regCur} ${fmt(amount ?? 0)}${about(regCur, usd ?? 0)}`;

    const sellNote =
      offer && sellUsd != null
        ? `Sell ${moneyText(offer.total, offer.currency)}${worked(offer.currency, sellUsd)}, from ${offer.fromQuotedHistory ? "our offer as the customer quoted it" : `${offer.sentBy.name}'s e-mail of`} ${plainWhen(offer.proof.when)}`
        : "";
    const buyNote = buy && buy.total != null && buyUsd != null ? `Buy ${moneyText(buy.total, buy.currency)}${worked(buy.currency, buyUsd)}, agreed with ${buy.agentName}, ${plainWhen(buy.proof.when)}` : "";
    const agent = buy ? (agentNameForDomain(buy.sideKey) ?? buy.agentName.toUpperCase()) : null;

    let prefill: FormPrefill | null = null;
    if (sellUsd != null || buyUsd != null) {
      prefill = { notes: [sellNote, buyNote].filter(Boolean) };
      const replace: string[] = [];
      if (sellUsd != null) {
        prefill.sell_total = sellUsd;
        if (sold != null) replace.push("sell_total");
      }
      if (buyUsd != null) {
        prefill.buy_total = buyUsd;
        if (bought != null) replace.push("buy_total");
        if (agent && nameKey(agent) !== nameKey(row?.agent_name)) {
          prefill.agent_name = agent;
          if (row?.agent_name) replace.push("agent_name");
        }
      }
      if (offer && !offer.fromQuotedHistory && !row?.quoted_date && timeOf(offer.sentAt) != null) prefill.quoted_date = muscatDate(offer.sentAt);
      if (replace.length) prefill.replace = replace;
    }

    const missingText =
      sold == null && offer && sellUsd != null
        ? `Not entered. The e-mails say sell ${moneyText(offer.total, offer.currency)}${about(offer.currency, sellUsd)}${buy && buy.total != null && buyUsd != null ? `, buy ${moneyText(buy.total, buy.currency)}${about(buy.currency, buyUsd)}` : ""}.`
        : null;

    const off = (register: number | null, mail: number | null) => register != null && mail != null && mail > 0 && Math.abs(register - mail) / mail > 0.05;
    const parts: string[] = [];
    const fill: FormPrefill = { notes: [], replace: [] };
    if (offer && sellUsd != null && off(soldUsd, sellUsd)) {
      parts.push(`Register sell ${inRegister(sold, soldUsd)}; the e-mails say ${moneyText(offer.total, offer.currency)}${about(offer.currency, sellUsd)}`);
      fill.sell_total = sellUsd;
      fill.replace?.push("sell_total");
      fill.notes.push(sellNote);
    }
    if (buy && buy.total != null && buyUsd != null && off(boughtUsd, buyUsd)) {
      parts.push(`Register buy ${inRegister(bought, boughtUsd)}; agreed by e-mail ${moneyText(buy.total, buy.currency)}${about(buy.currency, buyUsd)} (${buy.agentName}, ${buy.proof.when.split(",")[0]})`);
      fill.buy_total = buyUsd;
      fill.replace?.push("buy_total");
      fill.notes.push(buyNote);
    }
    const dismissId = `rates:${row?.id ?? ""}:${fill.sell_total ?? ""}:${fill.buy_total ?? ""}`;
    const differs = parts.length && !(Array.isArray(dismissed) ? dismissed : []).includes(dismissId) ? { text: parts.join(" · "), prefill: fill, dismissId } : null;

    let slip: RegisterMoney["slip"] = null;
    const profit = numeric(row?.profit) ?? (sold != null && bought != null ? sold - bought : null);
    if (sold != null && sold > 0 && profit != null && (profit / sold > 0.6 || profit < 0)) {
      const share = `${Math.round((profit / sold) * 100)}% of the sell`;
      const text =
        profit < 0
          ? `Sell ${fmt(sold)} is under the buy${bought != null ? ` ${fmt(bought)}` : ""}: the profit is below zero`
          : bought != null
            ? `Buy ${fmt(bought)} on a sell of ${fmt(sold)} looks like a slip: the profit is ${share}`
            : `The profit is ${share}: check the buy`;
      slip = { text, prefill: buyUsd != null && buyUsd !== boughtUsd ? { buy_total: buyUsd, replace: ["buy_total"], notes: [buyNote] } : null };
    }
    return { hasRates: sold != null || bought != null, missingText, differs, slip, prefill };
  } catch {
    return none;
  }
}

/**
 * The usual profit on this route: the median over the confirmed jobs of the same mode that have a sell and a buy, and
 * the agent who carried most of them. Information only; null under three such jobs.
 */
export function laneBenchmark(rows: HistoryRow[], row: Pick<EnquiryRow, "id" | "shipment_mode">): LaneBenchmark | null {
  try {
    const wins = (Array.isArray(rows) ? rows : []).filter(
      (r) => !!r && r.id !== row?.id && r.status === "confirmed" && (!row?.shipment_mode || r.shipment_mode === row.shipment_mode) && (numeric(r.sell_total) ?? 0) > 0 && (numeric(r.buy_total) ?? 0) > 0,
    );
    if (wins.length < 3) return null;
    const profits = wins.map((r) => numeric(r.profit) ?? (numeric(r.sell_total) ?? 0) - (numeric(r.buy_total) ?? 0)).sort((a, b) => a - b);
    const mid = profits.length >> 1;
    const median = profits.length % 2 ? profits[mid] : (profits[mid - 1] + profits[mid]) / 2;
    const byAgent = new Map<string, { name: string; wins: number }>();
    for (const r of wins) {
      const key = nameKey(r.agent_name);
      if (!key) continue;
      const known = byAgent.get(key) ?? { name: displayName(r.agent_name), wins: 0 };
      known.wins++;
      byAgent.set(key, known);
    }
    const topAgent = [...byAgent.values()].reduce<{ name: string; wins: number } | null>((best, a) => (!best || a.wins > best.wins ? a : best), null);
    return {
      pricedWins: wins.length,
      usualProfitUsd: Math.round(median),
      topAgent,
      text: `Usual profit on this route: about USD ${rounded(median)} (from ${wins.length} priced wins)${topAgent ? ` · ${topAgent.name} won ${topAgent.wins} of them` : ""}`,
    };
  } catch {
    return null;
  }
}
