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
 * The cells of a month calendar for "YYYY-MM", weeks starting on Saturday (the Omani week):
 * null for the blanks before the 1st, then each day as YYYY-MM-DD.
 */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const blanks = (first.getUTCDay() + 1) % 7; // Saturday 0, Sunday 1 … Friday 6
  const length = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return [...Array<null>(blanks).fill(null), ...Array.from({ length }, (_, i) => addDays(`${month}-01`, i))];
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

// --- Waiting for reference --------------------------------------------------------

/** The e-mails citing one SL reference that is not in the register yet: one row of "Waiting for reference". */
export interface ReferenceGroup {
  reference: string;
  /** Newest first. */
  emails: EmailListItem[];
  latest: EmailListItem;
  /** When the first of them arrived. */
  since: string;
  attachments: number;
}

/** Groups e-mails by the first SL reference they cite, the most recently active reference first. */
export function groupByReference(emails: EmailListItem[]): ReferenceGroup[] {
  const byRef = new Map<string, EmailListItem[]>();
  for (const e of emails) {
    const ref = (e.sl_refs[0] ?? "").toUpperCase() || "No reference";
    const list = byRef.get(ref);
    if (list) list.push(e);
    else byRef.set(ref, [e]);
  }
  const out: ReferenceGroup[] = [];
  for (const [reference, list] of byRef) {
    list.sort((a, b) => b.received_at.localeCompare(a.received_at));
    out.push({
      reference,
      emails: list,
      latest: list[0]!,
      since: list.at(-1)!.received_at,
      attachments: list.reduce((n, e) => n + e.attachments.length, 0),
    });
  }
  return out.sort((a, b) => b.latest.received_at.localeCompare(a.latest.received_at));
}

/** Register references are SL and six digits. */
const REFERENCE_DIGITS = 6;

/**
 * References one slip away from `ref`: one digit changed, two neighbours swapped, and a digit missing or
 * one too many when the length is off. Used to guess what a customer meant by a reference we do not have.
 */
export function referenceVariants(ref: string): string[] {
  const m = /^SL\s*(\d{4,8})$/i.exec(ref.trim());
  if (!m) return [];
  const d = m[1]!;
  const out = new Set<string>();
  const add = (digits: string) => {
    if (digits.length === REFERENCE_DIGITS && digits !== d) out.add(`SL${digits}`);
  };
  for (let i = 0; i < d.length; i++) {
    for (let x = 0; x <= 9; x++) add(d.slice(0, i) + x + d.slice(i + 1));
    if (i < d.length - 1) add(d.slice(0, i) + d[i + 1] + d[i] + d.slice(i + 2));
    if (d.length > REFERENCE_DIGITS) add(d.slice(0, i) + d.slice(i + 1));
  }
  if (d.length < REFERENCE_DIGITS) {
    for (let i = 0; i <= d.length; i++) for (let x = 0; x <= 9; x++) add(d.slice(0, i) + x + d.slice(i));
  }
  return [...out];
}

/** How `actual` differs from the reference written in an e-mail, in words. */
export function referenceSlip(written: string, actual: string): string {
  const a = written.replace(/\D/g, "");
  const b = actual.replace(/\D/g, "");
  if (a.length < b.length) return "one digit missing";
  if (a.length > b.length) return "one digit too many";
  const diff = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
  if (diff.length === 2 && diff[1] === diff[0]! + 1 && a[diff[0]!] === b[diff[1]!]) return "two digits swapped";
  return "one digit different";
}

// --- Ignored --------------------------------------------------------------------

export type IgnoreKind = "bulk" | "ops" | "self" | "hand" | "other";

export const IGNORE_KINDS: { key: IgnoreKind; label: string }[] = [
  { key: "bulk", label: "Newsletters & auto-replies" },
  { key: "ops", label: "Operations" },
  { key: "other", label: "Not an enquiry" },
  { key: "self", label: "Sent by us" },
  { key: "hand", label: "Ignored by hand" },
];

/** Why an ignored e-mail was set aside, from how it was filed (see gmail-sync's decide.ts). */
export function ignoreKind(e: Pick<EmailListItem, "match_method" | "note">): IgnoreKind {
  if (e.match_method === "manual") return "hand";
  const note = e.note ?? "";
  if (note.startsWith("Newsletter")) return "bulk";
  if (note.startsWith("Sent from the mailbox")) return "self";
  if (note.startsWith("Operations")) return "ops";
  return "other";
}
