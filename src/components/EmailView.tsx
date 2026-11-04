import { useState, type ReactNode } from "react";
import { attachmentUrl } from "../lib/api";
import { confidenceLevel, gmailThreadUrl, splitBody } from "../lib/emailDrafts";
import { errorMessage, fmtDateTime } from "../lib/format";
import type { EmailAttachment, EmailMessage } from "../lib/types";

const SENDER_STYLES = {
  external: "bg-sky-50 text-sky-700 ring-sky-200",
  staff: "bg-violet-50 text-violet-700 ring-violet-200",
  self: "bg-slate-100 text-slate-600 ring-slate-200",
};
const SENDER_LABELS = { external: "external", staff: "colleague", self: "pricing" };

export function Pill({ className, children, title }: { className: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
      {children}
    </span>
  );
}

export function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  const level = confidenceLevel(value);
  if (!level || value == null) return null;
  const style = {
    high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    medium: "bg-amber-50 text-amber-800 ring-amber-200",
    low: "bg-rose-50 text-rose-700 ring-rose-200",
  }[level];
  return (
    <Pill className={style} title="How sure the automatic reading is">
      {Math.round(value * 100)}% sure
    </Pill>
  );
}

function fmtSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function AttachmentLink({ file }: { file: EmailAttachment }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!file.storage_path) {
    return (
      <span className="text-xs text-slate-400" title={file.skipped ?? undefined}>
        📎 {file.filename} ({fmtSize(file.size)}{file.skipped ? `, ${file.skipped}` : ""})
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
    <span className="text-xs">
      <button type="button" onClick={open} disabled={busy} className="text-indigo-600 hover:underline disabled:text-slate-400">
        📎 {file.filename}
      </button>{" "}
      <span className="text-slate-400">({fmtSize(file.size)})</span>
      {error && <span className="ml-1 text-rose-600">{error}</span>}
    </span>
  );
}

/** One e-mail: sender, date, what they wrote (history folded away), attachments, link to Gmail. */
export function EmailView({ email, mailbox, showSummary = true }: { email: EmailMessage; mailbox?: string | null; showSummary?: boolean }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { text, earlier } = splitBody(email.body_text);
  const long = text.length > 900;

  return (
    <article className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-slate-900">{email.from_name ?? email.from_email}</span>
        {email.from_name && <span className="text-xs text-slate-500">{email.from_email}</span>}
        <Pill className={SENDER_STYLES[email.sender_type]}>{SENDER_LABELS[email.sender_type]}</Pill>
        <span className="ml-auto text-xs tabular-nums text-slate-500">{fmtDateTime(email.received_at)}</span>
      </header>
      <div className="text-sm font-medium text-slate-800">{email.subject || "(no subject)"}</div>
      <div className="text-xs text-slate-500">
        To {email.to_emails.join(", ") || "—"}
        {email.cc_emails.length > 0 && <> · Cc {email.cc_emails.join(", ")}</>}
      </div>
      {showSummary && email.summary && <p className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-900">{email.summary}</p>}
      {text ? (
        <div className="whitespace-pre-wrap break-words text-sm text-slate-800">
          {long && !expanded ? `${text.slice(0, 900)}…` : text}
          {long && (
            <button type="button" className="ml-1 text-xs text-indigo-600 hover:underline" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      ) : (
        <div className="text-sm italic text-slate-400">No new text (forward or reply only).</div>
      )}
      {earlier && (
        <div>
          <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => setShowEarlier(!showEarlier)}>
            {showEarlier ? "Hide earlier messages" : "Show earlier messages"}
          </button>
          {showEarlier && (
            <div className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words border-l-2 border-slate-200 pl-3 text-xs text-slate-600">
              {earlier}
            </div>
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
          className="ml-auto text-xs text-slate-500 hover:text-indigo-600 hover:underline"
        >
          Open in Gmail ↗
        </a>
      </footer>
    </article>
  );
}
