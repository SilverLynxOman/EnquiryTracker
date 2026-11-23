import type { PriceChecker } from "./types";

// Price checkers: customers who keep asking for prices and never book (supabase/migrations/20261109110000_price_checkers.sql).
// Worked out from the register, nobody tags them; the badge goes away by itself once the customer books a job.

/** Quotes in the window that make a customer a price checker, with no job confirmed in it. */
export const PRICE_CHECKER_MIN_QUOTES = 5;

/** Start of the window: the same day a year ago (29 February becomes the 28th). */
export function priceCheckerSince(today: string): string {
  const [y, m, d] = today.split("-");
  const day = m === "02" && d === "29" ? "28" : d;
  return `${Number(y) - 1}-${m}-${day}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "14 quotes in the last 12 months, no job booked". */
export function priceCheckerSummary(p: Pick<PriceChecker, "quotes">): string {
  return `${p.quotes} quotes in the last 12 months, no job booked`;
}

/** "Last job: March 2025", or that the register has none. */
export function lastJobText(p: Pick<PriceChecker, "last_win">): string {
  if (!p.last_win) return "No job booked in the register.";
  return `Last job: ${MONTHS[Number(p.last_win.slice(5, 7)) - 1]} ${p.last_win.slice(0, 4)}.`;
}
