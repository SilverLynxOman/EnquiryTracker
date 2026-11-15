import { displayName, fmtDayMonth, shortPort, TRADE_LABELS } from "../display";
import { muscatDate, splitBody } from "../emailDrafts";
import { dayWithWeekday, emailDomain } from "../enquiryDetails";
import { parseHouseSubject, type HouseSubject } from "../houseSubject";
import { nameKey, parseQty } from "../normalize";
import type { EmailMessage, EnquiryRow, ShipmentMode } from "../types";
import { STAFF, USD_PER } from "./constants";
import {
  AGENT_BLOCK,
  APPROVAL,
  APPROVAL_ASK,
  BASIS,
  BETTER_RATE,
  BOILERPLATE,
  CARGO_ADDRESS,
  CARGO_COMMODITY,
  CARGO_DIMS,
  CARGO_HS,
  CARGO_INCOTERM,
  CARGO_PACKAGES,
  CARGO_READY,
  CARGO_STACK_DG,
  CARGO_VOLUME,
  CARGO_WEIGHT,
  EQUIPMENT_A,
  EQUIPMENT_B,
  GREETING,
  GREETING_NAME,
  LINK_WRAPPERS,
  LOOP_IN_NAME,
  NOT_YES,
  OUR_PRICE_LINE,
  PHONE_INTL,
  PHONE_LABELLED,
  QUOTED_HEADER_LEAK,
  RATE_REQUEST,
  REQUEST_BLOCK,
  ROLE_LOCAL,
  SHIPPER_BLOCK,
  SIG_COMPANY,
  SIG_DESIGNATION,
  SIG_NAME,
  SIG_SIGNOFF,
  SL_REF,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
  WECHAT,
  WHATSAPP_A,
  WHATSAPP_B,
  WHATSAPP_MULTI,
  WON_OURS,
  YES,
  YES_EXTRA,
} from "./patterns";
import { bounceAddressOf, isFreeMail, outsideRecipients, proofOf, sentencesOf, shortWhen, signatureTextOf, staffOf } from "./read";
import type {
  Buy,
  CargoCheck,
  CargoField,
  CargoKey,
  Contact,
  Currency,
  Drift,
  DriftKind,
  FormPrefill,
  Handler,
  Offer,
  Party,
  PeopleBlock,
  Person,
  Phone,
  Proof,
  ReadMail,
  Side,
  SideKind,
  StaffMember,
  WonCue,
} from "./types";

// The yes, the people, the cargo and the register's drift: who said yes and when, who is who on the e-mails (with
// what their signatures give), who on our side handles the enquiry, what is known about the cargo, and where the
// e-mails say something else than the register. Pure and synchronous; nothing here writes to the register.

const OUR_DOMAIN = "silverlynxoman.com";
const OUR_GMAIL = "silverlynxco@gmail.com";
const DAY = 24 * 3_600_000;

const lower = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
const timeOf = (ts: unknown): number => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const listOf = <T>(v: readonly (T | null | undefined)[] | null | undefined): T[] =>
  Array.isArray(v) ? v.filter((x): x is T => x != null && typeof x === "object") : [];
/** A copy of a pattern that finds every match. */
const every = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
/** A copy of a pattern without the global flag, safe for exec. */
const once = (re: RegExp) => new RegExp(re.source, re.flags.replace("g", ""));
const flat = (text: string) => text.replace(/[ \t]+/g, " ");
const isOurAddress = (a: string) => emailDomain(a) === OUR_DOMAIN || a === OUR_GMAIL;
/** Our company's name as contact blocks write it. */
const OUR_COMPANY = /\bsilver\s*lynx\b/i;
/** A phone number's last eight digits: the same number written with or without its country code. */
const phoneKey = (p: Phone): string => (p.digits || p.display || "").replace(/\D/g, "").slice(-8);
const localPart = (a: string) => a.slice(0, Math.max(0, a.lastIndexOf("@")));
const keyOfAddress = (a: string): string => {
  const d = emailDomain(a);
  return !d ? "" : isFreeMail(d) ? a : d;
};
const ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Non-breaking spaces, also written out as "&nbsp;". */
const SPACES = new RegExp(`&nbsp;|[${String.fromCharCode(0xa0, 0x2007, 0x202f)}]`, "gi");
/** Zero-width characters and the byte-order mark. */
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff)}]`, "g");

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
  const body = text.replace(/\s+/g, " ").trim();
  return body.length <= max ? body : `${body.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** The e-mails that feed the rules, oldest first. */
function scoped(mails: readonly ReadMail[] | null | undefined): ReadMail[] {
  return listOf(mails)
    .filter((m) => m.scope === "in")
    .sort((a, b) => timeOf(a.at) - timeOf(b.at));
}

/** The newest Oman day among the e-mails: what "Mon 14:12" is said against when no date is given. */
function todayOf(mails: readonly ReadMail[]): string {
  let day = "";
  for (const m of mails) if (typeof m?.day === "string" && m.day > day) day = m.day;
  return day;
}

/** Every address on a mail: sender, to, cc. */
function addressesOf(m: ReadMail): string[] {
  const out: string[] = [];
  for (const a of [m.email?.from_email, ...listAddresses(m.email?.to_emails), ...listAddresses(m.email?.cc_emails)]) {
    const x = lower(a);
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
}
const listAddresses = (v: unknown): string[] => (Array.isArray(v) ? v.filter((a): a is string => typeof a === "string") : []);

/** What the sender wrote, before any cleaning: the greeting and the signature are still in it. */
function rawNewText(email: Pick<EmailMessage, "body_text" | "snippet"> | null | undefined): string {
  const body = typeof email?.body_text === "string" && email.body_text ? email.body_text : email?.snippet;
  return splitBody(typeof body === "string" ? body : "")
    .text.replace(/\r\n?/g, "\n")
    .replace(SPACES, " ")
    .replace(INVISIBLE, "")
    .replace(/&amp;/gi, "&");
}

/** The new text with the address of each mailto link kept in place (contact blocks are read from it). */
function textWithAddresses(email: Pick<EmailMessage, "body_text" | "snippet"> | null | undefined): string {
  return rawNewText(email).replace(/<mailto:\s*([^>\s]+)\s*>/gi, " $1 ");
}

/** The sentence of a text that holds a phrase, or the text's first 200 characters. */
function sentenceWith(text: string, phrase: string): string {
  const want = phrase.replace(/\s+/g, " ").trim().toLowerCase();
  const hit = sentencesOf(text).find((s) => s.replace(/\s+/g, " ").toLowerCase().includes(want));
  return clip(hit ?? text);
}

const refKey = (reference: string | null | undefined): string => {
  const m = /SL\s?-?(\d{6})/i.exec(reference ?? "");
  return m ? `SL${m[1]}` : (reference ?? "").trim().toUpperCase();
};
function refsIn(subject: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (subject ?? "").matchAll(SL_REF)) if (!out.includes(`SL${m[1]}`)) out.push(`SL${m[1]}`);
  return out;
}

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

// --- Amounts (only to compare a customer's figures with our offer) ---------------------------------------------

interface Amount { amount: number; currency: Currency }

const CURRENCY_ALIAS: Record<string, Currency> = {
  OMR: "OMR", RO: "OMR", USD: "USD", US$: "USD", $: "USD", "€": "EUR", INR: "INR", RS: "INR", "₹": "INR", AED: "AED",
  GBP: "GBP", "£": "GBP", CNY: "CNY", RMB: "CNY", SEK: "SEK", ZAR: "ZAR", SAR: "SAR", QAR: "QAR",
};

function currencyOf(raw: string): Currency | null {
  const k = raw.trim().toUpperCase().replace(/\.$/, "");
  if (k.startsWith("EUR")) return "EUR";
  return Object.hasOwn(CURRENCY_ALIAS, k) ? CURRENCY_ALIAS[k] : null;
}

/** "1,225" → 1225; "359.000" in rials → 359; "13.700" in dollars → 13700; "8.995,50" → 8995.5. */
function amountOf(raw: string, currency: Currency): number {
  let s = raw.trim();
  if (currency === "OMR" && /^\d+\.\d{3}$/.test(s)) return Number.parseFloat(s);
  if (/^\d{1,3}(?:[ ,]\d{3})+(?:\.\d{1,3})?$/.test(s)) s = s.replace(/[ ,]/g, "");
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,(\d{1,2})$/, ".$1").replace(/[ ,]/g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** A figure given as an estimate: "approx. OMR 44". */
const ROUGHLY = /\b(?:approx\.?|appx\.?|about|around|estimated|est\.?|roughly)\s*$/i;
const roughAt = (text: string, index: number) => index >= 0 && ROUGHLY.test(text.slice(Math.max(0, index - 30), index));

/** Every amount in a text with its currency; firmOnly leaves out estimates. */
function amountsIn(text: string, firmOnly = false): Amount[] {
  const out: Amount[] = [];
  const push = (cur: string, raw: string, index: number) => {
    const currency = currencyOf(cur);
    if (!currency || (firmOnly && roughAt(text, index))) return;
    const amount = amountOf(raw, currency);
    if (amount > 0) out.push({ amount, currency });
  };
  for (const m of text.matchAll(TOKEN_A)) push(m[1], m[2], m.index);
  for (const m of text.matchAll(TOKEN_B)) push(m[1], m[2], m.index);
  for (const m of text.matchAll(TOKEN_C)) push(m[2], m[1], m.index);
  return out;
}

/** The amounts of a mail: the money reading when it ran, else read from its text. firmOnly leaves out estimates. */
function mailAmounts(mail: ReadMail, firmOnly = false): Amount[] {
  const money = listOf(mail.money);
  const text = typeof mail.clean === "string" ? mail.clean : "";
  if (money.length) return money.filter((t) => t.amount > 0 && !(firmOnly && roughAt(text, t.index))).map((t) => ({ amount: t.amount, currency: t.currency }));
  return amountsIn(text, firmOnly);
}

/** Every figure of our offer: its lines, its total, its other options and its earlier amounts. */
function offerAmounts(offer: Offer): Amount[] {
  const out: Amount[] = [];
  for (const line of listOf(offer.lines)) if (typeof line.amount === "number") out.push({ amount: line.amount, currency: line.currency ?? offer.currency });
  if (typeof offer.total === "number") out.push({ amount: offer.total, currency: offer.currency });
  for (const option of listOf(offer.options)) if (typeof option.total === "number") out.push({ amount: option.total, currency: option.currency ?? offer.currency });
  for (const earlier of listOf(offer.earlier)) if (typeof earlier.amount === "number") out.push({ amount: earlier.amount, currency: earlier.currency ?? offer.currency });
  return out;
}

/** The same figure, in its own currency or converted (within 1%). */
function sameAmount(a: Amount, b: Amount): boolean {
  if (Math.abs(a.amount - b.amount) < 0.01) return true;
  if (a.currency === b.currency || !USD_PER[a.currency] || !USD_PER[b.currency] || b.amount <= 0) return false;
  return Math.abs((a.amount * USD_PER[a.currency]) / USD_PER[b.currency] - b.amount) <= 0.01 * b.amount;
}

// --- Yes and won (C.3.9) --------------------------------------------------------------------------------------

const NOT_OPEN = new Set(["confirmed", "lost", "cancelled", "not_genuine"]);
/** Our mailboxes whose words never mean the job was won: accounts write about money already owed. */
const NOT_A_WIN_SENDER = new Set(["accounts", "accountsreceivable", "finance"]);

/** The sentence in which a customer accepts, or null: the yes words without a condition or a question. */
function yesSentence(clean: string): string | null {
  for (const s of sentencesOf(clean)) {
    if ((YES.some((re) => re.test(s)) || YES_EXTRA.test(s)) && !NOT_YES.test(s)) return s;
  }
  return null;
}

/** A short line that approves ("Approved", "OK to proceed"), or null. */
function approvalLine(clean: string): string | null {
  const m = APPROVAL.exec(clean);
  if (!m) return null;
  const line = m[0].trim();
  return NOT_YES.test(line) ? null : line;
}

/** The first moment our offer was on file: its mail, or an earlier option or amount of it. */
function offerStart(offer: Offer | null, byId: Map<string, ReadMail>): number | null {
  if (!offer) return null;
  const times = [timeOf(offer.sentAt)];
  for (const e of [...listOf(offer.earlier), ...listOf(offer.options)]) times.push(timeOf(byId.get(e.proof?.emailId ?? "")?.at));
  const known = times.filter((t) => t > 0);
  return known.length ? Math.min(...known) : null;
}

/** An agent's mail with a price in it: the money reading's rate, else any amount when the money reading has not run. */
const isRate = (m: ReadMail) => m.moneyRole === "agent_rate" || (m.moneyRole == null && mailAmounts(m).length > 0);

/** The conversations a mail of ours went to: its own and each outside recipient's. */
function sideKeysOf(m: ReadMail): string[] {
  const keys = [m.sideKey];
  for (const a of outsideRecipients(m.email)) {
    const key = keyOfAddress(a);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * Yes and won signals, gated on party and status (C.3.9). Empty once the register says confirmed, lost, cancelled
 * or not genuine. The customer's yes counts from our offer (else the quoted date, else the enquiry date); our own
 * cues are "please proceed this shipment" to an agent after its rate, "thank you for the confirmation" to the
 * customer, and our agent's details sent on.
 */
export function wonCues(mails: ReadMail[], row: EnquiryRow, offer: Offer | null): WonCue[] {
  try {
    if (!row || NOT_OPEN.has(row.status)) return [];
    const list = scoped(mails);
    if (!list.length) return [];
    const today = todayOf(list);
    const byId = new Map(list.map((m) => [m.id, m]));
    const start = offerStart(offer, byId);
    const startDay = start == null ? (row.quoted_date || row.enquiry_date || "") : "";
    const afterOffer = (m: ReadMail) => (start != null ? timeOf(m.at) >= start : !startDay || m.day >= startDay);
    const known = offer ? offerAmounts(offer) : [];

    const firstRate = new Map<string, number>();
    const asks: { address: string; domain: string; t: number }[] = [];
    const cues: WonCue[] = [];
    const cue = (kind: WonCue["kind"], m: ReadMail, sentence: string, extra: Partial<WonCue> = {}) =>
      cues.push({ kind, day: m.day, betterRate: false, amountMismatch: false, proof: proofOf(m, today, sentence), ...extra });

    for (const m of list) {
      const t = timeOf(m.at);
      const clean = typeof m.clean === "string" ? m.clean : "";
      if (m.party === "agent" || m.party === "carrier") {
        if (!firstRate.has(m.sideKey) && isRate(m)) firstRate.set(m.sideKey, t);
        continue;
      }
      if (m.party === "customer") {
        const address = lower(m.from?.email);
        const domain = emailDomain(address) ?? "";
        if (APPROVAL_ASK.test(clean)) asks.push({ address, domain, t });
        if (m.siblingHint || !afterOffer(m)) continue;
        const colleagueAsked = !!domain && !isFreeMail(domain) && asks.some((a) => a.t < t && a.domain === domain && a.address !== address);
        const said = yesSentence(clean) ?? (colleagueAsked ? approvalLine(clean) : null);
        if (!said) continue;
        // An estimate they repeat ("approx. OMR 44" for a charge at actuals) is not a figure of their own.
        const amounts = known.length ? mailAmounts(m, true) : [];
        cue("customer_yes", m, said, {
          betterRate: BETTER_RATE.test(flat(clean)),
          amountMismatch: amounts.some((a) => !known.some((k) => sameAmount(a, k))),
        });
        continue;
      }
      if (m.party !== "us" || !m.toParty || m.toParty === "internal") continue;
      const sender = m.from?.staff?.mailbox ?? localPart(lower(m.from?.email));
      if (NOT_A_WIN_SENDER.has(sender)) continue;
      const hits = [...clean.matchAll(every(WON_OURS))].map((h) => h[0].trim());
      if (m.toParty === "agent") {
        const confirm = hits.find((h) => !/thank/i.test(h));
        if (!confirm || !sideKeysOf(m).some((k) => (firstRate.get(k) ?? Infinity) < t)) continue;
        const sentence = sentenceWith(clean, confirm);
        if (!NOT_YES.test(sentence)) cue("confirmed_to_agent", m, sentence);
        continue;
      }
      const thanks = hits.find((h) => /thank/i.test(h));
      if (thanks && m.toParty === "customer") cue("thanks_for_confirmation", m, sentenceWith(clean, thanks));
      const block = AGENT_BLOCK.exec(clean);
      if (block) cue("agent_details_sent", m, sentenceWith(clean, block[0]));
    }
    return cues;
  } catch {
    return [];
  }
}

/** The day to record a win on: the customer's yes when there is one, else the earliest of our own cues. */
export function wonDay(won: WonCue[]): string | null {
  const cues = listOf(won);
  const yes = cues.find((c) => c.kind === "customer_yes" && c.day);
  if (yes) return yes.day;
  return (
    cues
      .map((c) => c.day)
      .filter((d): d is string => typeof d === "string" && !!d)
      .sort()[0] ?? null
  );
}

/** A customer's yes words on a confirmed job: they approve a step (collection, a draft, a charge), the cue "Approves". */
export function approvesAfterConfirmation(mail: ReadMail): boolean {
  try {
    if (!mail || mail.scope !== "in" || mail.party !== "customer") return false;
    const clean = typeof mail.clean === "string" ? mail.clean : "";
    return !!yesSentence(clean) || !!approvalLine(clean);
  } catch {
    return false;
  }
}

// --- Phones, WhatsApp and WeChat ------------------------------------------------------------------------------

/** Countries whose numbers are written with a trunk 0 after the country code ("+86-0574-…"). */
const TRUNK_ZERO = ["86", "91", "44", "49", "90", "20", "27"];

/** Digits with the country code for tel: and wa.me, or "" when the country cannot be known. */
function digitsOf(display: string): string {
  const intl = /^(?:\+|00)/.test(display);
  let d = display.replace(/\(0\)/g, "").replace(/\D/g, "");
  if (display.startsWith("00")) d = d.slice(2);
  if (intl) {
    const cc = TRUNK_ZERO.find((c) => d.startsWith(`${c}0`));
    if (cc) d = cc + d.slice(cc.length + 1);
    return d.length >= 8 && d.length <= 15 ? d : "";
  }
  if (/^(?:968)?[279]\d{7}$/.test(d)) return d.length === 8 ? `968${d}` : d;
  if (/^1[3-9]\d{9}$/.test(d)) return `86${d}`;
  return "";
}

const MOBILE_LABEL = /^(?:mob(?:ile)?|cell|hp|handphone|gsm|m|c)$/i;

function phoneLabel(raw: string): Phone["label"] {
  const l = raw.trim().toLowerCase();
  if (MOBILE_LABEL.test(l)) return "mobile";
  if (l === "fax") return "fax";
  if (l === "phone" || l === "ph") return "phone";
  return "office";
}

const WA_ME = /wa\.me\/\+?(\d{8,15})/gi;

/** Numbers and a WeChat id read from a block of text, merged by number. */
function readPhones(text: string): { phones: Phone[]; wechat: string | null } {
  const phones: Phone[] = [];
  let wechat: string | null = null;
  const add = (raw: string, label: Phone["label"], whatsapp: boolean) => {
    let display = raw.replace(/\s+/g, " ").replace(/^\+\s/, "+").replace(/[\s\-./(]+$/, "").trim();
    let digits = digitsOf(display);
    if (!digits && display.includes("/")) {
      display = display.split("/")[0].trim();
      digits = digitsOf(display);
    }
    const bare = display.replace(/\D/g, "");
    if (bare.length < 7 || bare.length > 16) return;
    const key = (digits || bare).slice(-8);
    const known = phones.find((p) => (p.digits || p.display.replace(/\D/g, "")).slice(-8) === key);
    if (known) {
      known.whatsapp ||= whatsapp;
      if (whatsapp) delete known.whatsappGuessed;
      if (known.label === "phone" && label !== "phone") known.label = label;
      if (!known.digits && digits) known.digits = digits;
      return;
    }
    const guessed = !whatsapp && label === "mobile" && /^968[79]\d{7}$/.test(digits);
    phones.push({ label, display, digits, whatsapp: whatsapp || guessed, ...(guessed ? { whatsappGuessed: true } : {}) });
  };

  for (const m of text.matchAll(every(PHONE_LABELLED))) add(m[2], phoneLabel(m[1]), false);
  for (const m of text.matchAll(every(WHATSAPP_MULTI))) {
    const labels = m[0].slice(0, m[0].search(/[:：]/));
    add(m[1], "mobile", /whats/i.test(labels));
    if (/we ?chat/i.test(labels)) wechat ??= m[1].replace(/\s+/g, " ").trim();
  }
  for (const m of text.matchAll(every(WHATSAPP_A))) add(m[1], "mobile", true);
  for (const m of text.matchAll(every(WHATSAPP_B))) {
    add(m[1], "mobile", true);
    if (/we ?cha/i.test(m[0])) wechat ??= m[1].replace(/\s+/g, " ").trim();
  }
  for (const m of text.matchAll(WA_ME)) add(`+${m[1]}`, "mobile", true);
  for (const m of text.matchAll(every(PHONE_INTL))) add(m[0], "phone", false);

  const id = once(WECHAT).exec(text);
  if (id) {
    const value = id[1].trim();
    const phone = /^\+?\d/.test(value) ? (/^\+?[\d\s-]+/.exec(value)?.[0] ?? value).replace(/\s+/g, " ").trim() : value.split(/\s+/)[0];
    if (phone) wechat = phone;
  }
  return { phones, wechat };
}

// --- Signatures (C.3.14) --------------------------------------------------------------------------------------

const emptyContact = (): Contact => ({ name: null, designation: null, company: null, phones: [], wechat: null });

/** Words a sentence is made of: a line with them is the message, not a name or a company. */
const SENTENCE_WORD = /\b(?:please|pls|plz|kindly|the|to|is|are|was|will|we|you|your|our|and|for|with|from|this|that)\b/i;
/** Words of a desk or a department, never a person's name. */
const NOT_A_NAME = /\b(?:regards|thanks|thank|team|department|dept|desk|division|service|services|logistics|shipping|freight|cargo|group|company|international|trading|office|customer|operations?|sales|pricing|import|export|accounts?|management|disclaimer|note|confidential)\b/i;
/** Words of a postal address. */
const ADDRESS_WORD = /\b(?:sultanate|road|rd|street|st|box|building|bldg|floor|room|district|province|city|zone|area|tower|p\.?\s?o\.?|p\.?\s?c\.?|branch(?:es)?|office|add|address|plaza|estate|industrial)\b/i;
/** A label on a line of its own, its value on the next line ("Mobile" / "+20 128…"). */
const CONTACT_LABEL_LINE = /^[-*•\s]*(mob(?:ile)?|cell|tel(?:ephone)?|phone|ph|fax|e-?mail(?:\s+id)?|whats ?app|we ?chat(?:\s+id)?|direct(?: line)?|office(?: phone)?)\s*(?:no\.?|number)?\s*[:：]?\s*$/i;

/** Normalised text of a block: line breaks kept, link wrappers and invisible characters gone. */
function prepare(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(SPACES, " ")
    .replace(INVISIBLE, "")
    .replace(LINK_WRAPPERS, " ");
}

/** The lines of a block: bold stars off, spaces collapsed, empty and separator lines dropped. */
function blockLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\*+/g, " ").replace(/^[\s_]+|[\s_]+$/g, "").replace(/[ \t]+/g, " ").trim())
    .filter((l) => /[\p{L}\p{N}]/u.test(l));
}

/** A label alone on its line joined with the value on the next one: "Mobile: +20 128…". */
function pairLabels(lines: string[], label: RegExp): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    const next = lines[i + 1];
    if (m && next != null && !label.test(next)) {
      out.push(`${lines[i].replace(/[\s:：]+$/, "")}: ${next}`);
      i++;
    } else out.push(lines[i]);
  }
  return out;
}

const trimPunct = (s: string) => s.replace(/^[\s\-–,;:|/]+|[\s\-–,;:|/.]+$/g, "").trim();
/** A name in capitals read as a name: "BASIL IQBAL" → "Basil Iqbal". */
const personCase = (name: string) => (/[a-z]/.test(name) ? name : displayName(name));

/** The person's name on a signature line, with a role after "/", "|" or ",", or null. */
function nameFrom(line: string): { name: string; role: string | null } | null {
  // A run of dots is no name, and it would send the name pattern through every way of splitting the dots.
  if (line.length > 60 || /[@\d:：]|https?:|www\.|\.{3,}/i.test(line) || SIG_COMPANY.test(line)) return null;
  const m = SIG_NAME.exec(line);
  if (!m) return null;
  let name = m[1].trim();
  if (SENTENCE_WORD.test(name) || NOT_A_NAME.test(name) || SIG_DESIGNATION.test(name)) return null;
  // "Rashid Ahmad." loses its full stop; the initials of "Anwar K. S." keep theirs.
  if (/\p{L}{2,}\.$/u.test(name)) name = name.slice(0, -1);
  const role = m[2] ? trimPunct(m[2]) : "";
  return { name: personCase(name), role: role && !/\d/.test(role) ? role : null };
}

/** A company line: a legal form, else capitals of two words or more that are not an address. */
function companyFrom(lines: string[], skip: Set<number>): string | null {
  const usable = (l: string, i: number) => !skip.has(i) && !/[@]|https?:|www\./i.test(l);
  for (let i = 0; i < lines.length; i++) if (usable(lines[i], i) && SIG_COMPANY.test(lines[i])) return trimPunct(lines[i]);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!usable(l, i) || l.length > 60 || /[\d:：]/.test(l) || ADDRESS_WORD.test(l)) continue;
    if (/^[A-Z][A-Z&.,'()\- ]+$/.test(l) && l.trim().split(/\s+/).length >= 2) return trimPunct(l);
  }
  return null;
}

/**
 * A signature block read into a contact (lean: name, designation, company, labelled and international phones,
 * WhatsApp, WeChat). Takes the block after the sign-off line (signatureTextOf), or a text that still has its
 * sign-off line. No bare local numbers, Chinese landlines, QQ or Skype: their shapes catch reference numbers.
 */
export function parseSignature(bodyNewText: string): Contact {
  try {
    if (typeof bodyNewText !== "string" || !bodyNewText.trim()) return emptyContact();
    let text = prepare(bodyNewText).replace(BOILERPLATE, "");
    const off = SIG_SIGNOFF.exec(text);
    if (off) text = text.slice(off.index + off[0].length);
    const lines = pairLabels(blockLines(text), CONTACT_LABEL_LINE).slice(0, 18);
    if (!lines.length) return emptyContact();

    const contact = emptyContact();
    const skip = new Set<number>();
    const named = nameFrom(lines[0]);
    if (named) {
      contact.name = named.name;
      contact.designation = named.role;
      skip.add(0);
    }
    if (!contact.designation) {
      const from = named ? 1 : 0;
      for (let i = from; i < Math.min(lines.length, from + 3); i++) {
        const l = lines[i];
        if (/[@\d]|https?:/.test(l) || SIG_COMPANY.test(l) || !SIG_DESIGNATION.test(l)) continue;
        contact.designation = trimPunct(l);
        skip.add(i);
        break;
      }
    }
    contact.company = companyFrom(lines, skip);
    const { phones, wechat } = readPhones(lines.join("\n"));
    contact.phones = phones;
    contact.wechat = wechat;
    return contact;
  } catch {
    return emptyContact();
  }
}

// --- Shipper block --------------------------------------------------------------------------------------------

/** A label of a shipper's contact table, with its value on the same line or on the next one. */
const BLOCK_LABEL = /^[-*•\s]*((?:(?:vendor|shipper|supplier|consignee|notify)(?:['’]s)?\s+)?(?:company(?:\s+name)?|name|address|contact(?:\s+person|\s+name)?|person|attn|attention|mobile|mob|cell|tel|telephone|phone|ph|fax|e-?mail(?:\s+id)?|whats ?app|we ?chat))\s*(?:[:：\-–]\s*(.*))?$/i;
const BLOCK_LABEL_ALONE = /^[-*•\s]*(?:(?:vendor|shipper|supplier|consignee|notify)(?:['’]s)?\s+)?(?:company(?:\s+name)?|name|address|contact(?:\s+person|\s+name)?|person|attn|attention|mobile|mob|cell|tel|telephone|phone|ph|fax|e-?mail(?:\s+id)?|whats ?app|we ?chat)\s*[:：]?\s*$/i;
const BLOCK_STOP = /^\s*[-*•]?\s*(?:consignee|notify|agent)\b|^\s*(?:from|sent|to|cc|subject)\s*:/i;
/** A request for the details, not the details: "Please share the shipper contact details." */
const ASKS_FOR_DETAILS = /\b(?:please|pls|plz|kindly|can you|could you)\s+(?:share|send|provide|advise|give|confirm|forward)\b|\?\s*$/i;

const isSentenceLine = (l: string) => SENTENCE_WORD.test(l) && /[.?!:]\s*$/.test(l) && l.trim().split(/\s+/).length >= 4;
const endsBlock = (l: string) => SIG_SIGNOFF.test(l) || BLOCK_STOP.test(l) || AGENT_BLOCK.test(l);

function labelKind(label: string): "company" | "person" | "email" | "address" | "phone" {
  const l = label.toLowerCase();
  if (/contact|person|attn|attention/.test(l)) return "person";
  if (/mail/.test(l)) return "email";
  if (/address/.test(l)) return "address";
  if (/name|company/.test(l)) return "company";
  return "phone";
}

/**
 * A shipper, vendor or supplier contact block (SHIPPER_BLOCK) read into a contact with its e-mail: up to 12 lines
 * or 400 characters, label-then-next-line tables included. A block that starts at "Contact person" also takes the
 * company and address lines written just above it. Null when there is no block or nothing in it.
 */
export function shipperBlockOf(text: string): (Contact & { email: string | null }) | null {
  try {
    if (typeof text !== "string" || !text.trim()) return null;
    let body = prepare(text.replace(/<mailto:\s*([^>\s]+)\s*>/gi, " $1 "));
    const leak = body.search(QUOTED_HEADER_LEAK);
    if (leak >= 0) body = body.slice(0, leak);
    const lines = body.split("\n");
    const starts: number[] = [];
    let offset = 0;
    for (const l of lines) {
      starts.push(offset);
      offset += l.length + 1;
    }
    const lineOf = (index: number) => {
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1] <= index) i++;
      return i;
    };

    let at = -1;
    let contactPerson: string | null = null;
    for (const m of body.matchAll(every(SHIPPER_BLOCK))) {
      if (/^(?:consignee|notify)$/i.test(m[1] ?? "")) continue;
      const line = lineOf(m.index ?? 0);
      if (ASKS_FOR_DETAILS.test(lines[line])) continue;
      at = line;
      contactPerson = m[3] ? trimPunct(m[3]) : null;
      break;
    }
    if (at < 0) return null;

    let first = at;
    if (contactPerson) {
      for (let i = at - 1, seen = 0; i >= 0 && seen < 8; i--) {
        const l = lines[i].trim();
        if (!l) continue;
        if (isSentenceLine(l) || GREETING.test(l) || endsBlock(l) || l.length > 160) break;
        first = i;
        seen++;
      }
    }
    const block: string[] = [];
    let size = 0;
    for (let i = first; i < lines.length && block.length < 12 && size < 400; i++) {
      const l = lines[i].replace(/\*+/g, " ").replace(/[ \t]+/g, " ").trim();
      if (!l) continue;
      if (i > at && (endsBlock(l) || isSentenceLine(l))) break;
      if (i === at && !contactPerson && !BLOCK_LABEL.test(l)) continue; // the line that announces the block
      block.push(l);
      size += l.length;
    }
    const paired = pairLabels(block, BLOCK_LABEL_ALONE);

    let company: string | null = null;
    let person: string | null = contactPerson;
    let email: string | null = null;
    const used = new Set<number>();
    paired.forEach((l, i) => {
      const m = BLOCK_LABEL.exec(l);
      const value = m?.[2] ? trimPunct(m[2]) : "";
      if (!m || !value) return;
      used.add(i);
      const kind = labelKind(m[1]);
      if (kind === "company") company ??= value;
      else if (kind === "person") person ??= value;
      else if (kind === "email") email ??= value.match(ADDRESS)?.[0]?.toLowerCase() ?? null;
    });
    company ??= companyFrom(paired, used);
    if (!email) {
      for (const found of paired.join("\n").match(ADDRESS) ?? []) {
        const a = found.toLowerCase();
        if (!isOurAddress(a)) {
          email = a;
          break;
        }
      }
    }
    const { phones, wechat } = readPhones(paired.join("\n"));
    if (!company && !person && !email && !phones.length) return null;
    return {
      name: person ? clip(person, 60) : null,
      designation: null,
      company: company ? clip(company, 90) : null,
      phones,
      wechat,
      email,
    };
  } catch {
    return null;
  }
}

// --- Who handles it (C.3.14) ----------------------------------------------------------------------------------

/** The address of one of our mailboxes. */
const mailboxAddress = (mailbox: string) => (mailbox.includes("@") ? mailbox : `${mailbox}@${OUR_DOMAIN}`);

/** First names and the usual misspellings in greetings → the staff member's name. */
const GREETED: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const s of Object.values(STAFF)) {
    if (s.role === "Customer service" || s.role === "Customs clearance") continue;
    map.set(s.name.toLowerCase(), s.name);
    for (const word of s.name.toLowerCase().split(/\s+/)) {
      if (!/^\p{L}{3,}$/u.test(word)) continue;
      const known = map.get(word);
      if (known && known !== s.name) ambiguous.add(word);
      else map.set(word, s.name);
    }
  }
  for (const word of ambiguous) map.delete(word);
  const alias: Record<string, string> = { waheed: "Abdul Waheed", abudl: "Abdul Waheed", anwark: "Anwar K. S.", jithu: "Jittu Jacob", jeethu: "Jittu Jacob" };
  for (const [word, name] of Object.entries(alias)) map.set(word, name);
  return map;
})();

/** Greeting words that name nobody. */
const NOBODY = new Set(["sir", "sirs", "madam", "team", "all", "both", "client", "customer", "valued", "colleagues", "friend", "friends"]);

/** The name a mail's greeting uses ("Dear Anwar," → "Anwar"), or null. */
function greetingName(email: Pick<EmailMessage, "body_text" | "snippet">): string | null {
  const m = GREETING_NAME.exec(rawNewText(email));
  if (!m) return null;
  const words = m[1].split(/\s+/).filter(Boolean);
  if (!words.length || NOBODY.has(words[0].toLowerCase())) return null;
  return words.slice(0, 2).join(" ");
}

/** The staff member a greeting names, or null. */
function greetedStaff(name: string | null): string | null {
  if (!name) return null;
  const all = name.toLowerCase();
  return GREETED.get(all) ?? GREETED.get(all.split(/\s+/)[0]) ?? null;
}

/**
 * Who on our side handles the enquiry: among our in-scope mails with an outside recipient, from a mailbox whose
 * person may handle, the writer of the newest one who wrote two or more such mails; since their first mail after
 * the previous handler's last; earlier handlers in order. Also whether the sales person is on the e-mails, and the
 * name the customer's greetings use when it is not the handler's.
 */
export function handlerOf(mails: ReadMail[], row: EnquiryRow): Handler | null {
  try {
    const list = scoped(mails);
    const outward = list.filter((m) => m.party === "us" && !!m.toParty && m.toParty !== "internal" && !!m.from?.staff?.handles);
    const counts = new Map<string, number>();
    for (const m of outward) counts.set(m.from.staff!.name, (counts.get(m.from.staff!.name) ?? 0) + 1);
    const runs: { staff: StaffMember; address: string; first: string; last: string }[] = [];
    for (const m of outward) {
      const staff = m.from.staff!;
      if ((counts.get(staff.name) ?? 0) < 2) continue;
      const run = runs[runs.length - 1];
      const address = lower(m.from.email) || mailboxAddress(staff.mailbox);
      if (run && run.staff.name === staff.name) {
        run.last = m.at;
        run.address = address;
      } else runs.push({ staff, address, first: m.at, last: m.at });
    }
    // A colleague writing in between on the same day, the first one carrying on after: they share it, nobody took over.
    for (let i = 0; i + 2 < runs.length; ) {
      const [a, b, c] = [runs[i], runs[i + 1], runs[i + 2]];
      if (a.staff.name === c.staff.name && muscatDate(b.first) === muscatDate(b.last) && muscatDate(a.last) === muscatDate(c.first)) {
        a.last = c.last;
        a.address = c.address;
        runs.splice(i + 1, 2);
      } else i++;
    }
    const current = runs[runs.length - 1];
    if (!current) return null;

    const salesKey = nameKey(row?.sales_person_name);
    const salesStaff = salesKey ? Object.values(STAFF).find((s) => !!s.salesName && nameKey(s.salesName) === salesKey) : undefined;
    const salesMailbox = salesStaff ? mailboxAddress(salesStaff.mailbox) : null;
    const salesPerson = row?.sales_person_name?.trim()
      ? {
          name: salesStaff?.name ?? displayName(row.sales_person_name),
          mailbox: salesMailbox,
          onThread:
            !!salesMailbox &&
            list.some((m) => (m.party !== "us" || (!!m.toParty && m.toParty !== "internal")) && addressesOf(m).includes(salesMailbox)),
        }
      : null;

    const since = timeOf(current.first);
    const greets = new Map<string, number>();
    for (const m of list) {
      if (m.party !== "customer" || timeOf(m.at) < since) continue;
      const name = greetedStaff(greetingName(m.email));
      if (name) greets.set(name, (greets.get(name) ?? 0) + 1);
    }
    let top: string | null = null;
    let most = 0;
    for (const [name, n] of greets) {
      if (n > most) {
        top = name;
        most = n;
      }
    }
    const customerGreets = top && most >= 2 && top !== current.staff.name ? top : null;

    return {
      mailbox: current.address,
      name: current.staff.name,
      role: current.staff.role,
      since: current.first,
      previous: runs.slice(0, -1).filter((r) => r.staff.name !== current.staff.name).slice(-3).map((r) => ({ name: r.staff.name, role: r.staff.role, from: r.first, to: r.last })),
      salesPerson,
      customerGreets,
    };
  } catch {
    return null;
  }
}

// --- People (C.3.14) ------------------------------------------------------------------------------------------

/** Country codes and top-level domains → the time zone and the city the page names. */
const ZONES: [string, string, string][] = [
  ["968", "Asia/Muscat", "Muscat"], ["971", "Asia/Dubai", "Dubai"], ["86", "Asia/Shanghai", "Shanghai"], ["91", "Asia/Kolkata", "Kolkata"],
  ["39", "Europe/Rome", "Rome"], ["27", "Africa/Johannesburg", "Johannesburg"], ["90", "Europe/Istanbul", "Istanbul"],
  ["49", "Europe/Berlin", "Berlin"], ["46", "Europe/Stockholm", "Stockholm"], ["20", "Africa/Cairo", "Cairo"], ["44", "Europe/London", "London"],
];
const TLD_ZONES: Record<string, string> = { om: "968", ae: "971", cn: "86", in: "91", it: "39", za: "27", tr: "90", de: "49", se: "46", eg: "20", uk: "44" };
const CJK = /\p{Script=Han}/u;

const CLOCKS = new Map<string, Intl.DateTimeFormat>();
function clockIn(zone: string, at: Date): string | null {
  try {
    let clock = CLOCKS.get(zone);
    if (!clock) CLOCKS.set(zone, (clock = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })));
    return clock.format(at);
  } catch {
    return null;
  }
}

/** "Shanghai 15:32": the time where a person is, from a phone's country code, else the address's country, else Chinese script. Null in Oman's time. */
function localTimeOf(phones: Phone[], email: string, text: string, now: string): string | null {
  const at = new Date(timeOf(now));
  if (!timeOf(now)) return null;
  const ordered = [...phones.filter((p) => p.label === "mobile"), ...phones.filter((p) => p.label !== "mobile")];
  let code = "";
  for (const p of ordered) {
    const hit = ZONES.find(([cc]) => p.digits.startsWith(cc));
    if (hit) {
      code = hit[0];
      break;
    }
  }
  if (!code) {
    const tld = (emailDomain(email) ?? "").split(".").pop() ?? "";
    code = Object.hasOwn(TLD_ZONES, tld) ? TLD_ZONES[tld] : CJK.test(text) ? "86" : "";
  }
  const zone = ZONES.find(([cc]) => cc === code);
  if (!zone) return null;
  const there = clockIn(zone[1], at);
  const here = clockIn("Asia/Muscat", at);
  return there && there !== here ? `${zone[2]} ${there}` : null;
}

/** The value most often given, the newest winning a tie. */
function majority(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, { value: string; n: number; last: number }>();
  values.forEach((v, i) => {
    const value = typeof v === "string" ? v.trim() : "";
    if (!value) return;
    const key = value.toLowerCase();
    const known = counts.get(key);
    if (known) {
      known.n++;
      known.last = i;
    } else counts.set(key, { value, n: 1, last: i });
  });
  let best: { value: string; n: number; last: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n || (c.n === best.n && c.last > best.last)) best = c;
  return best?.value ?? null;
}

/** Several readings of one sender's signature merged: names by majority, every number once. */
function mergeContacts(contacts: Contact[]): Contact {
  const phones: Phone[] = [];
  for (const c of contacts) {
    for (const p of c.phones) {
      const key = (p.digits || p.display.replace(/\D/g, "")).slice(-8);
      const known = phones.find((q) => (q.digits || q.display.replace(/\D/g, "")).slice(-8) === key);
      if (known) {
        known.whatsapp ||= p.whatsapp;
        if (p.whatsapp && !p.whatsappGuessed) delete known.whatsappGuessed;
      } else phones.push({ ...p });
    }
  }
  return {
    name: majority(contacts.map((c) => c.name)),
    designation: majority(contacts.map((c) => c.designation)),
    company: majority(contacts.map((c) => c.company)),
    phones,
    wechat: majority(contacts.map((c) => c.wechat)),
  };
}

const shareWord = (a: string, b: string) => {
  const words = new Set(a.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 1));
  return b
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .some((w) => w.length > 1 && words.has(w));
};

/** The display name of a sender as written, when the mail had one that is not an address. */
function displayedName(m: ReadMail): string | null {
  const raw = typeof m.email?.from_name === "string" ? m.email.from_name.trim() : "";
  if (!raw || raw.includes("@")) return null;
  const name = m.from?.name?.trim();
  return name || null;
}

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

const KIND_PARTY: Record<SideKind, Party> = { customer: "customer", agent: "agent", carrier: "carrier", shipper: "shipper", other: "other", internal: "us" };

interface Entry {
  email: string;
  sideKey: string;
  party: Party;
  /** Their in-scope mails, oldest first. */
  wrote: ReadMail[];
  /** In the "to" of a mail of ours. */
  addressed: boolean;
  /** Times of our mails that had them in to or cc. */
  ours: number[];
  /** Names our greetings gave them when they were the only one written to. */
  greetings: string[];
  chips: string[];
}

/** The people on an enquiry's e-mails, one block per conversation and one for our side (C.3.14). */
export function peopleOf(sides: Side[], mails: ReadMail[], handler: Handler | null, row: EnquiryRow, now: string): PeopleBlock[] {
  try {
    return people(listOf(sides), listOf(mails), handler, row ?? ({} as EnquiryRow), now);
  } catch {
    return [];
  }
}

function people(sides: Side[], all: ReadMail[], handler: Handler | null, row: EnquiryRow, now: string): PeopleBlock[] {
  const list = scoped(all);
  if (!list.length) return [];
  const nowIso = timeOf(now) ? new Date(timeOf(now)).toISOString() : (list[list.length - 1]?.at ?? "");
  const today = nowIso ? muscatDate(nowIso) : todayOf(list);
  const sideOf = new Map(sides.map((s) => [s.key, s]));
  const contact = lower(row.contact_email);

  const customerDomains = new Set<string>();
  const addDomain = (a: string) => {
    const d = emailDomain(a);
    if (d && !isFreeMail(d) && !isOurAddress(a)) customerDomains.add(d);
  };
  if (contact) addDomain(contact);
  const customerSide = sideOf.get("customer");
  if (customerSide?.domain) customerDomains.add(customerSide.domain);
  for (const m of list) if (m.party === "customer") addDomain(lower(m.from?.email));

  // Who wrote: an entry per outside sender, on the conversation of their mails.
  const entries = new Map<string, Entry>();
  const entry = (email: string, sideKey: string, party: Party): Entry => {
    let e = entries.get(email);
    if (!e) entries.set(email, (e = { email, sideKey, party, wrote: [], addressed: false, ours: [], greetings: [], chips: [] }));
    return e;
  };
  const ourWriters = new Map<string, ReadMail[]>();
  const ourCopied = new Set<string>();
  for (const m of list) {
    const from = lower(m.from?.email);
    if (!from) continue;
    if (m.party === "us") {
      const mine = ourWriters.get(from);
      if (mine) mine.push(m);
      else ourWriters.set(from, [m]);
    } else if (m.sideKey && m.sideKey !== "internal") entry(from, m.sideKey, m.party).wrote.push(m);
  }
  // Our own numbers, from our signatures: one read in an outside mail is our signature quoted back, not theirs.
  const ourPhones = new Set<string>();
  for (const written of ourWriters.values()) {
    for (const m of written) for (const p of parseSignature(attempt(() => signatureTextOf(m.email), "")).phones) if (phoneKey(p).length >= 7) ourPhones.add(phoneKey(p));
  }
  const notOurs = (phones: Phone[]) => phones.filter((p) => !ourPhones.has(phoneKey(p)));

  /** The conversation of an address that was written to or copied. */
  const place = (a: string, m: ReadMail, inTo: boolean): { sideKey: string; party: Party } | null => {
    const known = entries.get(a);
    if (known) return known;
    const key = keyOfAddress(a);
    const side = key && key !== "customer" ? sideOf.get(key) : undefined;
    if (side && side.kind !== "internal") return { sideKey: side.key, party: KIND_PARTY[side.kind] };
    const domain = emailDomain(a);
    if (a === contact || (domain && !isFreeMail(domain) && customerDomains.has(domain))) return { sideKey: "customer", party: "customer" };
    // Another company the customer writes to (their supplier, "I have added our shipping partner in this loop") is the shipper.
    if (m.party === "customer" && inTo && domain && !isFreeMail(domain) && !isOurAddress(a)) return { sideKey: key || domain, party: "shipper" };
    if (m.party === "us" && m.toParty === "customer" && inTo) return { sideKey: "customer", party: "customer" };
    const own = sideOf.get(m.sideKey);
    if (own && own.kind !== "internal") return { sideKey: own.key, party: KIND_PARTY[own.kind] };
    return null;
  };

  for (const m of list) {
    const to = listAddresses(m.email?.to_emails).map(lower);
    const outside = outsideRecipients(m.email);
    for (const a of addressesOf(m)) if (isOurAddress(a) && !ourWriters.has(a)) ourCopied.add(a);
    const greeting = m.party === "us" && outside.filter((a) => to.includes(a)).length === 1 ? greetingName(m.email) : null;
    for (const a of outside) {
      const at = place(a, m, to.includes(a));
      if (!at) continue;
      const e = entry(a, at.sideKey, at.party);
      if (m.party !== "us") continue;
      e.ours.push(timeOf(m.at));
      if (to.includes(a)) {
        e.addressed = true;
        if (greeting && !greetedStaff(greeting)) e.greetings.push(greeting);
      }
    }
  }

  // Chips: out of office, bounced, added by a colleague.
  const since = timeOf(nowIso) - 7 * DAY;
  const threads = new Map<string, ReadMail[]>();
  for (const m of all) {
    const id = m.email?.gmail_thread_id ?? "";
    const thread = threads.get(id);
    if (thread) thread.push(m);
    else threads.set(id, [m]);
  }
  for (const m of all) {
    if (m.noise === "auto_reply" && timeOf(m.at) >= since) {
      const e = entries.get(lower(m.from?.email));
      if (e && !e.chips.includes("out of office")) e.chips.push("out of office");
    } else if (m.noise === "bounce") {
      const e = entries.get(attempt(() => bounceAddressOf(m.email), null) ?? "");
      if (e && !e.chips.includes("bounced")) e.chips.push("bounced");
    }
    if (m.scope === "in" || m.noise === "loop_in") attempt(() => loopIn(m, entries, threads.get(m.email?.gmail_thread_id ?? "") ?? [], today), undefined);
  }

  const personOf = (e: Entry): Person => {
    const read = mergeContacts(e.wrote.map((m) => parseSignature(attempt(() => signatureTextOf(m.email), ""))));
    const signed = { ...read, phones: notOurs(read.phones) };
    const shown = majority(e.wrote.map(displayedName));
    let name: string | null = null;
    if (signed.name && (!shown || shareWord(signed.name, shown) || NOT_A_NAME.test(shown))) name = signed.name;
    else if (shown) name = shown;
    else name = majority(e.greetings);
    const last = e.wrote[e.wrote.length - 1] ?? null;
    const lastAt = last ? timeOf(last.at) : 0;
    const replied = last ? Math.max(0, ...e.ours.filter((t) => t > lastAt)) : 0;
    const canSave = e.party === "customer" && e.email !== contact;
    const phone = signed.phones.find((p) => p.label === "mobile") ?? signed.phones.find((p) => p.label !== "fax");
    const prefill: FormPrefill | null = canSave
      ? {
          ...(name ? { contact_name: name } : {}),
          contact_email: e.email,
          ...(phone ? { contact_phone: phone.display } : {}),
          ...(row.contact_name || row.contact_email || row.contact_phone ? { replace: ["contact_name", "contact_email", "contact_phone"] } : {}),
          notes: [`Contact ${name || e.email}, from the signature on their e-mails`],
        }
      : null;
    return {
      ...signed,
      name,
      email: e.email,
      party: e.party,
      wrote: e.wrote.length,
      lastWrote: last?.at ?? null,
      lastWeReplied: replied ? new Date(replied).toISOString() : null,
      sharedDesk: ROLE_LOCAL.test(localPart(e.email)),
      chips: [...e.chips],
      localTime: localTimeOf(signed.phones, e.email, `${name ?? ""} ${e.wrote.map((m) => attempt(() => signatureTextOf(m.email), "")).join(" ")}`, nowIso),
      canSave,
      prefill,
    };
  };

  // One block per outside conversation.
  const blocks: PeopleBlock[] = [];
  const blockFor = new Map<string, PeopleBlock>();
  const order: SideKind[] = ["customer", "agent", "shipper", "carrier", "other"];
  const known = [...sides.filter((s) => s.kind !== "internal")].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const e of entries.values()) {
    if (!sideOf.has(e.sideKey) && !known.some((s) => s.key === e.sideKey)) {
      const kind: SideKind = e.party === "us" ? "other" : e.party;
      known.push({ key: e.sideKey, kind, name: e.sideKey === "customer" ? displayName(row.customer_name) : e.sideKey, domain: null, agentName: null } as Side);
    }
  }
  for (const side of known) {
    const block: PeopleBlock = {
      kind: side.kind,
      title: side.name || (side.kind === "customer" ? displayName(row.customer_name) : side.key),
      sideKey: side.key,
      note: side.kind === "agent" ? agentNote(side, all, today) : null,
      persons: [],
      copied: [],
      agentPrefill: agentPrefillOf(side, row),
    };
    blocks.push(block);
    blockFor.set(side.key, block);
  }
  for (const e of entries.values()) {
    const block = blockFor.get(e.sideKey);
    if (!block) continue;
    if (e.wrote.length || e.addressed) block.persons.push(personOf(e));
    else block.copied.push({ name: "", email: e.email });
  }

  // The shipper's contact from a contact block in any mail, kept with the person when they are on the e-mails.
  attempt(() => addShippers(list, entries, blocks, blockFor, notOurs), undefined);

  // Our side: colleagues who wrote, and those only copied.
  const us: PeopleBlock = { kind: "us", title: "Our side", sideKey: null, note: null, persons: [], copied: [], agentPrefill: null };
  for (const [address, written] of ourWriters) {
    const staff = staffOf(address);
    const signed = mergeContacts(written.map((m) => parseSignature(attempt(() => signatureTextOf(m.email), ""))));
    const last = written[written.length - 1];
    us.persons.push({
      ...signed,
      name: staff?.name ?? signed.name ?? last.from?.name ?? null,
      designation: staff?.role ?? signed.designation,
      company: null,
      email: address,
      party: "us",
      wrote: written.length,
      lastWrote: last.at,
      lastWeReplied: null,
      sharedDesk: false,
      chips: [],
      localTime: null,
      canSave: false,
      prefill: null,
    });
  }
  for (const address of ourCopied) us.copied.push({ name: staffOf(address)?.name ?? "", email: address });
  // The handler first, then whoever wrote most.
  const handling = lower(handler?.mailbox);
  us.persons.sort((a, b) => Number(b.email === handling) - Number(a.email === handling) || b.wrote - a.wrote);
  blocks.push(us);
  return blocks;
}

/** "agreed", "paused by us Mon 18:29", "declined": where the enquiry stands with an agent. */
function agentNote(side: Side, all: ReadMail[], today: string): string | null {
  if (side.pausedByUs) {
    const mail = all.find((m) => m.id === side.pausedByUs?.emailId);
    return `paused by us ${mail ? shortWhen(mail.at, today) : side.pausedByUs.when}`.trim();
  }
  if (side.agent?.state === "agreed") return "agreed";
  if (side.agent?.state === "declined") return "declined";
  return null;
}

/** "Set as this enquiry's agent": the register name the domain maps to, when it is not the enquiry's agent yet. */
function agentPrefillOf(side: Side, row: EnquiryRow): FormPrefill | null {
  if (side.kind !== "agent" || !side.agentName?.trim()) return null;
  if (nameKey(side.agentName) === nameKey(row.agent_name)) return null;
  return {
    agent_name: side.agentName,
    ...(row.agent_name ? { replace: ["agent_name"] } : {}),
    notes: [`Agent ${displayName(side.agentName)}, from the e-mails with ${side.domain ?? side.key}`],
  };
}

/** The chip "added by Manu Thu 16:06" on the person a loop-in note names, or on those it newly copies. */
function loopIn(m: ReadMail, entries: Map<string, Entry>, thread: ReadMail[], today: string): void {
  const hit = LOOP_IN_NAME.exec(typeof m.clean === "string" ? m.clean : "");
  if (!hit) return;
  const chip = `added by ${firstName(m.from?.name) || "a colleague"} ${shortWhen(m.at, today)}`.trim();
  const named = /^[@'\s]*([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})/.exec(hit[1])?.[1] ?? "";
  const word = named.split(/\s+/)[0]?.toLowerCase() ?? "";
  const targets: Entry[] = [];
  const at = timeOf(m.at);
  if (word.length >= 3) {
    for (const e of entries.values()) {
      if (e.wrote.length && timeOf(e.wrote[0].at) < at) continue; // on the e-mails before the note
      const words = [localPart(e.email), ...e.wrote.map((w) => w.from?.name ?? "")].join(" ").toLowerCase().split(/[^\p{L}]+/u);
      if (words.some((w) => w === word || (word.length >= 4 && w.startsWith(word)))) targets.push(e);
    }
  }
  if (!targets.length) {
    const earlier = thread.filter((x) => x !== m && timeOf(x.at) < at);
    if (earlier.length) {
      const seen = new Set(earlier.flatMap(addressesOf));
      for (const a of outsideRecipients(m.email)) {
        const e = entries.get(a);
        if (e && !seen.has(a)) targets.push(e);
      }
    }
  }
  for (const e of targets) if (!e.chips.some((c) => c.startsWith("added by"))) e.chips.push(chip);
}

/**
 * Shipper contacts read from contact blocks: merged into their person when on the e-mails, else a shipper block. A
 * block that names us (we are often the consignee), or leaves no address and no number of theirs, is no contact.
 */
function addShippers(list: ReadMail[], entries: Map<string, Entry>, blocks: PeopleBlock[], blockFor: Map<string, PeopleBlock>, notOurs: (phones: Phone[]) => Phone[]): void {
  const found: (Contact & { email: string | null })[] = [];
  for (const m of list) {
    const text = textWithAddresses(m.email);
    if (!SHIPPER_BLOCK.test(text)) continue;
    const c = shipperBlockOf(text);
    // A block that reads on into our own address is our signature, not the shipper's contact.
    if (!c || OUR_COMPANY.test(c.company ?? "") || OUR_COMPANY.test(c.name ?? "") || (c.email && isOurAddress(c.email))) continue;
    c.phones = notOurs(c.phones);
    if (!c.email && !c.phones.length && !c.wechat) continue;
    const same = found.find((f) => (c.email && f.email === c.email) || (!!c.name && !!f.name && c.name.toLowerCase() === f.name.toLowerCase()));
    if (same) {
      same.email ??= c.email;
      same.name ??= c.name;
      same.company ??= c.company;
      same.wechat ??= c.wechat;
      same.phones = mergeContacts([same, c]).phones;
    } else found.push(c);
  }
  for (const c of found) {
    const e = c.email ? entries.get(c.email) : undefined;
    const person = e ? blockFor.get(e.sideKey)?.persons.find((p) => p.email === e.email) : undefined;
    if (person) {
      person.name ??= c.name;
      person.company ??= c.company;
      person.wechat ??= c.wechat;
      person.phones = mergeContacts([person, c]).phones;
      continue;
    }
    if (e) continue;
    let block = blocks.find((b) => b.kind === "shipper");
    if (!block) {
      block = { kind: "shipper", title: c.company ?? "Shipper", sideKey: null, note: null, persons: [], copied: [], agentPrefill: null };
      const at = blocks.findIndex((b) => b.kind === "carrier" || b.kind === "other");
      blocks.splice(at < 0 ? blocks.length : at, 0, block);
    }
    block.persons.push({
      name: c.name,
      designation: null,
      company: c.company,
      phones: c.phones,
      wechat: c.wechat,
      email: c.email ?? "",
      party: "shipper",
      wrote: 0,
      lastWrote: null,
      lastWeReplied: null,
      sharedDesk: false,
      chips: [],
      localTime: null,
      canSave: false,
      prefill: null,
    });
  }
}

// --- Cargo (C.3.14) -------------------------------------------------------------------------------------------

const CARGO_LABEL: Record<CargoKey, string> = {
  commodity: "Commodity", packages: "Packages", gross_weight: "Gross weight", chargeable_weight: "Chargeable weight",
  volume: "Volume", dimensions: "Dimensions", equipment: "Equipment", incoterm: "Incoterm", pickup_address: "Pick-up address",
  cargo_ready: "Cargo ready", stackable_dg: "Stackable / DG", hs_code: "HS code", temperature: "Temperature",
};
const CARGO_ORDER = Object.keys(CARGO_LABEL) as CargoKey[];
/** What to ask for each missing fact. */
const CARGO_ASK: Record<CargoKey, string> = {
  commodity: "What the cargo is (commodity)",
  packages: "The number and type of packages",
  gross_weight: "The gross weight",
  chargeable_weight: "The chargeable weight",
  volume: "The volume in cbm",
  dimensions: "The dimensions of each package (length × width × height in cm)",
  equipment: "The container type and number",
  incoterm: "The incoterm",
  pickup_address: "The pick-up address",
  cargo_ready: "When the cargo will be ready",
  stackable_dg: "Whether the cargo is stackable, and whether it is dangerous goods",
  hs_code: "The HS code",
  temperature: "The temperature the cargo needs",
};
/** A cargo label alone on its line, its value on the next one, as requests are often laid out. */
const CARGO_LABEL_LINE = /^\s*(?:\d+\s*[.)]?\s*)?(material|commodity|cargo|goods|description|product|gross weight|gr\.?\s*wt\.?|net weight|weight|chargeable weight|cbm|volume|dimensions?|dims|no\.? of [a-z]+|number of [a-z]+|packages|pkgs|incoterms?|terms|pick ?-?up address|collection address|factory address|hs ?code|cargo ready(?: date)?|ready date|temperature)\s*[:：]?\s*$/i;
const OWN_LABEL_LINE = /^[A-Za-z][\w .\/&()-]{0,30}?\s*[:：]\s*\S/;
const TEMPERATURE = /\btemp(?:erature)?\s*[:：]\s*([^\n]{1,40})/i;
const DATEISH = /\d|today|tomorrow|\bnow\b|immediate|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/** Labels alone on a line joined with their value; a bare figure under a volume or weight label gets its unit. */
function labelled(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\*+/g, "").trim());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CARGO_LABEL_LINE.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    const next = lines[j];
    // A next line that is a label with its own value ("AOL : NEAREST AIRPORT") is not this label's value.
    if (next == null || CARGO_LABEL_LINE.test(next) || OWN_LABEL_LINE.test(next) || next.length > 200) {
      out.push(lines[i]);
      continue;
    }
    const label = m[1];
    const unit = /^\d[\d,.]*$/.test(next) ? (/cbm|volume/i.test(label) ? " cbm" : /weight|wt/i.test(label) ? " kg" : "") : "";
    out.push(`${label}: ${next}${unit}`);
    i = j;
  }
  return out.join("\n");
}

const lineAround = (text: string, index: number) => {
  const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const end = text.indexOf("\n", index);
  return clip(text.slice(start, end < 0 ? text.length : end));
};
const unitWord = (u: string) => (/^k/i.test(u) ? "kg" : "t");
const firstUpper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The cargo facts a text states, each with the line it was read from. */
function cargoFacts(raw: string): Map<CargoKey, { value: string; sentence: string }> {
  const text = labelled(raw);
  const out = new Map<CargoKey, { value: string; sentence: string }>();
  const put = (key: CargoKey, value: string | null | undefined, index: number) => {
    const v = (value ?? "").replace(/\s+/g, " ").trim();
    if (v && !out.has(key)) out.set(key, { value: v, sentence: lineAround(text, index) });
  };
  for (const m of text.matchAll(every(CARGO_WEIGHT))) {
    const label = m[0].slice(0, m[0].search(/\d/)).toLowerCase();
    if (/net/.test(label)) continue;
    put(/charg|\bcw\b/.test(label) ? "chargeable_weight" : "gross_weight", `${m[1]} ${unitWord(m[2])}`, m.index ?? 0);
  }
  const volume = once(CARGO_VOLUME).exec(text);
  if (volume) put("volume", `${volume[1]} cbm`, volume.index);
  const packages = once(CARGO_PACKAGES).exec(text);
  if (packages) put("packages", packages[0], packages.index);
  const dims = once(CARGO_DIMS).exec(text);
  if (dims) put("dimensions", `${dims[1]} × ${dims[2]} × ${dims[3]} ${dims[4].toLowerCase()}${dims[5] ? ` × ${dims[5]}` : ""}`, dims.index);
  // "73 X 45 X 47 CM" is a package's size, not 73 containers of 45 ft.
  const equipment = [...text.matchAll(every(EQUIPMENT_A))].find((m) => !/^\s*[x×*]\s*\d/i.test(text.slice((m.index ?? 0) + m[0].length))) ?? once(EQUIPMENT_B).exec(text);
  if (equipment) put("equipment", equipment[0].toUpperCase().replace(/\s*[x×*]\s*/, "×").replace(/\s+/g, " "), equipment.index ?? 0);
  const incoterm = once(CARGO_INCOTERM).exec(text);
  if (incoterm) put("incoterm", /^EX/i.test(incoterm[1]) ? "EXW" : incoterm[1].toUpperCase(), incoterm.index);
  const commodity = once(CARGO_COMMODITY).exec(text);
  if (commodity) put("commodity", trimPunct(commodity[1]), commodity.index);
  const address = once(CARGO_ADDRESS).exec(text);
  if (address) put("pickup_address", trimPunct(address[1]), address.index);
  const ready = once(CARGO_READY).exec(text);
  if (ready) {
    const said = trimPunct((ready[1] ?? ready[2] ?? "").split(",")[0]);
    put("cargo_ready", DATEISH.test(said) ? said : "Ready", ready.index);
  }
  const stacking: string[] = [];
  let stackAt = -1;
  for (const m of text.matchAll(every(CARGO_STACK_DG))) {
    const w = m[1].replace(/\s+/g, " ").trim();
    const word = /^non[- ]?stackable$/i.test(w) ? "Non-stackable" : /^stackable$/i.test(w) ? "Stackable" : /^non[- ]?dg$/i.test(w) ? "Non DG" : /^non[- ]?haz/i.test(w) ? "Non hazardous" : firstUpper(w);
    if (!stacking.includes(word)) stacking.push(word);
    if (stackAt < 0) stackAt = m.index ?? 0;
  }
  if (stacking.length) put("stackable_dg", stacking.join(" · "), stackAt);
  const hs = once(CARGO_HS).exec(text);
  if (hs) put("hs_code", hs[1], hs.index);
  const temperature = TEMPERATURE.exec(text);
  if (temperature) put("temperature", trimPunct(temperature[1]), temperature.index);
  return out;
}

/** The register's mode, read from the quantity when the mode column is empty. */
const modeOf = (row: EnquiryRow): ShipmentMode | null => row.shipment_mode ?? (row.qty_text ? parseQty(row.qty_text).mode : null);

/** The facts this kind of shipment needs before an agent can rate it. */
function requiredKeys(row: EnquiryRow, incoterm: string | null): CargoKey[] {
  const mode = modeOf(row);
  const keys: CargoKey[] =
    mode === "AIR" ? ["gross_weight", "dimensions", "commodity"]
    : mode === "FCL" ? ["equipment", "commodity"]
    : mode === "LCL" ? ["volume", "gross_weight", "commodity"]
    : mode === "COURIER" ? ["gross_weight", "dimensions"]
    : [];
  const door = /\bdoor[\s-]?to[\s-]?(?:door|port)\b|\bex-?works\b|\bexw\b/i.test(`${row.subject ?? ""} ${row.requirements ?? ""}`);
  if (incoterm === "EXW" || door) keys.push("pickup_address");
  return keys;
}

/** A weight in kg from "2,892 kg" or "1.5 t". */
function kgOf(value: string | null | undefined): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(kg|t)\b/i.exec(value ?? "");
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? (/^t$/i.test(m[2]) ? n * 1000 : n) : null;
}

/** The volumetric weight of the dimensions: cm³ ÷ 6000 for air and courier, ÷ 1000 (a tonne a cbm) by sea. */
function volumetricKg(value: string | null | undefined, mode: ShipmentMode | null): number | null {
  const m = once(CARGO_DIMS).exec(value ?? "");
  if (!m) return null;
  const toCm = /^mm$/i.test(m[4]) ? 0.1 : /^m$/i.test(m[4]) ? 100 : /^in/i.test(m[4]) ? 2.54 : 1;
  const [a, b, c] = [m[1], m[2], m[3]].map((x) => Number.parseFloat(x) * toCm);
  const count = m[5] ? Number.parseInt(m[5], 10) : 1;
  const cm3 = a * b * c * (count > 0 ? count : 1);
  return Number.isFinite(cm3) && cm3 > 0 ? cm3 / (mode === "AIR" || mode === "COURIER" ? 6000 : 1000) : null;
}

/**
 * What is known about the cargo and where each fact was read, in this order of trust: our newest request to an
 * agent, our offer's basis, the customer's e-mails, the register's requirements and quantity, then the AI's
 * reading. The facts the mode needs and nobody gave are the gaps; the request block and the questions are built
 * from what is known.
 */
export function cargoOf(row: EnquiryRow, mails: ReadMail[]): CargoCheck {
  const r = row ?? ({} as EnquiryRow);
  try {
    const list = scoped(mails);
    const today = todayOf(list);
    const facts = new Map<CargoKey, { value: string; source: string; proof: Proof | null }>();
    const take = (found: Map<CargoKey, { value: string; sentence: string }>, source: string, mail: ReadMail | null, keys?: CargoKey[]) => {
      for (const [key, fact] of found) {
        if (facts.has(key) || (keys && !keys.includes(key))) continue;
        facts.set(key, { value: fact.value, source, proof: mail ? proofOf(mail, today, fact.sentence) : null });
      }
    };
    const newest = [...list].reverse();
    const clean = (m: ReadMail) => (typeof m.clean === "string" ? m.clean : "");

    for (const m of newest) {
      if (m.party !== "us" || !m.toParty || m.toParty === "internal" || m.toParty === "customer") continue;
      if (REQUEST_BLOCK.test(clean(m)) || RATE_REQUEST.test(clean(m))) take(cargoFacts(clean(m)), `our request, ${shortWhen(m.at, today)}`, m);
    }
    for (const m of newest) {
      if (m.party !== "us" || m.toParty !== "customer" || !(OUR_PRICE_LINE.test(clean(m)) || BASIS.test(clean(m)))) continue;
      take(cargoFacts(clean(m)), `our offer, ${shortWhen(m.at, today)}`, m, ["volume", "gross_weight", "chargeable_weight", "packages", "dimensions", "stackable_dg"]);
    }
    for (const m of newest) if (m.party === "customer") take(cargoFacts(clean(m)), `the customer, ${shortWhen(m.at, today)}`, m);
    if (typeof r.requirements === "string" && r.requirements.trim()) take(cargoFacts(r.requirements), "requirements", null);

    const register = new Map<CargoKey, { value: string; sentence: string }>();
    const house = parseHouseSubject(r.subject);
    if (house?.incoterm) register.set("incoterm", { value: house.incoterm, sentence: "" });
    const qty = parseQty(r.qty_text ?? null);
    if (qty.mode === "FCL" && qty.containerType && r.qty_text) register.set("equipment", { value: r.qty_text.trim(), sentence: "" });
    take(register, "register", null);

    for (const m of newest) {
      const ai = m.email?.ai_result?.shipment;
      if (!ai || typeof ai !== "object") continue;
      const read = new Map<CargoKey, { value: string; sentence: string }>();
      const put = (key: CargoKey, v: unknown) => {
        if (typeof v === "string" && v.trim()) read.set(key, { value: clip(v, 120), sentence: "" });
      };
      put("commodity", ai.commodity);
      put("packages", ai.packages);
      put("gross_weight", ai.weight);
      put("volume", ai.volume);
      put("dimensions", ai.dimensions);
      put("incoterm", ai.incoterm);
      put("cargo_ready", ai.cargo_ready);
      take(read, "read by AI", m);
      break;
    }

    const incoterm = facts.get("incoterm")?.value.toUpperCase() ?? null;
    const required = requiredKeys(r, incoterm);
    const fields: CargoField[] = CARGO_ORDER.filter((key) => required.includes(key) || facts.has(key)).map((key) => {
      const fact = facts.get(key);
      return { key, label: CARGO_LABEL[key], value: fact?.value ?? null, source: fact?.source ?? null, proof: fact?.proof ?? null, required: required.includes(key) };
    });
    const gaps = required.filter((key) => !facts.has(key));

    const mode = modeOf(r);
    const dims = facts.get("dimensions")?.value ?? null;
    const gross = facts.get("gross_weight")?.value ?? null;
    const grossKg = kgOf(gross);
    const volumetric = volumetricKg(dims, mode);
    const warning = grossKg && volumetric && volumetric > 10 * grossKg ? `Check the dimensions: ${dims} for ${gross} looks like a typo.` : null;

    return { fields, gaps, warning, requestBlock: requestBlockOf(r, facts), askText: askTextOf(gaps) };
  } catch {
    return { fields: [], gaps: [], warning: null, requestBlock: attempt(() => requestBlockOf(r, new Map()), ""), askText: "" };
  }
}

/** The lines the house sends to agents, from the register and the facts found. */
function requestBlockOf(row: EnquiryRow, facts: Map<CargoKey, { value: string }>): string {
  const value = (key: CargoKey) => facts.get(key)?.value ?? null;
  const lines: [string, string | null | undefined][] = [
    ["POL", row.pol],
    ["POD", row.pod],
    ["UNIT", row.qty_text || row.shipment_mode],
    ["INCOTERM", value("incoterm")],
    ["COMMODITY", value("commodity")],
    ["DIMENSIONS", value("dimensions")],
    ["GR. WT.", value("gross_weight")],
    ["VOLUME", value("volume")],
    ["PACKAGES", value("packages")],
    ["PICK UP ADDRESS", value("pickup_address")],
  ];
  const out = lines.filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => `${k} : ${(v as string).trim()}`);
  if (modeOf(row) === "FCL") out.push("14 days free detention at destination; MBL seaway or telex");
  return out.join("\n");
}

/** The missing facts as a short numbered request. */
function askTextOf(gaps: CargoKey[]): string {
  if (!gaps.length) return "";
  return [`Please share these details of the shipment:`, ...gaps.map((key, i) => `${i + 1}. ${CARGO_ASK[key]}`)].join("\n");
}

// --- Drift (C.3.14) -------------------------------------------------------------------------------------------

const STATUS_WORD: Record<string, string> = { new: "awaiting quote", quoted: "quoted", confirmed: "confirmed" };
const SPECIFIC_MODES = new Set<ShipmentMode>(["FCL", "LCL", "AIR", "COURIER"]);
const MODE_WORD: Record<string, string> = { FCL: "FCL", LCL: "LCL", AIR: "air", COURIER: "courier" };
const portKey = (port: string | null | undefined) => shortPort(port).toUpperCase().replace(/\bMCT\b/, "MUSCAT");

/** Whether two ports are the same place: the same short name, or one inside the other. */
function samePort(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = portKey(a);
  const y = portKey(b);
  if (!x || !y || x === y) return true;
  return (b ?? "").toUpperCase().includes(x) || (a ?? "").toUpperCase().includes(y);
}

/** The register's incoterm: from its subject, else its requirements. */
function registerIncoterm(row: EnquiryRow): string | null {
  const house = parseHouseSubject(row.subject);
  if (house?.incoterm) return house.incoterm;
  const m = once(CARGO_INCOTERM).exec(row.requirements ?? "");
  return m ? (/^EX/i.test(m[1]) ? "EXW" : m[1].toUpperCase()) : null;
}

/**
 * Where the e-mails say something else than the register: the status (a won cue; an offer on a new row), the
 * quoted date, a date before the enquiry date, the quantity, incoterm, route, mode and direction of the newest
 * agent-side subject that carries our reference, the agent, and the contact our offer went to. Each comes with a
 * suggestion for the Edit form (the person saves) and an id for "Keep the register's".
 */
export function driftOf(
  row: EnquiryRow,
  mails: ReadMail[],
  sides: Side[],
  offer: Offer | null,
  buy: Buy | null,
  won: WonCue[],
  dismissed: string[],
  today: string,
): Drift[] {
  try {
    if (!row) return [];
    const list = scoped(mails);
    const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : todayOf(list);
    const put = new Set<string>();
    const away = new Set((Array.isArray(dismissed) ? dismissed : []).filter((d): d is string => typeof d === "string"));
    const out: Drift[] = [];
    const add = (kind: DriftKind, key: string, d: Omit<Drift, "id" | "kind">) => {
      const id = `drift:${kind}:${key}`;
      if (!away.has(id) && !put.has(id)) {
        put.add(id);
        out.push({ id, kind, ...d });
      }
    };
    const dayText = (iso: string) => dayWithWeekday(iso, day || iso);
    const byId = new Map(list.map((m) => [m.id, m]));
    const sideList = listOf(sides);

    // The days our offer went out, the first one first.
    const offerDays: string[] = [];
    if (offer) {
      const start = offerStart(offer, byId);
      if (start) offerDays.push(muscatDate(new Date(start).toISOString()));
      if (timeOf(offer.sentAt)) offerDays.push(muscatDate(new Date(timeOf(offer.sentAt)).toISOString()));
      for (const e of [...listOf(offer.earlier), ...listOf(offer.options)]) {
        const m = byId.get(e.proof?.emailId ?? "");
        if (m?.day) offerDays.push(m.day);
      }
    }
    const firstOffer = offerDays.length ? [...offerDays].sort()[0] : null;

    // Status.
    const open = row.status === "new" || row.status === "quoted";
    const cues = listOf(won);
    const winDay = open ? wonDay(cues) : null;
    // Our own won cues put away with "Not won yet" (won:{day}) say nothing about the status; a yes from the customer still does.
    const notWonYet = !!winDay && away.has(`won:${winDay}`) && !cues.some((c) => c.kind === "customer_yes");
    if (winDay && !notWonYet) {
      const cue = cues.find((c) => c.kind === "customer_yes") ?? cues.find((c) => c.day === winDay) ?? cues[0];
      const mismatch = cues.some((c) => c.kind === "customer_yes" && c.amountMismatch);
      const mail = `won on ${dayText(winDay)}`;
      const register = STATUS_WORD[row.status] ?? row.status;
      add("status", `won:${winDay}`, {
        text: `E-mails say ${mail}; the register says ${register}${mismatch ? ". The amount in their yes is not this offer's — check it is this enquiry" : ""}`,
        register,
        mail,
        proof: cue?.proof ?? null,
        prefill: mismatch
          ? null
          : {
              confirmed_date: winDay,
              ...(row.quoted_date ? {} : { quoted_date: firstOffer ?? winDay }),
              notes: [`Won by e-mail${cue?.proof ? `: ${cue.proof.who}, ${cue.proof.when}` : ""}`],
            },
        buttonLabel: mismatch ? "" : "Confirm job…",
      });
    } else if (row.status === "new" && offer && firstOffer) {
      const mail = `quoted on ${dayText(firstOffer)}`;
      add("status", `quoted:${firstOffer}`, {
        text: `E-mails say ${mail}; the register says awaiting quote`,
        register: "awaiting quote",
        mail,
        proof: offer.proof ?? null,
        prefill: { quoted_date: firstOffer, notes: [`Quoted by e-mail${offer.proof ? `: ${offer.proof.who}, ${offer.proof.when}` : ""}`] },
        buttonLabel: "Mark quoted…",
      });
    }

    // The quoted date, when the e-mails show a quote before the register's day. A first offer on file after it proves
    // nothing: the first quote may have gone by phone or before the mailbox was watched.
    if (row.quoted_date && firstOffer && !offerDays.includes(row.quoted_date) && firstOffer < row.quoted_date) {
      const mail = dayText(firstOffer);
      const register = dayText(row.quoted_date);
      add("quoted_date", firstOffer, {
        text: `E-mails say quoted on ${mail}; the register says ${register}`,
        register,
        mail,
        proof: offer?.proof ?? null,
        prefill: { quoted_date: firstOffer, replace: ["quoted_date"], notes: [`Our offer went out on ${mail}${offer?.proof ? ` (${offer.proof.who})` : ""}`] },
        buttonLabel: "Update the date…",
      });
    }

    // Dates in the wrong order.
    for (const [field, word] of [["confirmed_date", "Confirmed"], ["quoted_date", "Quoted"]] as const) {
      const value = row[field];
      if (!value || !row.enquiry_date || value >= row.enquiry_date) continue;
      const register = `${word.toLowerCase()} ${fmtDayMonth(value, day || value)}`;
      add("date_order", `${field}:${value}`, {
        text: `${word} ${fmtDayMonth(value, day || value)} is before the enquiry date — a typo?`,
        register,
        mail: "",
        proof: null,
        prefill: { replace: [field], notes: [`The enquiry came in on ${fmtDayMonth(row.enquiry_date, day || row.enquiry_date)}.`] },
        buttonLabel: "Fix the date…",
      });
    }

    // The newest agent-side subject that carries our reference.
    const agentKeys = new Set(sideList.filter((s) => s.kind === "agent").map((s) => s.key));
    const onAgentSide = (m: ReadMail) => (agentKeys.size ? agentKeys.has(m.sideKey) : m.party === "agent" || (m.party === "us" && m.toParty === "agent"));
    const reference = refKey(row.reference);
    let house: HouseSubject | null = null;
    let houseMail: ReadMail | null = null;
    for (let i = list.length - 1; i >= 0 && !house; i--) {
      const m = list[i];
      if (!onAgentSide(m) || !refsIn(m.email?.subject).includes(reference)) continue;
      house = houseOf(m.email?.subject);
      if (house) houseMail = m;
    }
    if (house && houseMail) {
      const subject = (houseMail.email.subject ?? "").trim();
      const proof = proofOf(houseMail, day, subject);
      const note = `From the subject of ${proof.who}'s e-mail of ${proof.when}: ${clip(subject, 120)}`;
      const theirs = house.qty_text ? parseQty(house.qty_text) : null;
      const ours = row.qty_text ? parseQty(row.qty_text) : null;
      const rowMode = modeOf(row);
      const mode = theirs?.mode ?? null;
      if (mode && SPECIFIC_MODES.has(mode) && mode !== rowMode && (!rowMode || SPECIFIC_MODES.has(rowMode) || rowMode === "OTHER")) {
        const mail = MODE_WORD[mode] ?? mode;
        const register = rowMode ? (MODE_WORD[rowMode] ?? rowMode) : "";
        add("mode", mode, {
          text: register ? `E-mails say ${mail}; the register says ${register}` : `E-mails say ${mail}; the register has no mode`,
          register,
          mail,
          proof,
          prefill: { shipment_mode: mode, ...(house.qty_text ? { qty_text: house.qty_text } : {}), replace: ["shipment_mode", "qty_text"], notes: [note] },
          buttonLabel: "Update…",
        });
      } else if (mode === "FCL" && house.qty_text && (!ours || ours.mode === "FCL") && (ours?.units !== theirs?.units || ours?.containerType !== theirs?.containerType)) {
        const mail = house.qty_text;
        const register = row.qty_text?.trim() ?? "";
        add("quantity", nameKey(mail) ?? mail, {
          text: register ? `E-mails say ${mail}; the register says ${register}` : `E-mails say ${mail}; the register has no quantity`,
          register,
          mail,
          proof,
          prefill: { qty_text: mail, ...(register ? { replace: ["qty_text"] } : {}), notes: [note] },
          buttonLabel: "Update…",
        });
      }
      const theirIncoterm = house.incoterm;
      const ourIncoterm = registerIncoterm(row);
      if (theirIncoterm && ourIncoterm && theirIncoterm !== ourIncoterm) {
        add("incoterm", theirIncoterm, {
          text: `E-mails say ${theirIncoterm}; the register says ${ourIncoterm}`,
          register: ourIncoterm,
          mail: theirIncoterm,
          proof,
          prefill: null,
          buttonLabel: "",
        });
      }
      const polMoved = !samePort(house.pol, row.pol);
      const podMoved = !samePort(house.pod, row.pod);
      if ((polMoved && row.pol) || (podMoved && row.pod)) {
        const mail = `${shortPort(house.pol)} → ${shortPort(house.pod)}`;
        const register = `${shortPort(row.pol) || "?"} → ${shortPort(row.pod) || "?"}`;
        add("route", portKey(house.pol) + ">" + portKey(house.pod), {
          text: `E-mails say ${mail}; the register says ${register}`,
          register,
          mail,
          proof,
          prefill: {
            ...(polMoved ? { pol: house.pol } : {}),
            ...(podMoved ? { pod: house.pod } : {}),
            replace: [...(polMoved ? ["pol"] : []), ...(podMoved ? ["pod"] : [])],
            notes: [note],
          },
          buttonLabel: "Update…",
        });
      }
      const direction = house.trade_type === "IMP" || house.trade_type === "EXP" ? house.trade_type : null;
      if (direction && row.trade_type && direction !== row.trade_type) {
        const mail = TRADE_LABELS[direction];
        const register = TRADE_LABELS[row.trade_type];
        add("direction", direction, {
          text: `E-mails say ${mail}; the register says ${register}`,
          register,
          mail,
          proof,
          prefill: { trade_type: direction, replace: ["trade_type"], notes: [note] },
          buttonLabel: "Update…",
        });
      }
    }

    // The agent.
    let chosen: { key: string; name: string | null; label: string; proof: Proof | null } | null = null;
    if (buy?.agreed) {
      const side = sideList.find((s) => s.key === buy.sideKey);
      chosen = { key: buy.sideKey, name: side?.agentName ?? null, label: displayName(side?.agentName) || buy.agentName || buy.sideKey, proof: buy.proof ?? null };
    } else {
      const rated = sideList.filter((s) => s.kind === "agent" && (s.agent?.state === "rated" || s.agent?.state === "agreed"));
      if (rated.length === 1) {
        const side = rated[0];
        chosen = { key: side.key, name: side.agentName, label: displayName(side.agentName) || side.name || side.key, proof: side.agent?.latest?.proof ?? null };
      }
    }
    if (chosen && chosen.label && !(chosen.name && nameKey(chosen.name) === nameKey(row.agent_name))) {
      const register = row.agent_name ? displayName(row.agent_name) : "";
      add("agent", nameKey(chosen.name) ?? chosen.key, {
        text: register ? `E-mails say the agent is ${chosen.label}; the register says ${register}` : `E-mails say the agent is ${chosen.label}; the register has none`,
        register,
        mail: chosen.label,
        proof: chosen.proof,
        prefill: chosen.name
          ? { agent_name: chosen.name, ...(row.agent_name ? { replace: ["agent_name"] } : {}), notes: [`The e-mails are with ${chosen.label}${chosen.proof ? ` (${chosen.proof.who}, ${chosen.proof.when})` : ""}`] }
          : null,
        buttonLabel: chosen.name ? "Update agent…" : "",
      });
    }

    // The contact our offer went to.
    const sentTo = listAddresses(offer?.sentTo).map(lower).filter((a) => a.includes("@") && !isOurAddress(a));
    const contact = lower(row.contact_email);
    if (offer && sentTo.length && !sentTo.includes(contact)) {
      const address = sentTo[0];
      const name = majority(list.filter((m) => lower(m.from?.email) === address).map(displayedName));
      add("contact", address, {
        text: contact ? `Our offer went to ${address}; the register's contact is ${row.contact_email?.trim()}` : `Our offer went to ${address}; the register has no contact`,
        register: contact ? (row.contact_email ?? "").trim() : "",
        mail: address,
        proof: offer.proof ?? null,
        prefill: {
          contact_email: address,
          ...(name ? { contact_name: name } : {}),
          ...(contact ? { replace: ["contact_name", "contact_email", "contact_phone"] } : {}),
          notes: [`Our offer${offer.proof ? ` of ${offer.proof.when}` : ""} went to ${address}`],
        },
        buttonLabel: "Update contact…",
      });
    }
    return out;
  } catch {
    return [];
  }
}
