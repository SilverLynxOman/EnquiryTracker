import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { EmailView, Pill, shownName } from "../../components/EmailView";
import { Icon, type IconName } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { Button } from "../../components/ui";
import { daysBetween, initials } from "../../lib/display";
import { muscatDate } from "../../lib/emailDrafts";
import type {
  ActionButton,
  Cue,
  EnquiryBrief,
  FormPrefill,
  MilestoneKey,
  NoiseKind,
  OtherParty,
  Party,
  PromiseMade,
  Proof,
  Question,
  ReadMail,
  ReplyPrefill,
  Side,
  SideKind,
  SideStateKind,
  Tone,
  Viewer,
} from "../../lib/enquiryBrief";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import type { EnquiryRow } from "../../lib/types";
import { ReplyBox } from "../inbox/ReplyBox";
import { ActionBtn, ProofLink, proofTitle, TONE_BOX, TONE_TEXT, type PageActions } from "./shared";

// One conversation of an enquiry (the customer's, an agent's, our own staff's): a header that says who it is with,
// whose move it is and the last words from each side, then its e-mails, newest first, and the reply being written.

/** Rows shown before "Show n older". */
const SHOWN = 8;

/** Cues a row shows as pills. */
const ROW_CUES = 2;

/** Answered questions listed before "Show n more answered". */
const ANSWERED_SHOWN = 3;

/** The longest sentence a chip quotes. */
const CHIP_SENTENCE = 60;

/** The longest part of a line that is kept on one line. */
const UNBROKEN = 32;

/** Who is speaking, as a colour family: the customer, the agents' column, our own staff, anyone else outside. */
type Hue = "customer" | "agent" | "ours" | "other";

const HUES: Record<Hue, { avatar: string; pill: string; stripe: string; edge: string; rule: string; word: string }> = {
  customer: {
    avatar: "bg-party-customer-bg text-party-customer",
    pill: "bg-party-customer-bg text-party-customer",
    stripe: "shadow-[inset_3px_0_0_var(--color-party-customer)]",
    edge: "shadow-[inset_0_3px_0_var(--color-party-customer)]",
    rule: "border-party-customer",
    word: "text-party-customer",
  },
  agent: {
    avatar: "bg-party-agent-bg text-party-agent",
    pill: "bg-party-agent-bg text-party-agent",
    stripe: "shadow-[inset_3px_0_0_var(--color-party-agent)]",
    edge: "shadow-[inset_0_3px_0_var(--color-party-agent)]",
    rule: "border-party-agent",
    word: "text-party-agent",
  },
  ours: {
    avatar: "bg-surface text-ink-muted ring-1 ring-inset ring-line",
    pill: "bg-surface text-ink-muted ring-1 ring-inset ring-line",
    stripe: "",
    edge: "shadow-[inset_0_3px_0_var(--color-control)]",
    rule: "border-control",
    word: "text-ink-muted",
  },
  other: {
    avatar: "bg-table-head text-ink-heading",
    pill: "bg-table-head text-ink-heading",
    stripe: "shadow-[inset_3px_0_0_var(--color-control)]",
    edge: "shadow-[inset_0_3px_0_var(--color-control)]",
    rule: "border-control",
    word: "text-ink-heading",
  },
};

const hueOfParty = (party: Party): Hue => (party === "customer" ? "customer" : party === "us" ? "ours" : party === "other" ? "other" : "agent");

const hueOfSide = (kind: SideKind): Hue => (kind === "customer" ? "customer" : kind === "internal" ? "ours" : kind === "other" ? "other" : "agent");

const PARTY_LABEL: Record<Party, string> = { customer: "Customer", agent: "Agent", carrier: "Carrier", shipper: "Shipper", us: "Ours", other: "External" };

const SIDE_KIND: Record<SideKind, { role: string; icon: IconName }> = {
  customer: { role: "Customer", icon: "user" },
  agent: { role: "Agent", icon: "ship" },
  carrier: { role: "Carrier", icon: "ship" },
  shipper: { role: "Shipper", icon: "package" },
  other: { role: "External", icon: "users" },
  internal: { role: "Our side", icon: "users" },
};

const STATE_ICON: Record<SideStateKind, IconName> = {
  waiting_on_us: "clock",
  said_yes: "check",
  on_hold: "pause",
  they_promised: "message",
  rate_in_hand: "tag",
  pass_on: "arrowRight",
  waiting_on_them: "send",
  nothing_pending: "check",
  no_word: "inbox",
};

/** What a conversation's state says when the brief gives it no sentence of its own. */
const STATE_WORDS: Record<SideStateKind, string> = {
  waiting_on_us: "Waiting for us",
  said_yes: "Said yes",
  on_hold: "On hold",
  they_promised: "They promised an update",
  rate_in_hand: "Rate in hand",
  pass_on: "News to pass on",
  waiting_on_them: "Waiting for them",
  nothing_pending: "Nothing pending",
  no_word: "No written word from them on file",
};

/** A cue's pill in its tone. */
const CUE_PILL: Record<Tone, string> = {
  neutral: "bg-surface text-ink-heading ring-1 ring-inset ring-line",
  primary: "bg-quoted-bg text-quoted",
  good: "bg-confirmed-bg text-confirmed",
  warn: "bg-await-bg text-await",
  bad: "bg-lost-bg text-lost",
  flag: "bg-not-genuine-bg text-not-genuine",
  info: "bg-lane-mail-bg text-lane-mail",
};

/** Why an e-mail is folded away, for its row in the list of hidden ones. */
const NOISE_LABEL: Record<NoiseKind, string> = { auto_reply: "Auto-reply", loop_in: "Adding a colleague", duplicate: "Duplicate", bounce: "Bounced" };

/** The shipment steps, as an open e-mail names the ones it shows. */
const STEP_LABEL: Record<MilestoneKey, string> = {
  booked: "Booked",
  so: "SO released",
  gate_in: "Gate-in",
  collected: "Collected",
  awb: "AWB",
  waybill: "Waybill",
  picked_up: "Picked up",
  in_transit: "In transit",
  sailed: "Sailed",
  departed: "Departed",
  bl: "BL",
  arrived: "Arrived",
  can_do: "CAN / DO",
  bayan: "Bayan",
  delivered: "Delivered",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A day as the brief gives it (a date or a timestamp) → "Thu 05 Nov" on the Oman calendar; words stay as written. */
function dayText(value: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const timed = value.length > 10 && !Number.isNaN(Date.parse(value));
  return dayWithWeekday(timed ? muscatDate(value) : value, today);
}

/** "Mon 09:25" for an e-mail within six days of today, "Mon 02 Nov 09:25" for an older one. */
function shortWhen(mail: ReadMail, today: string): string {
  const full = dayWithWeekday(mail.day, today);
  return `${Math.abs(daysBetween(mail.day, today)) <= 6 ? full.slice(0, 3) : full} ${mail.time}`;
}

const senderName = (mail: ReadMail) => mail.from.name.trim() || shownName(mail.email.from_name) || mail.email.from_email || "Unknown sender";

/** Who wrote an e-mail, when, and how it starts: what a line about it says on hover, and the e-mail it opens. */
function mailProof(mail: ReadMail, side: Side | null, today: string): Proof {
  const name = senderName(mail);
  const company = mail.party !== "us" && side && side.kind !== "internal" && side.name !== name ? ` (${side.name})` : "";
  return { emailId: mail.id, who: `${name}${company}`, when: `${dayWithWeekday(mail.day, today)}, ${mail.time}`, sentence: mail.excerpt };
}

/** A subject without its reply and forward prefixes. */
const bareSubject = (subject: string | null | undefined) => (subject ?? "").replace(/^\s*(?:(?:re|fw|fwd|aw)\s*[:：]\s*)+/i, "").replace(/\s+/g, " ").trim();

/** The line a row shows: how the e-mail starts, else its subject without the enquiry's own reference. */
function rowText(mail: ReadMail, reference: string): string {
  if (mail.excerpt.trim()) return mail.excerpt;
  const subject = bareSubject(mail.email.subject);
  const short = reference && subject.toUpperCase().startsWith(reference.toUpperCase()) ? subject.slice(reference.length).replace(/^[\s/|:-]+/, "") : subject;
  return short || subject || "(no text)";
}

/** Whether every word of the Find box is in an e-mail: its sender, addresses, subject, new text, cues or file names. */
function matchesFind(mail: ReadMail, find: string): boolean {
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [
    mail.from.name,
    mail.from.email,
    ...mail.email.to_emails,
    mail.email.subject,
    mail.clean || mail.email.snippet,
    mail.excerpt,
    ...mail.cues.map((cue) => cue.label),
    ...mail.files.map((file) => file.filename),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return words.every((word) => hay.includes(word));
}

/**
 * The e-mails with which a new subject starts in a conversation (newest first, as a conversation holds them): the
 * e-mail's id → the subject as written. The conversation's first subject is not a change, and neither is the
 * enquiry's own reference being added to one.
 */
export function subjectChanges(mails: ReadMail[], reference = ""): Map<string, string> {
  const own = reference.trim().toLowerCase();
  const seen = new Set<string>();
  const changes = new Map<string, string>();
  for (let i = mails.length - 1; i >= 0; i--) {
    const subject = bareSubject(mails[i].email.subject);
    const lower = subject.toLowerCase();
    const key = (own ? lower.split(own).join(" ") : lower).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    if (seen.size) changes.set(mails[i].id, subject);
    seen.add(key);
  }
  return changes;
}

/** What a day's heading adds about when its e-mails came in. */
function arrivalNote(mails: ReadMail[]): string {
  if (mails.length && mails.every((m) => m.outOfHours === "weekend")) return "over the weekend";
  const theirs = mails.filter((m) => m.party !== "us");
  return theirs.length && theirs.every((m) => m.outOfHours === "overnight") ? "arrived overnight" : "";
}

/** A conversation's Reply or Reply all, from its header or from one of its e-mails: the page builds who it goes to. */
export function replyAction(sideKey: string, all: boolean, emailId?: string): ActionButton {
  return { id: "reply", label: all ? "Reply all" : "Reply", variant: all ? "ghost" : "secondary", sideKey, all, ...(emailId ? { emailIds: [emailId] } : {}) };
}

export interface SideChip {
  key: string;
  text: string;
  tone: Tone;
  icon: IconName;
  /** The e-mail it was read from. */
  proof: Proof | null;
}

/** "We promised “will update by tomorrow” · Sun 08 Nov, 11:28 — due today": an open promise and when it falls due. */
function promiseChip(promise: PromiseMade, today: string, customer: boolean): SideChip {
  const ours = promise.by === "us";
  const sentence = clip(promise.sentence.trim(), CHIP_SENTENCE);
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(promise.due) && /^\d{4}-\d{2}-\d{2}$/.test(today);
  const days = dated ? daysBetween(today, promise.due) : null;
  const due = days == null ? "" : days === 0 ? "due today" : days === 1 ? "due tomorrow" : days < 0 ? `was due ${dayWithWeekday(promise.due, today)}` : `due ${dayWithWeekday(promise.due, today)}`;
  // A wait on an agent is never red; our own word to the customer, once broken, is.
  const tone: Tone = days == null || days > 0 ? "neutral" : ours && customer && days < 0 ? "bad" : "warn";
  const said = [ours ? "We promised" : "They promised", sentence && `“${sentence}”`].filter(Boolean).join(" ");
  const text = [[said, promise.proof.when].filter(Boolean).join(" · "), due].filter(Boolean).join(" — ");
  return { key: "promise", text, tone, icon: tone === "neutral" ? "message" : "alert", proof: promise.proof };
}

/**
 * The chips of a conversation's header, only those that apply: a deadline they set, how often they asked, an open
 * promise, a closed office, the files and when they usually write.
 */
export function sideChips(side: Side, today: string): SideChip[] {
  const customer = side.kind === "customer";
  const chips: SideChip[] = [];
  const { deadline, chase, promise, holiday } = side;
  if (deadline && !deadline.cleared) {
    chips.push(
      deadline.passed
        ? { key: "deadline", text: `Reply ${deadline.text} passed`, tone: customer ? "bad" : "warn", icon: "alert", proof: deadline.proof }
        : { key: "deadline", text: `Wants a reply ${deadline.text}`, tone: "warn", icon: "clock", proof: deadline.proof },
    );
  }
  if (chase?.text.trim()) {
    chips.push({ key: "chase", text: chase.text, tone: chase.unanswered > 0 ? "warn" : "neutral", icon: chase.unanswered > 0 && chase.urgent ? "alert" : "message", proof: null });
  }
  if (promise && !promise.kept) chips.push(promiseChip(promise, today, customer));
  if (holiday) {
    const closed = customer ? "Office closed" : "Origin closed";
    const day = holiday.proof.when.split(",")[0].trim();
    const what = holiday.value.trim();
    const text = /^weekend at origin$/i.test(what) ? "Weekend at origin" : [closed, day, what && !/^office closed$/i.test(what) ? `(${what})` : ""].filter(Boolean).join(" ");
    chips.push({ key: "holiday", text, tone: "neutral", icon: "calendar", proof: holiday.proof });
  }
  if (side.fileCount > 0) chips.push({ key: "files", text: plural(side.fileCount, "file"), tone: "neutral", icon: "paperclip", proof: null });
  if (side.replyWindow?.text.trim()) chips.push({ key: "window", text: side.replyWindow.text, tone: "neutral", icon: "clock", proof: null });
  return chips;
}

/** One line of a conversation's ⋯ menu: an action the page handles, or a link that opens in a new tab. */
export interface SideMenuEntry {
  label: string;
  icon: IconName;
  button?: ActionButton;
  href?: string;
  separatorBefore?: boolean;
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * The ⋯ menu of a conversation, for those who may edit: copy the address, open the thread in Gmail (with the
 * mailbox), say who this really is (kept in this browser), and the two suggestions for the Edit form: the writer as
 * the enquiry's contact, the agent as the enquiry's agent. Nothing here saves to the register by itself.
 */
export function sideMenu(side: Side, brief: EnquiryBrief, row: EnquiryRow, viewer: Viewer): SideMenuEntry[] {
  if (!viewer.canEdit) return [];
  const entries: SideMenuEntry[] = [];
  const address = side.currentWriter?.email ?? side.lastFromThem?.from.email ?? null;
  if (address) entries.push({ label: "Copy address", icon: "copy", button: { id: "copy", label: "Copy address", variant: "ghost", copyText: address, copiedToast: `${address} copied.` } });
  if (viewer.canReply && side.threads[0]?.gmailUrl) entries.push({ label: "Open in Gmail", icon: "external", href: side.threads[0].gmailUrl });

  const who = side.key === "customer" ? (side.domain ?? address) : side.kind === "internal" ? null : side.key;
  if (who) {
    const parties: OtherParty[] = ["customer", "agent", "shipper"];
    parties
      .filter((party) => party !== side.kind)
      .forEach((party, i) => {
        const label = `Treat as ${party}`;
        entries.push({ label: `${label} (this browser)`, icon: SIDE_KIND[party].icon, separatorBefore: i === 0, button: { id: "treat_as", label, variant: "ghost", address: who, party } });
      });
  }

  const block = brief.people.find((b) => b.sideKey === side.key);
  const suggestion = (label: string, icon: IconName, formPrefill: FormPrefill, first: boolean): SideMenuEntry => ({
    label,
    icon,
    separatorBefore: first,
    button: { id: "edit_prefilled", label, variant: "ghost", formPrefill },
  });
  if (side.kind === "customer") {
    const savable = block?.persons.filter((p) => p.canSave && p.prefill) ?? [];
    const person = savable.find((p) => sameName(p.email, address)) ?? savable[0];
    if (person?.prefill) entries.push(suggestion(`Save ${person.name?.trim() || person.email} as contact`, "user", person.prefill, true));
  }
  if (side.kind === "agent") {
    const own: FormPrefill | null =
      side.agentName && !sameName(side.agentName, row.agent_name)
        ? { agent_name: side.agentName, ...(row.agent_name ? { replace: ["agent_name"] } : {}), notes: [`Agent ${side.name}, from the e-mails with ${side.domain ?? side.key}`] }
        : null;
    const prefill = block ? block.agentPrefill : own;
    if (prefill) entries.push(suggestion("Set as this enquiry's agent", "ship", prefill, true));
  }
  return entries;
}

/** A line of parts ("a · b · c") that breaks between its parts before it breaks inside a short one. */
function Parts({ text }: { text: string }) {
  const parts = text.split(" · ");
  return (
    <>
      {parts.map((part, i) => {
        const piece = i < parts.length - 1 ? `${part} ·` : part;
        return (
          <Fragment key={i}>
            {i > 0 && " "}
            {part.length <= UNBROKEN ? <span className="whitespace-nowrap">{piece}</span> : piece}
          </Fragment>
        );
      })}
    </>
  );
}

function CuePill({ cue }: { cue: Cue }) {
  return (
    <Pill className={`shrink-0 tabular-nums ${CUE_PILL[cue.tone]}`} title="Read from the e-mail's text, so it can be wrong">
      {cue.label}
    </Pill>
  );
}

function FileCount({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-meta tabular-nums text-ink-muted" title={plural(count, "attachment")}>
      <Icon name="paperclip" className="size-3.5" />
      {count}
      <span className="sr-only"> {count === 1 ? "attachment" : "attachments"}</span>
    </span>
  );
}

/** Who an e-mail is with, for a row outside its conversation: "to Frontline" on ours, the company on theirs. */
function withWhom(mail: ReadMail, side: Side | null): string {
  if (mail.party === "us") {
    if (side) return side.kind === "internal" ? "" : `to ${side.name}`;
    const [first, ...rest] = mail.email.to_emails;
    return first ? `to ${first}${rest.length ? ` +${rest.length}` : ""}` : "";
  }
  if (side) return side.name !== senderName(mail) ? side.name : "";
  const address = mail.from.email ?? "";
  return address.includes("@") ? address.slice(address.lastIndexOf("@") + 1) : "";
}

/** The colour family of the conversation an e-mail belongs to: the stripe of its row in a list of every e-mail. */
function conversationHue(mail: ReadMail, side: Side | null): Hue {
  if (side) return hueOfSide(side.kind);
  if (mail.party !== "us") return hueOfParty(mail.party);
  return mail.toParty === "customer" ? "customer" : !mail.toParty || mail.toParty === "internal" ? "ours" : mail.toParty === "other" ? "other" : "agent";
}

export interface MailRowProps {
  mail: ReadMail;
  /** The conversation the e-mail belongs to; null when it has none (another enquiry's, a bounce). */
  side: Side | null;
  row: EnquiryRow;
  today: string;
  mailbox?: string | null;
  viewer: Viewer;
  /** No avatar column, the name and the pills on one line, a one-line excerpt. */
  compact: boolean;
  open: boolean;
  onToggle: () => void;
  actions: PageActions;
  /** Mark the row's left edge with the colour of its conversation (a list of every e-mail). */
  stripe?: boolean;
}

/**
 * One e-mail as a row: when, who, what it looks like and how it starts. A click opens the whole message with, for
 * those on the mailbox, Reply and Reply all for this very e-mail.
 */
export function MailRow({ mail, side, row, today, mailbox, viewer, compact, open, onToggle, actions, stripe = false }: MailRowProps) {
  const name = senderName(mail);
  const hue = HUES[hueOfParty(mail.party)];
  const cues = mail.cues.slice(0, ROW_CUES);
  const noise = mail.noise && !mail.cues.some((cue) => cue.key === "auto_reply" || cue.key === "bounce") ? NOISE_LABEL[mail.noise] : null;
  const day = dayWithWeekday(mail.day, today);
  // Rows set apart from the conversations stand under no day heading: they say their day themselves.
  const context = [mail.scope !== "in" ? day : "", stripe || !side ? withWhom(mail, side) : ""].filter(Boolean).join(" · ");
  const text = rowText(mail, row.reference);
  const quiet = mail.kind === "ack" ? "text-ink-muted" : "text-ink-heading";
  const steps = [...new Set(mail.milestones.filter((hit) => hit.proves && hit.key).map((hit) => STEP_LABEL[hit.key as MilestoneKey]))];
  const shown = mail.milestones.find((hit) => hit.proves && hit.key);
  // A reply is written in the e-mail's conversation: one filed here by mistake or folded away has none to answer in.
  const canReply = viewer.canReply && !!side && mail.scope === "in";
  // An e-mail of ours to several agents is listed in each of their conversations: only its own row carries the anchor.
  const anchored = !side || side.key === mail.sideKey;

  const pills = (
    <>
      <Pill className={`shrink-0 ${hue.pill}`}>{PARTY_LABEL[mail.party]}</Pill>
      {cues.map((cue, i) => (
        <CuePill key={`${cue.key}-${i}`} cue={cue} />
      ))}
      {noise && <Pill className="shrink-0 bg-table-head text-ink-muted">{noise}</Pill>}
      <FileCount count={mail.files.length} />
    </>
  );
  const notes = (
    <>
      {mail.sentFromApp && (
        <span className="mt-0.5 flex items-center gap-1 text-meta text-ink-muted">
          <Icon name="send" className="size-3.5" />
          <span className="min-w-0 truncate">sent from the app by {mail.sentFromApp}</span>
        </span>
      )}
      {mail.siblingHint && (
        <span className="mt-0.5 flex items-center gap-1 text-meta font-medium tabular-nums text-await">
          <Icon name="alert" className="size-3.5" />
          <span className="min-w-0 truncate">May be about {mail.siblingHint}</span>
        </span>
      )}
    </>
  );

  return (
    <li id={anchored ? `mail-${mail.id}` : undefined} data-mail={mail.id} className={`scroll-mt-20 ${stripe ? HUES[conversationHue(mail, side)].stripe : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`grid w-full items-start px-4 text-left transition-colors duration-150 hover:bg-row-hover focus-visible:-outline-offset-2 ${
          compact ? "grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 py-1.5" : "grid-cols-[2.75rem_2rem_minmax(0,1fr)] gap-x-3 py-2"
        } ${open ? "bg-row-hover" : ""}`}
      >
        <span className={`text-meta tabular-nums text-ink-muted ${compact ? "leading-6" : "pt-1.5"}`} title={`${day}, ${mail.time}`}>
          {mail.time}
        </span>
        {!compact && (
          <span aria-hidden="true" className={`flex size-8 items-center justify-center rounded-full text-meta font-semibold ${hue.avatar}`}>
            {initials(name.replace(/[^\p{L}\p{N}\s]/gu, " "))}
          </span>
        )}
        <span className="min-w-0">
          {compact ? (
            // One line: what does not fit wraps below it and is cut off whole, never in half.
            <span className="flex h-6 flex-wrap items-center gap-x-1.5 gap-y-2 overflow-hidden">
              <span className="max-w-[60%] truncate font-semibold text-ink">{name}</span>
              {context && <span className="max-w-[40%] truncate text-meta tabular-nums text-ink-muted">{context}</span>}
              {pills}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="min-w-0 break-words font-semibold text-ink">{name}</span>
              {context && <span className="min-w-0 break-words text-meta tabular-nums text-ink-muted">{context}</span>}
              {pills}
            </span>
          )}
          <span className={`block text-body ${quiet} ${compact ? "truncate" : "mt-0.5 line-clamp-2 break-words"}`}>{text}</span>
          {notes}
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-3 pt-1">
          {steps.length > 0 && (
            <p className="flex items-start gap-1.5 text-meta font-medium text-party-agent" title={shown ? [shown.sentence, shown.file].filter(Boolean).join(" · ") : undefined}>
              <Icon name="ship" className="mt-0.5 size-3.5" />
              <span className="min-w-0 break-words">Shows: {steps.join(" · ")}</span>
            </p>
          )}
          <EmailView email={mail.email} mailbox={mailbox} gmail={viewer.canReply} />
          {canReply && side && (
            <div className="flex flex-wrap gap-2">
              <ActionBtn button={replyAction(side.key, false, mail.id)} actions={actions} size="sm" />
              <ActionBtn button={replyAction(side.key, true, mail.id)} actions={actions} size="sm" />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** A chip of the header: a fact in its tone, with an icon, linked to the e-mail it was read from when there is one. */
function Chip({ chip, actions }: { chip: SideChip; actions: PageActions }) {
  return (
    <li className={`inline-flex max-w-full items-start gap-1 rounded-panel border px-2 py-0.5 text-meta tabular-nums ${TONE_BOX[chip.tone]} ${TONE_TEXT[chip.tone]}`}>
      <Icon name={chip.icon} className="mt-0.5 size-3.5" />
      <ProofLink proof={chip.proof} actions={actions} className="min-w-0 break-words">
        <Parts text={chip.text} />
      </ProofLink>
    </li>
  );
}

/** The last e-mail from one side of the conversation: who, when, what it looks like and how it starts. It opens the e-mail. */
function LastWord({ label, mail, side, today, hue, actions }: { label: string; mail: ReadMail; side: Side; today: string; hue: Hue; actions: PageActions }) {
  const cue = mail.cues[0];
  const text = mail.excerpt.trim();
  return (
    <div className={`relative border-l-[3px] py-0.5 pl-2.5 transition-colors duration-150 hover:bg-row-hover ${HUES[hue].rule}`}>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta">
        <ProofLink proof={mailProof(mail, side, today)} actions={actions} className="tabular-nums after:absolute after:inset-0">
          <span className={`font-semibold ${HUES[hue].word}`}>{label}</span>
          <span className="text-ink-heading"> · {senderName(mail)}</span>
          <span className="text-ink-muted"> · {shortWhen(mail, today)}</span>
        </ProofLink>
        {cue && <CuePill cue={cue} />}
        <FileCount count={mail.files.length} />
      </p>
      <p className={`line-clamp-2 break-words text-body ${text ? "text-ink" : "text-ink-muted"}`}>{text ? `“${text}”` : bareSubject(mail.email.subject) || "(no text)"}</p>
    </div>
  );
}

/** One question of the checklist: open with how long it has waited and the button that answers it, or ticked. */
export function QuestionLine({ question, sideKey, canReply, actions }: { question: Question; sideKey: string; canReply: boolean; actions: PageActions }) {
  const answer: ActionButton = { ...replyAction(sideKey, false, question.proof.emailId), label: "Answer", copyText: `“${question.sentence}”` };
  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 sm:grid-cols-[1rem_minmax(0,1fr)_auto]">
      {question.answered ? (
        <Icon name="check" className="mt-0.5 size-4 text-confirmed" />
      ) : (
        <span aria-hidden="true" className="mt-0.5 size-4 rounded-[3px] border-2 border-control bg-surface" />
      )}
      <span className={`min-w-0 break-words text-body ${question.answered ? "text-ink-muted" : "text-ink"}`}>
        <span className="sr-only">{question.answered ? "Answered: " : "Open: "}</span>
        <ProofLink proof={question.proof} actions={actions}>
          “{question.sentence}”
        </ProofLink>{" "}
        <span className="text-meta tabular-nums text-ink-muted">
          {question.answered ? question.answeredText?.trim() || "answered" : [question.proof.when, question.age.label].filter(Boolean).join(" · ")}
        </span>
      </span>
      {canReply && !question.answered && (
        <span className="col-start-2 sm:col-start-3">
          <Button variant="secondary" size="sm" loading={!!actions.busy.reply} onClick={() => actions.onAction(answer)}>
            Answer
            <span className="sr-only">: {question.sentence}</span>
          </Button>
        </span>
      )}
    </li>
  );
}

/** A run of rows under one day and one subject. */
interface Segment {
  day: string;
  /** The day differs from the rows above: it gets a heading. */
  heading: boolean;
  mails: ReadMail[];
  /** The subject that starts with the last e-mail of the run, when the e-mails below it have another. */
  changedTo: string | null;
}

function segmentsOf(mails: ReadMail[], changes: Map<string, string> | null): Segment[] {
  const segments: Segment[] = [];
  for (const mail of mails) {
    const last = segments[segments.length - 1];
    if (last && last.day === mail.day && !last.changedTo) last.mails.push(mail);
    else segments.push({ day: mail.day, heading: !last || last.day !== mail.day, mails: [mail], changedTo: null });
    const changed = changes?.get(mail.id);
    if (changed) segments[segments.length - 1].changedTo = changed;
  }
  return segments;
}

export interface ConversationSideProps {
  side: Side;
  brief: EnquiryBrief;
  row: EnquiryRow;
  today: string;
  mailbox?: string | null;
  viewer: Viewer;
  /** Rows without an avatar, on one line each (two narrow columns, or a phone). */
  compact: boolean;
  /** Start folded to the header; the heading unfolds it. */
  folded: boolean;
  actions: PageActions;
  /** The e-mail to show: when it is one of this conversation's, its row is expanded. */
  openMailId: string | null;
  /** Show only the e-mails about this shipment step. */
  milestoneFilter: MilestoneKey | null;
  /** Show only the e-mails that contain these words. */
  find: string;
  /** The reply being written, when it belongs to this conversation. */
  reply: ReplyPrefill | null;
  onCloseReply: () => void;
  onSent: (message: string) => void;
}

/**
 * One conversation: who it is with, whose move it is and since when, the last words from each side and what else
 * applies, then its e-mails, newest first. A reply is written under the header.
 */
export function ConversationSide({
  side,
  brief,
  row,
  today,
  mailbox,
  viewer,
  compact,
  folded,
  actions,
  openMailId,
  milestoneFilter,
  find,
  reply,
  onCloseReply,
  onSent,
}: ConversationSideProps) {
  const uid = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(openMailId && side.mails.some((m) => m.id === openMailId) ? [openMailId] : []));
  const [all, setAll] = useState(() => side.mails.findIndex((m) => m.id === openMailId) >= SHOWN);
  const [foldChoice, setFoldChoice] = useState<boolean | null>(null);
  const [foldedBefore, setFoldedBefore] = useState(folded);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [allAnswered, setAllAnswered] = useState(false);

  // The board folding or unfolding the conversation overrides what the reader chose before.
  if (foldedBefore !== folded) {
    setFoldedBefore(folded);
    setFoldChoice(null);
  }

  const replying = reply && reply.sideKey === side.key ? reply : null;

  // An e-mail to show: unfold, bring it out from behind "Show older", expand it.
  useEffect(() => {
    if (!openMailId) return;
    const at = side.mails.findIndex((m) => m.id === openMailId);
    if (at < 0) return;
    setFoldChoice(false);
    if (at >= SHOWN) setAll(true);
    setOpen((prev) => (prev.has(openMailId) ? prev : new Set(prev).add(openMailId)));
  }, [openMailId]);

  // A reply opens in the full conversation.
  useEffect(() => {
    if (replying) setFoldChoice(false);
  }, [replying?.targetEmailId, replying?.all]);

  const isFolded = foldChoice ?? folded;
  const kind = SIDE_KIND[side.kind];
  const hueKey = hueOfSide(side.kind);
  const hue = HUES[hueKey];
  const customer = side.kind === "customer";
  const internal = side.kind === "internal";

  // Who.
  const meta = [
    kind.role !== side.name ? kind.role : "",
    !customer && side.domain && side.domain !== side.name ? side.domain : "",
    side.mails.length ? plural(side.mails.length, "e-mail") : "",
    side.threads.length > 1 ? `${side.threads.length} threads` : "",
  ].filter(Boolean);

  // Whose move. A wait on an agent is never red.
  const tone: Tone = !customer && side.state.tone === "bad" ? "warn" : side.state.tone;
  const plain = tone === "neutral";
  const words = side.state.text.trim() || (side.mails.length ? STATE_WORDS[side.state.kind] : "");
  const stateText = words && side.state.age && !words.includes(side.state.age.label) ? `${words} · ${side.state.age.label}` : words;
  const summary = side.agent?.summary.trim();
  const summaryProof = side.agent?.latest?.proof ?? side.agent?.question?.proof ?? side.agent?.validity?.proof ?? null;

  // Chips and questions.
  const chips = sideChips(side, today);
  const openQuestions = side.questions.filter((q) => !q.answered);
  const answered = side.questions.filter((q) => q.answered).reverse();
  const answeredShown = allAnswered ? answered : answered.slice(0, ANSWERED_SHOWN);

  // Actions.
  const sales = !viewer.canReply && (viewer.canEdit || viewer.me != null);
  const chaseText = brief.copy.chase[side.key]?.trim();
  const menu: MenuItem[] = sideMenu(side, brief, row, viewer).map((entry) => ({
    label: entry.label,
    icon: entry.icon,
    separatorBefore: entry.separatorBefore,
    onSelect: () => {
      if (entry.button) actions.onAction(entry.button);
      else if (entry.href) window.open(entry.href, "_blank", "noopener,noreferrer");
    },
  }));
  const canReply = viewer.canReply && side.mails.length > 0;
  const hasActions = canReply || sales || menu.length > 0;

  // Rows.
  const query = find.trim();
  const step = milestoneFilter ? (brief.journey?.nodes.find((n) => n.key === milestoneFilter) ?? null) : null;
  const stepIds = step ? new Set([...step.emailIds, ...(step.proof ? [step.proof.emailId] : [])]) : null;
  const filtering = !!query || !!stepIds;
  const passing = side.mails.filter((m) => matchesFind(m, query) && (!stepIds || stepIds.has(m.id)));
  const capped = !filtering && passing.length > SHOWN;
  const shown = capped && !all ? passing.slice(0, SHOWN) : passing;
  const segments = segmentsOf(shown, filtering ? null : subjectChanges(side.mails, row.reference));
  const dayNote = (day: string) => arrivalNote(passing.filter((m) => m.day === day));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const target = replying ? (side.mails.find((m) => m.id === replying.targetEmailId) ?? brief.mails.find((m) => m.id === replying.targetEmailId) ?? null) : null;

  // Nothing from them on file: said once, by the state line when that is what it says.
  let noWord: ReactNode = null;
  if (!internal && !side.lastFromThem) {
    const said = !!stateText && side.state.kind === "no_word";
    const offer = customer ? brief.offer : null;
    if (!said || customer) {
      noWord = (
        <p className="break-words text-body text-ink-muted">
          {[said ? "" : `No written word from ${side.name} on file.`, customer ? "Confirmations often come by phone or WhatsApp." : ""].filter(Boolean).join(" ")}
          {offer && (
            <>
              {" "}
              <ProofLink proof={offer.proof} actions={actions} className="tabular-nums">
                Our offer of {dayText(offer.sentAt, today)}
              </ProofLink>
              {offer.sentTo.length ? ` went to ${offer.sentTo.join(", ")}.` : " is on file."}
            </>
          )}
        </p>
      );
    }
  }

  return (
    <section aria-labelledby={`${uid}-title`} className={`min-w-0 overflow-hidden rounded-panel border border-line bg-surface ${hue.edge}`}>
      <div className="px-4 pb-3 pt-3.5">
        <h3 id={`${uid}-title`}>
          <button
            type="button"
            aria-expanded={!isFolded}
            aria-controls={`${uid}-more ${uid}-rows`}
            onClick={() => setFoldChoice(!isFolded)}
            className="group flex w-full items-start gap-2 rounded-control text-left"
          >
            <Icon name={kind.icon} className={`mt-0.5 size-4 ${hue.word}`} />
            <span className="min-w-0 flex-1 break-words">
              <span className="text-body font-semibold text-ink">{side.name}</span>
              {meta.length > 0 && (
                <span className="text-meta font-normal tabular-nums text-ink-muted">
                  {" · "}
                  <Parts text={meta.join(" · ")} />
                </span>
              )}
              {side.pausedByUs && (
                <span className="text-meta font-normal tabular-nums text-ink-muted" title={proofTitle(side.pausedByUs)}>
                  {" · "}
                  <span className="whitespace-nowrap">paused by us {side.pausedByUs.when}</span>
                </span>
              )}
            </span>
            <Icon name={isFolded ? "chevronRight" : "chevronDown"} className="mt-0.5 size-4 text-ink-muted transition-colors duration-150 group-hover:text-ink" />
          </button>
        </h3>

        {stateText && (
          <p className={`mt-1.5 flex items-start gap-2 text-body font-semibold ${plain ? "text-ink" : TONE_TEXT[tone]}`}>
            <Icon name={STATE_ICON[side.state.kind]} className={`mt-0.5 size-4 ${plain ? "text-ink-muted" : ""}`} />
            <ProofLink proof={side.state.proof} actions={actions} className="min-w-0 break-words tabular-nums">
              <Parts text={stateText} />
            </ProofLink>
          </p>
        )}
        {summary && (
          <p className="mt-1 flex items-start gap-2 text-meta text-ink-heading">
            <Icon name="tag" className="mt-px size-4 text-ink-muted" />
            <ProofLink proof={summaryProof} actions={actions} className="min-w-0 break-words tabular-nums">
              <Parts text={summary} />
            </ProofLink>
          </p>
        )}

        <div id={`${uid}-more`}>
          {!isFolded && (noWord || side.lastFromThem || side.lastFromUs) && (
            <div className="mt-2.5 space-y-1.5">
              {noWord}
              {side.lastFromThem && <LastWord label="Them" mail={side.lastFromThem} side={side} today={today} hue={hueKey} actions={actions} />}
              {side.lastFromUs && <LastWord label="Us" mail={side.lastFromUs} side={side} today={today} hue="ours" actions={actions} />}
            </div>
          )}

          {!isFolded && (openQuestions.length > 0 || chips.length > 0) && (
            <ul role="list" className="mt-2.5 flex flex-wrap gap-1.5">
              {openQuestions.length > 0 && (
                <li className="inline-flex">
                  <button
                    type="button"
                    aria-expanded={questionsOpen}
                    aria-controls={`${uid}-questions`}
                    onClick={() => setQuestionsOpen(!questionsOpen)}
                    className="relative inline-flex items-center gap-1 rounded-panel bg-surface px-2 py-0.5 text-meta font-medium text-ink ring-1 ring-inset ring-control transition-colors duration-150 after:absolute after:inset-x-0 after:-inset-y-1 hover:bg-row-hover"
                  >
                    <Icon name={questionsOpen ? "chevronDown" : "chevronRight"} className="size-3.5 text-ink-muted" />
                    Open questions <span className="tabular-nums">{openQuestions.length}</span>
                  </button>
                </li>
              )}
              {chips.map((chip) => (
                <Chip key={chip.key} chip={chip} actions={actions} />
              ))}
            </ul>
          )}

          <div id={`${uid}-questions`}>
            {!isFolded && questionsOpen && openQuestions.length > 0 && (
              <div className="mt-2 rounded-control border border-line bg-table-head px-3 py-2">
                <ul role="list" aria-label={`Questions from ${side.name}`} className="space-y-1.5">
                  {openQuestions.map((question) => (
                    <QuestionLine key={question.id} question={question} sideKey={side.key} canReply={viewer.canReply} actions={actions} />
                  ))}
                  {answeredShown.map((question) => (
                    <QuestionLine key={question.id} question={question} sideKey={side.key} canReply={false} actions={actions} />
                  ))}
                </ul>
                {answered.length > ANSWERED_SHOWN && (
                  <Button variant="ghost" size="sm" className="-ml-2.5 mt-1" aria-expanded={allAnswered} onClick={() => setAllAnswered(!allAnswered)}>
                    {allAnswered ? "Show fewer answered" : `Show ${answered.length - ANSWERED_SHOWN} more answered`}
                  </Button>
                )}
              </div>
            )}
          </div>

          {!isFolded && hasActions && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canReply && (
                <>
                  <ActionBtn button={replyAction(side.key, false)} actions={actions} size="sm" />
                  <ActionBtn button={replyAction(side.key, true)} actions={actions} size="sm" />
                </>
              )}
              {sales && (
                <>
                  <p className="text-meta text-ink-muted">Pricing replies from the mailbox</p>
                  {chaseText && (
                    <ActionBtn button={{ id: "copy", label: "Copy chase text", variant: "secondary", copyText: chaseText, copiedToast: "Chase text copied." }} actions={actions} size="sm" />
                  )}
                </>
              )}
              {menu.length > 0 && (
                <span className="ml-auto inline-flex">
                  <Menu
                    label={`More for ${side.name}`}
                    trigger={<Icon name="more" />}
                    triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading transition-colors duration-150 hover:bg-row-hover hover:text-ink"
                    items={menu}
                  />
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {replying &&
        (target ? (
          <ReplyBox
            key={`${target.id}:${replying.all}:${replying.subject}:${replying.message}`}
            enquiryId={row.id}
            reference={row.reference}
            target={target.email}
            all={replying.all}
            mailbox={mailbox ?? undefined}
            prefill={{ to: replying.to, cc: replying.cc, subject: replying.subject, message: replying.message, warnings: replying.warnings }}
            onClose={onCloseReply}
            onSent={onSent}
          />
        ) : (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-await-bg px-4 py-2 text-body text-await">
            <span className="min-w-0 break-words">The e-mail to answer is not in this conversation any more.</span>
            <Button variant="secondary" size="sm" onClick={onCloseReply}>
              Close
            </Button>
          </div>
        ))}

      <div id={`${uid}-rows`}>
        {!isFolded && side.mails.length > 0 && (
          <div className="border-t border-line pb-2">
            {segments.map((segment, i) => {
              const note = segment.heading ? dayNote(segment.day) : "";
              return (
                <div key={`${segment.day}-${i}`}>
                  {segment.heading && (
                    <h4 className="px-4 pb-1 pt-3 text-meta font-semibold tabular-nums text-ink-muted">
                      {dayWithWeekday(segment.day, today)}
                      {note && <span className="font-normal"> · {note}</span>}
                    </h4>
                  )}
                  <ol role="list">
                    {segment.mails.map((mail) => (
                      <MailRow
                        key={mail.id}
                        mail={mail}
                        side={side}
                        row={row}
                        today={today}
                        mailbox={mailbox}
                        viewer={viewer}
                        compact={compact}
                        open={open.has(mail.id)}
                        onToggle={() => toggle(mail.id)}
                        actions={actions}
                      />
                    ))}
                  </ol>
                  {segment.changedTo && (
                    <p className="flex items-center gap-2 px-4 py-1 text-meta text-ink-muted" title={segment.changedTo}>
                      <span aria-hidden="true" className="h-px w-3 shrink-0 bg-line" />
                      <span className="min-w-0 truncate">Subject changed: {segment.changedTo}</span>
                      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-line" />
                    </p>
                  )}
                </div>
              );
            })}
            {filtering && !passing.length && (
              <p className="break-words px-4 pb-1 pt-3 text-meta text-ink-muted">
                {query ? `Nothing here${step ? ` about ${step.label}` : ""} says “${query}”.` : `No e-mail here is about ${step?.label ?? "this step"}.`}
              </p>
            )}
            {capped && (
              <div className="px-4 pb-1 pt-3">
                <Button variant="secondary" size="sm" aria-expanded={all} onClick={() => setAll(!all)}>
                  {all ? `Show the latest ${SHOWN}` : `Show ${passing.length - SHOWN} older`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
