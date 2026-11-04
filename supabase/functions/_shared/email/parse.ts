// Turns a Gmail API message (format=full) into a ParsedEmail. Web APIs only (atob, TextDecoder), so the
// same code runs in the Edge Function (Deno) and in the unit tests (Node).
import type { AttachmentMeta, GmailMessage, GmailMessagePart, ParsedEmail, SenderType } from "./types.ts";

const MAX_NEW_TEXT = 12_000;
const MAX_QUOTED_TEXT = 8_000;

export interface ParseOptions {
  /** The watched mailbox, e.g. pricing@silverlynxoman.com. */
  mailbox: string;
  /** Domains whose senders are staff, e.g. ["silverlynxoman.com"]. */
  internalDomains: string[];
}

// --- Low-level decoding ------------------------------------------------------

export function decodeBase64Url(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function charsetOf(contentType: string | null): string | null {
  const m = contentType?.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return m ? m[1] : null;
}

/** RFC 2047 encoded words (=?UTF-8?B?...?= / =?ISO-8859-1?Q?...?=), in case a header arrives encoded. */
export function decodeEncodedWords(value: string): string {
  if (!value.includes("=?")) return value;
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      try {
        if (enc.toUpperCase() === "B") return decodeBytes(decodeBase64Url(text), charset);
        const bytes: number[] = [];
        const q = text.replace(/_/g, " ");
        for (let i = 0; i < q.length; i++) {
          if (q[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(q.slice(i + 1, i + 3))) {
            bytes.push(parseInt(q.slice(i + 1, i + 3), 16));
            i += 2;
          } else {
            bytes.push(q.charCodeAt(i));
          }
        }
        return decodeBytes(new Uint8Array(bytes), charset);
      } catch {
        return text;
      }
    });
}

export function header(part: GmailMessagePart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? decodeEncodedWords(h.value) : null;
}

// --- Addresses ------------------------------------------------------------------

export interface Address {
  name: string | null;
  email: string;
}

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Splits "A <a@x.com>, 'Maria' <b@y.com>, c@z.com" into addresses (commas inside quotes are kept). */
export function parseAddressList(value: string | null): Address[] {
  if (!value) return [];
  const pieces: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    if ((ch === "," || ch === ";") && !quoted && !angle) {
      pieces.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  pieces.push(cur);

  const out: Address[] = [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    const angled = piece.match(/<([^>]+)>/);
    const email = (angled ? angled[1] : piece).match(EMAIL_RE)?.[0];
    if (!email) continue;
    let name: string | null = angled ? piece.slice(0, piece.indexOf("<")).trim() : null;
    name = name ? name.replace(/^["']+|["']+$/g, "").trim() || null : null;
    out.push({ name, email: email.toLowerCase() });
  }
  return out;
}

function messageIds(value: string | null): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

// --- Bodies -----------------------------------------------------------------------

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#") && k !== "#39") return String.fromCodePoint(parseInt(k.slice(1), 10));
      return ENTITIES[k] ?? m;
    })
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/[ \t\u00a0]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normaliseText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Where quoted history starts: Outlook header blocks (several languages), Gmail "On … wrote:",
// forwarded-message banners and Outlook's underscore separator.
const QUOTE_STARTS: RegExp[] = [
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^-{5,}\s*Forwarded message\s*-{5,}/im,
  /^Begin forwarded message:/im,
  /^_{10,}\s*$/m,
  /^On [^\n]{5,250}(\n[^\n]{0,250})?wrote:\s*$/im,
  /^(From|De|Von|Da|Van|Från|Od|发件人|寄件者|差出人|من)\s*[:：][^\n]*\n([^\n]*\n){0,3}?(Sent|Date|Envoyé|Gesendet|Inviato|Enviado|Wysłano|发送时间|日期|送信日時|التاريخ|تاريخ|Data)\s*[:：]/im,
  /^\s*在[^\n]{0,120}写道\s*[:：]/m,
  /^Le [^\n]{5,200}a écrit\s*:/im,
  /^Am [^\n]{5,200}schrieb[^\n]{0,120}:/im,
  /^El [^\n]{5,200}escribió:/im,
  /^Il giorno [^\n]{5,200}ha scritto:/im,
];

/** Splits a plain-text body into what the sender wrote now and the quoted history below it. */
export function splitQuoted(text: string): { newText: string; quotedText: string } {
  let cut = text.length;
  for (const re of QUOTE_STARTS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  const head = text
    .slice(0, cut)
    .split("\n")
    .filter((line) => !line.startsWith(">"))
    .join("\n");
  return { newText: normaliseText(head), quotedText: normaliseText(text.slice(cut)) };
}

interface Bodies {
  plain: string[];
  html: string[];
  attachments: (AttachmentMeta & { data?: string })[];
}

function walk(part: GmailMessagePart, out: Bodies) {
  const mime = (part.mimeType ?? "").toLowerCase();
  const disposition = (header(part, "Content-Disposition") ?? "").toLowerCase();
  const filename = part.filename ? decodeEncodedWords(part.filename) : "";

  if (part.parts?.length) {
    for (const p of part.parts) walk(p, out);
    return;
  }
  if (filename || disposition.startsWith("attachment") || part.body?.attachmentId) {
    const size = part.body?.size ?? 0;
    const contentId = header(part, "Content-ID");
    const isImage = mime.startsWith("image/");
    const inline =
      isImage && !disposition.startsWith("attachment") && (!!contentId || disposition.startsWith("inline") || size < 8_000);
    out.attachments.push({
      filename: filename || `attachment.${mime.split("/")[1] ?? "bin"}`,
      mime_type: mime || "application/octet-stream",
      size,
      inline,
      attachment_id: part.body?.attachmentId,
      data: part.body?.attachmentId ? undefined : part.body?.data,
    });
    return;
  }
  if (!part.body?.data) return;
  const text = decodeBytes(decodeBase64Url(part.body.data), charsetOf(header(part, "Content-Type")));
  if (mime === "text/plain") out.plain.push(text);
  else if (mime === "text/html") out.html.push(text);
}

// --- References --------------------------------------------------------------------

/** SL references (SL + YY + running number, e.g. SL262731), normalised and de-duplicated in order. */
export function extractSlRefs(...texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/(?<![A-Z0-9])SL[ -]?(2\d)[ -]?(\d{4,5})(?![0-9])/gi)) {
      const ref = `SL${m[1]}${m[2]}`;
      if (!out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

// --- Whole message -------------------------------------------------------------------

function isBulk(payload: GmailMessagePart | undefined, labels: string[]): boolean {
  if (labels.some((l) => l === "CATEGORY_PROMOTIONS" || l === "CATEGORY_SOCIAL" || l === "CATEGORY_FORUMS")) return true;
  if (header(payload, "List-Unsubscribe") || header(payload, "List-Id")) return true;
  if (/^(bulk|list|junk)$/i.test(header(payload, "Precedence")?.trim() ?? "")) return true;
  const auto = header(payload, "Auto-Submitted")?.trim().toLowerCase();
  if (auto && auto !== "no") return true;
  return !!(header(payload, "X-Autoreply") || header(payload, "X-Autorespond"));
}

function senderType(email: string | null, opts: ParseOptions): SenderType {
  if (!email) return "external";
  if (email === opts.mailbox.toLowerCase()) return "self";
  const domain = email.split("@")[1] ?? "";
  return opts.internalDomains.some((d) => d.toLowerCase() === domain) ? "staff" : "external";
}

export function parseGmailMessage(msg: GmailMessage, opts: ParseOptions): ParsedEmail & {
  attachments: (AttachmentMeta & { data?: string })[];
} {
  const payload = msg.payload;
  const bodies: Bodies = { plain: [], html: [], attachments: [] };
  if (payload) walk(payload, bodies);

  const rawText = bodies.plain.length ? bodies.plain.join("\n\n") : htmlToText(bodies.html.join("\n"));
  const { newText, quotedText } = splitQuoted(normaliseText(rawText));
  const subject = (header(payload, "Subject") ?? "").replace(/\s+/g, " ").trim();
  const from = parseAddressList(header(payload, "From"))[0] ?? null;
  const labels = msg.labelIds ?? [];
  const internalMs = Number(msg.internalDate);
  const dateHeader = header(payload, "Date");
  const received = Number.isFinite(internalMs) && internalMs > 0 ? new Date(internalMs) : new Date(dateHeader ?? Date.now());

  return {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    rfc_message_id: messageIds(header(payload, "Message-ID") ?? header(payload, "Message-Id"))[0] ?? null,
    in_reply_to: messageIds(header(payload, "In-Reply-To"))[0] ?? null,
    reference_ids: messageIds(header(payload, "References")),
    sender_type: senderType(from?.email ?? null, opts),
    from_email: from?.email ?? null,
    from_name: from?.name ?? null,
    to_emails: parseAddressList(header(payload, "To")).map((a) => a.email),
    cc_emails: parseAddressList(header(payload, "Cc")).map((a) => a.email),
    subject,
    received_at: received.toISOString(),
    snippet: decodeEncodedWords(msg.snippet ?? "").slice(0, 500),
    new_text: newText.slice(0, MAX_NEW_TEXT),
    quoted_text: quotedText.slice(0, MAX_QUOTED_TEXT),
    sl_refs: extractSlRefs(subject, newText),
    label_ids: labels,
    attachments: bodies.attachments,
    is_bulk: isBulk(payload, labels),
  };
}

/** Text stored in email_messages.body_text; the app folds away everything after the marker. */
export const QUOTE_MARKER = "\n\n――― earlier messages ―――\n";

export function storedBody(email: Pick<ParsedEmail, "new_text" | "quoted_text">): string {
  return email.quoted_text ? `${email.new_text}${QUOTE_MARKER}${email.quoted_text}` : email.new_text;
}

/** Calendar date in Oman (UTC+4, no DST) of an ISO timestamp, as YYYY-MM-DD. */
export function muscatDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}
