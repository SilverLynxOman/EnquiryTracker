import type { DateBasis, RegisterFilters } from "./api";
import { monthPeriod, weekPeriod } from "./reports";
import { SHIPMENT_MODES, STATUSES, type ShipmentMode, type Status } from "./types";

// The register's state lives in the URL, so a filtered view can be bookmarked, shared and survives a reload.

export type PeriodKey = "all" | "today" | "this_week" | "this_month" | "last_month" | "this_year" | "custom";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "all", label: "All dates" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week (Sat–Fri)" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range" },
];

export const BASIS_LABELS: Record<DateBasis, string> = {
  enquiry_date: "Enquiry date",
  quoted_date: "Quoted date",
  confirmed_date: "Confirmed date",
};

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface RegisterView {
  basis: DateBasis;
  period: PeriodKey;
  /** Only used for the custom period. */
  from: string;
  to: string;
  status: Status | "";
  salesPersonId: string;
  mode: ShipmentMode | "";
  q: string;
  sort: "asc" | "desc";
  page: number;
  size: number;
  /** Enquiry shown in the details drawer. */
  selected: string;
}

export const DEFAULT_VIEW: RegisterView = {
  basis: "enquiry_date",
  period: "this_month",
  from: "",
  to: "",
  status: "",
  salesPersonId: "",
  mode: "",
  q: "",
  sort: "desc",
  page: 0,
  size: 25,
  selected: "",
};

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Inclusive date range of a period, as YYYY-MM-DD; "" means open-ended. */
export function periodRange(period: PeriodKey, today: string, custom: { from: string; to: string } = { from: "", to: "" }) {
  switch (period) {
    case "all":
      return { from: "", to: "" };
    case "today":
      return { from: today, to: today };
    case "this_week": {
      const w = weekPeriod(today);
      return { from: w.from, to: w.to };
    }
    case "this_month": {
      const m = monthPeriod(today);
      return { from: m.from, to: m.to };
    }
    case "last_month": {
      const [y, mo] = today.split("-").map(Number);
      const m = monthPeriod(new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10));
      return { from: m.from, to: m.to };
    }
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case "custom":
      return { from: custom.from, to: custom.to };
  }
}

export function readRegisterView(p: URLSearchParams): RegisterView {
  const basis = p.get("basis");
  const status = p.get("status");
  const mode = p.get("mode");
  const size = Number(p.get("size"));
  const from = isDate(p.get("from")) ? p.get("from")! : "";
  const to = isDate(p.get("to")) ? p.get("to")! : "";
  let period = PERIODS.find((x) => x.key === p.get("period"))?.key;
  // Links from before the period presets carried only from/to.
  if (!period) period = from || to ? "custom" : DEFAULT_VIEW.period;
  return {
    basis: basis === "quoted_date" || basis === "confirmed_date" ? basis : "enquiry_date",
    period,
    from,
    to,
    status: STATUSES.includes(status as Status) ? (status as Status) : "",
    salesPersonId: p.get("sp") ?? "",
    mode: SHIPMENT_MODES.includes(mode as ShipmentMode) ? (mode as ShipmentMode) : "",
    q: p.get("q") ?? "",
    sort: p.get("sort") === "asc" ? "asc" : "desc",
    page: Math.max(0, Math.floor(Number(p.get("page")) || 0)),
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_VIEW.size,
    selected: p.get("sel") ?? "",
  };
}

/** Only values that differ from the defaults go in the URL. */
export function writeRegisterView(v: RegisterView): URLSearchParams {
  const p = new URLSearchParams();
  if (v.basis !== DEFAULT_VIEW.basis) p.set("basis", v.basis);
  if (v.period !== DEFAULT_VIEW.period) p.set("period", v.period);
  if (v.period === "custom") {
    if (v.from) p.set("from", v.from);
    if (v.to) p.set("to", v.to);
  }
  if (v.status) p.set("status", v.status);
  if (v.salesPersonId) p.set("sp", v.salesPersonId);
  if (v.mode) p.set("mode", v.mode);
  if (v.q) p.set("q", v.q);
  if (v.sort !== DEFAULT_VIEW.sort) p.set("sort", v.sort);
  if (v.page) p.set("page", String(v.page));
  if (v.size !== DEFAULT_VIEW.size) p.set("size", String(v.size));
  if (v.selected) p.set("sel", v.selected);
  return p;
}

/** Page buttons to show: all when few, else first, last and the neighbours of the current page ("gap" = …). */
export function pageItems(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const middle = [current - 1, current, current + 1].filter((p) => p > 0 && p < count - 1);
  const out: (number | "gap")[] = [0];
  if (middle[0] > 1) out.push("gap");
  out.push(...middle);
  if (middle[middle.length - 1] < count - 2) out.push("gap");
  out.push(count - 1);
  return out;
}

/** Columns a viewer can hide; the others always show. Narrow tables also hide them automatically. */
export const OPTIONAL_COLUMNS = [
  { key: "route", label: "Route" },
  { key: "shipment", label: "Shipment" },
  { key: "people", label: "Sales & agent" },
  { key: "profit", label: "Profit" },
] as const;

export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]["key"];
export type ColumnPrefs = Record<OptionalColumn, boolean>;

/** The query the view stands for, with the period turned into dates. */
export function viewFilters(v: RegisterView, today: string): RegisterFilters {
  const { from, to } = periodRange(v.period, today, v);
  return { basis: v.basis, from, to, status: v.status, salesPersonId: v.salesPersonId, mode: v.mode, q: v.q };
}
