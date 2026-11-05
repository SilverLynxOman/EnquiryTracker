import { addDays, fmtDate } from "./format";
import { round2 } from "./normalize";
import {
  MODE_LABELS,
  SHIPMENT_MODES,
  TRADE_TYPE_LABELS,
  type BreakdownDimension,
  type EnquiryRow,
  type SalespersonSummaryRow,
  type ShipmentMode,
  type TradeType,
} from "./types";

// Daily / weekly / monthly reports (docs/IMPLEMENTATION_PLAN.md, Phase 4). Each lists the enquiries raised in
// the period, then the earlier enquiries confirmed in it, like the old Excel reports.

export type PeriodKind = "daily" | "weekly" | "monthly";

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
}

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** Weeks run Saturday to Friday: the weekly DATA sheet covered 24.10.2026 – 30.10.2026. */
export const WEEK_STARTS_ON = 6;

/** 0 = Sunday … 6 = Saturday. */
function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Number of days from `from` to `to`, both included. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function lastOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function monthName(iso: string): string {
  return MONTH_NAMES[Number(iso.slice(5, 7)) - 1];
}

export function dayPeriod(iso: string): Period {
  return { kind: "daily", from: iso, to: iso };
}

/** The Saturday–Friday week containing the date. */
export function weekPeriod(iso: string): Period {
  const from = addDays(iso, -((weekday(iso) - WEEK_STARTS_ON + 7) % 7));
  return { kind: "weekly", from, to: addDays(from, 6) };
}

/** The calendar month containing the date. */
export function monthPeriod(iso: string): Period {
  const from = `${iso.slice(0, 7)}-01`;
  return { kind: "monthly", from, to: lastOfMonth(from) };
}

/** The period before (-1) or after (+1): the previous / next calendar month, otherwise a range of the same length. */
export function shiftPeriod(p: Period, step: -1 | 1): Period {
  if (p.kind === "monthly") {
    const [y, m] = p.from.split("-").map(Number);
    return monthPeriod(new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 10));
  }
  const days = daysInRange(p.from, p.to) * step;
  return { kind: p.kind, from: addDays(p.from, days), to: addDays(p.to, days) };
}

export function periodTitle(p: Period): string {
  switch (p.kind) {
    case "daily":
      return `DAILY REPORT ${fmtDate(p.from)}`;
    case "weekly":
      return `WEEKLY REPORT ${fmtDate(p.from)} TO ${fmtDate(p.to)}`;
    case "monthly":
      return `${monthName(p.from)} JOB ENQUIRIES - ${p.from.slice(0, 4)}`;
  }
}

/** Title of the section listing earlier enquiries confirmed in the period, as in the Excel reports. */
export const EARLIER_SECTION_TITLE: Record<PeriodKind, string> = {
  daily: "PREVIOUS DAY'S CONFIRMATION",
  weekly: "LAST WEEK'S CONFIRMATION",
  monthly: "LAST MONTH'S CONFIRMATION",
};

/** Name of the register sheet in the export, as in the old workbooks: 01.11 / DATA1 / NOV. */
export function registerSheetName(p: Period): string {
  switch (p.kind) {
    case "daily":
      return `${p.from.slice(8, 10)}.${p.from.slice(5, 7)}`;
    case "weekly":
      return "DATA1";
    case "monthly":
      return monthName(p.from).slice(0, 3);
  }
}

export function periodFileName(p: Period): string {
  const d = (iso: string) => fmtDate(iso).replace(/\./g, "-");
  switch (p.kind) {
    case "daily":
      return `Daily Report ${d(p.from)}.xlsx`;
    case "weekly":
      return `Weekly Report ${d(p.from)} to ${d(p.to)}.xlsx`;
    case "monthly":
      return `Monthly Report ${monthName(p.from)} ${p.from.slice(0, 4)}.xlsx`;
  }
}

export interface PeriodReport {
  /** Enquiries raised in the period, oldest first. */
  raised: EnquiryRow[];
  /** Enquiries raised before the period and confirmed in it, oldest first. */
  earlier: EnquiryRow[];
  /** "NO. OF ENQUIRIES": raised in the period, cancelled ones not counted (as in the sales-person summary). */
  enquiries: number;
  cancelled: number;
  /** "NO. OF CONFIRMATIONS": jobs confirmed in the period, whenever the enquiry was raised. */
  confirmations: number;
  confirmedSell: number;
  confirmedProfit: number;
}

const byDateThenReference = (a: EnquiryRow, b: EnquiryRow) =>
  a.enquiry_date.localeCompare(b.enquiry_date) || a.reference.localeCompare(b.reference);

function sum(rows: EnquiryRow[], pick: (r: EnquiryRow) => number | null): number {
  return round2(rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0));
}

/** `raised`: enquiry date in the period. `confirmed`: confirmation date in the period and status confirmed. */
export function buildPeriodReport(p: Period, raised: EnquiryRow[], confirmed: EnquiryRow[]): PeriodReport {
  const cancelled = raised.filter((r) => r.status === "cancelled").length;
  return {
    raised: [...raised].sort(byDateThenReference),
    earlier: confirmed.filter((r) => r.enquiry_date < p.from).sort(byDateThenReference),
    enquiries: raised.length - cancelled,
    cancelled,
    confirmations: confirmed.length,
    confirmedSell: sum(confirmed, (r) => r.sell_total),
    confirmedProfit: sum(confirmed, (r) => r.profit),
  };
}

export interface ModeTotal {
  mode: ShipmentMode;
  /** Enquiries raised in the period (not cancelled). */
  enquiries: number;
  /** Jobs confirmed in the period, with their units and profit. */
  confirmed: number;
  units: number;
  profit: number;
}

/** Enquiries and confirmed jobs per shipment mode. Rows without a mode count as OTHER. */
export function modeTotals(raised: EnquiryRow[], confirmed: EnquiryRow[]): ModeTotal[] {
  const totals = new Map<ShipmentMode, ModeTotal>();
  const of = (r: EnquiryRow) => {
    const mode = r.shipment_mode ?? "OTHER";
    let t = totals.get(mode);
    if (!t) totals.set(mode, (t = { mode, enquiries: 0, confirmed: 0, units: 0, profit: 0 }));
    return t;
  };
  for (const r of raised) if (r.status !== "cancelled") of(r).enquiries++;
  for (const r of confirmed) {
    const t = of(r);
    t.confirmed++;
    t.units += r.units ?? 0;
    t.profit += Number(r.profit) || 0;
  }
  return SHIPMENT_MODES.flatMap((m) => {
    const t = totals.get(m);
    return t ? [{ ...t, profit: round2(t.profit) }] : [];
  });
}

export const DIMENSIONS: { key: BreakdownDimension; label: string; plural: string }[] = [
  { key: "sales_person", label: "Sales person", plural: "SALES PERSONS" },
  { key: "customer", label: "Customer", plural: "CUSTOMERS" },
  { key: "agent", label: "Agent", plural: "AGENTS" },
  { key: "lane", label: "Lane (POL → POD)", plural: "LANES" },
  { key: "mode", label: "Shipment mode", plural: "SHIPMENT MODES" },
  { key: "trade_type", label: "Import / export", plural: "TRADE TYPES" },
];

/** Display name of a breakdown group: shipment modes and trade types come back as codes. */
export function breakdownLabel(dimension: BreakdownDimension, label: string): string {
  if (dimension === "mode") return MODE_LABELS[label as ShipmentMode] ?? label;
  if (dimension === "trade_type") return TRADE_TYPE_LABELS[label as TradeType] ?? label;
  return label;
}

/** part / whole as a percentage with one decimal, or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 1000) / 10 : null;
}

export type SummaryTotals = Omit<SalespersonSummaryRow, "sales_person">;

/** Total row of the sales-person summary (the DATA sheet). */
export function summaryTotals(rows: SalespersonSummaryRow[]): SummaryTotals {
  const t: SummaryTotals = {
    total_enquiries: 0, confirmed: 0, confirmed_new: 0, confirmed_old: 0, fcl_jobs: 0,
    fcl_units: 0, air: 0, lcl: 0, courier: 0, other: 0, profit: 0,
  };
  for (const r of rows) {
    for (const k of Object.keys(t) as (keyof SummaryTotals)[]) t[k] += Number(r[k]) || 0;
  }
  t.profit = round2(t.profit);
  return t;
}

// --- On-screen report: headings, comparisons and the figures behind the KPI tiles ---------------

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const dayNum = (iso: string) => Number(iso.slice(8, 10));
const monthShort = (iso: string) => SHORT_MONTHS[Number(iso.slice(5, 7)) - 1];
const titleMonth = (iso: string) => `${monthName(iso).slice(0, 1)}${monthName(iso).slice(1).toLowerCase()}`;

/** "5 Nov", or "5 Nov 2026" with the year. */
export function shortDate(iso: string, withYear = false): string {
  return `${dayNum(iso)} ${monthShort(iso)}${withYear ? ` ${iso.slice(0, 4)}` : ""}`;
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[weekday(iso)];
}

/** "31 Oct – 6 Nov 2026", "1–5 Oct", "5 Nov". */
export function rangeLabel(from: string, to: string, withYear = false): string {
  if (from === to) return shortDate(from, withYear);
  const year = withYear ? ` ${to.slice(0, 4)}` : "";
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayNum(from)}–${dayNum(to)} ${monthShort(to)}${year}`;
  const fromYear = withYear && from.slice(0, 4) !== to.slice(0, 4) ? ` ${from.slice(0, 4)}` : "";
  return `${shortDate(from)}${fromYear} – ${shortDate(to)}${year}`;
}

/** Heading of the on-screen report: "Thursday, 5 November 2026", "31 Oct – 6 Nov 2026", "November 2026". */
export function periodHeading(p: Period): string {
  if (p.kind === "daily") return `${weekdayName(p.from)}, ${dayNum(p.from)} ${titleMonth(p.from)} ${p.from.slice(0, 4)}`;
  if (p.kind === "monthly") return `${titleMonth(p.from)} ${p.from.slice(0, 4)}`;
  return rangeLabel(p.from, p.to, true);
}

/** The part of the period up to today: the whole period once it is over; null if it hasn't started. */
export function elapsed(p: Period, today: string): Period | null {
  if (today < p.from) return null;
  return today >= p.to ? p : { ...p, to: today };
}

/**
 * What the period is measured against: the period before, like for like. While a period is still running
 * only its days so far count, against the same number of days at the start of the period before.
 */
export function comparePeriod(p: Period, today: string): { current: Period; previous: Period; label: string } {
  const current = elapsed(p, today) ?? p;
  const prevWhole = shiftPeriod(p, -1);
  const partial = current.to !== p.to;
  const days = daysInRange(current.from, current.to);
  const previous = partial ? { ...prevWhole, to: addDays(prevWhole.from, days - 1) } : prevWhole;
  let label: string;
  if (p.kind === "daily") label = `${weekdayName(previous.from).slice(0, 3)} ${shortDate(previous.from)}`;
  else if (partial) label = rangeLabel(previous.from, previous.to);
  else label = p.kind === "monthly" ? titleMonth(previous.from) : "the week before";
  return { current, previous, label };
}

export interface ReportFigures {
  /** Raised in the period, cancelled not counted. */
  enquiries: number;
  /** Of those, the ones quoted. */
  quoted: number;
  /** Of those, the ones now confirmed. */
  converted: number;
  /** Jobs confirmed in the period, whenever raised. */
  confirmations: number;
  sales: number;
  profit: number;
}

export function reportFigures(raised: EnquiryRow[], confirmed: EnquiryRow[]): ReportFigures {
  const live = raised.filter((r) => r.status !== "cancelled");
  return {
    enquiries: live.length,
    quoted: live.filter((r) => r.quoted_date || r.status === "quoted" || r.status === "confirmed").length,
    converted: live.filter((r) => r.status === "confirmed").length,
    confirmations: confirmed.length,
    sales: sum(confirmed, (r) => r.sell_total),
    profit: sum(confirmed, (r) => r.profit),
  };
}

export interface DayCount {
  date: string;
  enquiries: number;
  confirmed: number;
}

/** Enquiries raised (not cancelled) and jobs confirmed on each day of the period. */
export function dailySeries(p: Period, raised: EnquiryRow[], confirmed: EnquiryRow[]): DayCount[] {
  const days = new Map<string, DayCount>();
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.set(d, { date: d, enquiries: 0, confirmed: 0 });
  for (const r of raised) if (r.status !== "cancelled") days.get(r.enquiry_date)!.enquiries++;
  for (const r of confirmed) {
    const day = r.confirmed_date && days.get(r.confirmed_date);
    if (day) day.confirmed++;
  }
  return [...days.values()];
}

/** Customers with the most profit on jobs confirmed in the period. */
export function topCustomers(confirmed: EnquiryRow[], n = 5): { name: string; profit: number; jobs: number }[] {
  const by = new Map<string, { name: string; profit: number; jobs: number }>();
  for (const r of confirmed) {
    const t = by.get(r.customer_name) ?? { name: r.customer_name, profit: 0, jobs: 0 };
    t.profit += Number(r.profit) || 0;
    t.jobs++;
    by.set(r.customer_name, t);
  }
  return [...by.values()]
    .map((t) => ({ ...t, profit: round2(t.profit) }))
    .sort((a, b) => b.profit - a.profit || b.jobs - a.jobs)
    .slice(0, n);
}

/** Profit for the whole month at the rate so far, while the month is running; null otherwise. */
export function monthPace(p: Period, today: string, profit: number): number | null {
  if (p.kind !== "monthly" || today < p.from || today >= p.to) return null;
  return Math.round((profit / daysInRange(p.from, today)) * daysInRange(p.from, p.to));
}
