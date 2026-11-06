import { addDays } from "./format";
import { daysSince } from "./masterActivity";
import type { EnquiryRow } from "./types";

// The figures on a customer's or agent's own page, worked out in the browser from its enquiries.

/** One enquiry as the customer and agent pages use it (a row of the enquiry_register view). */
export type DetailRow = Pick<
  EnquiryRow,
  | "id"
  | "reference"
  | "enquiry_date"
  | "quoted_date"
  | "status"
  | "shipment_mode"
  | "pol"
  | "pod"
  | "profit"
  | "customer_id"
  | "customer_name"
  | "agent_name"
  | "sales_person_name"
>;

export interface Tally {
  enquiries: number;
  confirmed: number;
  /** Profit on the confirmed enquiries. */
  profit: number;
}

const empty = (): Tally => ({ enquiries: 0, confirmed: 0, profit: 0 });

function add(t: Tally, r: Pick<DetailRow, "status" | "profit">) {
  t.enquiries++;
  if (r.status === "confirmed") {
    t.confirmed++;
    t.profit += r.profit ?? 0;
  }
}

export function tally(
  rows: readonly Pick<DetailRow, "status" | "profit">[],
): Tally {
  const t = empty();
  for (const r of rows) add(t, r);
  return t;
}

/** "2026-03" → "2026-04". */
function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * One entry per month from the first enquiry's month to today's month, oldest first, at most `max` months (the latest
 * ones). Months without enquiries are kept, so gaps show.
 */
export function monthSeries(
  rows: readonly Pick<DetailRow, "enquiry_date" | "status" | "profit">[],
  today: string,
  max = 24,
): (Tally & { month: string })[] {
  if (!rows.length) return [];
  const end = today.slice(0, 7);
  const first = rows
    .reduce(
      (m, r) => (r.enquiry_date < m ? r.enquiry_date : m),
      rows[0].enquiry_date,
    )
    .slice(0, 7);
  const months: string[] = [];
  for (let m = first < end ? first : end; m <= end; m = nextMonth(m))
    months.push(m);
  const kept = months.slice(-max);
  const index = new Map(kept.map((m, i) => [m, i]));
  const out = kept.map((month) => ({ month, ...empty() }));
  for (const r of rows) {
    const i = index.get(r.enquiry_date.slice(0, 7));
    if (i !== undefined) add(out[i], r);
  }
  return out;
}

/** The last `days` days up to today against the same number of days before them. */
export function windowCompare(
  rows: readonly Pick<DetailRow, "enquiry_date" | "status" | "profit">[],
  today: string,
  days = 90,
): { current: Tally; previous: Tally } {
  const curFrom = addDays(today, -(days - 1));
  const prevFrom = addDays(today, -(2 * days - 1));
  const current = empty();
  const previous = empty();
  for (const r of rows) {
    if (r.enquiry_date > today) continue;
    if (r.enquiry_date >= curFrom) add(current, r);
    else if (r.enquiry_date >= prevFrom) add(previous, r);
  }
  return { current, previous };
}

/** The usual number of days between enquiries (median gap between enquiry days), or null with fewer than 3 days. */
export function usualGap(
  rows: readonly Pick<DetailRow, "enquiry_date">[],
): number | null {
  const days = [...new Set(rows.map((r) => r.enquiry_date))].sort();
  if (days.length < 3) return null;
  const gaps = days
    .slice(1)
    .map((d, i) => daysSince(days[i], d))
    .sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2
    ? gaps[mid]
    : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

/** Enquiries grouped by a value (mode, lane, sales person…), most enquiries first; rows without one are left out. */
export function breakdown<R extends Pick<DetailRow, "status" | "profit">>(
  rows: readonly R[],
  key: (r: R) => string | null,
): (Tally & { value: string })[] {
  const groups = new Map<string, Tally>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    let t = groups.get(k);
    if (!t) groups.set(k, (t = empty()));
    add(t, r);
  }
  return [...groups.entries()]
    .map(([value, t]) => ({ value, ...t }))
    .sort(
      (a, b) =>
        b.enquiries - a.enquiries ||
        b.confirmed - a.confirmed ||
        a.value.localeCompare(b.value),
    );
}

/** 1-based position by enquiries among all of them (ties share a place), or null without enquiries. */
export function rankOf(
  id: string,
  all: readonly { id: string; enquiries: number }[],
): number | null {
  const me = all.find((m) => m.id === id);
  if (!me || !me.enquiries) return null;
  return all.filter((m) => m.enquiries > me.enquiries).length + 1;
}
