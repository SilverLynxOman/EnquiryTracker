import { displayName, shortPort } from "../display";
import { gmailThreadUrl, muscatDate, splitBody } from "../emailDrafts";
import { customerMarks, dayWithWeekday, emailDomain, isCustomerSender, muscatTime, whenSent } from "../enquiryDetails";
import { addDays } from "../format";
import { parseHouseSubject, type HouseSubject } from "../houseSubject";
import { nameKey, parseQty } from "../normalize";
import type { EmailMessage, EnquiryRow, HistoryRow } from "../types";
import { isWorkingDay, nextWorkingDay } from "../workdays";
import { AGENT_DOMAINS, STAFF } from "./constants";
import {
  ACK,
  ACK_WORDS,
  BOILERPLATE,
  BOUNCE_ADDRESS,
  BOUNCE_BODY,
  BOUNCE_FROM,
  BOUNCE_SUBJECT,
  CARRIER_DOMAIN,
  CHASE,
  DEADLINE_CLOCK,
  DEADLINE_DAY,
  DEADLINE_SPAN,
  DEADLINE_TODAY,
  DISPLAY_SPLIT,
  ESCALATION,
  FORWARDER_WORDS,
  FYI,
  GREETING,
  HOLD,
  HOLIDAY,
  LINK_WRAPPERS,
  LOOP_IN,
  NOISE_SENDER,
  NOISE_SUBJECT,
  NOISE_TEXT,
  OFFER_CUE,
  OUR_PRICE_LINE,
  PORT_DOMAINS,
  PROMISE,
  QUOTED_HEADER_LEAK,
  RATE_REQUEST,
  REQUEST,
  REQUEST_BLOCK,
  SHIPPER_BLOCK,
  SIGNATURE_IMAGE,
  SIGN_OFF_EXISTING,
  SIGN_OFF_EXTRA,
  SL_REF,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from "./patterns";
import type {
  Age,
  BriefInput,
  ChaseRun,
  CrossFiled,
  CrossFiledGroup,
  Deadline,
  DocFile,
  HiddenCounts,
  MailInput,
  NoiseKind,
  OtherParty,
  Party,
  PartyContext,
  PersonRef,
  Proof,
  Question,
  ReadMail,
  ReplyWindow,
  Side,
  SideKind,
  SideState,
  Sourced,
  StaffMember,
} from "./types";

// The reading layer of the enquiry brief: every filed e-mail cleaned, given a party and a conversation, and marked
// with what kind of e-mail it is. Pure and synchronous. The money, shipment, people and view modules build on it.

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
const round2 = (n: number) => Math.round(n * 100) / 100;
const isDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
/** One reading that fails gives its empty value; the rest of the page still reads. */
function attempt<T>(read: () => T, empty: T): T {
  try {
    return read();
  } catch {
    return empty;
  }
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Text on one line, cut at a word to at most max characters. */
function clip(text: string, max = 200): string {
  const body = text.replace(/\s+/g, " ").trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

// --- Cleaning -------------------------------------------------------------------------------------------------

/** Runs of spaces and tabs as one space, line breaks kept: what the kind rules test, so "the  SO status" still reads. */
const flat = (text: string) => text.replace(/[ \t]+/g, " ");

/** UTF-8 punctuation read as Windows-1252 by the sender's mail program ("â€“" for "–"). */
const MOJIBAKE = /â€[“”™˜œ\u009d¦]|â€/g;
const MOJIBAKE_FIX: Record<string, string> = { "â€“": "–", "â€”": "—", "â€™": "’", "â€˜": "‘", "â€œ": "“", "â€\u009d": "”", "â€¦": "…", "â€": "”" };

/** A text with that punctuation put right. */
export function repairedText(text: string): string {
  return typeof text === "string" ? text.replace(MOJIBAKE, (seq) => MOJIBAKE_FIX[seq] ?? seq) : "";
}

/**
 * What the sender wrote: the body without the quoted history, cut where a quoted header leaked into it. Non-breaking
 * spaces (also written out as "&nbsp;") become plain spaces and invisible characters go.
 */
function newPart(email: Pick<EmailMessage, "body_text" | "snippet"> | null | undefined): string {
  const body = typeof email?.body_text === "string" && email.body_text ? email.body_text : email?.snippet;
  let text = splitBody(typeof body === "string" ? body : "")
    .text.replace(/\r\n?/g, "\n")
    .replace(/&nbsp;|[\u00a0\u2007\u202f]/gi, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/&amp;/gi, "&")
    .replace(MOJIBAKE, (seq) => MOJIBAKE_FIX[seq] ?? seq);
  const leak = text.search(QUOTED_HEADER_LEAK);
  if (leak >= 0) text = text.slice(0, leak);
  return text;
}

function firstSignOff(text: string): number {
  const a = text.search(SIGN_OFF_EXISTING);
  const b = text.search(SIGN_OFF_EXTRA);
  return a < 0 ? b : b < 0 ? a : Math.min(a, b);
}

/** "Thanks," as the first line of a mail that goes on below it. */
const OPENING_THANKS = /^\s*(?:many thanks|thank you|thanks)[\s,.!]*\n/i;

/**
 * Where the sign-off line starts, or -1. A bare "Thanks," that opens the mail is not the sign-off when a later
 * line is: what stands between them is the message.
 */
function signOffAt(text: string): number {
  const at = firstSignOff(text);
  if (at < 0 || text.slice(0, at).trim()) return at;
  const opening = OPENING_THANKS.exec(text);
  if (!opening) return at;
  const later = firstSignOff(text.slice(opening[0].length - 1));
  return later < 0 ? at : opening[0].length - 1 + later;
}

const tidy = (text: string) => text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** The greeting removed (twice: "Dear Ashwin, Dear Anwar,"), also under a shout on a line of its own ("URGENT", "Reminder"). */
function withoutGreeting(text: string): string {
  const body = text.replace(GREETING, "").replace(GREETING, "");
  const first = /^\s*([^\n]{2,30})\n\s*/.exec(body);
  if (!first) return body;
  const shout = !/[a-z]/.test(first[1]) || /^[*_ ]*(?:kind |gentle |friendly )?reminder[ !.*_]*$/i.test(first[1]);
  return shout ? first[0] + body.slice(first[0].length).replace(GREETING, "") : body;
}

/** A name or a company on a line: no figure, no label, none of the words a sentence is made of. */
const NAME_LINE = /^[^\d:：@]{2,40}$/;
const SENTENCE_WORD = /\b(?:please|pls|plz|kindly|the|to|is|are|was|will|we|you|your|our|and|for|with|from|this|that)\b/i;

/**
 * Where a signature without a sign-off starts, or -1: a block of short lines that opens with a name and ends with
 * the sender's own address, alone on its line or after "E-mail:". Told only when the sender is known.
 */
function ownBlockAt(text: string, sender: string): number {
  const at = sender.includes("@") ? text.toLowerCase().lastIndexOf(sender) : -1;
  if (at < 0) return -1;
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const lineEnd = text.indexOf("\n", at);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).toLowerCase();
  const before = line.slice(0, at - lineStart);
  const after = line.slice(at - lineStart + sender.length);
  if (!/^\s*(?:(?:e-?mail|mail|e)\s*(?:id|address)?\s*[:：]?)?\s*<?$/.test(before) || !/^>?\s*$/.test(after)) return -1;
  const lineAbove = (start: number) => (start > 0 ? text.slice(text.lastIndexOf("\n", start - 2) + 1, start - 1) : "");
  const ends = (above: string) => /[.?!]\s*$/.test(above);
  let top = lineStart;
  for (let lines = 0; top > 0 && lines < 10; lines++) {
    const above = lineAbove(top);
    if (!above.trim() || above.length > 120 || ends(above)) break;
    top -= above.length + 1;
  }
  if (top === lineStart) return -1;
  const first = text.slice(top, text.indexOf("\n", top)).trim();
  const above = lineAbove(top);
  if (!NAME_LINE.test(first) || SENTENCE_WORD.test(first) || (above.trim() && !ends(above))) return -1;
  return top;
}

const senderOf = (email: unknown): string => lower((email as { from_email?: unknown } | null | undefined)?.from_email);

/** Where the message ends and the signature starts: the sign-off line, else the sender's own contact block; or -1. */
function signatureAt(text: string, sender: string): number {
  const at = signOffAt(text);
  return at >= 0 ? at : ownBlockAt(text, sender);
}

/**
 * The new text cleaned in a fixed order: standing notices, link wrappers, greeting, then everything from the
 * sign-off. keepAddresses leaves the address of a mailto link in place (shipper blocks are read from it).
 */
function cleaned(email: Pick<EmailMessage, "body_text" | "snippet"> | null | undefined, keepAddresses = false): string {
  let text = newPart(email).replace(BOILERPLATE, "");
  if (keepAddresses) text = text.replace(/<mailto:\s*([^>\s]+)\s*>/gi, " $1 ");
  text = withoutGreeting(text.replace(LINK_WRAPPERS, ""));
  const cut = signatureAt(text, senderOf(email));
  return tidy(cut >= 0 ? text.slice(0, cut) : text);
}

/**
 * New text of a mail, cleaned in a fixed order: quoted headers, boilerplate, link wrappers, greeting, sign-off.
 * Given the whole e-mail, a contact block that ends with the sender's own address counts as the sign-off too.
 */
export function cleanText(email: Pick<EmailMessage, "body_text" | "snippet">): string {
  try {
    return cleaned(email);
  } catch {
    return "";
  }
}

/**
 * The sender's signature block: the lines after the sign-off line up to the first boilerplate. Without a sign-off,
 * the contact block that ends with the sender's own address (when the whole e-mail is given).
 */
export function signatureTextOf(email: Pick<EmailMessage, "body_text" | "snippet">): string {
  try {
    const text = withoutGreeting(newPart(email).replace(LINK_WRAPPERS, " "));
    const at = signOffAt(text);
    if (at >= 0) return tidy(text.slice(at).replace(/^\n?[^\n]*\n?/, "").replace(BOILERPLATE, ""));
    const own = ownBlockAt(text, senderOf(email));
    return own < 0 ? "" : tidy(text.slice(own).replace(BOILERPLATE, ""));
  } catch {
    return "";
  }
}

/** The first lines of a cleaned text without the greeting, at most max characters. */
export function excerptOf(clean: string, max = 200): string {
  return typeof clean === "string" ? clip(clean.replace(GREETING, ""), max) : "";
}

/**
 * A text split on . ? ! and line breaks, trimmed, empty pieces dropped. A full stop inside a number does not split,
 * nor one that ends "no." ("correct no. of wooden boxes") or another short abbreviation.
 */
export function sentencesOf(clean: string): string[] {
  if (typeof clean !== "string") return [];
  return clean
    .split(/(?<=[.?!])(?<!\b(?:[Nn]o|[Nn]os|[Aa]pprox|[Aa]ppx|[Aa]bt|[Rr]ef|[Vv]s)\.)\s+|\s*\n+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The sentence around a position in a text. */
function sentenceAt(text: string, index: number): { start: number; end: number; text: string } {
  let start = 0;
  const before = /[.?!]\s+|\n+/g;
  for (let m = before.exec(text); m && m.index < index; m = before.exec(text)) {
    if (m.index + m[0].length <= index) start = m.index + m[0].length;
  }
  const rest = text.slice(index);
  const stop = rest.search(/[.?!](?=\s|$)|\n/);
  const end = stop < 0 ? text.length : index + stop + (rest[stop] === "\n" ? 0 : 1);
  return { start, end, text: text.slice(start, end).trim() };
}

// --- Addresses and names --------------------------------------------------------------------------------------

/** Free-mail domains (the same list as is_public_email_domain in the database). */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com", "qq.com", "163.com", "126.com", "rediffmail.com", "omantel.net.om",
]);

/** Whether a domain is a free-mail one: it says nothing about the sender's company. */
export function isFreeMail(domain: string | null | undefined): boolean {
  return FREE_MAIL.has(lower(domain));
}

const isOurAddress = (address: string) => emailDomain(address) === OUR_DOMAIN || address === OUR_GMAIL;

/** The staff member behind one of our addresses, or null. */
export function staffOf(address: string | null | undefined): StaffMember | null {
  const a = lower(address);
  if (!a) return null;
  if (Object.hasOwn(STAFF, a)) return STAFF[a];
  const local = a.slice(0, Math.max(0, a.lastIndexOf("@")));
  return emailDomain(a) === OUR_DOMAIN && Object.hasOwn(STAFF, local) ? STAFF[local] : null;
}

/** Outside addresses a mail went to (to, then cc): not ours and not the watched mailbox. */
export function outsideRecipients(email: Pick<EmailMessage, "to_emails" | "cc_emails">, mailbox?: string | null): string[] {
  const out: string[] = [];
  const own = lower(mailbox);
  for (const list of [email?.to_emails, email?.cc_emails]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const a = lower(raw);
      if (a && a.includes("@") && !isOurAddress(a) && a !== own && !out.includes(a)) out.push(a);
    }
  }
  return out;
}

/** A sender's name as shown: "Fahid, OTM" → "Fahid", "Smith, John" → "John Smith"; the address's local part without one. */
function personName(fromName: string | null | undefined, address: string): string {
  let name = (typeof fromName === "string" ? fromName : "").replace(/["<>]/g, "").replace(/\s+/g, " ").trim();
  if (!name || name.includes("@")) return address ? address.slice(0, address.lastIndexOf("@")) || address : "Unknown sender";
  const split = DISPLAY_SPLIT.exec(name);
  if (split) {
    const [, first, second] = split;
    name = /^[^,]+,\s/.test(name) && /^[A-Z][a-z]+$/.test(second) && !/\s/.test(first) ? `${second} ${first}` : first;
  }
  return name || address;
}

function personRef(email: MailInput, party: Party): PersonRef {
  const address = lower(email.from_email);
  const staff = party === "us" ? staffOf(address) : null;
  return { name: staff?.name ?? personName(email.from_name, address), email: address || null, staff };
}

const ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// --- Parties --------------------------------------------------------------------------------------------------

/** Legal forms and joining words: never what a company is recognised by. */
const LEGAL = new Set([
  "LLC", "SAOG", "SAOC", "SPC", "LTD", "LIMITED", "EST", "ESTABLISHMENT", "WLL", "FZE", "FZCO", "FZC", "INC", "PVT",
  "AND", "THE", "OF", "CO", "COMPANY",
]);
/** What may follow a customer's mark in a domain label: "hydrotecinternational", "acmeoman". */
const CUSTOMER_REST = new Set([
  "", "oman", "muscat", "om", "llc", "co", "group", "intl", "international", "trading", "trd", "gulf", "sohar",
  "salalah", "global", "est", "company", "holding", "me",
]);
/** What may follow an agent's mark in a domain label: "wincologistics", "maloneshipping". */
const AGENT_REST =
  /^(?:logistics?|shipping|cargo|freight|forwarding|forwarders?|lines?|express|worldwide|global|group|intl|international|trans|transport|consol|china|india|europe|uae|oman|muscat|me|co)+$/;
const DOMAIN_FILLER = new Set(["www", "mail", "email", "com", "net", "org", "gov", "edu", "co", "ac", "info", "biz"]);

/** The parts of a domain that carry the company's name. */
function labelsOf(domain: string): string[] {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return parts;
  return parts.slice(0, -1).filter((l) => !DOMAIN_FILLER.has(l));
}

/**
 * What a customer's domain would be made of: its marks (distinctive words, initials, the three-letter words of a
 * short name) and every word of the name, which may stand beside a mark ("omantextiles").
 */
function customerMarksOf(name: string | null | undefined): { marks: string[]; words: string[] } {
  const found = customerMarks(name ?? "");
  const words = (nameKey(name) ?? "").split(/[^A-Z]+/).filter((w) => w.length > 1 && !LEGAL.has(w)).map((w) => w.toLowerCase());
  const short = words.length <= 3 ? words.filter((w) => w.length === 3) : [];
  return { marks: [...new Set([...found.words, ...found.initials, ...short])], words };
}

/** Whether a domain label is made only of a company's own words and the usual endings, with one of its marks in it. */
function madeOfName(label: string, marks: string[], words: string[]): boolean {
  const text = label.replace(/-/g, "");
  const reach = new Array<number>(text.length + 1).fill(0);
  reach[0] = 1;
  for (let i = 0; i < text.length; i++) {
    if (!reach[i]) continue;
    for (const w of words) if (text.startsWith(w, i)) reach[i + w.length] = Math.max(reach[i + w.length], reach[i]);
    for (const w of CUSTOMER_REST) if (w && text.startsWith(w, i)) reach[i + w.length] = Math.max(reach[i + w.length], reach[i]);
    for (const m of marks) if (text.startsWith(m, i)) reach[i + m.length] = 2;
  }
  return reach[text.length] === 2;
}

/**
 * Whether an address is the customer's: the enquiry's contact or its company domain, the customer's name in the
 * domain or in the sender's name, initials or a short name with a usual ending ("gesoman", "xomoman"), or the
 * name in the local part of a free-mail address.
 */
function isCustomerAddress(address: string, domain: string, shown: string | null | undefined, ctx: PartyContext): boolean {
  const name = ctx.row?.customer_name ?? "";
  if (isCustomerSender(address, shown ?? null, { name, contactEmail: ctx.row?.contact_email })) return true;
  const { marks, words } = customerMarksOf(name);
  if (!marks.length) return false;
  if (isFreeMail(domain)) {
    const local = address.slice(0, address.lastIndexOf("@")).replace(/[^a-z]/g, "");
    return marks.some((m) => m.length >= 4 && local.includes(m));
  }
  return labelsOf(domain).some((label) => marks.includes(label.split("-")[0]) || madeOfName(label, marks, words));
}

/** What an agent's domain would be made of, from its register name. */
interface AgentMarks { name: string; words: string[]; initials: string[]; compact: string }
const AGENT_MARKS = new WeakMap<string[], AgentMarks[]>();
const AGENT_BY_DOMAIN = new WeakMap<string[], Map<string, string | null>>();

function agentMarksOf(name: string): AgentMarks {
  const marks = customerMarks(name);
  return { name, words: marks.words, initials: marks.initials, compact: (nameKey(name) ?? "").replace(/[^A-Z]/g, "").toLowerCase() };
}

/** Whether a domain (or a display name) carries an agent's register name. */
function matchesAgent(domain: string, shown: string | null | undefined, agent: AgentMarks): boolean {
  const follows = (label: string, mark: string) => {
    if (!label.startsWith(mark)) return false;
    const rest = label.slice(mark.length).replace(/-/g, "");
    return CUSTOMER_REST.has(rest) || AGENT_REST.test(rest);
  };
  for (const label of isFreeMail(domain) ? [] : labelsOf(domain)) {
    if (agent.initials.includes(label) || agent.initials.includes(label.split("-")[0])) return true;
    if (agent.words.some((w) => follows(label, w))) return true;
    if (agent.compact.length >= 3 && follows(label, agent.compact)) return true;
  }
  const name = (shown ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return !!name && agent.words.some((w) => name.includes(w));
}

function seedAgentName(domain: string): string | null {
  for (let d = domain; d.includes("."); d = d.slice(d.indexOf(".") + 1)) {
    if (Object.hasOwn(AGENT_DOMAINS, d)) return AGENT_DOMAINS[d];
  }
  return null;
}

/** The register agent name a domain maps to (seed table, then the agents' names), or null. */
export function agentNameForDomain(domain: string, agentNames?: string[]): string | null {
  try {
    const d = lower(domain);
    if (!d) return null;
    const seed = seedAgentName(d);
    if (!Array.isArray(agentNames) || !agentNames.length) return seed;
    let byDomain = AGENT_BY_DOMAIN.get(agentNames);
    if (!byDomain) AGENT_BY_DOMAIN.set(agentNames, (byDomain = new Map()));
    const known = byDomain.get(d);
    if (known !== undefined) return known;
    let marks = AGENT_MARKS.get(agentNames);
    if (!marks) AGENT_MARKS.set(agentNames, (marks = agentNames.filter((n) => typeof n === "string" && n.trim()).map(agentMarksOf)));
    const seedKey = seed ? nameKey(seed) : null;
    const hit =
      (seedKey ? marks.find((m) => nameKey(m.name) === seedKey) : undefined) ?? marks.find((m) => matchesAgent(d, null, m));
    byDomain.set(d, hit?.name ?? null);
    return hit?.name ?? null;
  } catch {
    return null;
  }
}

/** Whether an address or, for company domains, its domain is in a set of addresses. */
function inSet(set: Set<string> | undefined, address: string, domain: string): boolean {
  if (!set?.size || !address) return false;
  if (set.has(address)) return true;
  if (!domain || isFreeMail(domain)) return false;
  if (set.has(domain)) return true;
  for (const a of set) if (emailDomain(a) === domain) return true;
  return false;
}

/** The party of a sender. The first pass runs without the three sets: no offer, shipper or request rule. */
function partyOf(
  email: Pick<EmailMessage, "sender_type" | "from_email" | "from_name"> | null | undefined,
  ctx: PartyContext,
  withSets: boolean,
): Party {
  if (!email) return "other";
  const address = lower(email.from_email);
  const domain = emailDomain(address) ?? "";
  const chosen = ctx.overrides?.party;
  if (chosen) {
    for (const key of [address, domain]) if (key && Object.hasOwn(chosen, key)) return chosen[key];
  }
  if (email.sender_type !== "external" || isOurAddress(address)) return "us";
  if (!address || NOISE_SENDER.test(address) || PORT_DOMAINS.test(domain)) return "other";

  const seeded = seedAgentName(domain) != null || agentNameForDomain(domain, ctx.agentNames) != null;
  const registerAgent = !!ctx.row?.agent_name && matchesAgent(domain, email.from_name, agentMarksOf(ctx.row.agent_name));
  const asked = withSets && inSet(ctx.requestRecipients, address, domain);

  if (isCustomerAddress(address, domain, email.from_name, ctx)) return "customer";
  if (withSets && inSet(ctx.offerRecipients, address, domain) && !seeded && !registerAgent && !asked) return "customer";
  if (withSets && inSet(ctx.shipperAddresses, address, domain)) return "shipper";
  if (CARRIER_DOMAIN.test(domain)) return "carrier";
  if (seeded || registerAgent || asked) return "agent";
  if (!isFreeMail(domain) && FORWARDER_WORDS.test(labelsOf(domain).join("."))) return "agent";
  return "other";
}

/** Six-way party of a sender: us, the customer, an agent, a shipper, a carrier, or anyone else. */
export function classifyParty(email: Pick<EmailMessage, "sender_type" | "from_email" | "from_name">, ctx: PartyContext): Party {
  try {
    return partyOf(email, ctx ?? ({ row: {} } as PartyContext), true);
  } catch {
    return "other";
  }
}

/** The party of each address already asked about, per context: the same people are on every mail of a thread. */
const ADDRESS_PARTY = new WeakMap<PartyContext, Map<string, Party>>();

function partyOfAddress(address: string, ctx: PartyContext, withSets = true): Party {
  let known = ADDRESS_PARTY.get(ctx);
  if (!known) ADDRESS_PARTY.set(ctx, (known = new Map()));
  const key = `${withSets ? 1 : 0}${address}`;
  let party = known.get(key);
  if (!party) known.set(key, (party = partyOf({ sender_type: "external", from_email: address, from_name: null }, ctx, withSets)));
  return party;
}

const TO_PARTY_ORDER: OtherParty[] = ["customer", "agent", "shipper", "carrier", "other"];

/** The party a mail of ours was written to: the outside recipients' parties, customer first; "internal" without one. */
function toPartyOf(outside: string[], ctx: PartyContext): OtherParty | "internal" {
  const parties = new Set(outside.map((a) => partyOfAddress(a, ctx)));
  return TO_PARTY_ORDER.find((p) => parties.has(p)) ?? "internal";
}

const keyOfAddress = (address: string): string => {
  const domain = emailDomain(address);
  return !domain ? "" : isFreeMail(domain) ? address : domain;
};

/** Side keys of the outside recipients of one party: those in "to" first, those in "cc" when "to" has none. */
function recipientKeys(email: MailInput, party: OtherParty, ctx: PartyContext): string[] {
  for (const list of [email.to_emails, email.cc_emails]) {
    const keys: string[] = [];
    for (const a of outsideRecipients({ to_emails: list, cc_emails: [] })) {
      const key = keyOfAddress(a);
      if (key && partyOfAddress(a, ctx) === party && !keys.includes(key)) keys.push(key);
    }
    if (keys.length) return keys;
  }
  return [];
}

/** Side key of a mail: "customer", "internal", or the counterpart's domain (the exact address for free mail). */
export function sideKeyOf(email: MailInput, party: Party, toParty: ReadMail["toParty"], ctx: PartyContext): string {
  try {
    if (party === "customer" || (party === "us" && toParty === "customer")) return "customer";
    if (party === "us") return !toParty || toParty === "internal" ? "internal" : (recipientKeys(email, toParty, ctx)[0] ?? "internal");
    return keyOfAddress(lower(email?.from_email)) || "unknown";
  } catch {
    return "unknown";
  }
}

/** The conversation a mail belongs to and its kind. A bounce belongs to the address that could not be reached. */
function conversationOf(
  email: MailInput,
  party: Party,
  toParty: ReadMail["toParty"],
  bounced: string | null,
  ctx: PartyContext,
): { key: string; kind: SideKind } {
  const failed = bounced ? partyOfAddress(bounced, ctx) : "us";
  if (bounced && failed !== "us") return { key: failed === "customer" ? "customer" : keyOfAddress(bounced) || "unknown", kind: failed };
  const key = sideKeyOf(email, party, toParty, ctx) || "unknown";
  if (key === "customer" || key === "internal") return { key, kind: key };
  const counterpart = party === "us" ? toParty : party;
  return { key, kind: !counterpart || counterpart === "internal" ? "other" : counterpart };
}

// --- Wrong enquiry --------------------------------------------------------------------------------------------

const refKey = (reference: string | null | undefined): string => {
  const m = /SL\s?-?(\d{6})/i.exec(reference ?? "");
  return m ? `SL${m[1]}` : (reference ?? "").trim().toUpperCase();
};

/** The SL references a subject carries, as "SL262784". */
function refsIn(subject: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (subject ?? "").matchAll(SL_REF)) if (!out.includes(`SL${m[1]}`)) out.push(`SL${m[1]}`);
  return out;
}

const portKey = (port: string | null | undefined) => shortPort(port).toUpperCase().replace(/\bMCT\b/, "MUSCAT");

/** "LCL Ningbo → Sohar" */
function aboutOf(qty: string | null | undefined, pol: string | null | undefined, pod: string | null | undefined): string | null {
  const route = pol || pod ? `${shortPort(pol) || "?"} → ${shortPort(pod) || "?"}` : "";
  return [qty?.trim(), route].filter(Boolean).join(" ") || null;
}

const SPECIFIC_MODES = new Set(["FCL", "LCL", "AIR", "COURIER"]);

/** Whether a house subject names another mode or another port of discharge than the register's. */
function contradicts(house: HouseSubject, row: Pick<EnquiryRow, "shipment_mode" | "pod">): boolean {
  const mode = house.qty_text ? parseQty(house.qty_text).mode : null;
  if (mode && SPECIFIC_MODES.has(mode) && row.shipment_mode && SPECIFIC_MODES.has(row.shipment_mode) && mode !== row.shipment_mode) {
    return true;
  }
  const theirs = portKey(house.pod);
  const ours = portKey(row.pod);
  if (!theirs || !ours || theirs === ours) return false;
  return !(row.pod ?? "").toUpperCase().includes(theirs) && !house.pod.toUpperCase().includes(ours);
}

/** The house subject in a subject line, also when it follows other parts ("ENQ1020…//ABSOH…// LCL FOB NINGBO CHINA TO SOHAR OMAN"). */
function houseOf(subject: string | null | undefined): HouseSubject | null {
  const whole = parseHouseSubject(subject);
  if (whole || !subject || !subject.includes("//")) return whole;
  for (const part of subject.split("//")) {
    const parsed = parseHouseSubject(part);
    if (parsed) return parsed;
  }
  return null;
}

/** Whether a mail may be judged at all: not one a person filed here by hand, nor on a thread the person kept here. */
const mayBeElsewhere = (email: MailInput | null | undefined, ctx: PartyContext | null | undefined): boolean =>
  !!email && email.match_method !== "manual" && !ctx?.overrides?.keptThreads?.includes(email.gmail_thread_id);

/**
 * Whether the mail belongs to another enquiry: another reference, a contradicting subject, or an unknown sender.
 * Never for a thread the person kept here, nor for a mail a person filed here by hand.
 */
export function crossFiledOf(email: MailInput, row: EnquiryRow, thread: MailInput[], party: Party, ctx: PartyContext): CrossFiled | null {
  try {
    if (!mayBeElsewhere(email, ctx)) return null;
    const ours = refKey(row?.reference);
    const refs = refsIn(email?.subject);
    const house = houseOf(email?.subject);
    const about = house ? aboutOf(house.qty_text, house.pol, house.pod) : null;
    if (refs.length && !refs.includes(ours)) return { why: "other_reference", looksLike: refs[0], about };
    if (refs.includes(ours)) return null;
    if (house && contradicts(house, row)) return { why: "contradicts_register", looksLike: null, about };
    if (party !== "other" || email?.sender_type !== "external") return null;
    const named = email.sl_refs?.some((r) => refKey(r) === ours) || (Array.isArray(thread) ? thread : []).some((m) => refsIn(m?.subject).includes(ours));
    return named ? null : { why: "unknown_sender", looksLike: null, about: null };
  } catch {
    return null;
  }
}

const SUBJECT_PREFIX = /^\s*(?:\[[^\]]*\]\s*[-:]?\s*|(?:re|fw|fwd|aw|r|tr|sv|回复|答复|转发)\s*[:：]\s*|[-:|/]+\s*)/i;

/** A subject without its reply marks and references, in lower case with punctuation as spaces: the same subject reads the same. */
function subjectKey(subject: string | null | undefined): string {
  let s = (subject ?? "").replace(SL_REF, " ");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(SUBJECT_PREFIX, "");
  }
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const partOf = (inner: string, outer: string) => ` ${outer} `.includes(` ${inner} `);

/** The subjects filed here that carry this enquiry's reference, and those that carry only another one. */
interface FiledSubjects { own: string[]; other: { key: string; reference: string; about: string | null }[] }

function filedSubjects(emails: MailInput[], row: EnquiryRow): FiledSubjects {
  const ours = refKey(row.reference);
  const own = new Set<string>();
  const other = new Map<string, FiledSubjects["other"][number]>();
  for (const email of emails) {
    const refs = refsIn(email.subject);
    const key = refs.length ? subjectKey(email.subject) : "";
    if (!key) continue;
    if (refs.includes(ours)) own.add(key);
    else if (!other.has(key)) {
      const house = houseOf(email.subject);
      other.set(key, { key, reference: refs[0], about: house ? aboutOf(house.qty_text, house.pol, house.pod) : null });
    }
  }
  return { own: [...own], other: [...other.values()] };
}

/**
 * A mail without a reference whose subject is the subject of mail filed here under another enquiry's reference
 * ("RFQ – Air Import, Uttendorf…" beside "RE: SL262810 // RFQ – Air Import, Uttendorf…"): it belongs with that one.
 * Not when the thread or a like subject carries this enquiry's reference.
 */
function sameSubjectElsewhere(email: MailInput, threadIsOurs: boolean, subjects: FiledSubjects, ctx: PartyContext): CrossFiled | null {
  if (threadIsOurs || !subjects.other.length || !mayBeElsewhere(email, ctx) || refsIn(email.subject).length) return null;
  const key = subjectKey(email.subject);
  if (key.length < 20 || subjects.own.some((o) => partOf(key, o) || partOf(o, key))) return null;
  const hit = subjects.other.find((o) => partOf(key, o.key));
  return hit ? { why: "other_reference", looksLike: hit.reference, about: hit.about } : null;
}

/** Another open enquiry of the customer a mail may be about: a second reference in the subject, or its port. */
function siblingOf(email: MailInput, party: Party, row: EnquiryRow, open: { reference: string; ports: string[] }[]): string | null {
  const ours = refKey(row.reference);
  const refs = refsIn(email.subject);
  if (refs.includes(ours)) return refs.find((r) => r !== ours) ?? null;
  if (refs.length || party !== "customer" || !open.length) return null;
  const subject = (email.subject ?? "").toUpperCase();
  for (const other of open) {
    if (other.ports.some((p) => new RegExp(`\\b${p.replace(/[^A-Z0-9 ]/g, ".")}\\b`).test(subject))) return other.reference;
  }
  return null;
}

/** The customer's other open enquiries with the ports only they have (4 letters or more). */
function openSiblings(row: EnquiryRow, history: HistoryRow[] | undefined): { reference: string; ports: string[] }[] {
  const mine = new Set([portKey(row.pol), portKey(row.pod)]);
  const out: { reference: string; ports: string[] }[] = [];
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || h.id === row.id || h.reference === row.reference || (h.status !== "new" && h.status !== "quoted")) continue;
    const sameRoute = portKey(h.pol) === portKey(row.pol) && portKey(h.pod) === portKey(row.pod);
    if (sameRoute && h.shipment_mode === row.shipment_mode) continue;
    const ports = [portKey(h.pol), portKey(h.pod)].filter((p) => p.length >= 4 && !mine.has(p));
    if (ports.length) out.push({ reference: h.reference, ports });
  }
  return out;
}

// --- Noise and kinds ------------------------------------------------------------------------------------------

const rawBody = (email: Pick<EmailMessage, "body_text" | "snippet"> | null | undefined): string =>
  typeof email?.body_text === "string" && email.body_text ? email.body_text : typeof email?.snippet === "string" ? email.snippet : "";

/** What an "adding a colleague" note never has: a figure, a question, or "please" with something to do after it. */
const ASKS_OR_COUNTS = /\d|\?|\b(?:please|pls|plz|kindly)\s+\w/i;

/** The "to" addresses of a mail as one comparable key. */
const recipientsKey = (email: MailInput): string => (Array.isArray(email.to_emails) ? email.to_emails.map(lower).sort().join(",") : "");

/** An "adding a colleague" note: a short text with no figure and nothing asked. */
const isLoopIn = (text: string): boolean => text.length < 160 && LOOP_IN.test(text) && !ASKS_OR_COUNTS.test(text.replace(ADDRESS, ""));

/**
 * An "adding a colleague" line above a signature that has no sign-off: the first paragraph is the note and nothing
 * below it asks, promises or prices. It stays in the conversation but changes nothing, like an acknowledgement.
 */
function isLoopInAbove(clean: string): boolean {
  const gap = clean.search(/\n[ \t]*\n/);
  if (gap < 0 || !isLoopIn(clean.slice(0, gap))) return false;
  const rest = clean.slice(gap);
  return !isRequest(rest) && !PROMISE.test(flat(rest)) && !hasAmountFrom(rest, 100);
}

/** An auto-reply is short: a long mail that mentions a leave is a person writing. */
const AUTO_REPLY_MAX = 600;

function noiseKind(email: MailInput, clean: string, earlier: { email: MailInput; clean: string }[]): NoiseKind | null {
  const from = lower(email.from_email);
  const subject = (email.subject ?? "").trim();
  const sender = NOISE_SENDER.test(from);
  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject) || (sender && BOUNCE_BODY.test(rawBody(email)))) return "bounce";
  if (NOISE_SUBJECT.test(subject) || sender || (clean.length < AUTO_REPLY_MAX && NOISE_TEXT.test(flat(clean)))) return "auto_reply";
  if (isLoopIn(clean)) return "loop_in";
  const head = clean.slice(0, 200);
  const at = timeOf(email.received_at);
  if (head && at != null) {
    const to = recipientsKey(email);
    for (const e of earlier) {
      const t = timeOf(e.email.received_at);
      if (e.email === email || t == null || t > at || at - t > 120_000) continue;
      // The same words on another thread answer another mail (one "Go ahead" sent to two enquiries): not a repeat.
      if (lower(e.email.from_email) === from && recipientsKey(e.email) === to && e.clean.slice(0, 200) === head && e.email.gmail_thread_id === email.gmail_thread_id) return "duplicate";
    }
  }
  return null;
}

/** Mail that is folded away: auto-replies, bounces, "adding a colleague" notes and repeats of the same mail. */
export function noiseOf(email: MailInput, clean: string, earlier: MailInput[]): NoiseKind | null {
  try {
    if (!email) return null;
    const from = lower(email.from_email);
    const at = timeOf(email.received_at);
    const near = (Array.isArray(earlier) ? earlier : []).filter((e) => {
      const t = timeOf(e?.received_at);
      return !!e && e !== email && lower(e.from_email) === from && at != null && t != null && t <= at && at - t <= 120_000;
    });
    return noiseKind(email, clean ?? "", near.map((e) => ({ email: e, clean: cleaned(e) })));
  } catch {
    return null;
  }
}

/** The address a bounce says could not be reached, or null. */
export function bounceAddressOf(email: Pick<EmailMessage, "body_text" | "snippet">): string | null {
  const m = BOUNCE_ADDRESS.exec(rawBody(email));
  return m ? m[1].toLowerCase().replace(/[.-]+$/, "") : null;
}

/** An acknowledgement and nothing else: "Noted with thanks Ashwin". Decisions ("Approved") are not. */
export function isAck(clean: string): boolean {
  if (typeof clean !== "string" || clean.includes("?") || isRequest(clean)) return false;
  const text = clean.replace(/\s+/g, " ").trim();
  if (!text || text.length > 160) return false;
  return ACK.test(text.replace(ACK_WORDS, (w) => w.toLowerCase())) || FYI.test(text);
}

/** Asks for something: a question, or "please / kindly …" that is not just information or a go-ahead. */
export function isRequest(clean: string): boolean {
  return typeof clean === "string" && REQUEST.test(flat(clean));
}

/** Has the words of a reminder: "kind reminder", "any update?", "awaiting your reply". */
export function isChase(clean: string): boolean {
  return typeof clean === "string" && CHASE.test(flat(clean));
}

/** Urgent or a complaint: "urgent", "asap", "your team is not responding". */
export function isEscalation(clean: string): boolean {
  return typeof clean === "string" && ESCALATION.test(flat(clean));
}

/** Words that put a shipment on hold: "pls hold", "planning via", "cargo not ready". */
export function isHold(clean: string): boolean {
  return typeof clean === "string" && HOLD.test(flat(clean));
}

/** Our own "please hold" to an agent. */
const PAUSE = /\b(?:please|pls|plz|kindly)\s+hold\b|\bhold\s+(?:the|this|on)\b|\b(?:keep|put)\s+(?:it|this|the\s+\w+)\s+on\s+hold\b/i;

/**
 * In a mail of ours to the customer, "awaiting SO, will keep you posted" is news about someone else; only
 * "awaiting your confirmation" asks the customer for something.
 */
const AWAITING_OTHERS = /\bawaiting\b(?!\s+(?:for\s+)?(?:your|ur|you)\b)[^.?!\n]*/gi;

// --- Promises and deadlines -----------------------------------------------------------------------------------

/** Oman wall clock of a timestamp: its calendar day, weekday (0 = Sunday) and minutes since midnight. */
function omanClock(t: number): { day: string; weekday: number; minutes: number } {
  const local = new Date(t + OMAN_OFFSET);
  return { day: local.toISOString().slice(0, 10), weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

const WEEKDAYS = ["sun", "mon", "tues", "wednes", "thurs", "fri", "satur"];
/** The next day with that weekday name, after the given day. */
function nextWeekday(day: string, weekday: number, name: string): string | null {
  const target = WEEKDAYS.findIndex((w) => name.toLowerCase().startsWith(w));
  return target < 0 ? null : addDays(day, (target - weekday + 7) % 7 || 7);
}

const DUE_DAY = /\b(today|tomorrow|eod|cob|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;
/** A sentence that opens with what the other side has to do first. */
const THEIR_TURN_FIRST = /^\W*(?:once|if|as soon as|when|after)\s+(?:you|u|your|the (?:shipper|agent|carrier|customer|consignee))\b/i;

/** A promise in the text, with the Oman day it falls due: the day it names, else the next working day. */
export function promiseOf(clean: string, receivedAt: string): { sentence: string; due: string } | null {
  try {
    const t = timeOf(receivedAt);
    const text = typeof clean === "string" ? flat(clean) : "";
    if (t == null) return null;
    // "Once you release the booking … we will arrange the payment" waits on the reader: no promise with a due day.
    const found = [...text.matchAll(new RegExp(PROMISE.source, `${PROMISE.flags.replace("g", "")}g`))]
      .map((m) => sentenceAt(text, m.index ?? 0).text)
      .find((s) => !THEIR_TURN_FIRST.test(s));
    if (!found) return null;
    const sentence = found;
    const { day, weekday } = omanClock(t);
    const named = DUE_DAY.exec(sentence)?.[1].toLowerCase();
    const due = !named
      ? nextWorkingDay(day)
      : named === "tomorrow"
        ? addDays(day, 1)
        : named.endsWith("day") && named !== "today"
          ? (nextWeekday(day, weekday, named) ?? nextWorkingDay(day))
          : day;
    return { sentence: clip(sentence), due };
  } catch {
    return null;
  }
}

/** "5 pm" → 1020; "12:00 PM" → 720; "14:30 hrs" → 870. */
function clockMinutes(text: string): number | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|hrs|h|noon)/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const half = m[3].toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  return hour > 23 || minute > 59 ? null : hour * 60 + minute;
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (day: string, minutes: number) => ({
  at: `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}+04:00`,
  text: `by ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)} on ${dayWithWeekday(day, day)}`,
});

/**
 * A deadline the writer set for us, resolved on the Oman clock relative to the mail: at is "2026-11-09T12:00+04:00".
 * A day named inside a promise is the promise's, not a deadline.
 */
export function deadlineOf(clean: string, receivedAt: string): { at: string; text: string } | null {
  try {
    const t = timeOf(receivedAt);
    if (t == null || typeof clean !== "string" || !clean) return null;
    const text = flat(clean);
    const pm = PROMISE.exec(text);
    const promise = pm ? sentenceAt(text, pm.index) : null;
    const free = (m: RegExpExecArray | null): m is RegExpExecArray => !!m && !(promise && m.index >= promise.start && m.index < promise.end);
    const { day, weekday, minutes } = omanClock(t);
    const END = 18 * 60;

    const clock = DEADLINE_CLOCK.exec(text);
    if (free(clock)) {
      const at = clockMinutes(clock[1]);
      if (at != null) return stamp(at <= minutes ? addDays(day, 1) : day, at);
    }
    const named = DEADLINE_DAY.exec(text);
    if (free(named)) {
      const word = named[1].toLowerCase().replace(/\s+/g, " ");
      if (word === "noon") return stamp(12 * 60 <= minutes ? addDays(day, 1) : day, 12 * 60);
      if (word === "tomorrow") return stamp(addDays(day, 1), END);
      // End of the week is Thursday 18:00; a mail that came in on Thursday after 18:00 means next Thursday.
      if (/week$/.test(word)) {
        const ahead = (4 - weekday + 7) % 7;
        return stamp(addDays(day, ahead === 0 && minutes >= END ? 7 : ahead), END);
      }
      if (/day$/.test(word) && word !== "today" && !word.startsWith("end of")) {
        const on = nextWeekday(day, weekday, word);
        if (on) return stamp(on, END);
      }
      // Today, EOD, COB, this evening: 18:00 that day, or the next day when the mail came in after 18:00.
      return stamp(minutes >= END ? addDays(day, 1) : day, END);
    }
    const span = DEADLINE_SPAN.exec(text);
    if (free(span)) {
      const n = Number(span[1]);
      if (n > 0 && n < 1000) {
        // "Within 2 working days" counts Sunday to Thursday only, at the time of day the mail came in.
        if (/working/i.test(span[0])) {
          let due = day;
          for (let left = n; left > 0; ) {
            due = addDays(due, 1);
            if (isWorkingDay(due)) left--;
          }
          return stamp(due, minutes);
        }
        const due = omanClock(t + n * (/hour|hrs/i.test(span[0]) ? HOUR : DAY));
        return stamp(due.day, due.minutes);
      }
    }
    if (free(DEADLINE_TODAY.exec(text))) return stamp(minutes >= END ? addDays(day, 1) : day, END);
    return null;
  } catch {
    return null;
  }
}

/** "by 12:00 today", "by 18:00 tomorrow", "by 12:00 on Mon 09 Nov": a deadline as read on the given day. */
export function deadlineText(at: string, today: string): string {
  if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) return "";
  const day = at.slice(0, 10);
  const time = at.slice(11, 16);
  const known = isDay(today);
  if (known && day === today) return `by ${time} today`;
  if (known && day === addDays(today, 1)) return `by ${time} tomorrow`;
  return `by ${time} on ${dayWithWeekday(day, known ? today : day)}`;
}

// --- The clock ------------------------------------------------------------------------------------------------

/** How much an hour between 08:00 and 18:00 counts, by weekday (Sunday first): Friday nothing, Saturday half. */
const DAY_WEIGHT = [1, 1, 1, 1, 1, 0, 0.5];

/** Working and real hours between two timestamps (Oman clock; Saturday at half weight). */
export function workingHoursBetween(fromTs: string, toTs: string): { working: number; raw: number } {
  const a = timeOf(fromTs);
  const b = timeOf(toTs);
  if (a == null || b == null || b <= a) return { working: 0, raw: 0 };
  const from = a + OMAN_OFFSET;
  const to = b + OMAN_OFFSET;
  let working = 0;
  let day = Math.floor(from / DAY) * DAY;
  for (let i = 0; day < to && i < 4000; i++, day += DAY) {
    const weight = DAY_WEIGHT[new Date(day).getUTCDay()];
    const start = Math.max(from, day + 8 * HOUR);
    const end = Math.min(to, day + 18 * HOUR);
    if (weight && end > start) working += ((end - start) / HOUR) * weight;
  }
  return { working: round2(working), raw: round2((b - a) / HOUR) };
}

/** A wait in working and real hours, with the label that shows both. */
export function ageOf(fromTs: string, now: string): Age {
  const { working, raw } = workingHoursBetween(fromTs, now);
  const real = `${Math.round(raw)} h`;
  let label: string;
  if (working < 1) {
    const minutes = Math.round(working * 60);
    label = raw - working < 0.25 ? `${minutes} min` : `${minutes} working min (${real})`;
  } else if (working < 10) {
    label = `${Math.floor(working)} working h (${real})`;
  } else {
    const days = Math.floor(working) / 10;
    label = `${days} working day${days === 1 ? "" : "s"} (${real})`;
  }
  return { workingHours: working, rawHours: raw, label };
}

/** Whether a mail arrived outside 08:00–18:00 Oman ("overnight") or on a Friday or Saturday ("weekend"). */
export function outOfHoursOf(ts: string): "overnight" | "weekend" | null {
  const t = timeOf(ts);
  if (t == null) return null;
  const { weekday, minutes } = omanClock(t);
  if (weekday === 5 || weekday === 6) return "weekend";
  return minutes < 8 * 60 || minutes >= 18 * 60 ? "overnight" : null;
}

const WINDOW_CHINA = "Usually writes 05:00–09:00 Oman · weekend Sat–Sun";
const WINDOW_INDIA = "Usually writes 10:00–18:00 Oman";
const WINDOW_OMAN = "Works Oman hours · weekend Fri–Sat";
const WINDOW_EUROPE = "Usually writes after 12:00 Oman · weekend Sat–Sun";
const WINDOW_ALGERIA = "Usually writes after 12:00 Oman · weekend Fri–Sat";

/** When a counterpart usually writes, by its domain: fixed windows by country, or null. */
export function replyWindowFor(domain: string): ReplyWindow | null {
  const d = lower(domain);
  if (!d || !d.includes(".")) return null;
  const labels = labelsOf(d);
  const tld = d.slice(d.lastIndexOf(".") + 1);
  const named = (re: RegExp) => labels.some((l) => re.test(l));
  const text = named(/^(?:consolclub|yxcargo|winco|sanco|wwl|jasclog|yqn)/)
    ? WINDOW_CHINA
    : named(/^(?:cssmuscat|rcsworldwide|flgshipping)/)
      ? WINDOW_OMAN
      : tld === "cn"
        ? WINDOW_CHINA
        : tld === "in"
          ? WINDOW_INDIA
          : tld === "om"
            ? WINDOW_OMAN
            : tld === "it" || tld === "de" || tld === "tr" || tld === "se"
              ? WINDOW_EUROPE
              : tld === "dz"
                ? WINDOW_ALGERIA
                : null;
  return text ? { text } : null;
}

/** "Mon 14:12" for a time within six days of today, "Mon 02 Nov 14:12" otherwise (Oman clock). */
export function shortWhen(ts: string, today: string): string {
  const t = timeOf(ts);
  if (t == null) return "";
  const iso = new Date(t).toISOString();
  const day = muscatDate(iso);
  const known = isDay(today);
  const apart = known ? Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY : Infinity;
  const full = dayWithWeekday(day, known ? today : day);
  return `${apart <= 6 ? full.slice(0, 3) : full} ${muscatTime(iso)}`;
}

// --- Files ----------------------------------------------------------------------------------------------------

/** A logo or an icon from a signature: a known file name, or any image under 30 KB. */
export function isSignatureImage(file: { filename: string; mime_type: string; size: number }): boolean {
  const name = typeof file?.filename === "string" ? file.filename.trim() : "";
  if (SIGNATURE_IMAGE.test(name)) return true;
  const image = /^image\//i.test(file?.mime_type ?? "") || /\.(?:png|jpe?g|gif|bmp|webp)$/i.test(name);
  return image && typeof file?.size === "number" && file.size < 30 * 1024;
}

// --- Proof ----------------------------------------------------------------------------------------------------

/**
 * The name of the conversation each read mail belongs to, for "Reena Aneesh (Frontline)". Kept by the mail's
 * sender object, so a copy of the mail still finds it.
 */
const SIDE_NAME = new WeakMap<PersonRef, string>();

function sideNameOf(mail: ReadMail): string {
  const known = mail.from ? SIDE_NAME.get(mail.from) : undefined;
  if (known) return known;
  if (mail.sideKey === "customer") return "Customer";
  if (mail.sideKey === "internal") return "Our side";
  return displayName(agentNameForDomain(mail.sideKey)) || mail.sideKey;
}

/** Where a value was read: who wrote it, when, and the sentence (the mail's excerpt when none is given). */
export function proofOf(mail: ReadMail, today: string, sentence?: string, file?: string): Proof {
  const name = mail?.from?.name ?? "";
  const side = mail && mail.party !== "us" ? sideNameOf(mail) : "";
  const who = !side || side === name ? name || side : name ? `${name} (${side})` : side;
  let when = "";
  try {
    when = mail?.at ? whenSent(mail.at, today || muscatDate(mail.at)) : "";
  } catch {
    when = "";
  }
  const proof: Proof = { emailId: mail?.id ?? "", who, when, sentence: clip(typeof sentence === "string" ? sentence : (mail?.excerpt ?? "")) };
  if (file) proof.file = file;
  return proof;
}

// --- The first pass: our offers, our rate requests and shipper blocks ----------------------------------------

/** "1,225" → 1225; "359.000" in rials → 359; "13.700" in dollars → 13700. Rough: only to tell a price from a small figure. */
function roughAmount(raw: string, rials: boolean): number {
  let s = raw.trim();
  if (/^\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/[ ,]/g, "");
  else if (!rials && /^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,(\d{1,2})$/, ".$1").replace(/[ ,]/g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function hasAmountFrom(text: string, min: number): boolean {
  for (const m of text.matchAll(TOKEN_A)) if (roughAmount(m[2], /^(?:OMR|RO)$/i.test(m[1])) >= min) return true;
  for (const m of text.matchAll(TOKEN_B)) if (roughAmount(m[2], false) >= min) return true;
  for (const m of text.matchAll(TOKEN_C)) if (roughAmount(m[1], /^(?:OMR|RO)$/i.test(m[2])) >= min) return true;
  return false;
}

const SHIPPER_BLOCK_ALL = new RegExp(SHIPPER_BLOCK.source, "gi");
const SHIPPER_LABEL = /\b(?:shipper|vendor|supplier|contact\s+person)\b/gi;
const ASKS_FOR_DETAILS = /\b(?:please|pls|plz|kindly|can you|could you)\s+(?:share|send|provide|advise|give|confirm|forward)\b|\?\s*$/i;
const BLOCK_END = /\n\s*agent\b|\bagent(?:['’]s)?\s+(?:details|contact|address)\b|\bconsignee\b|\bnotify\b/i;
const REPLY_PREFIX = /^\s*(?:\[[^\]]*\]\s*)?(?:re|aw|sv|回复|答复)\s*[:：]/i;

/** Addresses given in a shipper block (any mail) or after a shipper label (our own mails). */
function shipperAddressesIn(text: string, own: boolean, senderDomain: string): string[] {
  const out: string[] = [];
  const scan = (re: RegExp, reach: number) => {
    for (const m of text.matchAll(re)) {
      if (/^(?:consignee|notify)$/i.test(m[1] ?? "")) continue;
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      const lineEnd = text.indexOf("\n", m.index);
      if (ASKS_FOR_DETAILS.test(text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd))) continue;
      const after = text.slice(m.index + m[0].length, m.index + reach);
      const stop = after.search(BLOCK_END);
      for (const found of (stop < 0 ? after : after.slice(0, stop)).match(ADDRESS) ?? []) {
        const a = found.toLowerCase();
        const domain = emailDomain(a) ?? "";
        if (isOurAddress(a) || (senderDomain && !isFreeMail(domain) && domain === senderDomain) || out.includes(a)) continue;
        out.push(a);
      }
    }
  };
  scan(SHIPPER_BLOCK_ALL, 400);
  if (own) scan(SHIPPER_LABEL, 250);
  return out;
}

interface Timed { email: MailInput; t: number; clean: string }

/** Who received our offer, who received our rate request, and which addresses a shipper block names. */
function firstPass(mails: Timed[], base: PartyContext, mailbox: string): Pick<PartyContext, "offerRecipients" | "requestRecipients" | "shipperAddresses"> {
  const priced = new Set<string>();
  const offered = new Set<string>();
  const asked = new Set<string>();
  const shippers = new Set<string>();
  const wrote = new Set<string>();
  const hasWritten = (a: string) => inSet(wrote, a, emailDomain(a) ?? "");
  const startedByUs = new Set<string>();
  const seenThreads = new Set<string>();
  for (const { email } of mails) {
    if (seenThreads.has(email.gmail_thread_id)) continue;
    seenThreads.add(email.gmail_thread_id);
    if (partyOf(email, base, false) === "us") startedByUs.add(email.gmail_thread_id);
  }

  for (const { email, clean } of mails) {
    const from = lower(email.from_email);
    const ours = partyOf(email, base, false) === "us";
    const outside = outsideRecipients(email, mailbox);
    const withAddresses = /@/.test(rawBody(email)) ? cleaned(email, true) : "";
    const house = !!parseHouseSubject(email.subject);
    if (ours) {
      if (outside.length) {
        // A rate request shows twice over: the shipment as a block, the words, our house subject. One alone may be
        // a question to the customer ("please share your target rate").
        const request = [REQUEST_BLOCK.test(clean), RATE_REQUEST.test(clean), house].filter(Boolean).length >= 2;
        if (OUR_PRICE_LINE.test(clean)) outside.forEach((a) => priced.add(a));
        else if (request) outside.forEach((a) => !hasWritten(a) && asked.add(a));
        else if (OFFER_CUE.test(clean) && hasAmountFrom(clean, 100)) outside.forEach((a) => offered.add(a));
      }
      if (withAddresses) shipperAddressesIn(withAddresses, true, "").forEach((a) => shippers.add(a));
    } else {
      if (withAddresses) shipperAddressesIn(withAddresses, false, emailDomain(from) ?? "").forEach((a) => shippers.add(a));
      if (from) wrote.add(from);
    }
    // A rate request and its replies carry our house subject: whoever is on a thread we started with one, or
    // answers one ("RE: …"), was asked for rates.
    if (house && (startedByUs.has(email.gmail_thread_id) || REPLY_PREFIX.test(email.subject ?? ""))) {
      for (const a of ours ? outside : [from, ...outside]) if (a && !isOurAddress(a) && a !== mailbox) asked.add(a);
    }
  }

  const within = (set: Set<string>, a: string) => inSet(set, a, emailDomain(a) ?? "");
  const offerRecipients = new Set(priced);
  for (const a of offered) if (!within(asked, a)) offerRecipients.add(a);
  const requestRecipients = new Set<string>();
  for (const a of asked) if (!within(priced, a) && partyOfAddress(a, base, false) !== "customer") requestRecipients.add(a);
  const shipperAddresses = new Set<string>();
  for (const a of shippers) if (partyOfAddress(a, base, false) === "other" && !within(priced, a)) shipperAddresses.add(a);
  return { offerRecipients, requestRecipients, shipperAddresses };
}

// --- Reading every mail ---------------------------------------------------------------------------------------

export interface ReadResult {
  /** Every filed mail, newest first, whatever its scope. */
  mails: ReadMail[];
  /** Customer first, then the other outside conversations by newest mail, our own last. */
  sides: Side[];
  hidden: HiddenCounts;
  crossFiled: CrossFiledGroup[];
  /** The party context with the three sets of the first pass filled. */
  ctx: PartyContext;
  /** The Oman calendar date of the input's now. */
  today: string;
}

const NEUTRAL_STATE: SideState = { kind: "nothing_pending", since: null, age: null, tone: "neutral", text: "", proof: null };

function emptySide(key: string, kind: SideKind, name: string, domain: string | null, agentName: string | null): Side {
  return {
    key, kind, name, domain, agentName,
    mails: [], threads: [], lastFromThem: null, lastFromUs: null, currentWriter: null,
    state: { ...NEUTRAL_STATE }, questions: [], chase: null, deadline: null, promise: null,
    replyWindow: null, holiday: null, agent: null, pausedByUs: null, fileCount: 0, hiddenCount: 0,
  };
}

const customerName = (row: EnquiryRow | null | undefined) => displayName(row?.customer_name) || "Customer";

function emptyResult(input: BriefInput | null | undefined): ReadResult {
  const row = (input?.row ?? {}) as EnquiryRow;
  const now = timeOf(input?.now) ?? 0;
  return {
    mails: [],
    sides: [emptySide("customer", "customer", customerName(row), null, null)],
    hidden: { autoReplies: 0, loopIns: 0, duplicates: 0, text: "", mails: [] },
    crossFiled: [],
    ctx: { row, overrides: input?.overrides, agentNames: input?.agentNames },
    today: muscatDate(new Date(now).toISOString()),
  };
}

const joinList = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** What a holiday sentence is about: the holiday it names, else why the office is closed. */
function holidayLabel(sentence: string): string {
  const named = /\b(deepavali|diwali|eid|chinese new year|national day)\b/i.exec(sentence)?.[1].toLowerCase();
  if (named) return named.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  if (/\bpublic holiday\b/i.test(sentence)) return "public holiday";
  return /\bweekend at origin\b/i.test(sentence) ? "weekend at origin" : "office closed";
}

/**
 * Every filed mail read once: party (two passes), conversation, scope (another enquiry's, noise, in), kind, what it
 * asks or promises, files. The mails come back newest first; the later modules fill money, milestones and cues.
 */
export function readMails(input: BriefInput): ReadResult {
  try {
    return read(input);
  } catch {
    return emptyResult(input);
  }
}

function read(input: BriefInput): ReadResult {
  const row = input.row;
  const mailbox = lower(input.mailbox);
  const timed: Timed[] = (Array.isArray(input.emails) ? input.emails : [])
    .filter((e): e is MailInput => !!e && typeof e === "object")
    .map((email) => ({ email, t: timeOf(email.received_at) ?? 0, clean: cleaned(email) }))
    .sort((a, b) => a.t - b.t);
  const nowMs = timeOf(input.now) ?? (timed.length ? timed[timed.length - 1].t : 0);
  const now = new Date(nowMs).toISOString();
  const today = muscatDate(now);
  const open = row.status === "new" || row.status === "quoted";

  const base: PartyContext = { row, overrides: input.overrides, agentNames: input.agentNames };
  const ctx: PartyContext = { ...base, ...attempt(() => firstPass(timed, base, mailbox), {}) };

  const parties = new Map<string, Party>();
  const senderParty = (email: MailInput): Party => {
    const key = `${email.sender_type}|${lower(email.from_email)}|${email.from_name ?? ""}`;
    let party = parties.get(key);
    if (!party) parties.set(key, (party = partyOf(email, ctx, true)));
    return party;
  };

  const threads = new Map<string, MailInput[]>();
  const ourThreads = new Set<string>();
  const reference = refKey(row.reference);
  for (const { email } of timed) {
    const list = threads.get(email.gmail_thread_id);
    if (list) list.push(email);
    else threads.set(email.gmail_thread_id, [email]);
    if (refsIn(email.subject).includes(reference)) ourThreads.add(email.gmail_thread_id);
  }
  const siblings = openSiblings(row, input.customerHistory);
  const subjects = attempt<FiledSubjects>(() => filedSubjects(timed.map((m) => m.email), row), { own: [], other: [] });
  const sentFromApp = new Map<string, string>();
  for (const reply of Array.isArray(input.replies) ? input.replies : []) {
    if (reply?.gmail_message_id) sentFromApp.set(reply.gmail_message_id, (reply.sent_by && input.profileNames?.get(reply.sent_by)) || "a colleague");
  }
  const agentOf = (key: string): string | null => {
    const domain = key.includes("@") ? "" : key;
    if (!domain) return null;
    const known = agentNameForDomain(domain, input.agentNames);
    if (known) return known;
    return row.agent_name && matchesAgent(domain, null, agentMarksOf(row.agent_name)) ? row.agent_name : null;
  };
  const sideName = (key: string, kind: SideKind): string =>
    kind === "customer" ? customerName(row) : kind === "internal" ? "Our side" : (kind === "agent" && displayName(agentOf(key))) || key;

  // Oldest first: one ReadMail per filed mail.
  const mails: ReadMail[] = [];
  const kinds = new Map<string, SideKind>();
  const extraSides = new Map<ReadMail, string[]>();
  timed.forEach(({ email, t, clean }, i) => {
    const at = new Date(t).toISOString();
    const party = senderParty(email);
    const outside = party === "us" ? outsideRecipients(email, mailbox) : [];
    const toParty = party === "us" ? toPartyOf(outside, ctx) : null;

    const earlier: { email: MailInput; clean: string }[] = [];
    for (let j = i - 1; j >= 0 && t - timed[j].t <= 120_000; j--) earlier.push(timed[j]);
    const noise = attempt(() => noiseKind(email, clean, earlier), null);
    const thread = threads.get(email.gmail_thread_id) ?? [];
    let crossFiled = crossFiledOf(email, row, thread, party, ctx);
    if (!crossFiled || crossFiled.why === "unknown_sender") {
      crossFiled = attempt(() => sameSubjectElsewhere(email, ourThreads.has(email.gmail_thread_id), subjects, ctx), null) ?? crossFiled;
    }
    if (crossFiled?.why === "unknown_sender" && noise) crossFiled = null;
    const scope: ReadMail["scope"] = crossFiled ? "cross_filed" : noise ? "noise" : "in";

    const { key: sideKey, kind } = conversationOf(email, party, toParty, scope === "noise" && noise === "bounce" ? bounceAddressOf(email) : null, ctx);
    if (scope === "in" || !kinds.has(sideKey)) kinds.set(sideKey, kind);

    const inScope = scope === "in";
    const from = personRef(email, party);
    const name = sideName(sideKey, kind);
    const files: DocFile[] = (Array.isArray(email.attachments) ? email.attachments : [])
      .filter((f) => f && typeof f.filename === "string" && !isSignatureImage(f))
      .map((f) => ({
        filename: f.filename, mime: f.mime_type ?? "", size: f.size ?? 0, storagePath: f.storage_path ?? null,
        emailId: email.id, at, from: party === "us" ? from.name : name, sideKey, crossFiled: scope === "cross_filed",
      }));
    const chase = inScope && isChase(clean);
    const urgent = inScope && isEscalation(clean);
    // A reminder or a complaint from them asks for an answer, whatever its words.
    const asks = isRequest(party === "us" && toParty === "customer" ? clean.replace(AWAITING_OTHERS, "") : clean) || (party !== "us" && (chase || urgent));
    const mail: ReadMail = {
      email, id: email.id, at, day: muscatDate(at), time: muscatTime(at), from, party, toParty, sideKey, scope,
      crossFiled: scope === "cross_filed" ? crossFiled : null,
      noise: scope === "noise" ? noise : null,
      siblingHint: inScope ? attempt(() => siblingOf(email, party, row, siblings), null) : null,
      kind: isAck(clean) || (!clean && !files.length) || isLoopInAbove(clean) ? "ack" : "substantive",
      clean, excerpt: excerptOf(clean),
      isRequest: inScope && asks,
      isChase: chase,
      isPureChase: chase && clean.length < 300,
      urgent,
      hold: inScope && open && party === "customer" && isHold(clean),
      promise: null, deadline: null, cues: [], money: [], moneyRole: null, milestones: [], files,
      sentFromApp: sentFromApp.get(email.gmail_message_id) ?? null,
      outOfHours: outOfHoursOf(at),
    };
    SIDE_NAME.set(from, name);

    if (inScope) {
      const promise = promiseOf(clean, at);
      if (promise) {
        mail.promise = { by: party === "us" ? "us" : "them", sentence: promise.sentence, due: promise.due, kept: false, proof: proofOf(mail, today, promise.sentence) };
      }
      const deadline = party !== "us" && mail.isRequest ? deadlineOf(clean, at) : null;
      if (deadline) {
        const text = flat(clean);
        const sentence = DEADLINE_CLOCK.exec(text) ?? DEADLINE_DAY.exec(text) ?? DEADLINE_SPAN.exec(text) ?? DEADLINE_TODAY.exec(text);
        mail.deadline = {
          at: deadline.at, text: deadlineText(deadline.at, today), passed: nowMs > (timeOf(deadline.at) ?? Infinity), cleared: false,
          proof: proofOf(mail, today, sentence ? sentenceAt(text, sentence.index).text : undefined),
        };
      }
      // A mail of ours addressed to several outside domains belongs to each of their conversations.
      if (party === "us" && toParty && toParty !== "internal" && toParty !== "customer") {
        const others = recipientKeys(email, toParty, ctx).filter((k) => k !== sideKey);
        if (others.length) extraSides.set(mail, others);
        for (const k of others) if (!kinds.has(k)) kinds.set(k, toParty);
      }
    }
    mails.push(mail);
  });
  mails.reverse();

  // The conversations.
  const sides = new Map<string, Side>();
  const sideFor = (key: string): Side => {
    let side = sides.get(key);
    if (!side) {
      const kind: SideKind = key === "customer" || key === "internal" ? key : (kinds.get(key) ?? "other");
      const domain = key === "customer" || key === "internal" ? null : (emailDomain(key) ?? key);
      sides.set(key, (side = emptySide(key, kind, sideName(key, kind), domain, kind === "agent" ? agentOf(key) : null)));
    }
    return side;
  };
  const customer = sideFor("customer");
  const autoReplies = new Map<string, ReadMail[]>();
  for (const mail of mails) {
    if (mail.scope === "in") {
      sideFor(mail.sideKey).mails.push(mail);
      for (const key of extraSides.get(mail) ?? []) sideFor(key).mails.push(mail);
    } else if (mail.noise === "auto_reply") {
      const list = autoReplies.get(mail.sideKey);
      if (list) list.push(mail);
      else autoReplies.set(mail.sideKey, [mail]);
    }
  }
  const hiddenMails = mails.filter((m) => m.scope === "noise" && m.noise !== "bounce");
  for (const mail of hiddenMails) {
    const side = sides.get(mail.sideKey);
    if (side) side.hiddenCount++;
  }
  for (const side of sides.values()) {
    attempt(() => fillSide(side, { now, nowMs, today, mailbox: input.mailbox, autoReplies: autoReplies.get(side.key) ?? [], ctx }), undefined);
  }
  if (!customer.domain) {
    const domain = emailDomain(customer.lastFromThem?.from.email ?? row.contact_email ?? customer.currentWriter?.email ?? "");
    customer.domain = domain && !isFreeMail(domain) ? domain : null;
  }
  if (!customer.currentWriter && row.contact_email) {
    const address = lower(row.contact_email);
    customer.currentWriter = { name: row.contact_name?.trim() || personName(null, address), email: address, staff: null };
  }

  const newest = (side: Side) => timeOf(side.mails[0]?.at) ?? 0;
  const outsideSides = [...sides.values()].filter((s) => s.key !== "customer" && s.key !== "internal").sort((a, b) => newest(b) - newest(a));
  const internal = sides.get("internal");
  const ordered = [customer, ...outsideSides, ...(internal && internal.mails.length ? [internal] : [])];

  // What is folded away, and what looks like another enquiry's.
  const count = (kind: NoiseKind) => hiddenMails.filter((m) => m.noise === kind).length;
  const hidden: HiddenCounts = { autoReplies: count("auto_reply"), loopIns: count("loop_in"), duplicates: count("duplicate"), text: "", mails: hiddenMails };
  const parts = [
    hidden.autoReplies ? plural(hidden.autoReplies, "auto-reply", "auto-replies") : "",
    hidden.loopIns ? plural(hidden.loopIns, "'adding a colleague' note") : "",
    hidden.duplicates ? plural(hidden.duplicates, "duplicate") : "",
  ].filter(Boolean);
  hidden.text = parts.length ? `${joinList(parts)} hidden` : "";

  const groups = new Map<string, CrossFiledGroup>();
  const history = new Map((Array.isArray(input.customerHistory) ? input.customerHistory : []).filter(Boolean).map((h) => [refKey(h.reference), h]));
  for (const mail of mails) {
    const cf = mail.crossFiled;
    if (!cf) continue;
    const key = cf.looksLike ?? `${cf.why}:${cf.about ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      const other = cf.looksLike ? history.get(cf.looksLike) : undefined;
      const about = (other ? aboutOf(other.qty_text, other.pol, other.pod) : null) ?? cf.about;
      groups.set(key, (group = { looksLike: cf.looksLike, about, why: cf.why, threadIds: [], mails: [], text: "" }));
    }
    group.mails.push(mail);
    group.about ??= cf.about;
    if (!group.threadIds.includes(mail.email.gmail_thread_id)) group.threadIds.push(mail.email.gmail_thread_id);
  }
  for (const group of groups.values()) {
    const n = group.mails.length;
    const about = group.about ? ` (${group.about})` : "";
    group.text = group.looksLike
      ? `${plural(n, "e-mail")} ${n === 1 ? "looks" : "look"} like ${group.looksLike}${about}`
      : `${plural(n, "e-mail")} may not belong here${about}`;
  }

  return { mails, sides: ordered, hidden, crossFiled: [...groups.values()], ctx, today };
}

interface SideFacts { now: string; nowMs: number; today: string; mailbox: string | null | undefined; autoReplies: ReadMail[]; ctx: PartyContext }

/** Everything a conversation says about itself once its mails are known (newest first). */
function fillSide(side: Side, { now, nowMs, today, mailbox, autoReplies, ctx }: SideFacts): void {
  const mails = side.mails;
  const theirs = (m: ReadMail) => m.party !== "us";
  side.lastFromThem = mails.find(theirs) ?? null;
  side.lastFromUs = mails.find((m) => !theirs(m)) ?? null;
  side.fileCount = mails.reduce((n, m) => n + m.files.length, 0);
  side.replyWindow = side.domain && side.kind !== "internal" ? replyWindowFor(side.domain) : null;

  const threads = new Map<string, Side["threads"][number]>();
  for (const m of mails) {
    const id = m.email.gmail_thread_id;
    const thread = threads.get(id);
    if (thread) thread.count++;
    else threads.set(id, { id, subject: (m.email.subject ?? "").trim() || "(no subject)", count: 1, gmailUrl: gmailThreadUrl(id, mailbox) });
  }
  side.threads = [...threads.values()];

  if (side.lastFromThem) side.currentWriter = side.lastFromThem.from;
  else if (side.lastFromUs && side.kind !== "internal") {
    const onSide = (a: string) => (side.kind === "customer" ? partyOfAddress(a, ctx) === "customer" : keyOfAddress(a) === side.key);
    const address = outsideRecipients(side.lastFromUs.email, mailbox).find(onSide);
    if (address) side.currentWriter = { name: personName(null, address), email: address, staff: null };
  }

  // Newest to oldest: what came after each mail decides whether a promise was kept and a request answered.
  let oursAfter: ReadMail | null = null;
  let theirsAfter = false;
  const questions: Question[] = [];
  for (const m of mails) {
    const own = m.sideKey === side.key;
    if (own && m.promise) m.promise.kept = m.promise.by === "us" ? !!oursAfter : theirsAfter;
    if (own && m.deadline) m.deadline.cleared = !!oursAfter;
    if (theirs(m) && m.kind === "substantive") {
      const sentences = sentencesOf(m.clean);
      let asked = sentences.filter(isRequest).slice(0, 6);
      if (!asked.length && m.isRequest) asked = sentences.filter((s) => isChase(s) || isEscalation(s)).slice(0, 1);
      for (let i = asked.length - 1; i >= 0; i--) {
        questions.push({
          id: `q:${m.id}:${i}`, sentence: clip(asked[i]), proof: proofOf(m, today, asked[i]), age: ageOf(m.at, now),
          answered: !!oursAfter, answeredText: oursAfter ? `answered ${shortWhen(oursAfter.at, today)}` : null,
        });
      }
    }
    if (m.kind === "substantive") {
      if (theirs(m)) theirsAfter = true;
      else oursAfter = m;
    }
  }
  side.questions = questions.reverse();
  const deadlines = mails.filter((m) => m.sideKey === side.key && m.deadline).map((m) => m.deadline as Deadline);
  side.deadline = deadlines.find((d) => !d.cleared) ?? deadlines[0] ?? null;
  side.promise = mails.find((m) => m.sideKey === side.key && m.promise && !m.promise.kept)?.promise ?? null;

  if (side.kind !== "internal") {
    side.chase = chaseRunOf(mails, nowMs, today);
    const since = nowMs - 7 * DAY;
    for (const m of [...mails, ...autoReplies].filter((x) => theirs(x) && (timeOf(x.at) ?? 0) >= since).sort((a, b) => (a.at < b.at ? 1 : -1))) {
      const text = flat(m.clean);
      const hit = HOLIDAY.exec(text);
      if (!hit) continue;
      const sentence = sentenceAt(text, hit.index).text;
      side.holiday = { value: holidayLabel(sentence), proof: proofOf(m, today, sentence) } satisfies Sourced<string>;
      break;
    }
    if (side.kind !== "customer") {
      const last = mails.find((m) => !theirs(m) && m.kind === "substantive");
      const text = last ? flat(last.clean) : "";
      const hit = last ? PAUSE.exec(text) : null;
      if (last && hit) side.pausedByUs = proofOf(last, today, sentenceAt(text, hit.index).text);
    }
  }
}

/** Their chases of the last ten days: mails with chase or urgent words, or sent on top of an unanswered one. */
function chaseRunOf(mails: ReadMail[], nowMs: number, today: string): ChaseRun | null {
  const counted: ReadMail[] = [];
  let unanswered = 0;
  for (let i = mails.length - 1; i >= 0; i--) {
    const m = mails[i];
    if (m.kind !== "substantive") continue;
    if (m.party === "us") {
      unanswered = 0;
      continue;
    }
    if ((m.isChase || m.urgent || unanswered > 0) && (timeOf(m.at) ?? 0) >= nowMs - 10 * DAY) counted.push(m);
    unanswered++;
  }
  if (counted.length < 2) return null;
  const first = counted[0];
  const last = counted[counted.length - 1];
  const urgent = counted.some((m) => m.urgent);
  return {
    count: counted.length, since: first.at, last: last.at, urgent, unanswered,
    text: `Asked ${counted.length} times since ${shortWhen(first.at, today)} · last ${shortWhen(last.at, today)}${urgent ? " · urgent" : ""}`,
  };
}
