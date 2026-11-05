import { useState, type ReactNode } from "react";
import { attachmentUrl } from "../lib/api";
import { displayName } from "../lib/display";
import { confidenceLevel, gmailThreadUrl, splitBody } from "../lib/emailDrafts";
import { errorMessage, fmtDateTime } from "../lib/format";
import type { EmailAttachment, EmailMessage } from "../lib/types";
import { Icon } from "./icons";

const SENDER = {
  external: { label: "External", className: "bg-table-head text-ink-heading" },
  staff: { label: "Colleague", className: "bg-selected text-primary" },
  self: { label: "Pricing mailbox", className: "bg-table-head text-ink-muted" },
};

export function Pill({ className, children, title }: { className: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-meta font-medium ${className}`}>
      {children}
    </span>
  );
}

/** How sure the automatic reading is, as text and colour (never colour alone). */
export function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  const level = confidenceLevel(value);
  if (!level || value == null) return null;
  const style = { high: "bg-confirmed-bg text-confirmed", medium: "bg-await-bg text-await", low: "bg-lost-bg text-lost" }[level];
  return (
    <Pill className={style} title="How sure the automatic reading is">
      {Math.round(value * 100)}% sure
    </Pill>
  );
}

function fmtSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function AttachmentLink({ file }: { file: EmailAttachment }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!file.storage_path) {
    return (
      <span className="inline-flex max-w-full items-start gap-1 text-meta break-all text-ink-muted" title={file.skipped ?? undefined}>
        <Icon name="paperclip" className="mt-0.5 size-3.5 shrink-0" />
        {file.filename} ({fmtSize(file.size)}
        {file.skipped ? `, ${file.skipped}` : ""})
      </span>
    );
  }
  async function open() {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await attachmentUrl(file.storage_path!, file.filename));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="max-w-full text-meta break-all">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="inline-flex max-w-full items-start gap-1 rounded-control text-left text-primary hover:text-primary-hover hover:underline disabled:text-ink-muted"
      >
        <Icon name="paperclip" className="mt-0.5 size-3.5 shrink-0" />
        {file.filename}
      </button>{" "}
      <span className="text-ink-muted">({fmtSize(file.size)})</span>
      {error && <span className="ml-1 text-lost">{error}</span>}
    </span>
  );
}

/** One e-mail: sender, date, what they wrote (history folded away), attachments, link to Gmail. */
export function EmailView({ email, mailbox, showSummary = true }: { email: EmailMessage; mailbox?: string | null; showSummary?: boolean }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { text, earlier } = splitBody(email.body_text);
  const long = text.length > 900;
  const sender = SENDER[email.sender_type];

  return (
    <article className="space-y-2 rounded-panel border border-line bg-surface p-3">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-body font-semibold text-ink">{email.from_name ?? email.from_email}</span>
        {email.from_name && <span className="text-meta text-ink-muted">{email.from_email}</span>}
        <Pill className={sender.className}>{sender.label}</Pill>
        <span className="ml-auto text-meta tabular-nums text-ink-muted">{fmtDateTime(email.received_at)}</span>
      </header>
      <div className="text-body font-medium text-ink">{email.subject || "(no subject)"}</div>
      <div className="text-meta text-ink-muted">
        To {email.to_emails.join(", ") || "—"}
        {email.cc_emails.length > 0 && <> · Cc {email.cc_emails.join(", ")}</>}
      </div>
      {showSummary && email.summary && <p className="rounded-control bg-selected px-2 py-1 text-meta text-ink">{email.summary}</p>}
      {text ? (
        <div className="whitespace-pre-wrap break-words text-body text-ink">
          {long && !expanded ? `${text.slice(0, 900)}…` : text}
          {long && (
            <button type="button" className="ml-1 text-meta text-primary hover:underline" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      ) : (
        <div className="text-body italic text-ink-muted">No new text (forward or reply only).</div>
      )}
      {earlier && (
        <div>
          <button type="button" className="text-meta text-primary hover:underline" aria-expanded={showEarlier} onClick={() => setShowEarlier(!showEarlier)}>
            {showEarlier ? "Hide earlier messages" : "Show earlier messages"}
          </button>
          {showEarlier && (
            <div className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-meta text-ink-muted">{earlier}</div>
          )}
        </div>
      )}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {email.attachments.map((a, i) => (
          <AttachmentLink key={`${a.filename}-${i}`} file={a} />
        ))}
        <a
          href={gmailThreadUrl(email.gmail_thread_id, mailbox)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-meta text-ink-muted hover:text-primary hover:underline"
        >
          Open in Gmail
          <Icon name="external" className="size-3.5" />
        </a>
      </footer>
    </article>
  );
}

/** "EXAMPLE TRADING LLC" → "Example Trading LLC" for display; empty stays empty. */
export function shownName(raw: string | null | undefined): string {
  return raw ? displayName(raw) : "";
}
