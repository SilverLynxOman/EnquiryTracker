import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { Alert, Button, buttonClass, inputClass, Spinner } from "../../components/ui";
import { displayName } from "../../lib/display";
import type {
  ActionButton,
  CrossFiledGroup,
  CueKey,
  EnquiryBrief,
  Flag,
  MilestoneKey,
  Proof,
  ReadMail,
  ReplyPrefill,
  Side,
  Viewer,
} from "../../lib/enquiryBrief";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import { errorMessage } from "../../lib/format";
import type { EnquiryRow } from "../../lib/types";
import { ConversationSide, MailRow } from "./ConversationSide";
import { ActionBtn, ProofLink, type PageActions } from "./shared";

/** Rows of the Everything list shown before "Show n older". */
const SHOWN = 8;

/** Rows of another enquiry's e-mails shown before "Show all n". */
const SET_ASIDE_SHOWN = 3;

/** The cues a row shows as pills; the chips of the Everything list filter by the same ones. */
const ROW_CUES = 2;

/** Which conversations the board shows: both columns, one of them, our own staff's, or every e-mail in one list. */
export type BoardView = "both" | "customer" | "agents" | "ours" | "all";

/**
 * The board's own width: a phone shows one conversation at a time, a stacked board puts the customer above the
 * agents, a tight one has two columns of compact rows, a wide one two roomy columns.
 */
export type BoardSize = "phone" | "stacked" | "tight" | "wide";

const sizeOf = (px: number): BoardSize => (px < 640 ? "phone" : px < 880 ? "stacked" : px < 1100 ? "tight" : "wide");

/** The size of an element's own width, measured before the first paint and kept up to date. Null until measured. */
function useSize() {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState<BoardSize | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setSize(sizeOf(el.clientWidth));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize(sizeOf(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const joinList = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** When a conversation's newest e-mail arrived; empty when it has none. */
const newestAt = (side: Side) => side.mails[0]?.at ?? "";

/** Whether a view holds the conversation with this key. Everything holds them all. */
function viewHolds(view: BoardView, key: string): boolean {
  if (view === "all") return true;
  if (view === "both") return key !== "internal";
  if (view === "customer") return key === "customer";
  if (view === "agents") return key !== "customer" && key !== "internal";
  return key === "internal";
}

/** The view that shows one conversation alone. */
const single = (key: string): BoardView => (key === "customer" ? "customer" : key === "internal" ? "ours" : "agents");

/** The view to open for a conversation: both columns where there is room, else the conversation alone. */
const homeView = (key: string, phone: boolean): BoardView => (phone || key === "internal" ? single(key) : "both");

/** The conversations of the agents column (agents, carriers, shippers, others): the agreed agent first, then by newest e-mail. */
export function agentColumn(sides: Side[]): Side[] {
  const outside = sides.filter((s) => viewHolds("agents", s.key)).sort((a, b) => (newestAt(a) < newestAt(b) ? 1 : newestAt(a) > newestAt(b) ? -1 : 0));
  const agreed = (s: Side) => s.agent?.state === "agreed";
  return [...outside.filter(agreed), ...outside.filter((s) => !agreed(s))];
}

/**
 * The conversations of the agents column that start folded to their header: those who declined or were paused by us;
 * on a stacked board, all but the one with the newest e-mail.
 */
export function foldedKeys(column: Side[], stacked: boolean): Set<string> {
  if (stacked) {
    const newest = column.reduce<Side | null>((best, s) => (!best || newestAt(s) > newestAt(best) ? s : best), null);
    return new Set(column.filter((s) => s !== newest).map((s) => s.key));
  }
  return new Set(column.filter((s) => s.agent?.state === "declined" || s.agent?.state === "paused" || !!s.pausedByUs).map((s) => s.key));
}

export interface ViewOption {
  key: BoardView;
  label: string;
  /** E-mails in the view; null for the views that are not counted. */
  count: number | null;
}

/** The views on offer, with how many e-mails each holds. A phone has no room for both columns; our side shows only when staff wrote to staff. */
export function viewOptions(brief: EnquiryBrief, size: BoardSize): ViewOption[] {
  const count = (view: BoardView) => new Set(brief.sides.filter((s) => viewHolds(view, s.key)).flatMap((s) => s.mails.map((m) => m.id))).size;
  const options: ViewOption[] = [];
  if (size !== "phone") options.push({ key: "both", label: size === "stacked" ? "Both" : "Side by side", count: null });
  options.push({ key: "customer", label: "Customer", count: count("customer") });
  options.push({ key: "agents", label: "Agents", count: count("agents") });
  if (brief.sides.some((s) => s.key === "internal")) options.push({ key: "ours", label: "Our side", count: count("ours") });
  options.push({ key: "all", label: "Everything", count: null });
  return options;
}

/** The view the board opens in: both columns, or on a phone the conversation whose move it is, else the customer's. */
export function startView(brief: EnquiryBrief, phone: boolean): BoardView {
  if (!phone) return "both";
  const hasMail = (key: string) => brief.sides.some((s) => s.key === key && s.mails.length > 0);
  const moveKey = brief.move.sideKey;
  if (moveKey && hasMail(moveKey)) return single(moveKey);
  if (hasMail("customer")) return "customer";
  return brief.sides.some((s) => viewHolds("agents", s.key) && s.mails.length > 0) ? "agents" : "customer";
}

/**
 * The view to be in to see an e-mail: the current one when it already shows it, else the e-mail's conversation, else
 * Everything (a bounce belongs to no conversation). Another enquiry's e-mails are listed under every view.
 */
export function viewForMail(brief: EnquiryBrief, mailId: string, current: BoardView, phone: boolean): BoardView {
  const mail = brief.mails.find((m) => m.id === mailId);
  if (!mail || mail.scope === "cross_filed" || current === "all") return current;
  const homes = brief.sides.filter((s) => s.mails.some((m) => m.id === mailId));
  if (!homes.length) return brief.hidden.mails.some((m) => m.id === mailId) && viewHolds(current, mail.sideKey) ? current : "all";
  return homes.some((s) => viewHolds(current, s.key)) ? current : homeView(homes[0].key, phone);
}

/** Whether every word of the Find box appears in an e-mail: its sender, addresses, subject, new text, cues or file names. */
export function mailMatches(mail: ReadMail, find: string): boolean {
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

/** "3 auto-replies, 1 'adding a colleague' note and 1 duplicate hidden", for the e-mails folded away under one view. */
export function hiddenLabel(mails: ReadMail[]): string {
  const count = (kind: ReadMail["noise"]) => mails.filter((m) => m.noise === kind).length;
  const known = count("auto_reply") + count("loop_in") + count("duplicate");
  const parts = [
    count("auto_reply") ? plural(count("auto_reply"), "auto-reply", "auto-replies") : "",
    count("loop_in") ? plural(count("loop_in"), "'adding a colleague' note") : "",
    count("duplicate") ? plural(count("duplicate"), "duplicate") : "",
    mails.length > known ? plural(mails.length - known, known ? "other e-mail" : "e-mail") : "",
  ].filter(Boolean);
  return parts.length ? `${joinList(parts)} hidden` : "";
}

/** The word a cue is filtered by in the Everything list, in the order the chips show; cues that say the same thing share one. */
const CUE_CHIP: Record<CueKey, string> = {
  offer: "Offer",
  final_offer: "Offer",
  rate: "Rate",
  agreed_buy: "Rate",
  rate_request: "Rate request",
  target: "Target",
  push: "Target",
  extra_charge: "Extra charge",
  accepts: "Says yes",
  yes: "Says yes",
  nominated: "Says yes",
  confirmed_to_agent: "Go-ahead",
  approves: "Approves",
  declined: "Declined",
  asks: "Asks",
  question: "Asks",
  chase: "Chase",
  agent_chasing: "Chase",
  urgent: "Urgent",
  complaint: "Complaint",
  hold: "Hold",
  promise: "Promise",
  ack: "Noted",
  booking: "Booking",
  so: "SO",
  space_etd: "ETD",
  sailed: "Sailed",
  bl_draft: "BL draft",
  bl_ok: "BL OK",
  telex: "Telex",
  originals: "Originals",
  pre_alert: "Pre-alert",
  eta: "ETA",
  arrived: "Arrived",
  can_do: "CAN / DO",
  bayan: "Bayan",
  docs: "Documents",
  delivery: "Delivery",
  awb: "AWB",
  waybill: "Waybill",
  paperwork: "Paperwork",
  payment: "Payment",
  dn: "Debit note",
  cod: "COD",
  detention: "Detention",
  bounce: "Bounced",
  auto_reply: "Auto-reply",
};

const CHIP_ORDER = [...new Set(Object.values(CUE_CHIP))];

/** The chip words of the cues an e-mail's row shows. */
const chipsOf = (mail: ReadMail): string[] => [...new Set(mail.cues.slice(0, ROW_CUES).map((cue) => CUE_CHIP[cue.key]).filter(Boolean))];

export interface CueChip {
  label: string;
  count: number;
}

/** The chips of the Everything list: one per kind of cue its rows show, with how many rows carry it. */
export function cueChips(mails: ReadMail[]): CueChip[] {
  const counts = new Map<string, number>();
  for (const mail of mails) for (const label of chipsOf(mail)) counts.set(label, (counts.get(label) ?? 0) + 1);
  return CHIP_ORDER.filter((label) => counts.has(label)).map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

/** What tells one group of another enquiry's e-mails from the next. */
const groupKey = (group: CrossFiledGroup) => group.looksLike ?? `${group.why}:${group.about ?? ""}`;

/**
 * The buttons of a group of e-mails that look like another enquiry's: the ones its flag carries, else Move and Keep
 * here (or Keep here and Wrong enquiry when no other reference is named). Keeping needs the right to edit; moving
 * e-mails needs the mailbox as well. None is filled.
 */
export function setAsideButtons(group: CrossFiledGroup, flags: Flag[], viewer: Viewer): ActionButton[] {
  const emailIds = group.mails.map((m) => m.id);
  const about = (button: ActionButton) =>
    (button.id === "keep_thread" && !!button.threadIds?.some((id) => group.threadIds.includes(id))) ||
    (button.id === "move_mails" && !!group.looksLike && button.reference === group.looksLike) ||
    (button.id === "wrong_enquiry" && !!button.emailIds?.some((id) => emailIds.includes(id)));
  const flag = flags.find((f) => f.kind === "wrong_enquiry" && f.buttons.some(about));
  const fromFlag = (flag?.buttons ?? []).filter((b) => b.id === "move_mails" || b.id === "keep_thread" || b.id === "wrong_enquiry");
  const keep = (variant: ActionButton["variant"]): ActionButton => ({ id: "keep_thread", label: "Keep here", variant, threadIds: group.threadIds });
  const own: ActionButton[] = group.looksLike
    ? [{ id: "move_mails", label: `Move to ${group.looksLike}`, variant: "secondary", reference: group.looksLike, emailIds }, keep("ghost")]
    : [keep("secondary"), { id: "wrong_enquiry", label: "Wrong enquiry", variant: "ghost", emailIds }];
  return (fromFlag.length ? fromFlag : own)
    .filter((button) => (button.id === "keep_thread" ? viewer.canEdit : viewer.canEdit && viewer.canReply))
    .map((button) => (button.variant === "primary" ? { ...button, variant: "secondary" } : button));
}

/** The agents we wrote to with no reply on file, as conversations: the ones "Chase those n" opens a reply to, in turn. */
export function chaseTargets(brief: EnquiryBrief): Side[] {
  const sides: Side[] = [];
  for (const named of brief.agentsSummary.noReplyOnFile) {
    const side = brief.sides.find((s) => s.key === named) ?? brief.sides.find((s) => s.name.toLowerCase() === named.toLowerCase());
    if (side && viewHolds("agents", side.key) && !sides.includes(side)) sides.push(side);
  }
  return sides;
}

/** The e-mail a part of the agents line was read from: the lowest rate on file, or what we asked an agent for. */
function partProof(part: string, brief: EnquiryBrief): Proof | null {
  if (/\b(?:best|lowest) on file\b/i.test(part)) return brief.agentsSummary.lowest?.latest?.proof ?? null;
  if (/^we asked\b/i.test(part)) return brief.targets.find((t) => t.who === "us_to_agent")?.proof ?? null;
  return null;
}

/** What every row the board renders itself needs: the Everything list, another enquiry's e-mails and the hidden ones. */
export interface RowContext {
  row: EnquiryRow;
  today: string;
  mailbox?: string | null;
  viewer: Viewer;
  compact: boolean;
  actions: PageActions;
  /** Ids of the rows that are expanded. */
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  sideOf: (mail: ReadMail) => Side | null;
}

function Rows({ mails, list, stripe, className }: { mails: ReadMail[]; list: RowContext; stripe?: boolean; className?: string }) {
  return (
    <ol role="list" className={className}>
      {mails.map((mail) => (
        <MailRow
          key={mail.id}
          mail={mail}
          side={list.sideOf(mail)}
          row={list.row}
          today={list.today}
          mailbox={list.mailbox}
          viewer={list.viewer}
          compact={list.compact}
          open={list.open.has(mail.id)}
          onToggle={() => list.onToggle(mail.id)}
          actions={list.actions}
          stripe={stripe}
        />
      ))}
    </ol>
  );
}

/**
 * Every e-mail in one list, newest first under day headings, each row striped by who it is with. The chips show only
 * the rows carrying one kind of cue.
 */
export function EverythingList({
  mails,
  capped,
  all,
  onAll,
  chips,
  chip,
  onChip,
  list,
}: {
  /** The e-mails to list, newest first, already filtered. */
  mails: ReadMail[];
  /** Whether older rows wait behind "Show n older" (not while a filter is on). */
  capped: boolean;
  all: boolean;
  onAll: (all: boolean) => void;
  chips: CueChip[];
  /** The pressed chip. */
  chip: string | null;
  onChip: (label: string | null) => void;
  list: RowContext;
}) {
  const shown = capped && !all ? mails.slice(0, SHOWN) : mails;
  const days: { day: string; mails: ReadMail[] }[] = [];
  for (const mail of shown) {
    const last = days[days.length - 1];
    if (last && last.day === mail.day) last.mails.push(mail);
    else days.push({ day: mail.day, mails: [mail] });
  }
  return (
    <div className="pb-2">
      {chips.length > 0 && (
        <div role="group" aria-label="Show only the e-mails marked" className="flex flex-wrap gap-1.5 px-4 pt-3">
          {chips.map(({ label, count }) => {
            const on = label === chip;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => onChip(on ? null : label)}
                className={`inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-meta font-medium transition-colors duration-150 ${
                  on ? "bg-selected text-primary-hover ring-1 ring-inset ring-primary/40" : "bg-table-head text-ink-heading hover:bg-row-hover hover:text-ink"
                }`}
              >
                {on && <Icon name="check" className="size-3.5" />}
                {label}
                <span className={`font-normal tabular-nums ${on ? "" : "text-ink-muted"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}
      {days.map(({ day, mails: ofDay }, i) => (
        <div key={`${day}-${i}`}>
          <h3 className="px-4 pb-1 pt-3 text-meta font-semibold tabular-nums text-ink-muted">{dayWithWeekday(day, list.today)}</h3>
          <Rows mails={ofDay} list={list} stripe />
        </div>
      ))}
      {capped && mails.length > SHOWN && (
        <div className="px-4 pt-3 pb-1">
          <Button variant="secondary" size="sm" aria-expanded={all} onClick={() => onAll(!all)}>
            {all ? `Show the latest ${SHOWN}` : `Show ${mails.length - SHOWN} older`}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * E-mails filed here that look like another enquiry's: greyed and left out of everything the page reads, each thread
 * under its subject, with the buttons that move them or keep them here.
 */
function SetAside({
  group,
  mails,
  buttons,
  capped,
  full,
  onFull,
  list,
}: {
  group: CrossFiledGroup;
  /** The group's e-mails that pass the filters, newest first. */
  mails: ReadMail[];
  buttons: ActionButton[];
  /** Whether rows beyond the first few wait behind "Show all n" (not while a filter is on). */
  capped: boolean;
  full: boolean;
  onFull: (full: boolean) => void;
  list: RowContext;
}) {
  const threads: { id: string; subject: string; mails: ReadMail[] }[] = [];
  for (const mail of capped && !full ? mails.slice(0, SET_ASIDE_SHOWN) : mails) {
    const last = threads[threads.length - 1];
    if (last && last.id === mail.email.gmail_thread_id) last.mails.push(mail);
    else threads.push({ id: mail.email.gmail_thread_id, subject: mail.email.subject?.trim() || "(no subject)", mails: [mail] });
  }
  const title = group.text.trim() || (group.looksLike ? `Looks like ${group.looksLike}` : "May not belong here");
  return (
    <div className="border-t border-line pb-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-2">
        <p className="flex min-w-0 flex-1 basis-64 items-start gap-2 py-1.5 text-body">
          <Icon name="flag" className="mt-0.5 size-4 text-await" />
          <span className="min-w-0 break-words">
            <strong className="font-semibold text-await">{title}</strong>
            <span className="text-meta text-ink-muted"> · left out of what this page reads</span>
          </span>
        </p>
        {buttons.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {buttons.map((button, i) => (
              <ActionBtn key={`${button.id}-${i}`} button={button} actions={list.actions} size="sm" />
            ))}
          </div>
        )}
      </div>
      {threads.map((thread, i) => (
        <div key={`${thread.id}-${i}`}>
          <p className="truncate px-4 pt-1 text-meta text-ink-muted" title={thread.subject}>
            {thread.subject}
          </p>
          {/* Greyed until one of them is opened to be read. */}
          <Rows mails={thread.mails} list={list} className={thread.mails.some((m) => list.open.has(m.id)) ? "" : "opacity-60"} />
        </div>
      ))}
      {capped && mails.length > SET_ASIDE_SHOWN && (
        <div className="px-4">
          <Button variant="ghost" size="sm" className="-ml-2.5" aria-expanded={full} onClick={() => onFull(!full)}>
            {full ? "Show fewer" : `Show all ${mails.length}`}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The Gmail threads of the conversations, to open in Gmail: a link for one thread, a menu for more. */
function GmailMenu({ sides }: { sides: Side[] }) {
  const seen = new Set<string>();
  const labels = new Set<string>();
  const items: (MenuItem & { url: string })[] = [];
  for (const side of sides) {
    for (const thread of side.threads) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      const subject = thread.subject.length > 64 ? `${thread.subject.slice(0, 63).trimEnd()}…` : thread.subject;
      const base = `${subject || "(no subject)"} · ${side.name} · ${plural(thread.count, "e-mail")}`;
      let label = base;
      for (let n = 2; labels.has(label); n++) label = `${base} (${n})`;
      labels.add(label);
      items.push({ label, icon: "external", url: thread.gmailUrl, onSelect: () => window.open(thread.gmailUrl, "_blank", "noopener,noreferrer") });
    }
  }
  if (!items.length) return null;
  if (items.length === 1) {
    return (
      <a href={items[0].url} target="_blank" rel="noreferrer" aria-label="Open in Gmail" title="Open in Gmail" className={buttonClass("ghost")}>
        Gmail
        <Icon name="external" className="size-3.5" />
      </a>
    );
  }
  return (
    <Menu
      label="Open in Gmail"
      trigger={
        <>
          Gmail
          <Icon name="chevronDown" className="size-3.5" />
        </>
      }
      triggerClassName={buttonClass("ghost")}
      header={<span className="text-meta text-ink-muted">Open a thread in Gmail</span>}
      items={items.map(({ label, icon, onSelect }) => ({ label, icon, onSelect }))}
    />
  );
}

/** A run of chases: the conversations to write to, and the one whose reply is open. */
interface ChaseRun {
  keys: string[];
  at: number;
}

const afterChase = (run: ChaseRun): ChaseRun | null => (run.at + 1 < run.keys.length ? { keys: run.keys, at: run.at + 1 } : null);

/**
 * What the agents were asked and what came back, in one line above their conversations, with the button that opens a
 * reply to each agent with no reply on file, one after the other.
 */
function AgentsLine({
  brief,
  actions,
  targets,
  run,
  onChase,
  onSkip,
  onStop,
}: {
  brief: EnquiryBrief;
  actions: PageActions;
  /** The agents to chase; empty for a reader without the mailbox. */
  targets: Side[];
  /** The chase in progress: which one, of how many, and who. */
  run: { at: number; total: number; name: string } | null;
  onChase: () => void;
  onSkip: () => void;
  onStop: () => void;
}) {
  const text = brief.agentsSummary.text.trim();
  if (!text && !run) return null;
  const parts = text ? text.split(" · ") : [];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border border-line bg-table-head px-3 py-1.5">
      <p className="min-w-0 flex-1 basis-64 break-words py-1 text-meta tabular-nums text-ink-heading">
        {parts.map((part, i) => (
          <span key={i}>
            <ProofLink proof={partProof(part, brief)} actions={actions}>
              {part}
            </ProofLink>
            {i < parts.length - 1 && " · "}
          </span>
        ))}
      </p>
      {run ? (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          <span role="status" className="min-w-0 wrap-anywhere text-meta font-medium tabular-nums text-ink">
            Chasing {run.at + 1} of {run.total} · {run.name}
          </span>
          {run.at + 1 < run.total && (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onStop}>
            Stop
          </Button>
        </div>
      ) : (
        targets.length > 0 && (
          <Button variant="secondary" size="sm" wrap onClick={onChase}>
            {targets.length === 1 ? `Chase ${targets[0].name}` : `Chase those ${targets.length}`}
          </Button>
        )
      )}
    </div>
  );
}

/** What to bring into view once it is on screen: an e-mail's row, or a conversation (its reply box, with reply). */
export type Spot = { mail: string } | { side: string; reply?: boolean };

/**
 * Where a reply that was asked for is brought into view: the view to switch to when the current one does not show
 * its conversation (null when it does; Everything lists rows, not conversations), and the reply box to scroll to,
 * every time, so asking again for a reply already open brings it back into sight. Null without the conversation.
 */
export function replySpot(brief: EnquiryBrief, sideKey: string, view: BoardView, phone: boolean): { view: BoardView | null; spot: Spot } | null {
  const side = brief.sides.find((s) => s.key === sideKey);
  if (!side) return null;
  return { view: view !== "all" && viewHolds(view, side.key) ? null : homeView(side.key, phone), spot: { side: side.key, reply: true } };
}

export interface ConversationBoardProps {
  brief: EnquiryBrief;
  row: EnquiryRow;
  today: string;
  mailbox?: string | null;
  /** The e-mails are still loading. */
  loading: boolean;
  /** Set when the e-mails could not be loaded. */
  error: unknown;
  onRetry?: () => void;
  viewer: Viewer;
  actions: PageActions;
  /** The e-mail to show: the board switches to a view that holds it, expands it and scrolls to it. */
  openMailId: string | null;
  /** The shipment step the e-mails are filtered to. */
  milestoneFilter: MilestoneKey | null;
  onClearMilestone?: () => void;
  /** The reply being written; it opens in the conversation it belongs to. */
  reply: ReplyPrefill | null;
  /**
   * Counts the times a reply was asked for. Asking again for the reply already open (after switching view, or with
   * its box scrolled away) changes nothing else, and still brings the reply back into view.
   */
  replyAsk?: number;
  onCloseReply: () => void;
  onSent: (message: string) => void;
}

/**
 * The enquiry's e-mails as the two conversations they are: the customer's beside the agents', each with whose move it
 * is, or one at a time, or every e-mail in one list. It holds the view, the Find box, the link to Gmail, what was
 * asked of the agents, the e-mails folded away and the ones that look like another enquiry's.
 */
export function ConversationBoard({
  brief,
  row,
  today,
  mailbox,
  loading,
  error,
  onRetry,
  viewer,
  actions,
  openMailId,
  milestoneFilter,
  onClearMilestone,
  reply,
  replyAsk = 0,
  onCloseReply,
  onSent,
}: ConversationBoardProps) {
  const [root, measured] = useSize();
  const size = measured ?? "wide";
  const phone = size === "phone";
  const [choice, setChoice] = useState<BoardView | null>(null);
  const [find, setFind] = useState("");
  const [chip, setChip] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [fullGroups, setFullGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [spot, setSpot] = useState<Spot | null>(null);
  const [chase, setChase] = useState<ChaseRun | null>(null);
  /** The reply of the chase in turn was sent, so its box closing is not the reader giving up. */
  const chaseSent = useRef(false);

  const options = viewOptions(brief, size);
  const view = choice && options.some((o) => o.key === choice) ? choice : startView(brief, phone);
  const customer = brief.sides.find((s) => s.key === "customer") ?? null;
  const internal = brief.sides.find((s) => s.key === "internal") ?? null;
  const column = agentColumn(brief.sides);
  const viewSides = view === "all" ? [] : brief.sides.filter((s) => viewHolds(view, s.key));

  const query = find.trim();
  const step = milestoneFilter ? (brief.journey?.nodes.find((n) => n.key === milestoneFilter) ?? null) : null;
  const stepIds = step ? new Set([...step.emailIds, ...(step.proof ? [step.proof.emailId] : [])]) : null;
  const filtering = !!query || !!stepIds;
  const passes = (mail: ReadMail) => mailMatches(mail, query) && (!stepIds || stepIds.has(mail.id));

  // Everything: what counts and the bounces; the folded e-mails and another enquiry's have their own places below.
  const everything = brief.mails.filter((m) => m.scope === "in" || m.noise === "bounce");
  const listed = everything.filter(passes);
  const chips = cueChips(listed);
  if (chip && !chips.some((c) => c.label === chip)) chips.push({ label: chip, count: 0 });
  const list = chip ? listed.filter((m) => chipsOf(m).includes(chip)) : listed;

  const hiddenHere = brief.hidden.mails.filter((m) => viewHolds(view, m.sideKey));
  const hiddenShown = hiddenHere.filter(passes);
  const hiddenText = hiddenHere.length === brief.hidden.mails.length ? brief.hidden.text.trim() || hiddenLabel(hiddenHere) : hiddenLabel(hiddenHere);
  const groups = brief.crossFiled.map((group) => ({ group, key: groupKey(group), mails: group.mails.filter(passes) })).filter((g) => g.mails.length > 0);

  const inView = view === "all" ? list : viewSides.flatMap((s) => s.mails).filter(passes);
  const found = inView.length > 0 || groups.length > 0 || (showHidden && hiddenShown.length > 0);
  const elsewhere = view === "all" ? 0 : listed.length;
  const nothing =
    found || !(filtering || (view === "all" && chip))
      ? null
      : query
        ? `Nothing ${step ? `about ${step.label}` : elsewhere ? "in this view" : "in these e-mails"} says “${query}”.`
        : step
          ? `No e-mail ${view === "all" ? "" : "in this view "}is about ${step.label}.`
          : `No e-mail here is marked ${chip}.`;

  const compact = phone || (size === "tight" && view === "both");
  const startFolded = foldedKeys(column, phone || size === "stacked");
  const mustShow = (side: Side) => side.mails.some((m) => m.id === openMailId) || reply?.sideKey === side.key || (filtering && side.mails.some(passes));
  const targets = viewer.canReply ? chaseTargets(brief) : [];
  const chasing = chase ? (brief.sides.find((s) => s.key === chase.keys[chase.at]) ?? null) : null;

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pick = (next: BoardView) => {
    setChoice(next);
    setAll(false);
  };

  /** Shows an e-mail: lifts what hides it, switches to a view that holds it, expands it, then scrolls to it. */
  const show = (id: string) => {
    const mail = brief.mails.find((m) => m.id === id);
    if (!mail) return;
    if (!mailMatches(mail, query)) setFind("");
    if (stepIds && !stepIds.has(id)) onClearMilestone?.();
    const next = viewForMail(brief, id, view, phone);
    if (next !== view) setChoice(next);
    if (next === "all") {
      if (chip && !chipsOf(mail).includes(chip)) setChip(null);
      if (everything.findIndex((m) => m.id === id) >= SHOWN) setAll(true);
    }
    if (mail.scope === "cross_filed") {
      const group = brief.crossFiled.find((g) => g.mails.some((m) => m.id === id));
      if (group) setFullGroups((prev) => new Set(prev).add(groupKey(group)));
    }
    if (brief.hidden.mails.some((m) => m.id === id)) setShowHidden(true);
    setOpen((prev) => new Set(prev).add(id));
    setSpot({ mail: id });
  };

  useEffect(() => {
    if (openMailId) show(openMailId);
  }, [openMailId]);

  // A value pressed inside the board shows its e-mail again even when it is the one already asked for.
  const inner: PageActions = {
    ...actions,
    onOpenMail: (id) => {
      actions.onOpenMail(id);
      show(id);
    },
  };

  // A reply opens in its conversation: when the view does not hold it, switch to one that does; either way bring the
  // reply into view, again each time it is asked for.
  useEffect(() => {
    if (!reply) return;
    const to = replySpot(brief, reply.sideKey, view, phone);
    if (!to) return;
    if (to.view) setChoice(to.view);
    setSpot(to.spot);
  }, [reply?.sideKey, reply?.targetEmailId, replyAsk]);

  // A step whose e-mails are all in another view shows in Everything.
  useEffect(() => {
    if (!stepIds || view === "all") return;
    const here = viewSides.some((s) => s.mails.some((m) => stepIds.has(m.id)));
    if (!here && everything.some((m) => stepIds.has(m.id))) setChoice("all");
  }, [milestoneFilter]);

  // Where the views scroll sideways, the chosen one stays in sight.
  useEffect(() => {
    const chosen = document.getElementById(`conversation-view-${view}`);
    const strip = chosen?.parentElement;
    if (!chosen || !strip) return;
    const button = chosen.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    if (button.left < box.left) strip.scrollLeft -= box.left - button.left;
    else if (button.right > box.right) strip.scrollLeft += button.right - box.right;
  }, [view, size]);

  // The row or conversation may only be on screen a frame or two after the view has switched.
  useEffect(() => {
    if (!spot) return;
    let frame = 0;
    let tries = 0;
    const look = () => {
      const wrapper = "mail" in spot ? null : [...(root.current?.querySelectorAll<HTMLElement>("[data-side]") ?? [])].find((e) => e.dataset.side === spot.side);
      // A reply: its box, else (the e-mail to answer is gone) the conversation that says so.
      const box = "mail" in spot || !spot.reply ? null : (wrapper?.querySelector<HTMLElement>("[data-reply-box]") ?? null);
      const el = "mail" in spot ? document.getElementById(`mail-${spot.mail}`) : (box ?? wrapper);
      if (!el) {
        if (++tries < 20) frame = requestAnimationFrame(look);
        return;
      }
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "mail" in spot ? "center" : "nearest" });
      if ("mail" in spot) el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      else box?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [spot]);

  // The chase in turn: the page opens a reply to that agent, with the chase text as its message.
  useEffect(() => {
    if (!chase) return;
    const side = brief.sides.find((s) => s.key === chase.keys[chase.at]);
    if (!side) {
      setChase(afterChase(chase));
      return;
    }
    chaseSent.current = false;
    const text = brief.copy.chase[side.key];
    actions.onAction({ id: "reply", label: `Chase ${side.name}`, variant: "secondary", sideKey: side.key, ...(text ? { copyText: text } : {}) });
  }, [chase]);

  const inChase = !!chase && reply?.sideKey === chase.keys[chase.at];
  const sentReply = (message: string) => {
    onSent(message);
    if (chase && inChase) {
      chaseSent.current = true;
      setChase(afterChase(chase));
    }
  };
  const closeReply = () => {
    onCloseReply();
    if (inChase && !chaseSent.current) setChase(null);
  };

  /** Left and Right, Home and End move along the views; Enter or Space picks the one in focus. */
  function onSwitchKey(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const at = buttons.findIndex((b) => b === document.activeElement);
    const to =
      event.key === "ArrowRight" ? Math.min(buttons.length - 1, at + 1) : event.key === "ArrowLeft" ? Math.max(0, at - 1) : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (at < 0 || to < 0) return;
    event.preventDefault();
    buttons[to].focus();
  }

  const rows: RowContext = {
    row,
    today,
    mailbox,
    viewer,
    compact: phone,
    actions: inner,
    open,
    onToggle: toggle,
    // Another enquiry's e-mail and a bounce belong to no conversation here.
    sideOf: (mail) => (mail.scope === "cross_filed" || mail.noise === "bounce" ? null : (brief.sides.find((s) => s.key === mail.sideKey) ?? null)),
  };

  const conversation = (side: Side) => (
    <div key={side.key} data-side={side.key} className="min-w-0 scroll-mt-16">
      <ConversationSide
        side={side}
        brief={brief}
        row={row}
        today={today}
        mailbox={mailbox}
        viewer={viewer}
        compact={compact}
        folded={startFolded.has(side.key) && !mustShow(side)}
        actions={inner}
        openMailId={openMailId}
        milestoneFilter={milestoneFilter}
        find={query}
        reply={reply && reply.sideKey === side.key ? reply : null}
        onCloseReply={closeReply}
        onSent={sentReply}
      />
    </div>
  );
  const customerSide = customer ? (
    conversation(customer)
  ) : (
    <p className="text-body text-ink-muted">No written word from {displayName(row.customer_name) || "the customer"} on file.</p>
  );
  const agentSides = (
    <>
      {(column.filter((s) => s.kind === "agent").length > 1 || chase) && (
        <AgentsLine
          brief={brief}
          actions={inner}
          targets={targets}
          run={chase ? { at: chase.at, total: chase.keys.length, name: chasing?.name ?? chase.keys[chase.at] } : null}
          onChase={() => setChase({ keys: targets.map((s) => s.key), at: 0 })}
          onSkip={() => chase && setChase(afterChase(chase))}
          onStop={() => setChase(null)}
        />
      )}
      {column.map(conversation)}
      {!column.length && (
        <p className="break-words text-body text-ink-muted">
          No agent has written yet. If agents were asked from another mailbox, copy {mailbox || "the pricing mailbox"} so their replies are filed here.
        </p>
      )}
    </>
  );

  const total = brief.mails.length;
  const waiting = loading && !total;

  return (
    <section
      id="conversation"
      ref={root}
      aria-labelledby="conversation-title"
      aria-busy={loading || undefined}
      className="@container scroll-mt-16 rounded-panel border border-line bg-surface"
    >
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <h2 id="conversation-title" className="text-body font-semibold text-ink">
          Conversation
          {total > 0 && (
            <span className="font-normal tabular-nums text-ink-muted">
              {" · "}
              {plural(total, "e-mail")}
              {brief.hidden.mails.length > 0 && ` · ${brief.hidden.mails.length} hidden`}
            </span>
          )}
        </h2>
        {total > 0 && (
          <>
            <div
              role={phone ? "tablist" : "group"}
              aria-label="View"
              onKeyDown={onSwitchKey}
              className="flex max-w-full gap-0.5 overflow-x-auto rounded-control border border-line p-0.5"
            >
              {options.map((option) => {
                const on = option.key === view;
                return (
                  <button
                    key={option.key}
                    id={`conversation-view-${option.key}`}
                    type="button"
                    role={phone ? "tab" : undefined}
                    aria-selected={phone ? on : undefined}
                    aria-controls={phone ? "conversation-panel" : undefined}
                    aria-pressed={phone ? undefined : on}
                    tabIndex={on ? 0 : -1}
                    onClick={() => pick(option.key)}
                    className={`h-7.5 shrink-0 whitespace-nowrap rounded-[5px] px-2.5 text-control transition-colors duration-150 focus-visible:-outline-offset-2 ${
                      on ? "bg-selected font-semibold text-primary-hover" : "font-medium text-ink-muted hover:bg-row-hover hover:text-ink"
                    }`}
                  >
                    {option.label}
                    {option.count != null && <span className="tabular-nums"> · {option.count}</span>}
                  </button>
                );
              })}
            </div>
            {/* Beside the views where the board is wide enough for one row; under them, from the left, where it is not. */}
            <div className="flex min-w-0 flex-1 basis-full items-center gap-2 @min-[1000px]:basis-48 @min-[1000px]:justify-end">
              <label className="relative min-w-0 flex-1 @min-[640px]:max-w-80 @min-[1000px]:max-w-56">
                <span className="sr-only">Find in the e-mails</span>
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
                <input type="search" className={`${inputClass} pl-8`} placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
              </label>
              {viewer.canReply && <GmailMenu sides={brief.sides} />}
            </div>
          </>
        )}
      </header>

      {!!error && (
        <div className="px-4 pt-4 last:pb-4">
          <Alert
            action={
              onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  <Icon name="refresh" className="size-3.5" />
                  Try again
                </Button>
              )
            }
          >
            The e-mails could not be loaded. {errorMessage(error)}
          </Alert>
        </div>
      )}

      {waiting ? (
        <div className="px-4">
          <Spinner label="Loading e-mails…" />
        </div>
      ) : !total ? (
        !error && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
            <p className="min-w-0 flex-1 basis-64 break-words text-body text-ink-muted">
              No e-mails are filed here yet. Mail whose subject carries <span className="font-medium tabular-nums text-ink-heading">{row.reference}</span> is added
              automatically.
            </p>
            <ActionBtn
              button={{ id: "copy", label: "Copy reference", variant: "secondary", copyText: row.reference, copiedToast: `${row.reference} copied.` }}
              actions={actions}
              size="sm"
            />
          </div>
        )
      ) : (
        <div id="conversation-panel" role={phone ? "tabpanel" : undefined} aria-labelledby={phone ? `conversation-view-${view}` : undefined}>
          {(step || nothing) && (
            <div className="space-y-1 border-b border-line bg-table-head px-4 py-1.5">
              {step && (
                <div className="flex flex-wrap items-center gap-x-2">
                  <p className="py-1.5 text-meta text-ink-heading">
                    Showing the e-mails about <span className="font-semibold text-ink">{step.label}</span>
                  </p>
                  {onClearMilestone && (
                    <Button variant="ghost" size="sm" onClick={onClearMilestone}>
                      Clear
                      <span className="sr-only"> the step, to show every e-mail</span>
                    </Button>
                  )}
                </div>
              )}
              {nothing && (
                <div className="flex flex-wrap items-center gap-x-2">
                  <p role="status" className="min-w-0 break-words py-1.5 text-meta text-ink-heading">
                    {nothing}
                  </p>
                  {elsewhere > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => pick("all")}>
                      Show {elsewhere} in Everything
                    </Button>
                  )}
                  {(query || chip) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFind("");
                        setChip(null);
                      }}
                    >
                      Clear
                      <span className="sr-only"> the filter</span>
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {view === "both" && (
            <div className="grid items-start gap-4 p-4 @min-[880px]:grid-cols-2">
              <div className="min-w-0">{customerSide}</div>
              <div className="min-w-0 space-y-3">{agentSides}</div>
            </div>
          )}
          {view === "customer" && <div className="p-4">{customerSide}</div>}
          {view === "agents" && <div className="space-y-3 p-4">{agentSides}</div>}
          {view === "ours" && internal && <div className="p-4">{conversation(internal)}</div>}
          {view === "all" && (
            <EverythingList mails={list} capped={!filtering && !chip} all={all} onAll={setAll} chips={chips} chip={chip} onChip={setChip} list={rows} />
          )}

          {groups.map(({ group, key, mails }) => (
            <SetAside
              key={key}
              group={group}
              mails={mails}
              buttons={setAsideButtons(group, brief.flags, viewer)}
              capped={!filtering}
              full={fullGroups.has(key)}
              onFull={(full) =>
                setFullGroups((prev) => {
                  const next = new Set(prev);
                  if (full) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
              list={rows}
            />
          ))}

          {hiddenText && (filtering ? hiddenShown.length > 0 : hiddenHere.length > 0) && (
            <div className="border-t border-line">
              <div className="flex flex-wrap items-center gap-x-2 px-4 py-1">
                <p className="py-1.5 text-meta text-ink-muted">{hiddenText}</p>
                <Button variant="ghost" size="sm" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                  {showHidden ? "Hide" : "Show"}
                  <span className="sr-only"> the hidden e-mails</span>
                </Button>
              </div>
              {showHidden && <Rows mails={hiddenShown} list={rows} className="pb-2" />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
