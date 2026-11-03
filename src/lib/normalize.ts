import type { ShipmentMode, TradeType } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Trimmed, single-spaced text, or null when empty. */
export function cleanText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** Punctuation/space-insensitive key. Must match public.name_key() in the database. */
export function nameKey(s: string | null | undefined): string | null {
  if (!s) return null;
  const k = s.toUpperCase().replace(/[.,'"`]/g, " ").replace(/\s+/g, " ").trim();
  return k === "" ? null : k;
}

export interface ParseResult<T> {
  value: T | null;
  warning?: string;
  error?: string;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Parses the register's dates: DD.MM.YYYY text (with the typos found in the 2026 sheets such as
 * "30..04.2026", "11.05.206", "13.10.20226"), Excel serial numbers and Date objects.
 * Returns YYYY-MM-DD. A mistyped year is replaced by `contextYear` and reported as a warning.
 */
export function parseExcelDate(v: unknown, contextYear?: number): ParseResult<string> {
  if (v == null || v === "") return { value: null };
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return { value: null, error: `"${v}" is not a date` };
    const d = new Date(Math.round((v - 25569) * 86400000));
    return { value: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` };
  }
  if (v instanceof Date) {
    return { value: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` };
  }

  const raw = String(v).trim();
  if (raw === "") return { value: null };
  const parts = raw.split(/[^0-9]+/).filter(Boolean);
  if (parts.length !== 3) return { value: null, error: `"${raw}" is not a date (expected DD.MM.YYYY)` };

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  let year = Number(parts[2]);
  let warning: string | undefined;

  if (parts[2].length === 2) {
    year = 2000 + year;
  } else if (parts[2].length !== 4) {
    if (!contextYear) return { value: null, error: `"${raw}" has an invalid year` };
    year = contextYear;
    warning = `"${raw}" has a mistyped year; read as ${pad(day)}.${pad(month)}.${year}`;
  }

  if (!isValidYmd(year, month, day)) return { value: null, error: `"${raw}" is not a valid date` };

  if (!warning && contextYear && Math.abs(year - contextYear) > 1) {
    warning = `"${raw}" is far from ${contextYear}; please check the year`;
  } else if (!warning && !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(raw)) {
    warning = `"${raw}" read as ${pad(day)}.${pad(month)}.${year}`;
  }
  return { value: `${year}-${pad(month)}-${pad(day)}`, warning };
}

/** Parses a money/quantity cell. Thousands separators and currency prefixes are tolerated. */
export function parseNumber(v: unknown): ParseResult<number> {
  if (v == null || v === "") return { value: null };
  if (typeof v === "number") return Number.isFinite(v) ? { value: v } : { value: null, error: "is not a number" };
  const raw = String(v).trim();
  const s = raw.replace(/[,\s]/g, "").replace(/^(OMR|USD|AED|\$)/i, "");
  if (s === "") return { value: null };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { value: Number(s) };
  return { value: null, error: `"${raw}" is not a number` };
}

/** IMP / EXP / CT from the MODE column. */
export function parseTradeType(v: string | null): TradeType | null {
  if (!v) return null;
  const s = v.toUpperCase().replace(/[^A-Z]/g, "");
  if (s === "IMP" || s === "IMPORT") return "IMP";
  if (s === "EXP" || s === "EXPORT") return "EXP";
  if (s === "CT" || s === "CROSSTRADE" || s === "XTRADE") return "CT";
  return null;
}

export interface QtyInfo {
  mode: ShipmentMode | null;
  units: number | null;
  containerType: string | null;
}

const CONTAINER_RE = /(\d+)\s*[X×*]\s*(20|40|45)(?![0-9])([^0-9/+&,]*)/g;

function containerType(size: string, suffix: string): string {
  if (/RF|REEFER|RH/.test(suffix)) return `${size}RF`;
  if (/OT|OPEN/.test(suffix)) return `${size}OT`;
  if (/FR|FLAT/.test(suffix)) return `${size}FR`;
  if (/HC|HQ|HIGH/.test(suffix)) return `${size}HC`;
  return size;
}

/**
 * Interprets the QTY column: "1X40'", "2X40 RF", "1 X 40HC", "LCL", "AIR", "COURIER", "RORO",
 * "1X20' / 1X40'" (alternatives: units = largest option), "1X20' + 1X40'" (both: units summed).
 */
export function parseQty(text: string | null): QtyInfo {
  if (!text) return { mode: null, units: null, containerType: null };
  const t = text.toUpperCase().replace(/\s+/g, " ").trim();

  const containers = [...t.matchAll(CONTAINER_RE)].map((m) => ({
    count: Number(m[1]),
    type: containerType(m[2], m[3] ?? ""),
  }));

  const kinds = new Set<ShipmentMode>();
  if (containers.length || /\bFCL\b/.test(t)) kinds.add("FCL");
  if (/\bLCL\b/.test(t)) kinds.add("LCL");
  if (/\bAIR\b/.test(t)) kinds.add("AIR");
  if (/COURIER/.test(t)) kinds.add("COURIER");
  if (/\bRO-?RO\b/.test(t)) kinds.add("RORO");
  if (/BREAK|\bBB\b|BULK/.test(t)) kinds.add("BREAK_BULK");
  if (/\bSEA\b/.test(t) && !kinds.has("FCL") && !kinds.has("LCL")) kinds.add("OTHER");

  const mode: ShipmentMode = kinds.size === 0 ? "OTHER" : kinds.size === 1 ? [...kinds][0] : "MULTI";

  let units: number | null = null;
  let ctype: string | null = null;
  if (containers.length) {
    const alternatives = t.includes("/");
    units = alternatives
      ? Math.max(...containers.map((c) => c.count))
      : containers.reduce((sum, c) => sum + c.count, 0);
    ctype = [...new Set(containers.map((c) => c.type))].join(alternatives ? "/" : "+");
  }
  return { mode, units, containerType: ctype };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
