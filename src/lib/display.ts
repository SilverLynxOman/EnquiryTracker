import { MODE_LABELS, type EnquiryRow, type ShipmentMode, type TradeType } from "./types";

// Presentation helpers. They change only how values are shown: stored data, exports and form inputs keep the
// register's original (upper-case) spelling.

/** Kept upper case when names are shown in title case. */
const UPPER_WORDS = new Set([
  "LLC", "L.L.C", "L.L.C.", "LLP", "WLL", "W.L.L", "W.L.L.", "FZE", "FZCO", "FZC", "FZ", "FZ-LLC", "SAOG", "SAOC", "SPC",
  "PLC", "UAE", "U.A.E", "KSA", "USA", "UK", "GCC", "DMCC", "JLT", "DWC", "II", "III", "IV",
]);
/** Two-letter words that read as words (Al Madina), not initials (JA Supply). */
const SHORT_WORDS = new Set(["AL", "EL", "OF", "TO", "DE", "LA", "LE", "DU", "DA", "AN", "AT", "BY", "IN", "ON", "OR"]);

/**
 * Title case for names typed in capitals: "AL MADINA TRADING" → "Al Madina Trading", keeping initials and company
 * suffixes: "JA SUPPLY" → "JA Supply", "A.V. FREIGHT" → "A.V. Freight", "SOHAR STEEL LLC" → "Sohar Steel LLC".
 * Names that already use lower case are left as typed.
 */
export function displayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = raw.trim().replace(/\s+/g, " ");
  if (/[a-z]/.test(text)) return text;
  return text
    .split(" ")
    .map((word) => {
      const bare = word.replace(/[(),]/g, "");
      const letters = bare.replace(/[^A-Z]/g, "");
      if (UPPER_WORDS.has(bare) || /\d/.test(word) || letters.length <= 1) return word;
      if (bare.includes(".") && letters.length <= 3) return word; // initials: A.V., S.A.
      if (letters.length === 2 && bare.length === 2 && !SHORT_WORDS.has(bare)) return word;
      return word.toLowerCase().replace(/(^|[-'/(&])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
    })
    .join(" ");
}

const COUNTRIES = [
  "OMAN", "UAE", "U.A.E", "INDIA", "CHINA", "SAUDI ARABIA", "KSA", "QATAR", "BAHRAIN", "KUWAIT", "PAKISTAN", "IRAN",
  "IRAQ", "YEMEN", "EGYPT", "TURKEY", "TURKIYE", "JORDAN", "SRI LANKA", "BANGLADESH", "SINGAPORE", "MALAYSIA",
  "INDONESIA", "THAILAND", "VIETNAM", "SOUTH KOREA", "KOREA", "JAPAN", "TAIWAN", "HONG KONG", "PHILIPPINES", "USA",
  "UNITED STATES", "UK", "UNITED KINGDOM", "GERMANY", "ITALY", "SPAIN", "FRANCE", "NETHERLANDS", "BELGIUM", "POLAND",
  "NORWAY", "SWEDEN", "DENMARK", "FINLAND", "RUSSIA", "KENYA", "TANZANIA", "SOUTH AFRICA", "NIGERIA", "DJIBOUTI",
  "SUDAN", "SOMALIA", "CANADA", "BRAZIL", "AUSTRALIA", "NEW ZEALAND", "MEXICO",
].sort((a, b) => b.length - a.length);

/** Port without its country, for the compact Route column: "JEBEL ALI UAE" → "Jebel Ali". */
export function shortPort(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = raw.trim().replace(/\s+/g, " ");
  const upper = text.toUpperCase();
  for (const country of COUNTRIES) {
    if (upper.length > country.length + 1 && upper.endsWith(` ${country}`)) {
      return displayName(text.slice(0, text.length - country.length - 1).replace(/[\s,-]+$/, ""));
    }
  }
  return displayName(text);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM-DD → "04 Nov 2026". */
export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "04 Nov", with the year only when it is not the reference year. */
export function fmtDayMonth(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? fmtDateLong(iso).slice(0, 6) : fmtDateLong(iso);
}

/** Whole days from `from` to `to` (negative when `from` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** A wait this long (days without a quote, or since the quote) is highlighted. Not a deadline: no "overdue". */
export const LONG_WAIT_DAYS = 7;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Second line under the status badge: how long it has waited, when it was confirmed, or why it closed. */
export function statusDetail(r: EnquiryRow, today: string): { text: string; longWait: boolean } {
  switch (r.status) {
    case "new":
    case "quoted": {
      const since = r.status === "new" ? r.enquiry_date : (r.quoted_date ?? r.enquiry_date);
      const days = Math.max(0, daysBetween(since, today));
      if (days === 0) return { text: r.status === "new" ? "Received today" : "Quoted today", longWait: false };
      return { text: `Waiting ${plural(days, "day")}`, longWait: days >= LONG_WAIT_DAYS };
    }
    case "confirmed":
      return { text: r.confirmed_date ? fmtDayMonth(r.confirmed_date, today) : "", longWait: false };
    case "lost":
    case "cancelled":
      return { text: r.closure_reason?.trim() || "No reason recorded", longWait: false };
  }
}

export type NextStep = "quote" | "confirm" | "view";

/** The one action offered on each row. Viewers (read-only) always get "view". */
export function nextStep(r: EnquiryRow, canEdit: boolean): NextStep {
  if (canEdit && r.status === "new") return "quote";
  if (canEdit && r.status === "quoted") return "confirm";
  return "view";
}

export const TRADE_LABELS: Record<TradeType, string> = { IMP: "Import", EXP: "Export", CT: "Cross trade" };

/** Shipment column: container counts for FCL ("2×20'"), otherwise the mode ("LCL", "Courier"). */
export function shipmentLabel(r: Pick<EnquiryRow, "shipment_mode" | "qty_text">): string {
  const qty = r.qty_text?.trim();
  if ((r.shipment_mode === "FCL" || r.shipment_mode === "MULTI" || !r.shipment_mode) && qty) {
    return qty.replace(/(\d)\s*X\s*(?=\d)/gi, "$1×");
  }
  return r.shipment_mode ? MODE_LABELS[r.shipment_mode as ShipmentMode] : "";
}

/** Initials for a small avatar: "SHIYAD" → "S", "ANWAR ALI" → "AA". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") : "?";
}
