import { addDays, firstOfMonth } from "./format";
import type { PeriodStats } from "./types";

export type KpiPeriod = "today" | "week" | "month" | "quarter" | "year";
export type KpiCompare = "previous" | "lastYear";

export const KPI_PERIODS: { value: KpiPeriod; label: string; title: string }[] = [
  { value: "today", label: "Today", title: "Today" },
  { value: "week", label: "Week", title: "This week" },
  { value: "month", label: "Month", title: "Month to date" },
  { value: "quarter", label: "Quarter", title: "Quarter to date" },
  { value: "year", label: "Year", title: "Year to date" },
];

export interface DateRange {
  from: string;
  to: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** The same calendar day a year earlier (29 Feb becomes 28 Feb). */
export function shiftYear(day: string): string {
  const [y, m, d] = parts(day);
  return iso(y - 1, m, Math.min(d, daysInMonth(y - 1, m)));
}

/** The week starts on Sunday, the first working day in Oman. */
export function weekStart(day: string): string {
  return addDays(day, -new Date(`${day}T00:00:00Z`).getUTCDay());
}

export function quarterStart(day: string): string {
  const [y, m] = parts(day);
  return iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
}

/** The selected period, up to and including today. */
export function periodRange(period: KpiPeriod, today: string): DateRange {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "month":
      return { from: firstOfMonth(today), to: today };
    case "quarter":
      return { from: quarterStart(today), to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/**
 * What the period is measured against: the same number of days into the previous
 * period, or the same dates a year earlier. A month to the 31st compares with a
 * shorter previous month up to its last day.
 */
export function compareRange(period: KpiPeriod, compare: KpiCompare, today: string): DateRange {
  const cur = periodRange(period, today);
  if (compare === "lastYear") return { from: shiftYear(cur.from), to: shiftYear(cur.to) };
  const elapsed = daysBetween(cur.from, cur.to);
  switch (period) {
    case "today":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "week":
      return { from: addDays(cur.from, -7), to: addDays(cur.to, -7) };
    case "month": {
      const [y, m, d] = parts(today);
      const from = iso(y, m - 1, 1);
      const [py, pm] = parts(from);
      return { from, to: iso(py, pm, Math.min(d, daysInMonth(py, pm))) };
    }
    case "quarter": {
      const from = quarterStart(addDays(cur.from, -1));
      const end = addDays(from, elapsed);
      const lastDay = addDays(cur.from, -1);
      return { from, to: end < lastDay ? end : lastDay };
    }
    case "year":
      return { from: shiftYear(cur.from), to: shiftYear(cur.to) };
  }
}

/** Short name for the comparison, read after "vs". */
export function compareLabel(period: KpiPeriod, compare: KpiCompare, today: string): string {
  if (compare === "lastYear") return period === "year" ? String(Number(today.slice(0, 4)) - 1) : "last year";
  switch (period) {
    case "today":
      return "yesterday";
    case "week":
      return "last week";
    case "month":
      return MONTHS[parts(compareRange("month", "previous", today).from)[1] - 1];
    case "quarter":
      return "last quarter";
    case "year":
      return String(Number(today.slice(0, 4)) - 1);
  }
}

export type KpiKey = "enquiries" | "quoted" | "confirmed" | "conversion" | "sales" | "profit" | "margin" | "avgProfit";

/** Rates move in percentage points; counts and money in percent. */
export interface KpiDef {
  key: KpiKey;
  label: string;
  kind: "count" | "money" | "rate";
  hint: string;
}

export const KPIS: KpiDef[] = [
  {
    key: "enquiries",
    label: "Enquiries",
    kind: "count",
    hint: "Enquiries raised in the period",
  },
  {
    key: "quoted",
    label: "Quoted",
    kind: "count",
    hint: "Quotes sent in the period",
  },
  {
    key: "confirmed",
    label: "Confirmed",
    kind: "count",
    hint: "Jobs confirmed in the period, by confirmation date",
  },
  {
    key: "conversion",
    label: "Conversion",
    kind: "rate",
    hint: "Share of the period's enquiries that are confirmed",
  },
  {
    key: "sales",
    label: "Sales",
    kind: "money",
    hint: "Sales on jobs confirmed in the period",
  },
  {
    key: "profit",
    label: "Profit",
    kind: "money",
    hint: "Profit on jobs confirmed in the period",
  },
  {
    key: "margin",
    label: "Margin",
    kind: "rate",
    hint: "Profit as a share of sales",
  },
  {
    key: "avgProfit",
    label: "Profit per job",
    kind: "money",
    hint: "Average profit on each confirmed job",
  },
];

/** The value of each KPI; null where it can't be worked out (a rate with nothing to divide by). */
export function kpiValues(s: PeriodStats): Record<KpiKey, number | null> {
  const profit = Number(s.profit);
  const sales = Number(s.sell_total);
  return {
    enquiries: s.enquiries,
    quoted: s.quoted,
    confirmed: s.confirmed,
    conversion: s.enquiries ? (s.converted / s.enquiries) * 100 : null,
    sales,
    profit,
    margin: sales ? (profit / sales) * 100 : null,
    avgProfit: s.confirmed ? profit / s.confirmed : null,
  };
}

export interface KpiDelta {
  direction: "up" | "down" | "flat";
  text: string;
}

/** Change against the comparison: points for rates, percent for the rest; null when there's no base. */
export function kpiDelta(kind: KpiDef["kind"], cur: number | null, prev: number | null): KpiDelta | null {
  if (cur == null || prev == null) return null;
  if (kind === "rate") {
    const d = cur - prev;
    const direction = Math.abs(d) < 0.05 ? "flat" : d > 0 ? "up" : "down";
    return { direction, text: `${Math.abs(d).toFixed(1)} pts` };
  }
  if (!prev) return null;
  const d = ((cur - prev) / prev) * 100;
  const direction = Math.abs(d) < 0.5 ? "flat" : d > 0 ? "up" : "down";
  return { direction, text: Math.abs(d) >= 1000 ? "999%+" : `${Math.abs(d).toFixed(0)}%` };
}

/** Bar under each figure: the rate itself, or how far the period has got towards the comparison. */
export function kpiBar(kind: KpiDef["kind"], cur: number | null, prev: number | null): number {
  if (cur == null) return 0;
  if (kind === "rate") return Math.max(0, Math.min(cur, 100));
  if (!prev) return cur > 0 ? 100 : 0;
  return Math.max(0, Math.min((cur / prev) * 100, 100));
}
