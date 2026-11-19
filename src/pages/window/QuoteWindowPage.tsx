import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Alert, Button, Spinner } from "../../components/ui";
import {
  closeEnquiries,
  countRegister,
  fetchFollowUpHistory,
  fetchHomePrefs,
  fetchQuoteTimes,
  fetchSalesPerson,
  fetchSalesPersons,
  fetchWindowEnquiries,
  logFollowUp,
  markQuoted,
  reopenEnquiries,
  type CloseKind,
  saveHomePrefs,
  undoFollowUp,
} from "../../lib/api";
import { daysBetween, displayName } from "../../lib/display";
import { addDays, errorMessage, todayIso } from "../../lib/format";
import { bandFilters, type FollowUpBand } from "../../lib/followUps";
import {
  buildWindow,
  clampWindow,
  customerRecords,
  monthWins,
  quickShare,
  shareWithin,
  suggestedWindow,
  TIMELINE_DAYS,
  winLags,
  type WindowSort,
} from "../../lib/quoteWindow";
import { DEFAULT_VIEW, writeRegisterView } from "../../lib/registerView";
import type { HomePrefs, ShipmentMode, WindowEnquiry } from "../../lib/types";
import { dayLabel, monthLabel, monthPace, previousMonth, seasonStart } from "../../lib/workdays";
import { MarkLostDialog } from "../followups/MarkLostDialog";
import { NotGenuineDialog } from "../followups/NotGenuineDialog";
import { ModeFilter } from "./ModeFilter";
import { MonthWinsCard, WonCard } from "./MonthWins";
import { PersonPicker } from "./PersonPicker";
import { QuoteTimeline } from "./QuoteTimeline";
import { SpeedCard } from "./SpeedCard";
import { WindowSettings } from "./WindowSettings";
import { WindowSummary } from "./WindowSummary";

const STALE_BANDS: FollowUpBand[] = ["14-30", "31-90", "90+", "unquoted"];
/** Quick-quote shares cover this many days. */
const SPEED_DAYS = 90;

/**
 * The Window: a sales person's home page. Every open quote on a timeline of days since it was sent, the win window
 * in which their wins usually arrive, and the month so far. Activity only: no money (docs/DESIGN.md, "The Window").
 */
export default function QuoteWindowPage({ salesPersonId }: { salesPersonId: string }) {
  const { profile, session, canEdit } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const userId = session?.user.id ?? null;
  const me = profile?.sales_person_id ?? null;
  const self = me === salesPersonId;

  const today = todayIso();
  const season = seasonStart(today);
  const lastMonthStart = previousMonth(today);
  // From January, last month is in the year before: load it too, for the month-so-far chart.
  const from = lastMonthStart < season ? lastMonthStart : season;
  const speedFrom = addDays(today, -SPEED_DAYS);

  const person = useQuery({ queryKey: ["window", "person", salesPersonId], queryFn: () => fetchSalesPerson(salesPersonId) });
  const enquiries = useQuery({ queryKey: ["window", "enquiries", salesPersonId, from], queryFn: () => fetchWindowEnquiries(salesPersonId, from) });
  const speed = useQuery({ queryKey: ["window", "speed", speedFrom], queryFn: () => fetchQuoteTimes(speedFrom) });
  const people = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const prefsQuery = useQuery({ queryKey: ["prefs", userId], queryFn: () => fetchHomePrefs(userId as string), enabled: self && !!userId });

  // On someone else's page the view settings last for this visit only: personal settings are private.
  const [visitPrefs, setVisitPrefs] = useState<HomePrefs>({});
  const prefs: HomePrefs = self ? (prefsQuery.data ?? {}) : visitPrefs;
  const savePrefs = useMutation({
    mutationFn: (next: HomePrefs) => saveHomePrefs(userId as string, next),
    onMutate: (next) => queryClient.setQueryData(["prefs", userId], next),
    onError: () => void queryClient.invalidateQueries({ queryKey: ["prefs", userId] }),
  });
  const updatePrefs = (change: Partial<HomePrefs>) => {
    const next = { ...prefs, ...change };
    if (self && userId) savePrefs.mutate(next);
    else setVisitPrefs(next);
  };

  const rows = useMemo(() => enquiries.data ?? [], [enquiries.data]);
  const lags = useMemo(() => winLags(rows, season), [rows, season]);
  const records = useMemo(() => customerRecords(rows, season), [rows, season]);
  const suggested = suggestedWindow(lags);
  const windowDays = prefs.windowDays ? clampWindow(prefs.windowDays) : suggested;
  const mode: ShipmentMode | "" = prefs.mode ?? "";
  const sort: WindowSort = prefs.sort === "customers" ? "customers" : "newest";

  const openIds = useMemo(
    () => rows.filter((e) => e.status === "quoted" && e.quoted_date && daysBetween(e.quoted_date, today) <= TIMELINE_DAYS).map((e) => e.id),
    [rows, today],
  );
  const chases = useQuery({ queryKey: ["window", "chases", openIds], queryFn: () => fetchFollowUpHistory(openIds), enabled: openIds.length > 0 });
  const stale = useQuery({
    queryKey: ["window", "stale", salesPersonId, today, mode],
    queryFn: async () => {
      const counts = await Promise.all(STALE_BANDS.map((b) => countRegister({ ...bandFilters(b, today, { salesPersonId, q: "" }), mode })));
      return Object.fromEntries(STALE_BANDS.map((b, i) => [b, counts[i]])) as Record<FollowUpBand, number>;
    },
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ kind: CloseKind; e: WindowEnquiry } | null>(null);
  const [closed, setClosed] = useState<{ kind: CloseKind; ids: string[]; reference: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const quote = useMutation({
    mutationFn: (e: WindowEnquiry) => markQuoted(e.id, today),
    onSuccess: (_v, e) => {
      for (const key of ["window", "register", "dashboard", "reports", "enquiry", "follow-ups"]) void queryClient.invalidateQueries({ queryKey: [key] });
      setNotice(`${e.reference} marked as quoted today.`);
    },
  });
  const chase = useMutation({
    mutationFn: ({ e, done }: { e: WindowEnquiry; done: boolean }) => (done ? logFollowUp : undoFollowUp)(e.id, salesPersonId, today),
    onSuccess: (_v, { e, done }) => {
      void queryClient.invalidateQueries({ queryKey: ["window", "chases"] });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups", "log"] });
      setNotice(done ? `${e.reference}: follow-up logged for today.` : `${e.reference}: today's follow-up removed.`);
    },
  });
  const markLost = useMutation({
    mutationFn: ({ kind, e, reason }: { kind: CloseKind; e: WindowEnquiry; reason: string }) => closeEnquiries(kind, [e.id], reason),
    onSuccess: (ids, { kind, e }) => {
      setClosing(null);
      setClosed({ kind, ids, reference: e.reference });
      void queryClient.invalidateQueries();
    },
  });
  const undo = useMutation({
    mutationFn: (ids: string[]) => reopenEnquiries(ids),
    onSuccess: () => {
      setNotice(`${closed?.reference ?? "The enquiry"} reopened.`);
      setClosed(null);
      void queryClient.invalidateQueries();
    },
  });

  if (enquiries.isLoading || person.isLoading) return <Spinner label="Loading open quotes…" />;
  if (enquiries.error) return <Alert>The open quotes could not be loaded. {errorMessage(enquiries.error)}</Alert>;

  const name = displayName(person.data?.name) || "this sales person";
  const owner = self ? "your" : `${name}'s`;
  const view = buildWindow({ rows, today, windowDays, mode, sort, records, chases: chases.data ?? [], me });
  const month = monthWins(rows, today, mode, season);
  const pace = monthPace(today);
  const times = speed.data ?? [];
  const names = new Map((people.data ?? []).map((p) => [p.id, displayName(p.name)]));
  const staleLink = (band?: FollowUpBand) =>
    `/follow-ups?${new URLSearchParams({ sp: salesPersonId, ...(band && band !== "14-30" ? { band } : {}) }).toString()}`;
  const registerLink = `/enquiries?${writeRegisterView({ ...DEFAULT_VIEW, basis: "confirmed_date", status: "confirmed", period: "this_month", salesPersonId, mode }).toString()}`;
  const staleCounts = stale.data ?? null;
  const busy = quote.isPending ? (quote.variables?.id ?? null) : chase.isPending ? (chase.variables?.e.id ?? null) : null;
  const actionError = quote.error ?? chase.error ?? undo.error ?? savePrefs.error;
  const detailError = chases.error ?? stale.error ?? speed.error;

  return (
    <div className="space-y-4">
      {!self && (
        <Alert kind="info" action={<PersonPicker current={salesPersonId} />}>
          You're viewing {name}'s open quotes. Only {name} can log their follow-ups, and their settings stay private.
        </Alert>
      )}
      {closed && (
        <Alert
          kind="success"
          action={
            <div className="flex gap-2">
              {closed.ids.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => undo.mutate(closed.ids)} loading={undo.isPending}>
                  Undo
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setClosed(null)}>
                Dismiss
              </Button>
            </div>
          }
        >
          {closed.ids.length ? `${closed.reference} ${closed.kind === "lost" ? "marked as lost" : "marked not genuine"}.` : `${closed.reference} was already closed, so nothing changed.`}
        </Alert>
      )}
      {actionError && <Alert>That did not save. {errorMessage(actionError)}</Alert>}
      {detailError && <Alert kind="warning">Some details could not be loaded. {errorMessage(detailError)}</Alert>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta text-ink-muted">
            {dayLabel(today)} · day {pace.day} of {pace.total}
          </p>
          <h1 className="text-title font-semibold text-ink">{self ? "My open quotes" : `${name}'s open quotes`}</h1>
        </div>
        <ModeFilter value={mode} onChange={(m) => updatePrefs({ mode: m })} />
      </div>

      <WindowSummary
        view={view}
        windowDays={windowDays}
        staleQuotes={staleCounts ? staleCounts["14-30"] + staleCounts["31-90"] + staleCounts["90+"] : null}
        staleLink={staleLink()}
        won={month.total}
        lastByNow={month.lastByNow}
        monthName={monthLabel(today)}
        lastMonthName={monthLabel(lastMonthStart)}
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_44rem]">
          <QuoteTimeline
            view={view}
            windowDays={windowDays}
            history={{ wins: lags.length, inWindow: shareWithin(lags, windowDays), inTimeline: shareWithin(lags, TIMELINE_DAYS) }}
            owner={owner}
            ownerId={salesPersonId}
            sort={sort}
            onSort={(s) => updatePrefs({ sort: s })}
            today={today}
            canEdit={canEdit}
            canChase={self}
            busy={busy}
            personName={(id) => names.get(id) ?? "a colleague"}
            stale={staleCounts}
            staleLink={staleLink}
            onQuoted={(e) => quote.mutate(e)}
            onChase={(e, done) => chase.mutate({ e, done })}
            onWon={(e) => navigate(`/enquiries/${e.id}/edit?confirm=1`)}
            onMarkLost={(e) => (markLost.reset(), setClosing({ kind: "lost", e }))}
            onMarkNotGenuine={(e) => (markLost.reset(), setClosing({ kind: "not_genuine", e }))}
          />
        </div>
        <aside className="flex min-w-0 flex-[1_1_20rem] flex-col gap-4">
          <MonthWinsCard month={month} today={today} owner={owner} />
          <WonCard month={month} today={today} registerLink={registerLink} />
          <SpeedCard
            mine={quickShare(times.filter((t) => t.sales_person_id === salesPersonId))}
            team={quickShare(times)}
            label={self ? "You" : name}
            days={SPEED_DAYS}
          />
          {self && (
            <WindowSettings
              windowDays={windowDays}
              suggested={suggested}
              custom={!!prefs.windowDays}
              onChange={(d) => updatePrefs({ windowDays: clampWindow(d) })}
              onReset={() => updatePrefs({ windowDays: undefined })}
            />
          )}
        </aside>
      </div>

      {closing?.kind === "lost" && (
        <MarkLostDialog
          count={1}
          references={[closing.e.reference]}
          saving={markLost.isPending}
          error={markLost.error}
          onClose={() => setClosing(null)}
          onConfirm={(reason) => markLost.mutate({ kind: "lost", e: closing.e, reason })}
        />
      )}
      {closing?.kind === "not_genuine" && (
        <NotGenuineDialog
          count={1}
          references={[closing.e.reference]}
          customer={displayName(closing.e.customer_name)}
          saving={markLost.isPending}
          error={markLost.error}
          onClose={() => setClosing(null)}
          onConfirm={(reason) => markLost.mutate({ kind: "not_genuine", e: closing.e, reason })}
        />
      )}
      {notice && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-control bg-ink px-4 py-2.5 text-body font-medium text-white shadow-[0_8px_24px_rgba(25,36,59,0.25)]"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
