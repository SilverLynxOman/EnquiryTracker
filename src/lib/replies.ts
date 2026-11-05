import { splitBody } from "./emailDrafts";
import type { EmailMessage } from "./types";

type Answered = Pick<EmailMessage, "sender_type" | "from_email" | "from_name" | "to_emails" | "cc_emails" | "subject" | "received_at" | "body_text">;

const norm = (a: string) => a.trim().toLowerCase();

function unique(list: (string | null | undefined)[], skip: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of list) {
    if (!raw) continue;
    const a = norm(raw);
    if (!a || skip.has(a) || out.includes(a)) continue;
    out.push(a);
  }
  return out;
}

/**
 * Who a reply goes to. Reply: the sender, or, when the answered e-mail is our own, the people it went to.
 * Reply all adds everyone else on it. Our own mailbox is never a recipient.
 */
export function replyRecipients(email: Answered, ourAddresses: string[], all: boolean): { to: string[]; cc: string[] } {
  const ours = new Set(ourAddresses.map(norm));
  const mine = email.sender_type === "self" || (!!email.from_email && ours.has(norm(email.from_email)));
  const to = mine ? unique(email.to_emails, ours) : unique([email.from_email, ...(all ? email.to_emails : [])], ours);
  const cc = all ? unique(email.cc_emails, new Set([...ours, ...to])) : [];
  return { to, cc };
}

/** "Re: " once, and the enquiry's reference kept in the subject so the answer is filed automatically. */
export function replySubject(subject: string | null, reference: string): string {
  let s = (subject ?? "").trim();
  if (reference && !s.toUpperCase().includes(reference.toUpperCase())) s = s ? `${reference} ${s}` : reference;
  return /^(re|aw|回复|答复)\s*[:：]/i.test(s) ? s : `Re: ${s}`;
}

function quoteDate(ts: string): string {
  // Oman time, as the team reads it: "Thu, 5 Nov 2026 at 15:28".
  const d = new Date(new Date(ts).getTime() + 4 * 3600_000);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${weekday}, ${date} at ${d.toISOString().slice(11, 16)}`;
}

/** The answered e-mail under the reply, Gmail style: "On …, Name <address> wrote:" and "> " before each line. */
export function quoteEmail(email: Answered): string {
  const who = email.from_name && email.from_email ? `${email.from_name} <${email.from_email}>` : (email.from_email ?? email.from_name ?? "");
  const text = splitBody(email.body_text).text;
  const lines = (text || "(no text)").split(/\r?\n/).map((l) => (l ? `> ${l}` : ">"));
  return [`On ${quoteDate(email.received_at)}, ${who} wrote:`, ...lines].join("\n");
}

/** The text that is sent: the message, the signature after "-- ", and the quoted e-mail. */
export function composeReply(message: string, signature: string, quote: string | null): string {
  const parts = [message.replace(/\s+$/, "")];
  if (signature.trim()) parts.push(`-- \n${signature.trim()}`);
  if (quote) parts.push(quote);
  return parts.join("\n\n");
}

/** Splits what was typed in a To/Cc box: commas, semicolons, spaces or new lines; "Name <a@b>" keeps the address. */
export function parseAddresses(input: string): string[] {
  return input
    .split(/[,;\n]+/)
    .map((part) => {
      const angle = part.match(/<([^>]+)>/);
      return norm(angle ? angle[1]! : part);
    })
    .flatMap((a) => a.split(/\s+/))
    .filter(Boolean);
}

export const looksLikeEmail = (a: string) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(a);
