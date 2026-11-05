import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { AttachmentLink, shownName } from "../../components/EmailView";
import { Icon } from "../../components/icons";
import { Alert, Button, Empty, Spinner, StatusBadge, buttonClass, inputClass } from "../../components/ui";
import { checkMailNow, fetchEmailReplies, fetchEnquiriesByIds, fetchEnquiryEmails, fetchFollowUpHistory, fetchProfileNames, linkEmail, logFollowUp, searchEmails, undoFollowUp } from "../../lib/api";
import {
  dayLabel,
  decodeEntities,
  groupByEnquiry,
  modeGroup,
  muscatTime,
  rowSubject,
  senderName,
  type Conversation,
  type ModeFilter,
} from "../../lib/conversations";
import { initials, shipmentLabel, shortPort, TRADE_LABELS } from "../../lib/display";
import { DayPicker, FilterTags, FiltersMenu, ViewToggle } from "./ListToolbar";
import { ReplyBox } from "./ReplyBox";
import { gmailThreadUrl, muscatDate, splitBody } from "../../lib/emailDrafts";
import { errorMessage } from "../../lib/format";
import type { EmailMessage, EmailReply, EnquiryRow, ShipmentMode } from "../../lib/types";

/** The most e-mails one day (or one search) loads; a busy day is a few hundred. */
const DAY_LIMIT = 500;

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

const AVATAR = {
  external: "bg-mode-fcl-bg text-mode-fcl",
  staff: "bg-selected text-primary",
  self: "bg-table-head text-ink-heading",
};

function ModeTile({ mode, size = "md" }: { mode: ShipmentMode | null | undefined; size?: "md" | "lg" }) {
  const m = mode ? MODE_STYLE[mode] : NO_MODE;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-control font-bold ${m.tile} ${size === "lg" ? "size-13 text-meta" : "size-10 text-[11px]"}`}
    >
      {m.label}
    </span>
  );
}

function Avatar({ name, type, className = "size-8 text-[11px]" }: { name: string; type: EmailMessage["sender_type"]; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${AVATAR[type]} ${className}`}>
      {initials(name.replace(/[^\p{L}\p{N}\s]/gu, " "))}
    </span>
  );
}

function route(e: EnquiryRow | undefined): string {
  if (!e) return "";
  const from = shortPort(e.pol);
  const to = shortPort(e.pod);
  const r = from || to ? `${from || "?"} → ${to || "?"}` : (e.subject ?? "");
  const what = shipmentLabel(e);
  return what ? `${r} · ${what}` : r;
}

/** Follow-up e-mails, one row per enquiry, the selected conversation open beside the list. */
export function Conversations({ mailbox, onNotice, listView }: { mailbox?: string; onNotice: (n: ReactNode) => void; listView: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const today = muscatDate(new Date().toISOString());
  const view = params.get("view") === "list" ? "list" : "threads";
  const q = params.get("q") ?? "";
  const day = params.get("day") || today;
  const sender = (params.get("sender") ?? "") as "" | "external" | "staff";
  const mode = (params.get("mode") ?? "") as "" | ModeFilter;
  const filesOnly = params.get("files") === "1";
  const [typed, setTyped] = useState(q);
  const paneRef = useRef<HTMLDivElement>(null);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    setParams(next, { replace: true });
  }

  useEffect(() => {
    if (typed.trim() === q) return;
    const t = setTimeout(() => update({ q: typed.trim(), e: "" }), 350);
    return () => clearTimeout(t);
  }, [typed]);

  const search = { status: "linked" as const, q, sender, from: q ? "" : day, to: q ? "" : day, page: 0, pageSize: DAY_LIMIT };
  const emails = useQuery({
    queryKey: ["inbox", "history", "threads", search],
    queryFn: () => searchEmails(search),
    placeholderData: keepPreviousData,
    refetchInterval: day === today ? 60_000 : false,
    enabled: view === "threads",
  });
  const all = useMemo(() => groupByEnquiry(emails.data?.rows ?? []), [emails.data]);
  const ids = all.map((c) => c.enquiryId);
  const enquiries = useQuery({
    queryKey: ["inbox", "conversation-enquiries", ids],
    queryFn: () => fetchEnquiriesByIds(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const byId = useMemo(() => new Map((enquiries.data ?? []).map((e) => [e.id, e])), [enquiries.data]);

  const shown = all.filter(
    (c) => (!mode || modeGroup(byId.get(c.enquiryId)?.shipment_mode) === mode) && (!filesOnly || c.attachments > 0),
  );
  const selected = shown.find((c) => c.enquiryId === params.get("e")) ?? shown[0];
  const mailCount = shown.reduce((n, c) => n + c.emails.length, 0);
  const filtered = Boolean(q || sender || mode || filesOnly);

  function pick(c: Conversation) {
    update({ e: c.enquiryId });
    if (window.innerWidth < 1024) setTimeout(() => paneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  if (view === "list")
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end gap-2 text-meta text-ink-muted">
          Every e-mail, newest first
          <ViewToggle view={view} onChange={(v) => update({ view: v === "threads" ? "" : v })} />
        </div>
        {listView}
      </div>
    );

  return (
    // From lg up the view fills the rest of the screen (InboxPage gives it the height) and the list and the
    // conversation each scroll on their own; on a phone the page scrolls as usual.
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
      {/* Conversation list */}
      <section aria-label="Conversations" className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface lg:w-[42%] lg:shrink-0">
        {/* One toolbar row, then a slim summary line with the filters in use */}
        <div className="border-b border-line px-3 pt-3 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <span className="sr-only">Search e-mails</span>
              <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                className={`${inputClass} pl-8`}
                placeholder="Search subject, sender or SL reference"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            <DayPicker day={day} today={today} sender={sender} searching={!!q} onPick={(d) => update({ day: d >= today ? "" : d, e: "" })} />
            <FiltersMenu sender={sender} filesOnly={filesOnly} mode={mode} onChange={(c) => update({ ...c, e: "" })} />
            <ViewToggle view={view} onChange={(v) => update({ view: v === "threads" ? "" : v })} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
            <span className="font-semibold text-ink">
              {emails.isLoading
                ? "Loading…"
                : `${shown.length} enquir${shown.length === 1 ? "y" : "ies"} · ${mailCount} e-mail${mailCount === 1 ? "" : "s"}`}
            </span>
            {q && <span className="text-ink-muted">matching “{q}”</span>}
            {emails.isFetching && !emails.isLoading && <span className="text-ink-muted">· updating…</span>}
            <span className="ml-auto flex items-center gap-1">
              <FilterTags sender={sender} filesOnly={filesOnly} mode={mode} onChange={(c) => update({ ...c, e: "" })} />
              {filtered && (
                <button
                  type="button"
                  className="px-1 text-[11px] font-semibold text-primary hover:underline"
                  onClick={() => {
                    setTyped("");
                    update({ q: "", sender: "", mode: "", files: "", e: "" });
                  }}
                >
                  Clear all
                </button>
              )}
            </span>
          </div>
        </div>

        {emails.error ? (
          <div className="p-3">
            <Alert action={<Button variant="secondary" size="sm" onClick={() => emails.refetch()}>Try again</Button>}>
              Loading the e-mails failed. {errorMessage(emails.error)}
            </Alert>
          </div>
        ) : emails.isLoading ? (
          <Spinner />
        ) : !shown.length ? (
          <div className="p-3">
            <Empty>{filtered ? "No conversations match. Try fewer filters." : `No follow-up e-mails ${day === today ? "yet today" : "on this day"}.`}</Empty>
          </div>
        ) : (
          <ul className={`min-h-0 flex-1 divide-y divide-line overflow-y-auto ${emails.isPlaceholderData ? "opacity-60" : ""}`}>
            {shown.map((c) => (
              <ConversationRow key={c.enquiryId} conv={c} enquiry={byId.get(c.enquiryId)} active={c === selected} searching={!!q} onPick={() => pick(c)} />
            ))}
          </ul>
        )}
        {(emails.data?.rows.length ?? 0) >= DAY_LIMIT && (
          <p className="border-t border-line px-3 py-2 text-meta text-ink-muted">
            Showing the latest {DAY_LIMIT} e-mails. Narrow the search, or use “Every e-mail” to page through all of them.
          </p>
        )}
      </section>

      {/* Reading pane */}
      <div ref={paneRef} className="min-w-0 flex-1 scroll-mt-16 lg:flex lg:min-h-0 lg:flex-col">
        {selected ? (
          <ConversationPane key={selected.enquiryId} conv={selected} enquiry={byId.get(selected.enquiryId)} mailbox={mailbox} onNotice={onNotice} />
        ) : (
          !emails.isLoading && (
            <div className="hidden rounded-panel border border-dashed border-line p-10 text-center text-body text-ink-muted lg:block">Pick a conversation to read it.</div>
          )
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  conv,
  enquiry,
  active,
  searching,
  onPick,
}: {
  conv: Conversation;
  enquiry?: EnquiryRow;
  active: boolean;
  searching: boolean;
  onPick: () => void;
}) {
  const last = conv.latest;
  const text = decodeEntities(last.summary || last.snippet || "").replace(/\s+/g, " ").trim() || rowSubject(last.subject, conv.reference);
  const n = conv.emails.length;
  const busy = n >= 4;
  const people = conv.emails.filter((e, i, a) => a.findIndex((x) => senderName(x) === senderName(e)) === i).slice(0, 3);
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
        <ModeTile mode={enquiry?.shipment_mode} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="text-body font-bold tabular-nums text-primary">{conv.reference}</span>
            {enquiry && (
              <span className="max-sm:hidden">
                <StatusBadge status={enquiry.status} />
              </span>
            )}
            <span className="ml-auto shrink-0 text-meta tabular-nums text-ink-muted">
              {searching ? dayLabel(muscatDate(last.received_at), muscatDate(new Date().toISOString())) + " " : ""}
              {muscatTime(last.received_at)}
            </span>
          </span>
          <span className="truncate text-meta font-semibold text-ink-heading">{route(enquiry) || rowSubject(last.subject, conv.reference)}</span>
          <span className="truncate text-meta text-ink-muted">
            <span className="font-semibold text-ink">{senderName(last)}:</span> {text}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap tabular-nums ${
              busy ? "bg-lane-mail text-white" : "bg-lane-mail-bg text-lane-mail"
            }`}
          >
            {n} {searching ? "found" : "new"}
          </span>
          <span className="flex">
            {people.map((e, i) => (
              <Avatar key={e.id} name={senderName(e)} type={e.sender_type} className={`size-7 text-[10px] ring-2 ring-surface ${i ? "-ml-2" : ""}`} />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

function ConversationPane({ conv, enquiry, mailbox, onNotice }: { conv: Conversation; enquiry?: EnquiryRow; mailbox?: string; onNotice: (n: ReactNode) => void }) {
  const { canEdit, profile } = useAuth();
  const queryClient = useQueryClient();
  const [showEarlier, setShowEarlier] = useState(false);
  const today = muscatDate(new Date().toISOString());
  const scroller = useRef<HTMLDivElement>(null);
  /** Distance from the bottom to keep when earlier e-mails are added above (null: jump to the newest). */
  const keepFromBottom = useRef<number | null>(null);

  const thread = useQuery({ queryKey: ["enquiry-emails", conv.enquiryId], queryFn: () => fetchEnquiryEmails(conv.enquiryId) });

  // Open at the newest e-mail, like a chat; showing earlier ones keeps the current view in place.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight - (keepFromBottom.current ?? 0);
    keepFromBottom.current = null;
  }, [thread.isSuccess, showEarlier]);

  function toggleEarlier() {
    const el = scroller.current;
    keepFromBottom.current = showEarlier ? null : el ? el.scrollHeight - el.scrollTop : null;
    setShowEarlier(!showEarlier);
  }
  const messages = thread.data ?? [...conv.emails].reverse();
  // Open at the first e-mail of the day (or search hit) being looked at; anything before folds away.
  const firstShown = conv.emails.at(-1)!.received_at;
  const earlier = messages.filter((m) => m.received_at < firstShown);
  const visible = showEarlier ? messages : messages.filter((m) => m.received_at >= firstShown);
  const files = messages.reduce((n, m) => n + m.attachments.length, 0);
  const latest = messages.at(-1) ?? conv.latest;

  const me = profile?.sales_person_id ?? null;
  const history = useQuery({
    queryKey: ["follow-ups", "log", [conv.enquiryId]],
    queryFn: () => fetchFollowUpHistory([conv.enquiryId]),
    enabled: !!me,
  });
  const chasedToday = (history.data ?? []).some((h) => h.sales_person_id === me && h.followed_up_on === today);
  const chase = useMutation({
    mutationFn: (done: boolean) => (done ? logFollowUp : undoFollowUp)(conv.enquiryId, me as string, today),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
      void queryClient.invalidateQueries({ queryKey: ["window"] });
    },
  });

  const unlink = useMutation({
    mutationFn: (emailId: string) => linkEmail(emailId, null),
    onSuccess: () => {
      onNotice("Moved to “Needs review”.");
      for (const key of ["inbox", "enquiry-emails", "register", "dashboard", "window"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  // Replying from the app: which e-mail is being answered, and whether to everyone on it.
  const [reply, setReply] = useState<{ target: EmailMessage; all: boolean } | null>(null);
  const replies = useQuery({ queryKey: ["email-replies", conv.enquiryId], queryFn: () => fetchEmailReplies(conv.enquiryId), staleTime: 30_000 });
  const names = useQuery({ queryKey: ["profile-names"], queryFn: fetchProfileNames, staleTime: 600_000 });
  const sentBy = new Map((replies.data ?? []).map((r) => [r.gmail_message_id, names.data?.get(r.sent_by ?? "") ?? "a colleague"]));
  const filed = new Set(messages.map((m) => m.gmail_message_id));
  // Sent from the app but not read back from Gmail yet (the next mail check files it).
  const pending = (replies.data ?? []).filter((r) => !filed.has(r.gmail_message_id));

  function sent(message: string) {
    setReply(null);
    onNotice(`${message} It is in Gmail's Sent folder and appears in this conversation after the next mail check.`);
    void queryClient.invalidateQueries({ queryKey: ["email-replies", conv.enquiryId] });
    // Read the mailbox now so the sent e-mail is filed here without waiting for the 5-minute job.
    void checkMailNow()
      .catch(() => undefined)
      .finally(() => {
        for (const key of ["enquiry-emails", "inbox", "email-replies"]) void queryClient.invalidateQueries({ queryKey: [key] });
      });
  }

  useLayoutEffect(() => {
    if (pending.length && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [pending.length]);

  return (
    <article aria-label={`Conversation on ${conv.reference}`} className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      {/* Enquiry header: stays in view */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3">
        <ModeTile mode={enquiry?.shipment_mode} size="lg" />
        <div className="min-w-60 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/enquiries/${conv.enquiryId}`} className="text-[1.25rem] font-extrabold tabular-nums text-primary hover:text-primary-hover hover:underline">
              {conv.reference}
            </Link>
            {enquiry && <StatusBadge status={enquiry.status} />}
          </div>
          {enquiry && (
            <div className="flex flex-wrap items-center gap-x-2 text-body text-ink-heading">
              <span className="font-semibold">{shortPort(enquiry.pol) || "?"}</span>
              <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true" className="text-primary">
                <path d="M0 6h32" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
                <path d="m30 2 6 4-6 4" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span className="font-semibold">{shortPort(enquiry.pod) || "?"}</span>
              <span className="text-ink-muted">
                {[shipmentLabel(enquiry), enquiry.trade_type ? TRADE_LABELS[enquiry.trade_type] : null].filter(Boolean).join(" · ")}
              </span>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-meta">
          <dt className="text-ink-muted">Customer</dt>
          <dd className="font-semibold text-ink">{shownName(enquiry?.customer_name) || "—"}</dd>
          <dt className="text-ink-muted">Sales person</dt>
          <dd className="font-semibold text-ink">{shownName(enquiry?.sales_person_name) || "—"}</dd>
          <dt className="text-ink-muted">On this enquiry</dt>
          <dd className="font-semibold text-ink">
            {messages.length} e-mail{messages.length === 1 ? "" : "s"}
            {files ? ` · ${files} file${files === 1 ? "" : "s"}` : ""}
          </dd>
        </dl>
      </div>

      {/* Conversation: subject and actions stay put, the e-mails scroll between them */}
      <div className="flex flex-col overflow-hidden rounded-panel border border-line bg-surface lg:min-h-0 lg:flex-1">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-body font-semibold text-ink" title={latest.subject ?? undefined}>
            {rowSubject(latest.subject, conv.reference) || "(no subject)"}
          </h2>
          <span className="text-meta text-ink-muted tabular-nums">
            {visible.length} of {messages.length} shown
          </span>
        </div>

        <div ref={scroller} className="space-y-3 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {earlier.length > 0 && (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" onClick={toggleEarlier} aria-expanded={showEarlier}>
                <Icon name={showEarlier ? "chevronDown" : "chevronUp"} className="size-3.5" />
                {showEarlier ? "Hide earlier e-mails" : `Show ${earlier.length} earlier e-mail${earlier.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          )}
          {thread.error && <Alert>{errorMessage(thread.error)}</Alert>}
          {unlink.error && <Alert>{errorMessage(unlink.error)}</Alert>}

        <ol className="space-y-3">
          {visible.map((m, i) => {
            const prev = visible[i - 1];
            const dayOf = muscatDate(m.received_at);
            return (
              <li key={m.id} className="space-y-3">
                {(!prev || muscatDate(prev.received_at) !== dayOf) && (
                  <div className="flex items-center gap-3 text-[11px] font-bold tracking-wide text-ink-muted uppercase">
                    <span className="h-px flex-1 bg-line" />
                    {dayLabel(dayOf, today)}
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <Bubble
                  email={m}
                  mailbox={mailbox}
                  canUnlink={canEdit}
                  unlinking={unlink.isPending && unlink.variables === m.id}
                  onUnlink={() => unlink.mutate(m.id)}
                  sentBy={sentBy.get(m.gmail_message_id)}
                  onReply={canEdit ? () => setReply({ target: m, all: false }) : undefined}
                />
              </li>
            );
          })}
          {pending.map((r) => (
            <li key={r.id}>
              <PendingReply reply={r} by={names.data?.get(r.sent_by ?? "") ?? "a colleague"} />
            </li>
          ))}
        </ol>
        </div>

        {reply && (
          <div className="flex shrink-0 flex-col lg:max-h-[60%]">
            <ReplyBox
              key={`${reply.target.id}-${reply.all}`}
              enquiryId={conv.enquiryId}
              reference={conv.reference}
              target={reply.target}
              all={reply.all}
              mailbox={mailbox}
              onClose={() => setReply(null)}
              onSent={sent}
            />
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3">
          <Link to={`/enquiries/${conv.enquiryId}`} className={buttonClass(canEdit ? "secondary" : "primary")}>
            Open enquiry
          </Link>
          {canEdit && (
            <>
              <Button variant={reply && !reply.all ? "secondary" : "primary"} onClick={() => setReply({ target: latest, all: false })} title="Reply to the latest e-mail, from the pricing mailbox">
                <Icon name="send" />
                Reply
              </Button>
              <Button variant="secondary" onClick={() => setReply({ target: latest, all: true })} title="Reply to everyone on the latest e-mail">
                Reply all
              </Button>
            </>
          )}
          <a href={gmailThreadUrl(latest.gmail_thread_id, mailbox)} target="_blank" rel="noreferrer" className={buttonClass("ghost")}>
            Open in Gmail
            <Icon name="external" className="size-3.5" />
          </a>
          {canEdit && me && (
            <Button
              variant="secondary"
              loading={chase.isPending}
              aria-pressed={chasedToday}
              onClick={() => chase.mutate(!chasedToday)}
              title={chasedToday ? "You logged a follow-up on this enquiry today. Click to undo." : "Log that you followed this enquiry up today"}
            >
              {!chase.isPending && <Icon name={chasedToday ? "check" : "bell"} />}
              {chasedToday ? "Followed up today" : "Log follow-up"}
            </Button>
          )}
          {chase.error && <span className="text-meta text-lost">{errorMessage(chase.error)}</span>}
        </div>
      </div>
    </article>
  );
}

const SENDER_TAG = {
  external: { label: "External", className: "bg-table-head text-ink-heading" },
  staff: { label: "Colleague", className: "bg-surface text-primary" },
  self: { label: "Pricing mailbox", className: "bg-surface text-ink-muted" },
};

/** A reply sent from the app that the mail check has not read back yet. */
function PendingReply({ reply, by }: { reply: EmailReply; by: string }) {
  const [open, setOpen] = useState(false);
  const text = reply.body_text.split(/\n-- \n|\nOn .+ wrote:\n/)[0]!.trim();
  return (
    <div className="flex flex-row-reverse items-start gap-2.5">
      <Avatar name={by} type="self" className="size-9 text-meta" />
      <div className="max-w-[85%] min-w-0 rounded-panel rounded-tr-sm border border-dashed border-primary/50 bg-selected/40 px-3.5 py-2.5">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-meta font-bold text-ink">Sent by {by}</span>
          <span className="rounded-full bg-surface px-1.5 text-[11px] font-semibold text-primary">from the app</span>
          <span className="ml-auto text-meta tabular-nums text-ink-muted">{muscatTime(reply.sent_at)}</span>
        </div>
        <div className="text-meta text-ink-muted">To {[...reply.to_emails, ...reply.cc_emails].join(", ")}</div>
        <div className="mt-1 text-body whitespace-pre-wrap break-words text-ink">{open || text.length <= 400 ? text : `${text.slice(0, 400)}…`}</div>
        {text.length > 400 && (
          <button type="button" className="text-meta text-primary hover:underline" onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show all"}
          </button>
        )}
        {reply.attachments.length > 0 && (
          <div className="mt-1 text-meta text-ink-muted">
            <Icon name="paperclip" className="mr-1 inline size-3.5" />
            {reply.attachments.map((a) => a.filename).join(", ")}
          </div>
        )}
        <div className="mt-1 text-[11px] text-ink-muted">Sent through Gmail · filed here after the next mail check</div>
      </div>
    </div>
  );
}

function Bubble({
  email,
  mailbox,
  canUnlink,
  unlinking,
  onUnlink,
  sentBy,
  onReply,
}: {
  email: EmailMessage;
  mailbox?: string;
  canUnlink: boolean;
  unlinking: boolean;
  onUnlink: () => void;
  /** Who sent it from the app, when it was. */
  sentBy?: string;
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
      <div
        className={`min-w-0 max-w-[85%] rounded-panel border px-3.5 py-2.5 ${
          ours ? "rounded-tr-sm border-selected bg-selected/70" : "rounded-tl-sm border-line bg-surface"
        }`}
      >
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
          {canUnlink && (
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
