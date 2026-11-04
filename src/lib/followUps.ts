import type { RegisterFilters } from "./api";
import { daysBetween } from "./display";
import { addDays } from "./format";
import type { EnquiryRow } from "./types";

// Follow-ups: open enquiries that have waited too long, in age bands, so they can be chased or closed as lost.

/** An open quote (or an enquiry still without one) is stale after this many days. */
export const STALE_DAYS = 14;

export type FollowUpBand = "14-30" | "31-90" | "90+" | "unquoted";

export const FOLLOW_UP_BANDS: { key: FollowUpBand; label: string; description: string }[] = [
  { key: "14-30", label: "Quoted 14–30 days ago", description: "Quotes still worth chasing" },
  { key: "31-90", label: "31–90 days", description: "Quoted one to three months ago" },
  { key: "90+", label: "Over 90 days", description: "Quoted more than three months ago" },
  { key: "unquoted", label: "Not quoted", description: `Received ${STALE_DAYS} or more days ago and never quoted` },
];

export const isFollowUpBand = (v: string | null): v is FollowUpBand => FOLLOW_UP_BANDS.some((b) => b.key === v);

/**
 * Register filters for one band. Days are counted to today, so a quote sent on 21 Oct is 14 days old on 4 Nov.
 * The quoted bands are contiguous and do not overlap: 14–30, 31–90, then 91 and more.
 */
export function bandFilters(band: FollowUpBand, today: string, other: { salesPersonId: string; q: string }): RegisterFilters {
  const daysAgo = (n: number) => addDays(today, -n);
  const base = { mode: "" as const, salesPersonId: other.salesPersonId, q: other.q };
  switch (band) {
    case "14-30":
      return { ...base, basis: "quoted_date", status: "quoted", from: daysAgo(30), to: daysAgo(STALE_DAYS) };
    case "31-90":
      return { ...base, basis: "quoted_date", status: "quoted", from: daysAgo(90), to: daysAgo(31) };
    case "90+":
      return { ...base, basis: "quoted_date", status: "quoted", from: "", to: daysAgo(91) };
    case "unquoted":
      return { ...base, basis: "enquiry_date", status: "new", from: "", to: daysAgo(STALE_DAYS) };
  }
}

/** All quotes that have waited STALE_DAYS or more (the three quoted bands together). */
export function staleQuoteFilters(today: string): RegisterFilters {
  return { basis: "quoted_date", status: "quoted", from: "", to: addDays(today, -STALE_DAYS), mode: "", salesPersonId: "", q: "" };
}

/** Days since the quote, or since the enquiry when it was never quoted. */
export function waitingDays(row: Pick<EnquiryRow, "quoted_date" | "enquiry_date">, today: string): number {
  return daysBetween(row.quoted_date ?? row.enquiry_date, today);
}

/** Suggestions for the lost reason; any text is accepted. */
export const LOST_REASONS = [
  "No reply from customer",
  "Rate not competitive",
  "Booked with another forwarder",
  "Shipment postponed by customer",
  "Enquiry withdrawn by customer",
];
