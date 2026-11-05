import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { Link, useSearchParams } from "react-router";
import { AttachmentLink, shownName } from "../../components/EmailView";
import { Icon, type IconName } from "../../components/icons";
import { StatusBadge, inputClass } from "../../components/ui";
import { decodeEntities, muscatTime, senderName } from "../../lib/conversations";
import { initials, shipmentLabel, shortPort, TRADE_LABELS } from "../../lib/display";
import { gmailThreadUrl, splitBody } from "../../lib/emailDrafts";
import type { EmailMessage, EnquiryRow, ShipmentMode, TradeType } from "../../lib/types";

// The pieces every Inbox tab is built from: a list panel on the left, the selected item in a reading pane
// on the right (header card, then a body whose middle scrolls between a title bar and pinned actions).

export const refClass = "font-semibold tabular-nums text-primary hover:text-primary-hover hover:underline";

const MODE_STYLE: Record<ShipmentMode, { tile: string; label: string }> = {
  FCL: { tile: "bg-mode-fcl-bg text-mode-fcl", label: "FCL" },
  LCL: { tile: "bg-mode-lcl-bg text-mode-lcl", label: "LCL" },
  AIR: { tile: "bg-mode-air-bg text-mode-air", label: "AIR" },
  COURIER: { tile: "bg-mode-courier-bg text-mode-courier", label: "CRR" },
  RORO: { tile: "bg-mode-other-bg text-mode-other", label: "RORO" },
  BREAK_BULK: { tile: "bg-mode-other-bg text-mode-other", label: "BB" },
  MULTI: { tile: "bg-mode-other-bg text-mode-other", label: "MIX" },
  OTHER: { tile: "bg-mode-other-bg text-mode-other", label: "OTH" },
};
const NO_MODE = { tile: "bg-mode-other-bg text-mode-other", label: "—" };

const tileSize = (size: "md" | "lg") => (size === "lg" ? "size-13 text-meta" : "size-10 text-[11px]");

export function ModeTile({ mode, size = "md" }: { mode: ShipmentMode | null | undefined; size?: "md" | "lg" }) {
  const m = mode ? MODE_STYLE[mode] : NO_MODE;
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-control font-bold ${m.tile} ${tileSize(size)}`}>
      {m.label}
    </span>
  );
}

/** A square tile with an icon, for rows that have no shipment mode yet. */
export function IconTile({ icon, className, size = "md" }: { icon: IconName; className: string; size?: "md" | "lg" }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-control ${className} ${tileSize(size)}`}>
      <Icon name={icon} className={size === "lg" ? "size-6" : "size-5"} />
    </span>
  );
}

const AVATAR = {
  external: "bg-mode-fcl-bg text-mode-fcl",
  staff: "bg-selected text-primary",
  self: "bg-table-head text-ink-heading",
};

export function Avatar({ name, type, className = "size-8 text-[11px]" }: { name: string; type: EmailMessage["sender_type"]; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${AVATAR[type]} ${className}`}>
      {initials(name.replace(/[^\p{L}\p{N}\s]/gu, " "))}
    </span>
  );
}

/** Up to three senders as overlapping avatars. */
export function People({ emails }: { emails: EmailMessage[] }) {
  const people = emails.filter((e, i, a) => a.findIndex((x) => senderName(x) === senderName(e)) === i).slice(0, 3);
  return (
    <span className="flex">
      {people.map((e, i) => (
        <Avatar key={e.id} name={senderName(e)} type={e.sender_type} className={`size-7 text-[10px] ring-2 ring-surface ${i ? "-ml-2" : ""}`} />
      ))}
    </span>
  );
}

export function route(e: Pick<EnquiryRow, "pol" | "pod" | "subject" | "shipment_mode" | "qty_text"> | undefined): string {
  if (!e) return "";
  const from = shortPort(e.pol);
  const to = shortPort(e.pod);
  const r = from || to ? `${from || "?"} → ${to || "?"}` : (e.subject ?? "");
  const what = shipmentLabel(e);
  return what ? `${r} · ${what}` : r;
}

/** "Zhejiang ····> Muscat  Courier · Import" */
export function RouteLine({ pol, pod, extra }: { pol: string | null | undefined; pod: string | null | undefined; extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-body text-ink-heading">
      <span className="font-semibold">{shortPort(pol) || "?"}</span>
      <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true" className="text-primary">
        <path d="M0 6h32" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
        <path d="m30 2 6 4-6 4" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span className="font-semibold">{shortPort(pod) || "?"}</span>
      {extra && <span className="text-ink-muted">{extra}</span>}
    </div>
  );
}

export function shipmentExtra(e: { shipment_mode?: ShipmentMode | null; qty_text?: string | null; trade_type?: TradeType | null }): string {
  return [shipmentLabel({ shipment_mode: e.shipment_mode ?? null, qty_text: e.qty_text ?? null }), e.trade_type ? TRADE_LABELS[e.trade_type] : null]
    .filter(Boolean)
    .join(" · ");
}

/** Small rounded label used on rows and headers. */
export function Tag({ className, children, title, icon }: { className: string; children: ReactNode; title?: string; icon?: IconName }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap tabular-nums ${className}`}>
      {icon && <Icon name={icon} className="size-3" />}
      {children}
    </span>
  );
}

// --- Layout ----------------------------------------------------------------------

/** List beside reading pane. From lg up it fills the height InboxPage gives it and each side scrolls on its own. */
export function SplitView({ list, pane, paneRef }: { list: ReactNode; pane: ReactNode; paneRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
      <section aria-label="List" className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface lg:w-[42%] lg:shrink-0">
        {list}
      </section>
      <div ref={paneRef} className="min-w-0 flex-1 scroll-mt-16 lg:flex lg:min-h-0 lg:flex-col">
        {pane}
      </div>
    </div>
  );
}

/** The toolbar row, then a slim summary line. */
export function ListHead({ tools, chips, summary, tags }: { tools: ReactNode; chips?: ReactNode; summary: ReactNode; tags?: ReactNode }) {
  return (
    <div className="border-b border-line px-3 pt-3 pb-2">
      <div className="flex flex-wrap items-center gap-2">{tools}</div>
      {chips && <div className="mt-2 flex flex-wrap items-center gap-1.5">{chips}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
        {summary}
        {tags && <span className="ml-auto flex items-center gap-1">{tags}</span>}
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative min-w-48 flex-1">
      <span className="sr-only">Search</span>
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
      <input type="search" className={`${inputClass} pl-8`} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A row of the list: tile, three lines, and a column on the right. */
export function ListRow({
  active,
  onPick,
  tile,
  top,
  time,
  line2,
  line3,
  side,
}: {
  active: boolean;
  onPick: () => void;
  tile: ReactNode;
  top: ReactNode;
  time: ReactNode;
  line2: ReactNode;
  line3: ReactNode;
  side: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active || undefined}
        onClick={onPick}
        className={`flex w-full gap-3 px-3 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
          active ? "bg-selected shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-row-hover"
        }`}
      >
        {tile}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            {top}
            <span className="ml-auto shrink-0 text-meta tabular-nums text-ink-muted">{time}</span>
          </span>
          <span className="truncate text-meta font-semibold text-ink-heading">{line2}</span>
          <span className="truncate text-meta text-ink-muted">{line3}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">{side}</span>
      </button>
    </li>
  );
}

/** A sticky day heading inside the list. */
export function DayHeading({ label, count }: { label: string; count: number }) {
  return (
    <li className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-table-head px-3 py-1.5 text-meta font-semibold text-ink-heading">
      {label}
      <span className="font-normal text-ink-muted tabular-nums">{count}</span>
    </li>
  );
}

/** The header card of the reading pane. */
export function PaneHeader({ tile, children, facts }: { tile: ReactNode; children: ReactNode; facts: [string, ReactNode][] }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3">
      {tile}
      <div className="min-w-60 flex-1 space-y-1">{children}</div>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-meta">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="font-semibold text-ink">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The body card: a title bar, the scrolling middle, and the actions pinned at the bottom. */
export function PaneBody({
  title,
  aside,
  children,
  actions,
  scrollRef,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-panel border border-line bg-surface lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-body font-semibold text-ink">{title}</h2>
        {aside && <span className="text-meta text-ink-muted">{aside}</span>}
      </div>
      <div ref={scrollRef} className="space-y-3 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children, line = true }: { children: ReactNode; line?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-[11px] font-bold tracking-wide text-ink-muted uppercase">
      {line && <span className="h-px flex-1 bg-line" />}
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function PanePlaceholder({ children }: { children: ReactNode }) {
  return <div className="hidden rounded-panel border border-dashed border-line p-10 text-center text-body text-ink-muted lg:block">{children}</div>;
}

/** An enquiry the e-mail may belong to, with why we think so and the button that files it there. */
export function EnquiryChoice({ enquiry, reasons, best, action }: { enquiry: EnquiryRow; reasons: string[]; best: boolean; action: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-panel border bg-surface px-3 py-2.5 sm:flex-nowrap ${best ? "border-primary ring-3 ring-selected" : "border-line"}`}>
      <ModeTile mode={enquiry.shipment_mode} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link to={`/enquiries/${enquiry.id}`} className={refClass}>
            {enquiry.reference}
          </Link>
          <StatusBadge status={enquiry.status} />
          <span className="truncate text-meta text-ink-muted">{shownName(enquiry.customer_name)}</span>
        </div>
        <div className="truncate text-meta font-semibold text-ink-heading">{route(enquiry)}</div>
        <div className="text-[12px] text-ink-muted">{reasons.join(" · ")}</div>
      </div>
      {action}
    </div>
  );
}

// --- E-mails ----------------------------------------------------------------------

const SENDER_TAG = {
  external: { label: "External", className: "bg-table-head text-ink-heading" },
  staff: { label: "Colleague", className: "bg-surface text-primary" },
  self: { label: "Pricing mailbox", className: "bg-surface text-ink-muted" },
};

/** One e-mail as a chat bubble: theirs on the left, ours on the right. */
export function Bubble({
  email,
  mailbox,
  onUnlink,
  unlinking = false,
  sentBy,
  onReply,
}: {
  email: EmailMessage;
  mailbox?: string;
  /** Shows "Wrong enquiry" (Follow-up e-mails). */
  onUnlink?: () => void;
  unlinking?: boolean;
  /** Who sent it from the app, when it was. */
  sentBy?: string;
  /** Shows "Reply" (Follow-up e-mails). */
  onReply?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [quoted, setQuoted] = useState(false);
  const body = splitBody(email.body_text);
  const text = decodeEntities(body.text);
  const earlier = decodeEntities(body.earlier);
  const long = text.length > 700;
  const ours = email.sender_type !== "external";
  const name = senderName(email);
  const tag = SENDER_TAG[email.sender_type];
  return (
    <div className={`flex items-start gap-2.5 ${ours ? "flex-row-reverse" : ""}`}>
      <Avatar name={name} type={email.sender_type} className="size-9 text-meta" />
      <div className={`min-w-0 max-w-[85%] rounded-panel border px-3.5 py-2.5 ${ours ? "rounded-tr-sm border-selected bg-selected/70" : "rounded-tl-sm border-line bg-surface"}`}>
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-meta font-bold text-ink" title={email.from_email ?? undefined}>
            {name}
          </span>
          <span className={`rounded-full px-1.5 text-[11px] font-semibold ${tag.className}`}>{tag.label}</span>
          {sentBy && <span className="rounded-full bg-surface px-1.5 text-[11px] font-semibold text-primary">sent from the app by {sentBy}</span>}
          <span className="ml-auto text-meta tabular-nums text-ink-muted">{muscatTime(email.received_at)}</span>
        </div>
        {text ? (
          <div className="text-body whitespace-pre-wrap break-words text-ink">
            {long && !expanded ? `${text.slice(0, 700)}…` : text}
            {long && (
              <button type="button" className="ml-1 text-meta text-primary hover:underline" onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show less" : "Show all"}
              </button>
            )}
          </div>
        ) : (
          <div className="text-body text-ink-muted italic">No new text (forward or reply only).</div>
        )}
        {email.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {email.attachments.map((a, i) => (
              <AttachmentLink key={`${a.filename}-${i}`} file={a} />
            ))}
          </div>
        )}
        {quoted && earlier && (
          <div className="mt-2 max-h-80 overflow-auto border-l-2 border-line pl-3 text-meta whitespace-pre-wrap break-words text-ink-muted">{earlier}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-meta">
          {onReply && (
            <button type="button" className="font-medium text-primary hover:underline" onClick={onReply}>
              Reply
            </button>
          )}
          {earlier && (
            <button type="button" className="text-primary hover:underline" aria-expanded={quoted} onClick={() => setQuoted(!quoted)}>
              {quoted ? "Hide quoted history" : "Quoted history"}
            </button>
          )}
          <a href={gmailThreadUrl(email.gmail_thread_id, mailbox)} target="_blank" rel="noreferrer" className="text-ink-muted hover:text-primary hover:underline">
            Gmail
          </a>
          {onUnlink && (
            <button
              type="button"
              disabled={unlinking}
              className="text-ink-muted hover:text-lost hover:underline disabled:opacity-50"
              title="This e-mail is not about this enquiry: send it back to Needs review"
              onClick={onUnlink}
            >
              {unlinking ? "Unlinking…" : "Wrong enquiry"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- URL state ----------------------------------------------------------------------

/** The tab's filters live in the address; `update` changes some and keeps the rest. */
export function useInboxParams() {
  const [params, setParams] = useSearchParams();
  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    setParams(next, { replace: true });
  }
  return { params, update };
}

/** Search as you type into ?q=, once typing pauses. */
export function useTypedSearch(q: string, update: (changes: Record<string, string>) => void) {
  const [typed, setTyped] = useState(q);
  useEffect(() => {
    if (typed.trim() === q) return;
    const t = setTimeout(() => update({ q: typed.trim(), e: "" }), 300);
    return () => clearTimeout(t);
  }, [typed]);
  return [typed, setTyped] as const;
}

/** Case-insensitive "every word appears somewhere in these texts". */
export function matches(q: string, ...texts: (string | null | undefined)[]): boolean {
  if (!q) return true;
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/** Scroll the reading pane into view on a phone after picking a row. */
export function revealPane(ref: RefObject<HTMLDivElement | null>) {
  if (window.innerWidth < 1024) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}
