import { useState } from "react";
import { Icon } from "../../components/icons";
import { Menu } from "../../components/Menu";
import { Button, Card } from "../../components/ui";
import { attachmentUrl } from "../../lib/api";
import { daysBetween, displayName } from "../../lib/display";
import { muscatDate } from "../../lib/emailDrafts";
import type { DocGroup, DocKind, DocSubKind } from "../../lib/enquiryBrief";
import { dayWithWeekday, muscatTime } from "../../lib/enquiryDetails";
import { errorMessage, todayIso } from "../../lib/format";
import type { PageActions } from "./shared";

// The files that came with the enquiry's e-mails, one row per document: what it is, its version when it was sent
// again in another size, who sent the latest one and when. A click opens the stored file; a file that was not
// stored opens the e-mail it came with.

/** Rows shown before "Show n more documents". */
const DOCS_SHOWN = 8;

/** The order the kinds are listed in, and the word for a kind when the brief gives a document no label. */
const KINDS: Record<DocKind, { order: number; label: string }> = {
  booking_so: { order: 0, label: "Booking / SO" },
  bl_awb: { order: 1, label: "BL / AWB" },
  pre_alert_can: { order: 2, label: "Pre-alert / CAN" },
  customs_do: { order: 3, label: "Customs / DO" },
  invoice_payment: { order: 4, label: "Invoice" },
  packing: { order: 5, label: "Packing list" },
  quote: { order: 6, label: "Quote" },
  photo: { order: 7, label: "Photo" },
  other: { order: 8, label: "Other" },
};

/** Within a kind: the draft, then the final, the telex or seaway release, the originals. */
const SUB_KINDS: DocSubKind[] = ["draft", "final", "telex_seaway", "original"];

const kindOf = (group: DocGroup) => KINDS[group.kind] ?? KINDS.other;

const subOrder = (group: DocGroup) => {
  const at = SUB_KINDS.indexOf(group.subKind);
  return at < 0 ? SUB_KINDS.length : at;
};

/**
 * The documents in the order the card lists them: by kind (booking and SO, BL and AWB, pre-alert and CAN, customs,
 * invoices, packing lists, quotes, photos, the rest), the newest first within a kind, and those from e-mails that
 * look like another enquiry's after all the others.
 */
export function orderedGroups(groups: DocGroup[]): DocGroup[] {
  return [...groups].sort(
    (a, b) =>
      Number(a.latest.crossFiled) - Number(b.latest.crossFiled) ||
      kindOf(a).order - kindOf(b).order ||
      subOrder(a) - subOrder(b) ||
      (a.latest.at < b.latest.at ? 1 : a.latest.at > b.latest.at ? -1 : 0),
  );
}

/** "Mon 11:18" within six days of today, "Mon 02 Nov, 11:18" before that, in Oman time; words stay as written. */
function shortWhen(at: string, today: string): string {
  if (Number.isNaN(Date.parse(at))) return at.trim();
  const day = muscatDate(at);
  const full = dayWithWeekday(day, today);
  return Math.abs(daysBetween(day, today)) <= 6 ? `${full.slice(0, 3)} ${muscatTime(at)}` : `${full}, ${muscatTime(at)}`;
}

function fmtSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/**
 * One document: its kind and version, when the latest came and from whom, the file's name and how often it was
 * sent. The whole of it is the button that opens the file; the ⋯ menu opens the e-mail it came with.
 */
function DocRow({ group, today, looksLike, actions }: { group: DocGroup; today: string; looksLike: string | null; actions: PageActions }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = group.latest;
  const path = file.storagePath;
  const elsewhere = file.crossFiled;
  const label = group.label.trim() || kindOf(group).label;
  const source = [shortWhen(file.at, today), displayName(file.from)].filter(Boolean).join(" · ");

  async function open() {
    if (!path) {
      actions.onOpenMail(file.emailId);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await attachmentUrl(path, file.filename));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const nameLook = busy || elsewhere ? "text-ink-muted" : path ? "text-primary group-hover:text-primary-hover" : "text-ink-heading";
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={open}
          disabled={busy}
          aria-busy={busy || undefined}
          title={file.size > 0 ? `${file.filename} (${fmtSize(file.size)})` : file.filename}
          className="group min-w-0 flex-1 rounded-control text-left disabled:cursor-wait"
        >
          <span className="sr-only">{path ? "Open the file: " : "Open the e-mail with the file: "}</span>
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className={`text-body font-medium ${elsewhere ? "text-ink-muted" : "text-ink"}`}>{label}</span>
            {group.version > 1 && <span className="rounded bg-table-head px-1 text-meta font-medium tabular-nums text-ink-heading">v{group.version}</span>}
            {source && <span className="text-meta tabular-nums text-ink-muted">· {source}</span>}
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5 text-meta">
            <span className={`min-w-0 truncate group-hover:underline ${nameLook}`}>{file.filename}</span>
            {group.sentTimes > 1 && <span className="shrink-0 tabular-nums text-ink-muted">· sent {group.sentTimes}×</span>}
            {busy && <span className="shrink-0 text-ink-muted">· opening…</span>}
          </span>
        </button>
        <Menu
          label={`More about ${label}: ${file.filename}`}
          trigger={<Icon name="more" />}
          triggerClassName="-my-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-heading transition-colors duration-150 hover:bg-row-hover hover:text-ink"
          items={[{ label: "Open the e-mail", icon: "message", onSelect: () => actions.onOpenMail(file.emailId) }]}
        />
      </div>
      {elsewhere && (
        <p className="mt-0.5 flex items-start gap-1 text-meta text-ink-muted">
          <Icon name="alert" className="mt-0.5 size-3.5" />
          <span className="min-w-0 break-words">from an e-mail that looks like {looksLike?.trim() || "another enquiry's"}</span>
        </p>
      )}
      {!path && <p className="mt-0.5 text-meta text-ink-muted">Not stored here: it opens the e-mail it came with.</p>}
      {error && (
        <p role="alert" className="mt-0.5 break-words text-meta text-lost">
          The file could not be opened. {error}
        </p>
      )}
    </li>
  );
}

export interface DocumentsCardProps {
  /** The enquiry's documents, one group per file name with its versions. */
  groups: DocGroup[];
  /** The watched mailbox's address. */
  mailbox?: string | null;
  actions: PageActions;
  /** The e-mails that look like another enquiry's (the brief's crossFiled), to name that enquiry on their files. */
  crossFiled?: { looksLike: string | null; mails: { id: string }[] }[];
  /** Oman's date, to say "Mon 11:18" for this week's files. */
  today?: string;
}

/**
 * Documents: the files on the enquiry's e-mails by kind and version, signature logos left out. Files from e-mails
 * that look like another enquiry's come last, greyed, and say so.
 */
export function DocumentsCard({ groups, actions, crossFiled, today = todayIso() }: DocumentsCardProps) {
  const [all, setAll] = useState(false);
  if (!groups.length) {
    return (
      <Card title="Documents">
        <p className="text-body text-ink-muted">No documents yet. Files on the e-mails appear here; signature logos are left out.</p>
      </Card>
    );
  }
  const other = new Map<string, string | null>();
  for (const found of crossFiled ?? []) for (const mail of found.mails) other.set(mail.id, found.looksLike);
  const ordered = orderedGroups(groups);
  const more = ordered.length - DOCS_SHOWN;
  return (
    <Card title={`Documents (${groups.length})`}>
      <ul role="list" className="divide-y divide-line">
        {(all ? ordered : ordered.slice(0, DOCS_SHOWN)).map((group, i) => (
          <DocRow key={`${group.latest.emailId}-${group.latest.filename}-${i}`} group={group} today={today} looksLike={other.get(group.latest.emailId) ?? null} actions={actions} />
        ))}
      </ul>
      {more > 0 && (
        <Button variant="ghost" size="sm" className="-ml-2.5 mt-2" aria-expanded={all} onClick={() => setAll(!all)}>
          <Icon name={all ? "chevronUp" : "chevronDown"} className="size-3.5" />
          {all ? "Show fewer documents" : `Show ${more} more document${more === 1 ? "" : "s"}`}
        </Button>
      )}
    </Card>
  );
}
