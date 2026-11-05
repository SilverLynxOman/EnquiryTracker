import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { Alert, Button, buttonClass, Spinner, StatusBadge } from "../../components/ui";
import {
  closeEnquiriesAsLost,
  deleteEnquiry,
  fetchCustomerHistory,
  fetchEnquiry,
  fetchEnquiryEmails,
  fetchFollowUpHistory,
  fetchInboxCounts,
  fetchSalesPersons,
  logFollowUp,
  markQuoted,
  reopenEnquiries,
  undoFollowUp,
} from "../../lib/api";
import { displayName, shipmentLabel, TRADE_LABELS } from "../../lib/display";
import { buildStages, customerStats, dayWithWeekday, emailSuggestion, readThread } from "../../lib/enquiryDetails";
import { errorMessage, todayIso } from "../../lib/format";
import type { EnquiryRow, ShipmentMode } from "../../lib/types";
import { seasonStart } from "../../lib/workdays";
import { MarkLostDialog } from "../followups/MarkLostDialog";
import { CustomerCard } from "./CustomerCard";
import { EmailThread } from "./EmailThread";
import { HistoryCard } from "./HistoryCard";
import { RatesCard, ShipmentCard } from "./JobCards";
import { LaneCard } from "./LaneCard";
import { NextStepCard } from "./NextStepCard";
import { StageLine } from "./StageLine";

const MODE_DOT: Partial<Record<ShipmentMode, string>> = {
  FCL: "bg-mode-fcl",
  LCL: "bg-mode-lcl",
  AIR: "bg-mode-air",
  COURIER: "bg-mode-courier",
};

/** Everything that changes what the register, the dashboard and the sales pages show. */
const ENQUIRY_KEYS = ["register", "dashboard", "reports", "window", "voyage", "follow-ups", "customer-history", "lane-history"];

export default function EnquiryPage() {
  const { id } = useParams();
  return <EnquiryView key={id} id={id!} />;
}

/** One enquiry: where it stands, the next step, the shipment, the e-mails, the customer and the route. */
function EnquiryView({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { canEdit, isAdmin, profile } = useAuth();
  const today = todayIso();
  const since = seasonStart(today);
  const me = profile?.sales_person_id ?? null;
  const editLink = `/enquiries/${id}/edit`;

  const enquiry = useQuery({ queryKey: ["enquiry", id], queryFn: () => fetchEnquiry(id) });
  const emails = useQuery({ queryKey: ["enquiry-emails", id], queryFn: () => fetchEnquiryEmails(id) });
  const chases = useQuery({ queryKey: ["follow-ups", "log", "enquiry", id], queryFn: () => fetchFollowUpHistory([id]) });
  const salesPersons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const counts = useQuery({ queryKey: ["inbox", "counts"], queryFn: fetchInboxCounts, staleTime: 60_000 });
  const row = enquiry.data;
  const history = useQuery({
    queryKey: ["customer-history", row?.customer_id, since],
    queryFn: () => fetchCustomerHistory(row!.customer_id, since),
    enabled: !!row,
    staleTime: 60_000,
  });

  const savedReference = (location.state as { saved?: string } | null)?.saved;
  const [notice, setNotice] = useState<{ text: string; undoIds?: string[] } | null>(savedReference ? { text: `Saved ${savedReference}.` } : null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!notice || notice.undoIds) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const names = useMemo(() => new Map((salesPersons.data ?? []).map((p) => [p.id, displayName(p.name)])), [salesPersons.data]);
  const thread = useMemo(
    () => (row ? readThread(emails.data ?? [], { name: row.customer_name, contactEmail: row.contact_email }) : []),
    [row, emails.data],
  );
  const suggestion = useMemo(() => (row ? emailSuggestion(row, thread) : null), [row, thread]);
  const stats = useMemo(() => (row && history.data ? customerStats(history.data, row.id, since, today) : undefined), [row, history.data, since, today]);
  const chaseList = chases.data ?? [];

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
  const markLost = useMutation({
    mutationFn: (reason: string) => closeEnquiriesAsLost([id], reason),
    onSuccess: (ids) => {
      setClosing(false);
      setNotice({ text: `${row?.reference ?? "The enquiry"} is closed as lost.`, undoIds: ids });
      void queryClient.invalidateQueries();
    },
  });
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

  if (enquiry.isLoading) return <Spinner />;
  if (enquiry.error || !row) {
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

  const confirm = (date: string | null) => navigate(`${editLink}?confirm=${date ?? "1"}`);

  async function copyReference(r: EnquiryRow) {
    try {
      await navigator.clipboard.writeText(r.reference);
      setNotice({ text: `${r.reference} copied.` });
    } catch {
      setActionError("The reference could not be copied. Select it and copy it instead.");
    }
  }

  const menu: MenuItem[] = [];
  if (canEdit && (row.status === "new" || row.status === "quoted")) menu.push({ label: "Mark lost…", icon: "close", onSelect: () => setClosing(true) });
  if (canEdit && row.status === "lost") menu.push({ label: "Reopen", icon: "refresh", onSelect: () => reopen.mutate([id]) });
  menu.push({ label: "Copy reference", icon: "copy", onSelect: () => void copyReference(row) });
  if (isAdmin) {
    menu.push({
      label: "Delete enquiry…",
      icon: "close",
      danger: true,
      separatorBefore: true,
      onSelect: () => window.confirm(`Delete ${row.reference}? This cannot be undone.`) && remove.mutate(),
    });
  }

  const mode = row.shipment_mode;
  const route = [row.pol, row.pod].filter(Boolean).map((p) => displayName(p)).join(" → ");
  const facts = [
    row.trade_type ? TRADE_LABELS[row.trade_type] : "",
    route,
    row.sales_person_name ? `Sales ${displayName(row.sales_person_name)}` : "No sales person",
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-muted">
            <Link to="/enquiries" className="font-medium text-primary hover:underline">
              ← Register
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-semibold tabular-nums text-ink-heading">{row.reference}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold text-ink">{displayName(row.customer_name)}</h1>
            <StatusBadge status={row.status} />
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
      </div>

      {notice && (
        <Alert
          kind="success"
          action={
            notice.undoIds?.length ? (
              <Button variant="secondary" size="sm" loading={reopen.isPending} onClick={() => reopen.mutate(notice.undoIds!)}>
                Undo
              </Button>
            ) : undefined
          }
        >
          {notice.text}
        </Alert>
      )}
      {actionError && <Alert>{actionError}</Alert>}

      <StageLine stages={buildStages(row, chaseList, today)} today={today} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-4">
          <NextStepCard
            row={row}
            today={today}
            suggestion={suggestion}
            stats={stats}
            chases={chaseList}
            names={names}
            me={me}
            canEdit={canEdit}
            editLink={editLink}
            quoting={quote.isPending}
            chasing={chase.isPending}
            reopening={reopen.isPending}
            onMarkQuoted={(date) => quote.mutate(date)}
            onConfirm={confirm}
            onChase={(done) => chase.mutate(done)}
            onMarkLost={() => setClosing(true)}
            onReopen={() => reopen.mutate([id])}
          />
          <ShipmentCard row={row} />
          <RatesCard row={row} />
          <EmailThread items={thread} loading={emails.isLoading} error={emails.error} reference={row.reference} today={today} mailbox={counts.data?.mailboxes[0]?.email} />
        </div>
        <aside className="min-w-0 space-y-4" aria-label="Customer and route">
          <CustomerCard row={row} today={today} stats={stats} loading={history.isLoading} error={history.error} />
          <LaneCard row={row} today={today} />
          <HistoryCard enquiry={row} chases={chaseList} names={names} today={today} />
        </aside>
      </div>

      {closing && (
        <MarkLostDialog
          count={1}
          references={[row.reference]}
          saving={markLost.isPending}
          error={markLost.error}
          onClose={() => setClosing(false)}
          onConfirm={(reason) => markLost.mutate(reason)}
        />
      )}
    </div>
  );
}
