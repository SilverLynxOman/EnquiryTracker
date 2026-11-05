import { shortPort } from "./display";
import { addDays } from "./format";
import { monthPeriod } from "./reports";
import type { EnquiryRow } from "./types";

// Dates for the sales home page (The Window) and the team voyage: Oman's working week, the month's pace and the
// quick-quote deadline. Pure functions, tested in workdays.test.ts.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "November" */
export function monthLabel(iso: string): string {
  return MONTH_NAMES[Number(iso.slice(5, 7)) - 1];
}

/** "Thursday 5 November" */
export function dayLabel(iso: string): string {
  return `${DAY_NAMES[weekday(iso)]} ${Number(iso.slice(8, 10))} ${monthLabel(iso)}`;
}

/** The previous calendar month's first day. */
export function previousMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

/** This year's first day: records and averages cover the calendar year. */
export function seasonStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/** Oman's working week runs Sunday to Thursday. Public holidays are not known to the app. */
export function isWorkingDay(iso: string): boolean {
  const day = weekday(iso);
  return day !== 5 && day !== 6;
}

/** The first working day after the date. */
export function nextWorkingDay(iso: string): string {
  let d = addDays(iso, 1);
  while (!isWorkingDay(d)) d = addDays(d, 1);
  return d;
}

export interface MonthPace {
  /** Working days in the month. */
  total: number;
  /** Working days before today. */
  done: number;
  /** Today as "day N of total" (on a weekend: the working days so far). */
  day: number;
  /** Share of the month's working days behind us (0–1). */
  share: number;
}

export function monthPace(today: string): MonthPace {
  const { from, to } = monthPeriod(today);
  let total = 0;
  let done = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    total++;
    if (d < today) done++;
  }
  return { total, done, day: done + (isWorkingDay(today) ? 1 : 0), share: total ? done / total : 0 };
}

/** The date of a month's Nth working day; its last working day when it has fewer (null for N below 1). */
export function nthWorkingDay(monthIso: string, n: number): string | null {
  if (n < 1) return null;
  const { from, to } = monthPeriod(monthIso);
  let count = 0;
  let last: string | null = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    count++;
    last = d;
    if (count === n) return d;
  }
  return last;
}

export interface LastMonthPoint {
  /** Last month's count after as many working days as this month has behind it. */
  byNow: number;
  /** Last month's whole count. */
  total: number;
}

/**
 * Where last month stood at this point. Confirmations bunch up later in a month, so this is a fairer yardstick
 * than a straight line (or a projection) early on: the team had 25 of October's 161 jobs after five working days.
 */
export function lastMonthAtThisPoint(dates: (string | null)[], today: string, pace: MonthPace): LastMonthPoint {
  const prev = monthPeriod(previousMonth(today));
  const inPrev = dates.filter((d): d is string => !!d && d >= prev.from && d <= prev.to);
  const cutoff = nthWorkingDay(prev.from, pace.done);
  return { byNow: cutoff ? inPrev.filter((d) => d <= cutoff).length : 0, total: inPrev.length };
}

/** A quote is quick when it goes out by the end of the next working day after the enquiry arrived. */
export function quoteDeadline(enquiryDate: string): string {
  return nextWorkingDay(enquiryDate);
}

export function isQuickQuote(e: Pick<EnquiryRow, "enquiry_date" | "quoted_date">): boolean {
  return !!e.quoted_date && e.quoted_date <= quoteDeadline(e.enquiry_date);
}

/** "Shanghai → Sohar" (ports without their country). */
export function laneLabel(pol: string | null, pod: string | null): string {
  const from = shortPort(pol);
  const to = shortPort(pod);
  return from || to ? `${from || "?"} → ${to || "?"}` : "";
}
