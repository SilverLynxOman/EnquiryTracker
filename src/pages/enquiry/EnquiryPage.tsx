import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { PriceCheckerTag, usePriceCheckers } from "../../components/PriceChecker";
import { Alert, Button, buttonClass, Spinner, StatusBadge } from "../../components/ui";
import {
  closeEnquiries,
  deleteEnquiry,
  fetchAudit,
  fetchCustomerHistory,
  fetchEmailReplies,
  fetchEnquiry,
  fetchEnquiryEmails,
  fetchFollowUpHistory,
  fetchInboxCounts,
  fetchLaneHistory,
  fetchNames,
  fetchProfileNames,
  fetchSalesPersons,
  linkEmail,
  logFollowUp,
  markQuoted,
  reopenEnquiries,
  undoFollowUp,
  type CloseKind,
} from "../../lib/api";
import { displayName, shipmentLabel, TRADE_LABELS } from "../../lib/display";
import { buildBrief, replyDefaults, type ActionButton, type MailInput, type MilestoneKey, type ReplyPrefill, type Viewer } from "../../lib/enquiryBrief";
import { closedBy, customerStats, dayWithWeekday } from "../../lib/enquiryDetails";
import { errorMessage, fmtDateTime, todayIso } from "../../lib/format";
import type { ShipmentMode } from "../../lib/types";
import { seasonStart } from "../../lib/workdays";
import { MarkLostDialog } from "../followups/MarkLostDialog";
import { NotGenuineDialog } from "../followups/NotGenuineDialog";
import { CargoCard } from "./CargoCard";
import { ConversationBoard } from "./ConversationBoard";
import { CustomerCard } from "./CustomerCard";
import { DatesNumbersCard } from "./DatesNumbersCard";
import { DocumentsCard } from "./DocumentsCard";
import { FlagsStrip } from "./FlagsStrip";
import { GlanceBand } from "./GlanceBand";
import { HandlerLine, JourneyChip, TruthTag } from "./HeaderExtras";
import { HistoryCard } from "./HistoryCard";
import { ShipmentCard } from "./JobCards";
import { LaneCard } from "./LaneCard";
import { NowCard } from "./NowCard";
import { PeopleCard } from "./PeopleCard";
import { PricesCard } from "./PricesCard";
import type { PageActions } from "./shared";
import { ShipmentTrack } from "./ShipmentTrack";
import { StageLine } from "./StageLine";
import { StatusText } from "./StatusText";
import { useBriefOverrides } from "./useBriefOverrides";

const MODE_DOT: Partial<Record<ShipmentMode, string>> = {
  FCL: "bg-mode-fcl",
  LCL: "bg-mode-lcl",
  AIR: "bg-mode-air",
  COURIER: "bg-mode-courier",
};

/** Everything that changes what the register, the dashboard and the sales pages show. */
const ENQUIRY_KEYS = ["register", "dashboard", "reports", "window", "voyage", "follow-ups", "customer-history", "lane-history"];

/** How often the page re-reads the clock: ages and deadlines in the brief move with it. */
const TICK_MS = 5 * 60_000;

export interface Notice {
  text: string;
  /** Undo for a close (reopen these enquiries). */
  undoIds?: string[];
  /** Undo for anything else. */
  undo?: () => void;
}

/** A notice with nothing to undo goes by itself after a few seconds; one with an Undo stays until the next action. */
export const hidesByItself = (notice: Notice) => !notice.undoIds?.length && !notice.undo;

const mailCount = (n: number) => (n === 1 ? "1 e-mail" : `${n} e-mails`);

/**
 * What the page asks before it files e-mails under another enquiry (to) or back to Needs review (null). Moving them
 * cannot be undone from here (filing them back by hand would count them for this enquiry for good), so it asks first.
 */
export function moveQuestion(count: number, to: string | null, here: string): string {
  const they = count === 1 ? "It" : "They";
  return to
    ? `Move ${mailCount(count)} to ${to}? ${they} will stop counting for ${here}.`
    : `Send ${mailCount(count)} back to Needs review? ${they} will stop counting for ${here}.`;
}

/** What the page says once e-mails were moved: a plain notice, with nothing to undo. */
export const movedText = (count: number, to: string | null) => (to ? `${mailCount(count)} moved to ${to}.` : `${mailCount(count)} sent back to Needs review.`);

/**
 * What the page says after closing as lost or not genuine. The database closes only open enquiries and returns the
 * ids it closed: none means someone confirmed or closed it meanwhile, which is said as an error, not as done.
 */
export function closeOutcome(ids: string[], reference: string, kind: CloseKind): { notice: Notice } | { error: string } {
  if (!ids.length) return { error: `${reference} was not closed: it is not open any more.` };
  return { notice: { text: `${reference} is ${kind === "lost" ? "closed as lost" : "marked not genuine"}.`, undoIds: ids } };
}

export default function EnquiryPage() {
  const { id } = useParams();
  return <EnquiryView key={id} id={id!} />;
}

/**
 * One enquiry: whose move it is and the one next step, what was offered and what agents charge, the two
 * conversations, the shipment's steps and the people, read from the e-mails (src/lib/enquiryBrief.ts) on top of
 * the register. Nothing read from an e-mail is saved without a click.
 */
function EnquiryView({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { canEdit, isAdmin, seesAll, profile } = useAuth();
  const today = todayIso();
  const since = seasonStart(today);
  const me = profile?.sales_person_id ?? null;
  const editLink = `/enquiries/${id}/edit`;
  const viewer: Viewer = useMemo(() => ({ canEdit, canReply: canEdit && seesAll, me }), [canEdit, seesAll, me]);

  const enquiry = useQuery({ queryKey: ["enquiry", id], queryFn: () => fetchEnquiry(id) });
  const emails = useQuery({ queryKey: ["enquiry-emails", id], queryFn: () => fetchEnquiryEmails(id) });
  const replies = useQuery({ queryKey: ["enquiry-replies", id], queryFn: () => fetchEmailReplies(id) });
  const chases = useQuery({ queryKey: ["follow-ups", "log", "enquiry", id], queryFn: () => fetchFollowUpHistory([id]) });
  const salesPersons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const agentNames = useQuery({ queryKey: ["names", "agents"], queryFn: () => fetchNames("agents"), staleTime: 300_000 });
  const people = useQuery({ queryKey: ["profile-names"], queryFn: fetchProfileNames, staleTime: 300_000 });
  const counts = useQuery({ queryKey: ["inbox", "counts"], queryFn: fetchInboxCounts, staleTime: 60_000 });
  const row = enquiry.data;
  const history = useQuery({
    queryKey: ["customer-history", row?.customer_id, since],
    queryFn: () => fetchCustomerHistory(row!.customer_id, since),
    enabled: !!row,
    staleTime: 60_000,
  });
  // The same key as the route card's, so both read one request.
  const pol = row?.pol?.trim() ?? "";
  const pod = row?.pod?.trim() ?? "";
  const lane = useQuery({
    queryKey: ["lane-history", pol.toUpperCase(), pod.toUpperCase(), since],
    queryFn: () => fetchLaneHistory(pol, pod, since),
    enabled: !!pol && !!pod,
    staleTime: 60_000,
  });
  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => fetchAudit(id), enabled: row?.status === "not_genuine" });

  const savedReference = (location.state as { saved?: string } | null)?.saved;
  const [notice, setNotice] = useState<Notice | null>(savedReference ? { text: `Saved ${savedReference}.` } : null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closing, setClosing] = useState<CloseKind | null>(null);
  const [openMailId, setOpenMailId] = useState<string | null>(null);
  const [milestone, setMilestone] = useState<MilestoneKey | null>(null);
  const [reply, setReply] = useState<ReplyPrefill | null>(null);
  /** Counts the times a reply was asked for: asking again brings the open reply back into view. */
  const [replyAsk, setReplyAsk] = useState(0);
  const [now, setNow] = useState(() => new Date().toISOString());
  const { overrides, treatAs, keepThreads, dismiss, undismiss } = useBriefOverrides(id);
  const checkers = usePriceCheckers();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notice || !hidesByItself(notice)) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const names = useMemo(() => new Map((salesPersons.data ?? []).map((p) => [p.id, displayName(p.name)])), [salesPersons.data]);
  const mailbox = counts.data?.mailboxes[0]?.email ?? null;
  const checker = row ? checkers.get(row.customer_id) : undefined;
  const chaseList = chases.data ?? [];

  const brief = useMemo(
    () =>
      row
        ? buildBrief({
            row,
            emails: (emails.data ?? []) as MailInput[],
            followUps: chases.data ?? [],
            replies: replies.data,
            profileNames: people.data,
            salesPersonNames: names,
            customerHistory: history.data,
            laneHistory: lane.data,
            agentNames: agentNames.data,
            checker,
            mailbox,
            now,
            viewer,
            overrides,
          })
        : null,
    [row, emails.data, chases.data, replies.data, people.data, names, history.data, lane.data, agentNames.data, checker, mailbox, now, viewer, overrides],
  );
  const stats = useMemo(() => (row && history.data ? customerStats(history.data, row.id, since, today) : undefined), [row, history.data, since, today]);

  const refresh = () => {
    for (const key of ENQUIRY_KEYS) void queryClient.invalidateQueries({ queryKey: [key] });
    void queryClient.invalidateQueries({ queryKey: ["enquiry", id] });
    void queryClient.invalidateQueries({ queryKey: ["audit", id] });
  };

  const quote = useMutation({
    mutationFn: (date: string) => markQuoted(id, date),
    onMutate: () => setActionError(null),
    onSuccess: (_v, date) => {
      refresh();
      setNotice({ text: `Marked as quoted on ${dayWithWeekday(date, today)}.` });
    },
    onError: (e) => setActionError(`It could not be marked as quoted. ${errorMessage(e)}`),
  });
  const chase = useMutation({
    mutationFn: (done: boolean) => (done ? logFollowUp : undoFollowUp)(id, me!, today),
    onMutate: () => setActionError(null),
    onSuccess: (_v, done) => {
      void queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
      void queryClient.invalidateQueries({ queryKey: ["window", "chases"] });
      setNotice({ text: done ? "Follow-up logged for today." : "Today's follow-up removed." });
    },
    onError: (e) => setActionError(`The follow-up could not be saved. ${errorMessage(e)}`),
  });
  const close = useMutation({
    mutationFn: ({ kind, reason }: { kind: CloseKind; reason: string }) => closeEnquiries(kind, [id], reason),
    onMutate: () => setActionError(null),
    onSuccess: (ids, { kind }) => {
      setClosing(null);
      const outcome = closeOutcome(ids, row?.reference ?? "The enquiry", kind);
      if ("error" in outcome) {
        setNotice(null);
        setActionError(outcome.error);
      } else setNotice(outcome.notice);
      void queryClient.invalidateQueries();
    },
  });
  const openClose = (kind: CloseKind) => {
    close.reset();
    setClosing(kind);
  };
  const reopen = useMutation({
    mutationFn: (ids: string[]) => reopenEnquiries(ids),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      setNotice({ text: `${row?.reference ?? "The enquiry"} is open again.` });
      void queryClient.invalidateQueries();
    },
    onError: (e) => setActionError(`It could not be reopened. ${errorMessage(e)}`),
  });
  const remove = useMutation({
    mutationFn: () => deleteEnquiry(id),
    onSuccess: () => {
      for (const key of ENQUIRY_KEYS) void queryClient.invalidateQueries({ queryKey: [key] });
      navigate("/enquiries", { replace: true });
    },
    onError: (e) => setActionError(`It could not be deleted. ${errorMessage(e)}`),
  });
  /**
   * Files e-mails under another enquiry (or back to Needs review with null), once the person said yes. There is no
   * Undo: filing them back by hand would mark them as filed here on purpose, so they would count for this enquiry.
   */
  const moving = useMutation({
    mutationFn: async ({ ids, to }: { ids: string[]; to: string | null }) => {
      for (const emailId of ids) await linkEmail(emailId, to);
    },
    onMutate: () => setActionError(null),
    onSuccess: (_v, { ids, to }) => {
      void queryClient.invalidateQueries({ queryKey: ["enquiry-emails"] });
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      setNotice({ text: movedText(ids.length, to) });
    },
    onError: (e, { to }) =>
      setActionError(
        `The e-mails could not be moved. ${errorMessage(e)}${to ? ` If ${to} is not in the register yet, use Keep here or Wrong enquiry instead.` : ""}`,
      ),
  });

  /** Shows an e-mail in the conversation; the same e-mail asked for twice scrolls to it again. */
  function openMail(emailId: string) {
    setOpenMailId(null);
    requestAnimationFrame(() => setOpenMailId(emailId));
  }

  async function copy(text: string, toast: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ text: toast });
    } catch {
      setActionError("The text could not be copied. Select it and copy it instead.");
    }
  }

  /** A reply a card asked for without the details: the defaults for that conversation, with the card's text as the message. */
  function startReply(button: ActionButton) {
    if (!brief || !row) return;
    if (button.replyPrefill) {
      setReply(button.replyPrefill);
      setReplyAsk((n) => n + 1);
      return;
    }
    const side = brief.sides.find((s) => s.key === (button.sideKey ?? "customer"));
    if (!side) return;
    const target = button.emailIds?.[0] ? brief.mails.find((m) => m.id === button.emailIds![0]) : undefined;
    const prefill = replyDefaults(side, brief.handler, row, mailbox, { target, all: !!button.all, message: button.copyText });
    if (!prefill.targetEmailId || !brief.mails.some((m) => m.id === prefill.targetEmailId)) {
      if (button.copyText) void copy(button.copyText, `There is no e-mail from ${side.name} to answer here. The text is copied: send it from Gmail.`);
      else setActionError(`There is no e-mail from ${side.name} to answer here. Write to them from Gmail.`);
      return;
    }
    setReply(prefill);
    setReplyAsk((n) => n + 1);
  }

  function onAction(button: ActionButton) {
    if (!row) return;
    setActionError(null);
    switch (button.id) {
      case "mark_quoted":
        return quote.mutate(button.date ?? today);
      case "confirm_job":
        return navigate(`${editLink}?confirm=${button.date ?? "1"}`, button.formPrefill ? { state: { prefill: button.formPrefill } } : undefined);
      case "edit_prefilled":
        return navigate(editLink, button.formPrefill ? { state: { prefill: button.formPrefill } } : undefined);
      case "edit":
        return navigate(editLink);
      case "reply":
        return startReply(button);
      case "log_follow_up":
        return me ? chase.mutate(true) : undefined;
      case "undo_follow_up":
        return me ? chase.mutate(false) : undefined;
      case "mark_lost":
        return openClose("lost");
      case "not_genuine":
        return openClose("not_genuine");
      case "reopen":
        return reopen.mutate([id]);
      case "copy":
        return button.copyText ? void copy(button.copyText, button.copiedToast ?? "Copied.") : undefined;
      case "open_mail":
        return button.emailIds?.[0] ? openMail(button.emailIds[0]) : undefined;
      case "move_mails":
      case "wrong_enquiry": {
        const ids = button.emailIds ?? [];
        const to = button.id === "move_mails" ? (button.reference ?? "") : null;
        if (!ids.length || to === "") return;
        if (!window.confirm(moveQuestion(ids.length, to, row.reference))) return;
        return moving.mutate({ ids, to });
      }
      case "keep_thread":
        if (button.threadIds?.length) {
          keepThreads(button.threadIds);
          setNotice({ text: "Kept here. These e-mails count for this enquiry again." });
        }
        return;
      case "dismiss": {
        const dismissId = button.dismissId;
        if (!dismissId) return;
        dismiss(dismissId);
        return setNotice({ text: "Put away in this browser.", undo: () => undismiss(dismissId) });
      }
      case "treat_as":
        if (button.address && button.party) {
          treatAs(button.address, button.party);
          setNotice({ text: `${button.address} is read as ${button.party === "other" ? "external" : `the ${button.party}`} in this browser.` });
        }
        return;
    }
  }

  const actions: PageActions = {
    onOpenMail: openMail,
    onAction,
    busy: {
      mark_quoted: quote.isPending,
      log_follow_up: chase.isPending,
      undo_follow_up: chase.isPending,
      reopen: reopen.isPending,
      move_mails: moving.isPending,
      wrong_enquiry: moving.isPending,
    },
  };

  if (enquiry.isLoading) return <Spinner />;
  if (enquiry.error || !row || !brief) {
    return (
      <Alert
        action={
          <Link to="/enquiries" className={buttonClass("secondary", "sm")}>
            Back to the register
          </Link>
        }
      >
        This enquiry could not be loaded. It may have been deleted. {enquiry.error ? errorMessage(enquiry.error) : ""}
      </Alert>
    );
  }

  const menu: MenuItem[] = [];
  if (canEdit && (row.status === "new" || row.status === "quoted")) {
    menu.push({ label: "Mark lost…", icon: "close", onSelect: () => openClose("lost") });
    menu.push({ label: "Not genuine…", icon: "flag", onSelect: () => openClose("not_genuine") });
  }
  if (canEdit && (row.status === "lost" || row.status === "not_genuine")) menu.push({ label: "Reopen", icon: "refresh", onSelect: () => reopen.mutate([id]) });
  menu.push({ label: "Copy reference", icon: "copy", onSelect: () => void copy(row.reference, `${row.reference} copied.`) });
  if (brief.copy.houseSubject) menu.push({ label: "Copy house subject", icon: "copy", onSelect: () => void copy(brief.copy.houseSubject, "House subject copied.") });
  if (brief.copy.status) menu.push({ label: "Copy status text", icon: "copy", onSelect: () => void copy(brief.copy.status!, "Status text copied.") });
  if (isAdmin) {
    menu.push({
      label: "Delete enquiry…",
      icon: "close",
      danger: true,
      separatorBefore: true,
      onSelect: () => window.confirm(`Delete ${row.reference}? This cannot be undone.`) && remove.mutate(),
    });
  }

  // Who marked it not genuine stays on the Now card, as the register's history says.
  const closer = row.status === "not_genuine" && row.closure ? closedBy(audit.data ?? [], row.closure) : null;
  const nowAction = closer
    ? {
        ...brief.now,
        lines: [
          ...brief.now.lines,
          { text: `Marked by ${closer.by ? (people.data?.get(closer.by) ?? "a colleague") : "the system"}, ${fmtDateTime(closer.at)}.`, tone: null },
        ],
      }
    : brief.now;

  const mode = row.shipment_mode;
  const route = [row.pol, row.pod].filter(Boolean).map((p) => displayName(p)).join(" → ");
  const facts = [
    row.trade_type ? TRADE_LABELS[row.trade_type] : "",
    route,
    row.sales_person_name ? `Sales ${displayName(row.sales_person_name)}` : "No sales person",
  ].filter(Boolean);
  const hasMail = (emails.data ?? []).length > 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-muted">
            <Link to="/enquiries" className="font-medium text-primary hover:underline">
              ← Register
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-semibold tabular-nums text-ink-heading">{row.reference}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-headline font-semibold text-ink">{displayName(row.customer_name)}</h1>
            <StatusBadge status={row.status} />
            <TruthTag truth={brief.truth} />
            {checker && <PriceCheckerTag info={checker} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink-heading">
            {mode && (
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <span aria-hidden="true" className={`size-2 rounded-full ${MODE_DOT[mode] ?? "bg-mode-other"}`} />
                {shipmentLabel(row)}
              </span>
            )}
            {facts.map((f) => (
              <span key={f} className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="text-control">
                  ·
                </span>
                {f}
              </span>
            ))}
          </div>
          {(brief.journey || hasMail) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <JourneyChip journey={brief.journey} />
              <HandlerLine handler={brief.handler} hasMail={hasMail} today={today} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Link to={editLink} className={buttonClass("secondary")}>
              <Icon name="edit" className="size-4" />
              Edit
            </Link>
          )}
          <Menu
            label={`More actions for ${row.reference}`}
            trigger={<Icon name="more" />}
            triggerClassName="inline-flex size-9 items-center justify-center rounded-control text-ink-heading ring-1 ring-inset ring-control hover:bg-row-hover hover:text-ink"
            items={menu}
          />
        </div>
      </header>

      {notice && (
        <Alert
          kind="success"
          action={
            notice.undoIds?.length ? (
              <Button variant="secondary" size="sm" loading={reopen.isPending} onClick={() => reopen.mutate(notice.undoIds!)}>
                Undo
              </Button>
            ) : notice.undo ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  notice.undo!();
                  setNotice(null);
                }}
              >
                Undo
              </Button>
            ) : undefined
          }
        >
          {notice.text}
        </Alert>
      )}
      {actionError && <Alert>{actionError}</Alert>}

      <FlagsStrip flags={brief.flags} actions={actions} canEdit={viewer.canEdit} canReply={viewer.canReply} />

      <GlanceBand
        move={brief.move}
        offer={brief.offer}
        margin={brief.margin}
        registerMoney={brief.registerMoney}
        row={row}
        needsYou={brief.needsYou}
        now={<NowCard now={nowAction} checker={checker} row={row} actions={actions} />}
        actions={actions}
        loading={emails.isLoading}
        error={emails.error}
        onRetry={() => void emails.refetch()}
      />
      <StickyMove brief={brief} viewer={viewer} actions={actions} />

      <StageLine stages={brief.stages} today={today} actions={actions}>
        {brief.journey && (
          <ShipmentTrack
            journey={brief.journey}
            today={today}
            actions={actions}
            selected={milestone}
            onSelect={setMilestone}
            reference={row.reference}
            confirmedDate={row.confirmed_date}
          />
        )}
      </StageLine>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-4">
          <StatusText status={brief.statusText} canReply={viewer.canReply} actions={actions} />
          <ConversationBoard
            brief={brief}
            row={row}
            today={today}
            mailbox={mailbox}
            loading={emails.isLoading}
            error={emails.error}
            onRetry={() => void emails.refetch()}
            viewer={viewer}
            actions={actions}
            openMailId={openMailId}
            milestoneFilter={milestone}
            onClearMilestone={() => setMilestone(null)}
            reply={reply}
            replyAsk={replyAsk}
            onCloseReply={() => setReply(null)}
            onSent={(message) => {
              setReply(null);
              setNotice({ text: message });
              void queryClient.invalidateQueries({ queryKey: ["enquiry-emails", id] });
              void queryClient.invalidateQueries({ queryKey: ["enquiry-replies", id] });
            }}
          />
          <PricesCard
            row={row}
            offer={brief.offer}
            agentRates={brief.agentRates}
            buy={brief.buy}
            targets={brief.targets}
            margin={brief.margin}
            trail={brief.trail}
            trailSentence={brief.trailSentence}
            registerMoney={brief.registerMoney}
            viewer={viewer}
            actions={actions}
          />
        </div>
        <aside className="min-w-0 space-y-4" aria-label="People, cargo, dates and documents">
          <PeopleCard people={brief.people} handler={brief.handler} row={row} viewer={viewer} actions={actions} today={today} />
          <CargoCard cargo={brief.cargo} drift={brief.drift} viewer={viewer} actions={actions} />
          <DatesNumbersCard dates={brief.dates} refs={brief.refs} row={row} today={today} copy={brief.copy} actions={actions} />
          <DocumentsCard groups={brief.documents} crossFiled={brief.crossFiled} mailbox={mailbox} today={today} actions={actions} />
        </aside>
      </div>

      {/* The record: what the register holds, the customer's year, the route before, and what happened. */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ShipmentCard row={row} />
        <CustomerCard row={row} today={today} checker={checker} stats={stats} loading={history.isLoading} error={history.error} />
        <LaneCard row={row} today={today} benchmark={brief.laneBenchmark} />
        <HistoryCard enquiry={row} chases={chaseList} names={names} today={today} events={brief.history} actions={actions} />
      </div>

      {closing === "lost" && (
        <MarkLostDialog
          count={1}
          references={[row.reference]}
          saving={close.isPending}
          error={close.error}
          onClose={() => setClosing(null)}
          onConfirm={(reason) => close.mutate({ kind: "lost", reason })}
        />
      )}
      {closing === "not_genuine" && (
        <NotGenuineDialog
          count={1}
          references={[row.reference]}
          customer={displayName(row.customer_name)}
          saving={close.isPending}
          error={close.error}
          onClose={() => setClosing(null)}
          onConfirm={(reason) => close.mutate({ kind: "not_genuine", reason })}
        />
      )}
    </div>
  );
}

/**
 * On a phone, once the glance band has scrolled away: whose move it is with its age, and for mailbox users a
 * Reply button for that conversation.
 */
function StickyMove({ brief, viewer, actions }: { brief: NonNullable<ReturnType<typeof buildBrief>>; viewer: Viewer; actions: PageActions }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const band = document.getElementById("glance");
    if (!band || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    io.observe(band);
    return () => io.disconnect();
  }, []);

  const move = brief.move;
  if (!shown || move.kind === "closed") return null;
  const canAnswer = viewer.canReply && !!move.sideKey && brief.sides.some((s) => s.key === move.sideKey && s.mails.length > 0);
  return (
    <div className="sticky top-14 z-10 -mx-4 flex items-center gap-2 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur sm:hidden" role="status">
      <span className="min-w-0 flex-1 truncate text-body">
        <span className="font-semibold text-ink">{move.word}</span>
        {move.clock && <span className="text-ink-muted"> · {move.clock}</span>}
      </span>
      {canAnswer && (
        <Button
          variant="secondary"
          size="sm"
          aria-label="Reply"
          onClick={() => actions.onAction({ id: "reply", label: "Reply", variant: "secondary", sideKey: move.sideKey! })}
        >
          <Icon name="send" className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
