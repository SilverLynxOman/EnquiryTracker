// Builds the RFC 5322 message for a reply sent from the app, and checks the request the app sends.
// Pure functions (no Deno or network), so they run under Vitest too (mime.test.ts).

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  /** Standard base64 of the file's bytes. */
  data: string;
}

export interface SendRequest {
  /** email_messages.id of the e-mail being answered: gives the thread, In-Reply-To and References. */
  replyToEmailId: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachments: OutgoingAttachment[];
}

export class Refusal extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const MAX_RECIPIENTS = 50;
/** Gmail accepts messages up to 25 MB once encoded; base64 adds a third, so files may total about 18 MB. */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEmail(s: string): boolean {
  return EMAIL.test(s);
}

/** Decoded size of a base64 string, without decoding it. */
export function base64Size(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

function addresses(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Refusal(`${field} must be a list of e-mail addresses.`);
  const out: string[] = [];
  for (const v of value) {
    const a = String(v).trim().toLowerCase();
    if (!a) continue;
    if (!isEmail(a)) throw new Refusal(`“${String(v).trim()}” is not an e-mail address.`);
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/** Checks the app's request; throws a Refusal with a message for the person sending. */
export function parseSendRequest(raw: unknown): SendRequest {
  if (!raw || typeof raw !== "object") throw new Refusal("Empty request.");
  const r = raw as Record<string, unknown>;
  const replyToEmailId = String(r.replyToEmailId ?? "");
  if (!UUID.test(replyToEmailId)) throw new Refusal("Which e-mail is this a reply to?");
  const to = addresses(r.to, "To");
  const cc = addresses(r.cc, "Cc").filter((a) => !to.includes(a));
  if (!to.length) throw new Refusal("Add at least one address under To.");
  if (to.length + cc.length > MAX_RECIPIENTS) throw new Refusal(`At most ${MAX_RECIPIENTS} recipients.`);
  const subject = String(r.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!subject) throw new Refusal("The subject is empty.");
  if (subject.length > 500) throw new Refusal("The subject is too long.");
  const body = String(r.body ?? "");
  if (!body.trim()) throw new Refusal("The message is empty.");
  if (body.length > 200_000) throw new Refusal("The message is too long.");

  const attachments: OutgoingAttachment[] = [];
  if (r.attachments != null && !Array.isArray(r.attachments)) throw new Refusal("Attachments must be a list.");
  let total = 0;
  for (const a of (r.attachments as unknown[] | undefined) ?? []) {
    const f = a as Record<string, unknown>;
    const filename = String(f.filename ?? "").replace(/[\r\n"\\/]+/g, " ").trim();
    const data = String(f.data ?? "");
    if (!filename || !data) throw new Refusal("An attachment is missing its name or content.");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new Refusal(`“${filename}” could not be read.`);
    total += base64Size(data);
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(f.mimeType ?? "")) ? String(f.mimeType) : "application/octet-stream";
    attachments.push({ filename, mimeType, data: data.replace(/\s/g, "") });
  }
  if (total > MAX_ATTACHMENT_BYTES) throw new Refusal("The attachments are too large for one e-mail (about 18 MB in all).");
  return { replyToEmailId, to, cc, subject, body, attachments };
}

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A header value: plain when it is printable ASCII, otherwise an RFC 2047 encoded word. */
export function headerText(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8Base64(s)}?=`;
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

export interface ReplyMessage {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** Message-ID of the e-mail being answered, with its angle brackets. */
  inReplyTo: string | null;
  /** The answered e-mail's References plus its Message-ID, oldest first. */
  references: string[];
  attachments: OutgoingAttachment[];
  date: Date;
  boundary: string;
}

/** Adds angle brackets to a Message-ID that lacks them. */
export function messageId(id: string): string {
  const t = id.trim();
  return t.startsWith("<") ? t : `<${t}>`;
}

/** The whole message, CRLF line endings, ready for base64url and Gmail's users.messages.send. */
export function buildReplyMessage(m: ReplyMessage): string {
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to.join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    `Subject: ${headerText(m.subject)}`,
    `Date: ${m.date.toUTCString().replace("GMT", "+0000")}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${messageId(m.inReplyTo)}`] : []),
    ...(m.references.length ? [`References: ${m.references.map(messageId).join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];
  const text = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8Base64(m.body.replace(/\r?\n/g, "\r\n"))),
  ];
  if (!m.attachments.length) return [...headers, ...text, ""].join("\r\n");

  const parts = [...headers, `Content-Type: multipart/mixed; boundary="${m.boundary}"`, "", `--${m.boundary}`, ...text];
  for (const a of m.attachments) {
    const name = headerText(a.filename);
    parts.push(
      `--${m.boundary}`,
      `Content-Type: ${a.mimeType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(a.data),
    );
  }
  parts.push(`--${m.boundary}--`, "");
  return parts.join("\r\n");
}

/** base64url without padding, as Gmail's `raw` field wants. */
export function base64Url(s: string): string {
  return utf8Base64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
