import { nameKey } from "./normalize";
import type { Status } from "./types";

// What the master lists show beyond the summary views' counts: a 12-month trend, who handles a customer or agent,
// its lanes and recent enquiries. All of it comes from one light fetch of every enquiry (a few thousand rows),
// grouped here in the browser, so no extra database views are needed.

/** One enquiry, reduced to what the master lists use. */
export interface ActivityRow {
  id: string;
  reference: string;
  enquiry_date: string;
  status: Status;
  customer_id: string;
  agent_id: string | null;
  pol: string | null;
  pod: string | null;
  sales_person: string | null;
}

export type ActivityKind = "customers" | "agents" | "ports";

/** The master rows (ids) an enquiry counts for. A port counts once per enquiry even when it is both POL and POD. */
export function activityKeys(kind: ActivityKind, r: ActivityRow): string[] {
  if (kind === "customers") return [r.customer_id];
  if (kind === "agents") return r.agent_id ? [r.agent_id] : [];
  const keys = [nameKey(r.pol), nameKey(r.pod)].filter((k): k is string => !!k);
  return [...new Set(keys)];
}

/** Enquiries per master id, newest first. */
export function groupActivity(kind: ActivityKind, rows: readonly ActivityRow[]): Map<string, ActivityRow[]> {
  const out = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    for (const k of activityKeys(kind, r)) {
      const list = out.get(k);
      if (list) list.push(r);
      else out.set(k, [r]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => b.enquiry_date.localeCompare(a.enquiry_date) || b.reference.localeCompare(a.reference));
  return out;
}

/** The first day of the 12 months ending with today's month, oldest first: ["2025-12-01", …, "2026-11-01"]. */
export function last12Months(today: string): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 11 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
}

/** Enquiries in each of the last 12 months (oldest first), and how many of them were confirmed. */
export function monthlyCounts(rows: readonly Pick<ActivityRow, "enquiry_date" | "status">[], today: string): { month: string; enquiries: number; confirmed: number }[] {
  const months = last12Months(today);
  const index = new Map(months.map((m, i) => [m.slice(0, 7), i]));
  const out = months.map((month) => ({ month, enquiries: 0, confirmed: 0 }));
  for (const r of rows) {
    const i = index.get(r.enquiry_date.slice(0, 7));
    if (i === undefined) continue;
    out[i].enquiries++;
    if (r.status === "confirmed") out[i].confirmed++;
  }
  return out;
}

/** Values by how often they occur, most first (ties alphabetical), with their share of the non-empty values. */
export function ranked(values: readonly (string | null)[]): { value: string; count: number; share: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = [...counts.values()].reduce((n, c) => n + c, 0);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Days from `from` to `to` (both YYYY-MM-DD). */
export function daysSince(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** No enquiry for this many days counts as dormant; within ACTIVE_DAYS counts as active. */
export const ACTIVE_DAYS = 90;
export const DORMANT_DAYS = 180;

export type Lifecycle = "new" | "active" | "quiet" | "dormant" | "none";

/**
 * Where a customer, agent or port stands: "new" when its first enquiry is in today's month, "active" with an enquiry
 * in the last 90 days, "dormant" with none for 180 days, "quiet" in between, "none" without enquiries.
 */
export function lifecycle(first: string | null, last: string | null, today: string): Lifecycle {
  if (!last) return "none";
  if (first && first.slice(0, 7) === today.slice(0, 7)) return "new";
  const days = daysSince(last, today);
  if (days <= ACTIVE_DAYS) return "active";
  if (days > DORMANT_DAYS) return "dormant";
  return "quiet";
}

/** "Today", "Yesterday", "5 days ago", "3 months ago", "Over a year ago". */
export function agoLabel(day: string, today: string): string {
  const d = daysSince(day, today);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d} days ago`;
  if (d < 365) {
    const m = Math.max(1, Math.round(d / 30.4));
    return m === 1 ? "A month ago" : `${m} months ago`;
  }
  return "Over a year ago";
}

/** Confirmed share of enquiries, 0–1, or null without enquiries. */
export const winRate = (r: { enquiries: number; confirmed: number }) => (r.enquiries ? r.confirmed / r.enquiries : null);

/** "SOHAR → JEBEL ALI" lane label from an enquiry, or null when either end is missing. */
export function laneOf(r: Pick<ActivityRow, "pol" | "pod">): string | null {
  return r.pol && r.pod ? `${r.pol} → ${r.pod}` : null;
}
