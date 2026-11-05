import { useState } from "react";
import { EmailView, Pill, shownName } from "../../components/EmailView";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, Spinner } from "../../components/ui";
import { initials } from "../../lib/display";
import { CUE_LABELS, dayWithWeekday, emailDomain, muscatTime, type EmailCue, type EmailParty, type ThreadItem } from "../../lib/enquiryDetails";
import { errorMessage } from "../../lib/format";
import type { EmailMessage } from "../../lib/types";

/** Rows shown before "Show older". */
const SHOWN = 8;

type Filter = "all" | EmailParty;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "customer", label: "Customer" },
  { key: "other", label: "Agents and others" },
  { key: "us", label: "Ours" },
];

const PARTY: Record<EmailParty, { label: string; className: string }> = {
  customer: { label: "Customer", className: "bg-selected text-primary-hover" },
  other: { label: "External", className: "bg-table-head text-ink-heading" },
  us: { label: "Ours", className: "bg-surface text-ink-muted ring-1 ring-inset ring-line" },
};

const CUE_STYLE: Record<EmailCue, string> = {
  quote: "bg-quoted-bg text-quoted",
  yes: "bg-confirmed-bg text-confirmed",
  rate: "bg-surface text-ink ring-1 ring-inset ring-control",
  rate_request: "bg-surface text-ink-muted ring-1 ring-inset ring-line",
};

/** Attachments other than the logos and icons of e-mail signatures (image001.png…). */
function fileCount(email: EmailMessage): number {
  return email.attachments.filter((a) => !((a.mime_type ?? "").startsWith("image/") && /^image\d+\.\w+$/i.test(a.filename ?? ""))).length;
}

function senderName(email: EmailMessage): string {
  return shownName(email.from_name) || email.from_email || "Unknown sender";
}

function recipients(email: EmailMessage): string {
  const [first, ...rest] = email.to_emails;
  if (!first) return "";
  return rest.length ? `${first} +${rest.length}` : first;
}

/** The enquiry's e-mails, newest first: who wrote, what it looks like, and the whole message on a click. */
export function EmailThread({
  items,
  loading,
  error,
  reference,
  today,
  mailbox,
}: {
  items: ThreadItem[];
  loading: boolean;
  error: unknown;
  reference: string;
  today: string;
  mailbox?: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const count = (f: Filter) => (f === "all" ? items.length : items.filter((i) => i.party === f).length);
  const list = filter === "all" ? items : items.filter((i) => i.party === filter);
  const shown = all ? list : list.slice(0, SHOWN);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filters = items.length > 0 && (
    <div role="group" aria-label="Show e-mails from" className="flex flex-wrap gap-1 rounded-control border border-line p-0.5">
      {FILTERS.filter((f) => f.key === "all" || count(f.key) > 0).map((f) => (
        <button
          key={f.key}
          type="button"
          aria-pressed={filter === f.key}
          onClick={() => {
            setFilter(f.key);
            setAll(false);
          }}
          className={`rounded-[5px] px-2 py-1 text-meta font-medium ${filter === f.key ? "bg-selected text-primary-hover" : "text-ink-muted hover:text-ink"}`}
        >
          {f.label} · {count(f.key)}
        </button>
      ))}
    </div>
  );

  return (
    <Card title={items.length ? `E-mails (${items.length})` : "E-mails"} actions={filters}>
      {loading ? (
        <Spinner label="Loading e-mails…" />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !items.length ? (
        <p className="text-body text-ink-muted">No e-mails are filed here yet. Mail whose subject carries {reference} is added automatically.</p>
      ) : (
        <>
          <ol className="-mx-4 -mt-2">
            {shown.map((t, i) => {
              const isOpen = open.has(t.email.id);
              const files = fileCount(t.email);
              return (
                <li key={t.email.id}>
                  {(i === 0 || shown[i - 1].day !== t.day) && (
                    <h3 className="px-4 pb-1 pt-3 text-meta font-semibold uppercase tracking-wide text-ink-muted">{dayWithWeekday(t.day, today)}</h3>
                  )}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(t.email.id)}
                    className={`grid w-full grid-cols-[2.75rem_2rem_minmax(0,1fr)] items-start gap-x-3 px-4 py-2 text-left hover:bg-row-hover ${isOpen ? "bg-row-hover" : ""}`}
                  >
                    <span className="pt-1.5 text-meta tabular-nums text-ink-muted">{muscatTime(t.email.received_at)}</span>
                    <span aria-hidden="true" className={`flex size-8 items-center justify-center rounded-full text-meta font-semibold ${PARTY[t.party].className}`}>
                      {initials(senderName(t.email))}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-ink">{senderName(t.email)}</span>
                        {t.party === "us" ? (
                          recipients(t.email) && <span className="text-meta text-ink-muted">to {recipients(t.email)}</span>
                        ) : (
                          <span className="text-meta text-ink-muted">{emailDomain(t.email.from_email)}</span>
                        )}
                        <Pill className={PARTY[t.party].className}>{PARTY[t.party].label}</Pill>
                        {t.cue && (
                          <Pill className={CUE_STYLE[t.cue]} title="Read from the e-mail's text, so it can be wrong">
                            {CUE_LABELS[t.cue]}
                          </Pill>
                        )}
                        {files > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-meta text-ink-muted" title={`${files} attachment${files === 1 ? "" : "s"}`}>
                            <Icon name="paperclip" className="size-3.5" />
                            {files}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-body text-ink-heading">{t.excerpt || t.email.subject || "(no text)"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 pt-1">
                      <EmailView email={t.email} mailbox={mailbox} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {list.length > SHOWN && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={() => setAll(!all)}>
                {all ? `Show the latest ${SHOWN}` : `Show ${list.length - SHOWN} older`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
