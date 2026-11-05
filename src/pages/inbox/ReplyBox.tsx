import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Button, inputClass } from "../../components/ui";
import { sendReply } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import { composeReply, looksLikeEmail, parseAddresses, quoteEmail, replyRecipients, replySubject } from "../../lib/replies";
import type { EmailMessage } from "../../lib/types";

/** Seconds between "Send now" and the e-mail leaving, during which Undo stops it. */
const UNDO_SECONDS = 5;
/** Gmail's limit is 25 MB once encoded, which leaves about 18 MB of files. */
const MAX_FILES_BYTES = 18 * 1024 * 1024;
const SIGNATURE_KEY = "reply-signature";

interface Draft {
  targetId: string;
  all: boolean;
  to: string;
  cc: string;
  subject: string;
  message: string;
  quote: boolean;
}

// Drafts and the signature live in this browser only: a convenience, so every access may fail (private windows).
function readStore<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not saved; the reply still works */
  }
}

function fmtSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Writing a reply to one e-mail of a conversation; it goes out through Gmail as the pricing mailbox. */
export function ReplyBox({
  enquiryId,
  reference,
  target,
  all,
  mailbox,
  onClose,
  onSent,
}: {
  enquiryId: string;
  reference: string;
  target: EmailMessage;
  all: boolean;
  mailbox?: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const draftKey = `reply-draft:${enquiryId}`;
  const initial = useMemo(() => {
    const saved = readStore<Draft>(draftKey);
    if (saved && saved.targetId === target.id && saved.all === all) return saved;
    const r = replyRecipients(target, mailbox ? [mailbox] : [], all);
    return { targetId: target.id, all, to: r.to.join(", "), cc: r.cc.join(", "), subject: replySubject(target.subject, reference), message: "", quote: true };
  }, [draftKey, target, all, mailbox, reference]);

  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [message, setMessage] = useState(initial.message);
  const [quote, setQuote] = useState(initial.quote);
  const [files, setFiles] = useState<File[]>([]);
  const [signature, setSignature] = useState(() => readStore<string>(SIGNATURE_KEY) ?? "");
  const [editSignature, setEditSignature] = useState(false);
  const [phase, setPhase] = useState<"edit" | "confirm" | "countdown" | "sending">("edit");
  const [left, setLeft] = useState(UNDO_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => textRef.current?.focus(), []);

  // Keep the draft while the person moves around.
  useEffect(() => {
    const t = setTimeout(() => writeStore(draftKey, { targetId: target.id, all, to, cc, subject, message, quote } satisfies Draft), 400);
    return () => clearTimeout(t);
  }, [draftKey, target.id, all, to, cc, subject, message, quote]);

  const toList = parseAddresses(to);
  const ccList = parseAddresses(cc).filter((a) => !toList.includes(a));
  const bad = [...toList, ...ccList].filter((a) => !looksLikeEmail(a));
  const filesBytes = files.reduce((n, f) => n + f.size, 0);
  const problem = !toList.length
    ? "Add at least one address under To."
    : bad.length
      ? `Not an e-mail address: ${bad.join(", ")}`
      : !message.trim()
        ? "Write a message."
        : !subject.trim()
          ? "The subject is empty."
          : filesBytes > MAX_FILES_BYTES
            ? "The attachments are too large for one e-mail (about 18 MB in all)."
            : null;

  async function send() {
    setPhase("sending");
    setError(null);
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, mimeType: f.type || "application/octet-stream", data: await fileToBase64(f) })));
      const body = composeReply(message, signature, quote ? quoteEmail(target) : null);
      const r = await sendReply({ replyToEmailId: target.id, to: toList, cc: ccList, subject: subject.trim(), body, attachments });
      writeStore(draftKey, null);
      onSent(r.message);
    } catch (e) {
      setError(errorMessage(e));
      setPhase("edit");
    }
  }

  // The undo window: count down, then send.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (left <= 0) {
      void send();
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, left]);

  function discard() {
    if ((message.trim() || files.length) && !window.confirm("Discard this reply?")) return;
    writeStore(draftKey, null);
    onClose();
  }

  const locked = phase !== "edit";
  const label = "w-12 shrink-0 text-meta font-medium text-ink-muted";
  const fieldClass = `${inputClass} h-8`;

  return (
    <section aria-label={all ? "Reply to all" : "Reply"} className="flex min-h-0 flex-col border-t-2 border-primary bg-surface">
      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
        <Icon name="send" className="size-4 text-primary" />
        <h3 className="text-body font-semibold text-ink">{all ? "Reply to all" : "Reply"}</h3>
        <span className="text-meta text-ink-muted">from {mailbox ?? "the pricing mailbox"} · appears in Gmail's Sent folder</span>
        <button type="button" aria-label="Close the reply (the draft is kept)" title="Close (the draft is kept)" className="ml-auto inline-flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-row-hover hover:text-ink" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="min-h-0 space-y-2 overflow-y-auto px-4 pb-3">
        <div className="flex items-center gap-2">
          <label htmlFor="reply-to" className={label}>
            To
          </label>
          <input id="reply-to" className={fieldClass} value={to} disabled={locked} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" autoComplete="off" />
          {!showCc && (
            <button type="button" className="shrink-0 text-meta font-medium text-primary hover:underline" onClick={() => setShowCc(true)}>
              Cc
            </button>
          )}
        </div>
        {showCc && (
          <div className="flex items-center gap-2">
            <label htmlFor="reply-cc" className={label}>
              Cc
            </label>
            <input id="reply-cc" className={fieldClass} value={cc} disabled={locked} onChange={(e) => setCc(e.target.value)} autoComplete="off" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="reply-subject" className={label}>
            Subject
          </label>
          <input id="reply-subject" className={fieldClass} value={subject} disabled={locked} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <textarea
          ref={textRef}
          aria-label="Message"
          className={`${inputClass} h-auto min-h-28 resize-y py-2 leading-relaxed`}
          rows={5}
          value={message}
          disabled={locked}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write your reply…"
        />

        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-table-head py-0.5 pr-0.5 pl-2 text-[12px] text-ink-heading">
                <Icon name="paperclip" className="size-3.5 shrink-0" />
                <span className="truncate">{f.name}</span>
                <span className="text-ink-muted">({fmtSize(f.size)})</span>
                <button type="button" disabled={locked} aria-label={`Remove ${f.name}`} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-black/10" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  <Icon name="close" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {editSignature && (
          <div className="space-y-1">
            <label htmlFor="reply-signature" className="text-meta font-medium text-ink-muted">
              Your signature (kept in this browser, added under every reply)
            </label>
            <textarea
              id="reply-signature"
              className={`${inputClass} h-auto py-2`}
              rows={3}
              value={signature}
              onChange={(e) => {
                setSignature(e.target.value);
                writeStore(SIGNATURE_KEY, e.target.value || null);
              }}
              placeholder={"Best regards,\nYour name\nSilver Lynx Co LLC"}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
          <label className="inline-flex items-center gap-1.5 text-ink-heading">
            <input type="checkbox" checked={quote} disabled={locked} onChange={(e) => setQuote(e.target.checked)} className="size-4 accent-primary" />
            Quote {target.from_name || target.from_email || "the e-mail"}'s message
          </label>
          <button type="button" disabled={locked} className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => fileRef.current?.click()}>
            <Icon name="paperclip" className="size-3.5" />
            Attach files
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              setFiles([...files, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button type="button" className="text-primary hover:underline" onClick={() => setEditSignature(!editSignature)}>
            {editSignature ? "Done with signature" : signature ? "Edit signature" : "Add a signature"}
          </button>
        </div>

        {error && <Alert>{error}</Alert>}

        {phase === "confirm" ? (
          <div className="space-y-2 rounded-panel bg-selected p-3 text-meta text-ink">
            <p className="font-semibold">Send this reply from {mailbox ?? "the pricing mailbox"}?</p>
            <p>
              <span className="text-ink-muted">To:</span> {toList.join(", ")}
              {ccList.length > 0 && (
                <>
                  <br />
                  <span className="text-ink-muted">Cc:</span> {ccList.join(", ")}
                </>
              )}
              {files.length > 0 && (
                <>
                  <br />
                  <span className="text-ink-muted">Attachments:</span> {files.length} ({fmtSize(filesBytes)})
                </>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setLeft(UNDO_SECONDS);
                  setPhase("countdown");
                }}
              >
                <Icon name="send" />
                Send now
              </Button>
              <Button variant="secondary" onClick={() => setPhase("edit")}>
                Back
              </Button>
            </div>
          </div>
        ) : phase === "countdown" ? (
          <div className="flex items-center gap-3 rounded-panel bg-await-bg p-3 text-meta text-await" role="status">
            <span className="font-semibold">Sending in {left}…</span>
            <Button variant="secondary" size="sm" onClick={() => setPhase("edit")}>
              Undo
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!!problem} loading={phase === "sending"} onClick={() => setPhase("confirm")} title={problem ?? undefined}>
              {phase !== "sending" && <Icon name="send" />}
              {phase === "sending" ? "Sending…" : "Send"}
            </Button>
            <Button variant="ghost" disabled={locked} onClick={discard}>
              Discard
            </Button>
            {problem && message.trim() && <span className="text-meta text-ink-muted">{problem}</span>}
          </div>
        )}
      </div>
    </section>
  );
}
