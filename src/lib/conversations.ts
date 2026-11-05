import { fmtDateLong } from "./display";
import { addDays } from "./format";
import type { EmailListItem, ShipmentMode } from "./types";

/** The e-mails of one enquiry in a result set: one row of the Follow-up e-mails "By enquiry" view. */
export interface Conversation {
  enquiryId: string;
  reference: string;
  /** Newest first. */
  emails: EmailListItem[];
  latest: EmailListItem;
  /** Distinct sender names, newest first. */
  people: string[];
  attachments: number;
}

export function senderName(e: Pick<EmailListItem, "from_name" | "from_email">): string {
  return (e.from_name || e.from_email || "Unknown sender").trim();
}

/** Groups e-mails (any order) by the enquiry they are filed to, the most recently active enquiry first. */
export function groupByEnquiry(emails: EmailListItem[]): Conversation[] {
  const byId = new Map<string, EmailListItem[]>();
  for (const e of emails) {
    if (!e.enquiry) continue;
    const list = byId.get(e.enquiry.id);
    if (list) list.push(e);
    else byId.set(e.enquiry.id, [e]);
  }
  const out: Conversation[] = [];
  for (const [enquiryId, list] of byId) {
    list.sort((a, b) => b.received_at.localeCompare(a.received_at));
    out.push({
      enquiryId,
      reference: list[0]!.enquiry!.reference,
      emails: list,
      latest: list[0]!,
      people: [...new Set(list.map(senderName))],
      attachments: list.reduce((n, e) => n + e.attachments.length, 0),
    });
  }
  return out.sort((a, b) => b.latest.received_at.localeCompare(a.latest.received_at));
}

export type ModeFilter = "FCL" | "LCL" | "AIR" | "OTHER";

/** Which quick mode filter an enquiry falls under. */
export function modeGroup(mode: ShipmentMode | null | undefined): ModeFilter {
  return mode === "FCL" || mode === "LCL" || mode === "AIR" ? mode : "OTHER";
}

/**
 * The seven days the week strip shows for a selected day: the last week up to today while the
 * selection is within it, otherwise the selected day's week (Saturday to Friday, the Omani week), never past today.
 */
export function weekDays(selected: string, today: string): string[] {
  let end: string;
  if (selected > addDays(today, -7)) end = today;
  else {
    const weekday = new Date(`${selected}T00:00:00Z`).getUTCDay(); // 0 = Sunday … 6 = Saturday
    end = addDays(selected, (5 - weekday + 7) % 7); // the Friday that ends its week
    if (end > today) end = today;
  }
  return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
}

// --- Row display helpers (Oman time, UTC+4) -------------------------------------


/** Oman wall-clock time (UTC+4) of a timestamp, as HH:MM. */
export function muscatTime(ts: string): string {
  return new Date(new Date(ts).getTime() + 4 * 3600_000).toISOString().slice(11, 16);
}

export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const weekday = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${fmtDateLong(day)}`;
}

/** Gmail snippets arrive HTML-escaped ("&amp;", "&#39;"). */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}

/** The subject for a one-line row: reply/forward prefixes and the reference (shown in its own column) removed. */
export function rowSubject(subject: string | null, reference?: string | null): string {
  let s = (subject ?? "").replace(/^\s*((re|fw|fwd|aw|r|tr|sv|回复|答复|转发)\s*[:：]\s*)+/i, "");
  if (reference) s = s.replace(new RegExp(`^\\s*${reference}\\s*(//|[-:|])?\\s*`, "i"), "");
  return s.trim() || (subject ?? "").trim();
}
