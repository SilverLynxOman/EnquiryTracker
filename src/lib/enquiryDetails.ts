import { daysBetween, fmtDayMonth } from "./display";
import { muscatDate } from "./emailDrafts";
import { STALE_DAYS } from "./followUps";
import { addDays } from "./format";
import { nameKey } from "./normalize";
import { waitStatus } from "./quoteWindow";
import { countsAsEnquiry, type AuditEntry, type Closure, type EnquiryRow, type FollowUpRecord, type HistoryRow } from "./types";
import { isQuickQuote, quoteDeadline } from "./workdays";

// The enquiry page's older rules: who a customer's sender is, its progress line, the customer's record and the lane's
// history. Reading the e-mails themselves lives in ./brief.
// Everything here works on data the app already holds; nothing is stored.

// --- Who wrote an e-mail -------------------------------------------------------------------------------------

export interface CustomerHint {
  name: string;
  /** The enquiry's contact, when it has one. */
  contactEmail?: string | null;
}

/** Free-mail domains say nothing about a sender's company (the same list as is_public_email_domain in the database). */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com", "qq.com", "163.com", "126.com", "rediffmail.com", "omantel.net.om",
]);

/** Legal forms and joining words: never part of what a company's mail domain is made of. */
const LEGAL_FORMS = new Set([
  "LLC", "SAOG", "SAOC", "SPC", "LTD", "LIMITED", "EST", "ESTABLISHMENT", "WLL", "FZE", "FZCO", "FZC", "INC", "PVT",
  "AND", "THE", "OF",
]);

/** Words too common in company names to recognise a customer by (an agent's domain may contain them too). */
const COMMON_WORDS = new Set([
  "OMAN", "MUSCAT", "SOHAR", "SALALAH", "DUQM", "GULF", "ARABIA", "ARABIAN", "MIDDLE", "EAST", "INTERNATIONAL",
  "INTL", "NATIONAL", "GLOBAL", "GENERAL", "GROUP", "HOLDING", "HOLDINGS", "TRADING", "TRADERS", "TRADE", "SERVICES",
  "SERVICE", "SOLUTIONS", "ENTERPRISES", "ENTERPRISE", "INDUSTRIES", "INDUSTRIAL", "INDUSTRY", "ENGINEERING",
  "CONTRACTING", "CONSTRUCTION", "TECHNOLOGY", "TECHNOLOGIES", "PROJECTS", "PRODUCTS", "SUPPLY", "SUPPLIES",
  "LOGISTICS", "SHIPPING", "FREIGHT", "CARGO", "MARINE", "UNITED", "PARTNERS", "BROTHERS", "SONS", "COMPANY",
  "CORPORATION", "CORP", "INVESTMENT", "INVESTMENTS", "DEVELOPMENT", "EQUIPMENT", "MATERIALS", "BUILDING", "PETROLEUM",
  "ENERGY", "WORLD", "STAR", "BUSINESS",
]);

/** Parts of a domain that are not the company's name. */
const DOMAIN_FILLER = new Set([
  "www", "mail", "email", "com", "net", "org", "gov", "edu", "co", "ac", "info", "biz", "om", "in", "ae", "uk", "it",
  "de", "fr", "eg", "sa", "qa", "kw", "bh", "pk", "cn", "hk", "sg", "my", "us", "ca", "au", "tr", "es", "nl", "be",
  "ch", "at", "jp", "kr", "lk", "bd",
]);

export function emailDomain(address: string | null | undefined): string | null {
  const at = (address ?? "").trim().toLowerCase().lastIndexOf("@");
  return at < 0 ? null : (address ?? "").trim().toLowerCase().slice(at + 1) || null;
}

/** What a customer's mail domain or sender name would contain: its distinctive words, and its initials (3+ letters). */
export function customerMarks(name: string): { words: string[]; initials: string[] } {
  const all = (nameKey(name) ?? "").split(/[^A-Z]+/).filter((w) => w.length > 1 && !LEGAL_FORMS.has(w));
  const words = [...new Set(all.filter((w) => w.length >= 4 && !COMMON_WORDS.has(w)).map((w) => w.toLowerCase()))];
  const initials = new Set<string>();
  // ONEIC.COM.OM is Oman National Engineering & Investment Co; CMS-EGYPT.COM is Consolidated Marine Services.
  for (const ws of [all, all.filter((w) => w !== "CO" && w !== "COMPANY")]) {
    const s = ws.map((w) => w[0]).join("").toLowerCase();
    if (s.length >= 3) initials.add(s);
  }
  return { words, initials: [...initials] };
}

/** Whether an e-mail address (and display name) belongs to the enquiry's customer. */
export function isCustomerSender(fromEmail: string | null, fromName: string | null, customer: CustomerHint): boolean {
  const from = (fromEmail ?? "").trim().toLowerCase();
  const contact = (customer.contactEmail ?? "").trim().toLowerCase();
  if (from && from === contact) return true;
  const domain = emailDomain(from);
  if (domain && !PUBLIC_DOMAINS.has(domain) && domain === emailDomain(contact)) return true;

  const marks = customerMarks(customer.name);
  if (domain && !PUBLIC_DOMAINS.has(domain)) {
    for (const label of domain.split(".").filter((l) => l && !DOMAIN_FILLER.has(l))) {
      if (marks.words.some((w) => label.includes(w))) return true;
      if (marks.initials.includes(label) || marks.initials.includes(label.split("-")[0])) return true;
    }
  }
  const shown = (fromName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return !!shown && marks.words.some((w) => shown.includes(w));
}

// --- The progress line ---------------------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Thu 05 Nov", with the year when it is not this year's. */
export function dayWithWeekday(iso: string, today: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${fmtDayMonth(iso.slice(0, 10), today)}`;
}

/** Oman clock time (UTC+4) of a timestamp: "13:45". */
export function muscatTime(ts: string): string {
  return new Date(new Date(ts).getTime() + 4 * 3600_000).toISOString().slice(11, 16);
}

/** "Thu 05 Nov, 13:45" in Oman time. */
export function whenSent(ts: string, today: string): string {
  return `${dayWithWeekday(muscatDate(ts), today)}, ${muscatTime(ts)}`;
}

export type StageState = "done" | "current" | "todo" | "closed";

export interface Stage {
  key: "received" | "quoted" | "chased" | "outcome";
  label: string;
  state: StageState;
  /** The day it happened, when it has. */
  date: string | null;
  note: string;
  tone: "good" | "warn" | "bad" | "flag" | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** How quickly the quote went out, against the quick-quote deadline (the end of the next working day). */
export function quoteSpeed(row: Pick<EnquiryRow, "enquiry_date" | "quoted_date">): { text: string; quick: boolean } | null {
  if (!row.quoted_date) return null;
  const days = daysBetween(row.enquiry_date, row.quoted_date);
  if (days <= 0) return { text: "The same day", quick: true };
  if (isQuickQuote(row)) return { text: "By the next working day", quick: true };
  return { text: `${plural(days, "day")} after the enquiry`, quick: false };
}

const SOURCE_NOTES: Record<EnquiryRow["source"], string> = {
  import: "From the Excel register",
  email: "From an e-mail",
  manual: "Entered in the app",
};

export function buildStages(
  row: Pick<EnquiryRow, "status" | "source" | "enquiry_date" | "quoted_date" | "confirmed_date" | "closure_reason">,
  chases: FollowUpRecord[],
  today: string,
): Stage[] {
  const received: Stage = { key: "received", label: "Enquiry received", state: "done", date: row.enquiry_date, note: SOURCE_NOTES[row.source], tone: null };

  let quoted: Stage;
  const speed = quoteSpeed(row);
  if (row.quoted_date && speed) {
    quoted = { key: "quoted", label: "Quoted", state: "done", date: row.quoted_date, note: speed.text, tone: speed.quick ? "good" : null };
  } else if (row.status === "new") {
    const deadline = quoteDeadline(row.enquiry_date);
    const wait = waitStatus(row.enquiry_date, today);
    quoted = {
      key: "quoted",
      label: "Quote",
      state: "current",
      date: null,
      note:
        wait === "overdue"
          ? `Overdue since ${fmtDayMonth(addDays(deadline, 1), today)}`
          : wait === "due_today"
            ? "Due by the end of today"
            : `Due by the end of ${fmtDayMonth(deadline, today)}`,
      tone: wait === "overdue" ? "bad" : wait === "due_today" ? "warn" : null,
    };
  } else {
    quoted = { key: "quoted", label: "Quote", state: "todo", date: null, note: "Never quoted", tone: null };
  }

  const last = [...chases].sort((a, b) => (a.followed_up_on < b.followed_up_on ? 1 : -1))[0];
  const chaseNote = last
    ? `${plural(chases.length, "follow-up")}, last ${fmtDayMonth(last.followed_up_on, today)}`
    : "None logged";
  let chased: Stage;
  if (row.status === "quoted") {
    const waited = daysBetween(row.quoted_date ?? row.enquiry_date, today);
    chased = {
      key: "chased",
      label: `Waiting ${plural(Math.max(0, waited), "day")}`,
      state: "current",
      date: null,
      note: chaseNote,
      tone: waited >= STALE_DAYS ? "warn" : null,
    };
  } else if (row.status === "new") {
    chased = { key: "chased", label: "Follow-ups", state: "todo", date: null, note: "After the quote", tone: null };
  } else {
    chased = { key: "chased", label: "Follow-ups", state: last ? "done" : "todo", date: last?.followed_up_on ?? null, note: chaseNote, tone: null };
  }

  let outcome: Stage;
  if (row.status === "confirmed" && row.confirmed_date) {
    const lag = row.quoted_date ? daysBetween(row.quoted_date, row.confirmed_date) : null;
    outcome = {
      key: "outcome",
      label: "Job confirmed",
      state: "done",
      date: row.confirmed_date,
      note: lag == null ? "" : lag <= 0 ? "On the day of the quote" : `${plural(lag, "day")} after the quote`,
      tone: "good",
    };
  } else if (row.status === "lost" || row.status === "cancelled" || row.status === "not_genuine") {
    outcome = {
      key: "outcome",
      label: row.status === "lost" ? "Lost" : row.status === "cancelled" ? "Cancelled" : "Not genuine",
      state: "closed",
      date: null,
      note: row.closure_reason?.trim() || "No reason recorded",
      tone: row.status === "not_genuine" ? "flag" : "bad",
    };
  } else {
    outcome = { key: "outcome", label: "Won or lost", state: "todo", date: null, note: "Not yet", tone: null };
  }

  return [received, quoted, chased, outcome];
}

// --- The customer's record and the lane's history ------------------------------------------------------------

export interface CustomerStats {
  /** Enquiries raised since the season start (cancelled and not genuine ones aside), this one included. */
  enquiries: number;
  /** Their enquiries since the season start that staff marked not genuine. */
  notGenuine: number;
  won: number;
  /** Sell and profit of those won (the register keeps USD). */
  sold: number;
  profit: number;
  /** The latest confirmed job other than this one. */
  lastWin: HistoryRow | null;
  /** Median days from quote to confirmation, from 3 wins or more. */
  usualDays: number | null;
  /** The customer's other open enquiries: waiting for a quote, quoted, and quoted STALE_DAYS or more ago. */
  awaiting: number;
  quoted: number;
  stale: number;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

export function customerStats(rows: HistoryRow[], currentId: string, since: string, today: string): CustomerStats {
  const raised = rows.filter((r) => r.enquiry_date >= since);
  const season = raised.filter((r) => countsAsEnquiry(r.status));
  const won = season.filter((r) => r.status === "confirmed");
  const lags = won
    .filter((r) => r.quoted_date && r.confirmed_date)
    .map((r) => daysBetween(r.quoted_date!, r.confirmed_date!))
    .filter((d) => d >= 0);
  const others = rows.filter((r) => r.id !== currentId);
  const lastWin =
    others
      .filter((r) => r.status === "confirmed" && r.confirmed_date)
      .sort((a, b) => (a.confirmed_date! < b.confirmed_date! ? 1 : a.confirmed_date! > b.confirmed_date! ? -1 : 0))[0] ?? null;
  const quoted = others.filter((r) => r.status === "quoted");
  return {
    enquiries: season.length,
    notGenuine: raised.filter((r) => r.status === "not_genuine").length,
    won: won.length,
    sold: won.reduce((s, r) => s + (r.sell_total ?? 0), 0),
    profit: won.reduce((s, r) => s + (r.profit ?? 0), 0),
    lastWin,
    usualDays: lags.length >= 3 ? median(lags) : null,
    awaiting: others.filter((r) => r.status === "new").length,
    quoted: quoted.length,
    stale: quoted.filter((r) => daysBetween(r.quoted_date ?? r.enquiry_date, today) >= STALE_DAYS).length,
  };
}

export interface LaneStats {
  /** Other enquiries on the lane in the same mode since the season start (cancelled and not genuine ones aside). */
  enquiries: number;
  won: number;
  open: number;
  /** The latest wins with their prices, newest first. */
  wins: HistoryRow[];
}

export function laneStats(rows: HistoryRow[], current: Pick<EnquiryRow, "id" | "shipment_mode">, since: string, show = 4): LaneStats {
  const lane = rows.filter(
    (r) =>
      r.id !== current.id &&
      r.enquiry_date >= since &&
      countsAsEnquiry(r.status) &&
      (!current.shipment_mode || r.shipment_mode === current.shipment_mode),
  );
  const won = lane.filter((r) => r.status === "confirmed");
  return {
    enquiries: lane.length,
    won: won.length,
    open: lane.filter((r) => r.status === "new" || r.status === "quoted").length,
    wins: won
      .filter((r) => r.confirmed_date)
      .sort((a, b) => (a.confirmed_date! < b.confirmed_date! ? 1 : a.confirmed_date! > b.confirmed_date! ? -1 : 0))
      .slice(0, show),
  };
}

/** Who closed the enquiry the way it is closed now, and when: the latest change in its history that set the closure. */
export function closedBy(audit: AuditEntry[], closure: Closure): { by: string | null; at: string } | null {
  const hit = audit
    .filter((a) => a.action === "update" && (a.changes as Record<string, { new?: unknown }> | null)?.closure?.new === closure)
    .sort((a, b) => (a.changed_at < b.changed_at ? 1 : a.changed_at > b.changed_at ? -1 : 0))[0];
  return hit ? { by: hit.changed_by, at: hit.changed_at } : null;
}
