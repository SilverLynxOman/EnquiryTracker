import { daysBetween } from "./display";
import { STALE_DAYS } from "./followUps";
import { monthPeriod } from "./reports";
import type { FollowUpRecord, QuoteTime, ShipmentMode, WindowEnquiry } from "./types";
import { isQuickQuote, previousMonth, quoteDeadline } from "./workdays";

// The Window: a sales person's home page. Every open quote sits on a timeline of days since it was sent, against
// the "win window": the days in which that person's wins usually arrive. Activity only, never money. Pure
// functions, tested in quoteWindow.test.ts. How it looks: docs/DESIGN.md, "The Window".

/** The timeline's last day. From STALE_DAYS a quote is stale and the Follow-ups page takes over. */
export const TIMELINE_DAYS = STALE_DAYS - 1;

/** The win window in days since the quote: suggested from a person's own wins, within these bounds. */
export const WINDOW_MIN = 3;
export const WINDOW_MAX = 10;
export const WINDOW_DEFAULT = 7;
/** The suggested window covers this share of a person's wins… */
export const WINDOW_COVERAGE = 0.95;
/** …once they have this many wins with a quote date this year. Until then, WINDOW_DEFAULT. */
export const WINDOW_MIN_WINS = 10;

export function clampWindow(days: number): number {
  return Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, Math.round(days)));
}

/** Days from quote to confirmation for each job won since `since`. A confirmation dated before its quote counts as 0. */
export function winLags(rows: WindowEnquiry[], since: string): number[] {
  const lags: number[] = [];
  for (const e of rows) {
    if (e.status !== "confirmed" || !e.quoted_date || !e.confirmed_date || e.confirmed_date < since) continue;
    lags.push(Math.max(0, daysBetween(e.quoted_date, e.confirmed_date)));
  }
  return lags;
}

/** Share of the wins confirmed within `days` of the quote (0 without wins). */
export function shareWithin(lags: number[], days: number): number {
  return lags.length ? lags.filter((d) => d <= days).length / lags.length : 0;
}

/** The shortest window that covers WINDOW_COVERAGE of a person's wins. */
export function suggestedWindow(lags: number[]): number {
  if (lags.length < WINDOW_MIN_WINS) return WINDOW_DEFAULT;
  for (let d = WINDOW_MIN; d < WINDOW_MAX; d++) {
    if (shareWithin(lags, d) >= WINDOW_COVERAGE) return d;
  }
  return WINDOW_MAX;
}

export type WaitStatus = "overdue" | "due_today" | "new";

/** Against the quick-quote deadline: the end of the next working day after the enquiry arrived. */
export function waitStatus(enquiryDate: string, today: string): WaitStatus {
  const deadline = quoteDeadline(enquiryDate);
  if (today > deadline) return "overdue";
  return today === deadline ? "due_today" : "new";
}

export interface CustomerRecord {
  enquiries: number;
  wins: number;
}

const NO_RECORD: CustomerRecord = { enquiries: 0, wins: 0 };

/** Customers merged on the Customers page share an id, so their history adds up. */
export function customerKey(e: Pick<WindowEnquiry, "customer_id" | "customer_name">): string {
  return e.customer_id || e.customer_name;
}

/** Each customer's enquiries with this sales person since `since` (cancelled ones aside), and how many were won. */
export function customerRecords(rows: WindowEnquiry[], since: string): Map<string, CustomerRecord> {
  const out = new Map<string, CustomerRecord>();
  for (const e of rows) {
    if (e.enquiry_date < since || e.status === "cancelled") continue;
    const key = customerKey(e);
    const r = out.get(key) ?? { enquiries: 0, wins: 0 };
    r.enquiries++;
    if (e.status === "confirmed") r.wins++;
    out.set(key, r);
  }
  return out;
}

/** How likely a customer is to confirm, nudged towards the middle so one win from one enquiry doesn't top 28 from 31. */
export function customerScore(r: CustomerRecord): number {
  return (r.wins + 1) / (r.enquiries + 2);
}

export type WindowSort = "newest" | "customers";

export interface WaitingItem {
  row: WindowEnquiry;
  /** Days since the enquiry arrived. */
  days: number;
  status: WaitStatus;
  customer: CustomerRecord;
}

export interface QuoteItem {
  row: WindowEnquiry & { quoted_date: string };
  /** Days since the quote. */
  days: number;
  inWindow: boolean;
  customer: CustomerRecord;
  /** The latest follow-up on this quote, by anyone. */
  lastChase: FollowUpRecord | null;
  /** The viewer, as a sales person, logged a follow-up on it today. */
  chasedToday: boolean;
}

export interface WindowView {
  /** Awaiting a quote and received less than STALE_DAYS ago, longest waiting first. */
  waiting: WaitingItem[];
  /** Quoted no more than TIMELINE_DAYS ago. */
  quotes: QuoteItem[];
  overdue: number;
  inWindow: number;
  lastChance: number;
}

export function buildWindow(input: {
  rows: WindowEnquiry[];
  today: string;
  windowDays: number;
  /** "" for every mode. */
  mode: ShipmentMode | "";
  sort: WindowSort;
  records: Map<string, CustomerRecord>;
  chases: FollowUpRecord[];
  /** The viewer's sales person, for "chased today"; null when they are not one. */
  me: string | null;
}): WindowView {
  const { rows, today, windowDays, mode, records, chases, me } = input;
  const keep = (e: WindowEnquiry) => !mode || e.shipment_mode === mode;
  const record = (e: WindowEnquiry) => records.get(customerKey(e)) ?? NO_RECORD;

  const latest = new Map<string, FollowUpRecord>();
  const mineToday = new Set<string>();
  for (const c of chases) {
    const seen = latest.get(c.enquiry_id);
    if (!seen || c.followed_up_on > seen.followed_up_on) latest.set(c.enquiry_id, c);
    if (me && c.sales_person_id === me && c.followed_up_on === today) mineToday.add(c.enquiry_id);
  }

  const waiting: WaitingItem[] = rows
    .filter((e) => e.status === "new" && keep(e))
    .map((e) => ({ row: e, days: daysBetween(e.enquiry_date, today), status: waitStatus(e.enquiry_date, today), customer: record(e) }))
    .filter((w) => w.days >= 0 && w.days < STALE_DAYS)
    .sort((a, b) => b.days - a.days || a.row.reference.localeCompare(b.row.reference));

  const quotes: QuoteItem[] = rows
    .filter((e): e is WindowEnquiry & { quoted_date: string } => e.status === "quoted" && !!e.quoted_date && keep(e))
    .map((e) => {
      const days = daysBetween(e.quoted_date, today);
      return { row: e, days, inWindow: days <= windowDays, customer: record(e), lastChase: latest.get(e.id) ?? null, chasedToday: mineToday.has(e.id) };
    })
    .filter((q) => q.days >= 0 && q.days <= TIMELINE_DAYS);

  const byAge = (a: QuoteItem, b: QuoteItem) => a.days - b.days || a.row.reference.localeCompare(b.row.reference);
  quotes.sort(
    input.sort === "customers"
      ? (a, b) => Number(b.inWindow) - Number(a.inWindow) || customerScore(b.customer) - customerScore(a.customer) || byAge(a, b)
      : byAge,
  );

  const inWindow = quotes.filter((q) => q.inWindow).length;
  return { waiting, quotes, overdue: waiting.filter((w) => w.status === "overdue").length, inWindow, lastChance: quotes.length - inWindow };
}

export interface MonthWins {
  /** Wins added up day by day: this month up to today, and the whole of last month. */
  thisMonth: number[];
  lastMonth: number[];
  /** Days in this month: the chart's width. */
  monthDays: number;
  total: number;
  lastTotal: number;
  /** Last month's wins by the same day of the month. */
  lastByNow: number;
  /** The best earlier month this year (the latest of equals), when one had wins. */
  best: { month: string; wins: number } | null;
  /** This month's wins confirmed on the day they were quoted. */
  sameDay: number;
  /** This month's wins, latest first. */
  wins: WindowEnquiry[];
}

export function monthWins(rows: WindowEnquiry[], today: string, mode: ShipmentMode | "", since: string): MonthWins {
  const month = monthPeriod(today);
  const prev = monthPeriod(previousMonth(today));
  const day = Number(today.slice(8, 10));
  const monthDays = Number(month.to.slice(8, 10));
  const lastDays = Number(prev.to.slice(8, 10));
  const daily = new Array<number>(monthDays).fill(0);
  const lastDaily = new Array<number>(lastDays).fill(0);
  const byMonth = new Map<string, number>();
  const wins: WindowEnquiry[] = [];
  let sameDay = 0;

  for (const e of rows) {
    const d = e.confirmed_date;
    if (e.status !== "confirmed" || !d || (mode && e.shipment_mode !== mode)) continue;
    if (d >= month.from && d <= today) {
      daily[Number(d.slice(8, 10)) - 1]++;
      wins.push(e);
      if (e.quoted_date === d) sameDay++;
    } else if (d >= prev.from && d <= prev.to) {
      lastDaily[Number(d.slice(8, 10)) - 1]++;
    }
    if (d >= since && d < month.from) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + 1);
  }

  const running = (counts: number[]) => {
    let sum = 0;
    return counts.map((n) => (sum += n));
  };
  const thisMonth = running(daily).slice(0, day);
  const lastMonth = running(lastDaily);
  let best: MonthWins["best"] = null;
  for (const [m, wins] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
    if (!best || wins >= best.wins) best = { month: `${m}-01`, wins };
  }
  return {
    thisMonth,
    lastMonth,
    monthDays,
    total: thisMonth.at(-1) ?? 0,
    lastTotal: lastMonth.at(-1) ?? 0,
    lastByNow: lastMonth[Math.min(day, lastDays) - 1] ?? 0,
    best,
    sameDay,
    wins: wins.sort((a, b) => (b.confirmed_date ?? "").localeCompare(a.confirmed_date ?? "") || a.reference.localeCompare(b.reference)),
  };
}

/** Share of quoted enquiries that were quoted by the end of the next working day. */
export function quickShare(times: Pick<QuoteTime, "enquiry_date" | "quoted_date">[]): { share: number; count: number } {
  const quoted = times.filter((t) => !!t.quoted_date);
  const quick = quoted.filter((t) => isQuickQuote(t)).length;
  return { share: quoted.length ? quick / quoted.length : 0, count: quoted.length };
}
