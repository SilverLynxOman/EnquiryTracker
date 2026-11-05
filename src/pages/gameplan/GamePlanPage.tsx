import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import { Alert, Button, Spinner } from "../../components/ui";
import {
  fetchFollowUpLog,
  fetchGamePlanPrefs,
  fetchPlanActivity,
  fetchPlanEnquiries,
  fetchSalesPerson,
  logFollowUp,
  markQuoted,
  saveGamePlanPrefs,
  undoFollowUp,
} from "../../lib/api";
import { displayName } from "../../lib/display";
import { addDays, errorMessage, todayIso } from "../../lib/format";
import {
  buildGamePlan,
  countsBetween,
  defaultGoal,
  FOLLOW_UP_TO_DAYS,
  goalSource,
  lastMonthAtThisPoint,
  levelFor,
  monthLabel,
  monthPace,
  paceShare,
  personalBests,
  planHeadline,
  previousMonth,
  quickQuoteDays,
  quickQuoteStreak,
  seasonStart,
  streakWeek,
  winStack,
  xpEarned,
  type Mission,
} from "../../lib/gamePlan";
import { monthPeriod } from "../../lib/reports";
import type { GamePlanPrefs, GoalType } from "../../lib/types";
import { BestsCard, GoalCard, WinStackCard } from "./cards";
import { HighFivesCard } from "./HighFivesCard";
import { MakeItMine } from "./MakeItMine";
import { MissionsCard } from "./MissionsCard";
import { PersonPicker } from "./PersonPicker";
import { PlanHero } from "./PlanHero";
import { TeamVoyageCard } from "./TeamVoyage";

const HIGH_FIVE_FIELD = "high-five-to";
const NO_ACTIVITY = { followUps: 0, highFives: 0, highFivesToday: 0 };

/**
 * A sales person's home page: today's missions, the quick-quote streak, the monthly goal, records, high-fives
 * and the team voyage. Activity only: no profit or sales amounts (docs/DESIGN.md, "Game plan").
 */
export default function GamePlanPage({ salesPersonId }: { salesPersonId: string }) {
  const { profile, session, canEdit } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const self = profile?.sales_person_id === salesPersonId;

  const today = todayIso();
  const season = seasonStart(today);
  const from = addDays(today, -45) < season ? addDays(today, -45) : season;
  const month = monthPeriod(today);
  const prev = previousMonth(today);
  const prevRange = monthPeriod(prev);

  const person = useQuery({ queryKey: ["plan", "person", salesPersonId], queryFn: () => fetchSalesPerson(salesPersonId) });
  const enquiries = useQuery({ queryKey: ["plan", "enquiries", salesPersonId, from], queryFn: () => fetchPlanEnquiries(salesPersonId, from) });
  const followLog = useQuery({
    queryKey: ["plan", "follow-ups", salesPersonId, today],
    queryFn: () => fetchFollowUpLog(salesPersonId, addDays(today, -FOLLOW_UP_TO_DAYS)),
  });
  const activity = useQuery({ queryKey: ["plan", "activity", salesPersonId, season, today], queryFn: () => fetchPlanActivity(salesPersonId, season, today) });
  const prefsQuery = useQuery({ queryKey: ["prefs", userId], queryFn: () => fetchGamePlanPrefs(userId as string), enabled: self && !!userId });

  const [customizing, setCustomizing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const prefs: GamePlanPrefs = (self ? prefsQuery.data : undefined) ?? {};
  const hidden = new Set(prefs.hidden ?? []);
  const showXp = !hidden.has("xp");

  const invalidate = () => {
    for (const key of ["plan", "voyage", "register", "dashboard", "reports", "enquiry"]) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const quote = useMutation({
    mutationFn: (m: Mission) => markQuoted(m.enquiryId as string, today),
    onMutate: () => setActionError(null),
    onSuccess: (_, m) => {
      invalidate();
      setNotice(`${m.reference} marked as quoted today.${showXp ? ` +${m.xp} XP` : ""}`);
    },
    onError: (e, m) => setActionError(`${m.reference} could not be marked as quoted. ${errorMessage(e)}`),
  });
  const follow = useMutation({
    mutationFn: ({ m, done }: { m: Mission; done: boolean }) => (done ? logFollowUp : undoFollowUp)(m.enquiryId as string, salesPersonId, today),
    onMutate: () => setActionError(null),
    onSuccess: (_, { m, done }) => {
      queryClient.invalidateQueries({ queryKey: ["plan"] });
      if (done) setNotice(`Follow-up on ${m.reference} logged.${showXp ? ` +${m.xp} XP` : ""}`);
    },
    onError: (e, { m }) => setActionError(`The follow-up on ${m.reference} could not be saved. ${errorMessage(e)}`),
  });
  const savePrefs = useMutation({
    mutationFn: (next: GamePlanPrefs) => saveGamePlanPrefs(userId as string, next),
    onMutate: (next) => {
      setActionError(null);
      queryClient.setQueryData(["prefs", userId], next);
    },
    onError: (e) => {
      setActionError(`Your settings could not be saved. ${errorMessage(e)}`);
      queryClient.invalidateQueries({ queryKey: ["prefs", userId] });
    },
  });

  const rows = useMemo(() => enquiries.data ?? [], [enquiries.data]);
  const days = useMemo(() => quickQuoteDays(rows, today), [rows, today]);

  if (enquiries.isLoading || person.isLoading) return <Spinner label="Loading the game plan…" />;
  if (enquiries.error) return <Alert>The game plan could not be loaded. {errorMessage(enquiries.error)}</Alert>;

  const name = displayName(person.data?.name) || "there";
  const owner = self ? "My" : `${name}'s`;
  const counts = activity.data ?? NO_ACTIVITY;
  const followUps = followLog.data ?? [];
  const streak = quickQuoteStreak(days, season);
  const plan = buildGamePlan({ rows, today, followUps, highFiveGivenToday: counts.highFivesToday > 0 });
  const missions = hidden.has("highFives") ? plan.missions.filter((m) => m.kind !== "high_five") : plan.missions;

  const pace = monthPace(today);
  const thisMonth = countsBetween(rows, month.from, today);
  const lastMonth = countsBetween(rows, prevRange.from, prevRange.to);
  const defaults: Record<GoalType, number> = { wins: defaultGoal("wins", lastMonth), quotes: defaultGoal("quotes", lastMonth) };
  const goalType: GoalType = prefs.goalType ?? "wins";
  const target = prefs.goals?.[goalType] ?? defaults[goalType];
  const goalHint = prefs.goals?.[goalType] !== undefined ? "Your own goal" : goalSource(goalType, target, lastMonth, monthLabel(prev));
  // The pace marker follows last month's shape: wins bunch up later in a month, so a straight line is unfair early on.
  const goalDates = goalType === "wins" ? rows.filter((e) => e.status === "confirmed").map((e) => e.confirmed_date) : rows.map((e) => e.quoted_date);
  const lastPoint = lastMonthAtThisPoint(goalDates, today, pace);
  const fromLastMonth = lastPoint.total >= 5 && pace.done > 0;
  const marker = fromLastMonth
    ? `Marker: ${monthLabel(prev)} after ${pace.done} working ${pace.done === 1 ? "day" : "days"} (${lastPoint.byNow})`
    : "Marker: a steady pace through the month";

  const followUpsToday = followUps.filter((f) => f.followed_up_on === today).length;
  const xpSeason = xpEarned(rows, season, today, counts);
  const xpToday = xpEarned(rows, today, today, { followUps: followUpsToday, highFives: counts.highFivesToday });
  const busy = quote.isPending ? `quote:${quote.variables?.enquiryId}` : follow.isPending ? `follow:${follow.variables?.m.enquiryId}` : null;
  const secondaryError = followLog.error ?? activity.error;

  const focusHighFive = () => {
    const field = document.getElementById(HIGH_FIVE_FIELD);
    if (!field) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    field.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    field.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-4">
      {!self && (
        <Alert kind="info" action={<PersonPicker current={salesPersonId} />}>
          You're viewing {name}'s game plan. Personal goals and settings are private, so you see the defaults.
        </Alert>
      )}
      {actionError && (
        <Alert
          action={
            <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>
              Dismiss
            </Button>
          }
        >
          {actionError}
        </Alert>
      )}
      {secondaryError && <Alert kind="warning">Follow-ups and high-fives are not available yet. {errorMessage(secondaryError)}</Alert>}

      <PlanHero
        name={name}
        today={today}
        pace={pace}
        headline={planHeadline(missions, streak)}
        why={self ? (prefs.why ?? null) : null}
        streak={streak}
        week={streakWeek(days, today)}
        level={showXp ? levelFor(xpSeason) : null}
        xpToday={xpToday}
        vibe={prefs.vibe ?? "sun"}
        action={
          self ? (
            <Button variant="secondary" aria-expanded={customizing} aria-controls="make-it-mine" onClick={() => setCustomizing((open) => !open)}>
              <Icon name="sliders" />
              Make it mine
            </Button>
          ) : undefined
        }
      />

      {self && customizing && (
        <MakeItMine
          id="make-it-mine"
          prefs={prefs}
          goalType={goalType}
          target={target}
          defaults={defaults}
          lastMonthLabel={monthLabel(prev)}
          saving={savePrefs.isPending}
          onChange={(next) => savePrefs.mutate(next)}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <MissionsCard
          plan={{ ...plan, missions }}
          salesPersonId={salesPersonId}
          actions={{
            self,
            canEdit,
            showXp,
            busy,
            onMarkQuoted: (m) => quote.mutate(m),
            onFollowUp: (m, done) => follow.mutate({ m, done }),
            onHighFive: focusHighFive,
          }}
        />
        <GoalCard
          title={`${owner} ${monthLabel(today)} goal`}
          type={goalType}
          value={goalType === "wins" ? thisMonth.wins : thisMonth.quotes}
          target={target}
          hint={goalHint}
          share={paceShare(lastPoint, pace)}
          marker={marker}
          counts={thisMonth}
        />
      </div>

      {!hidden.has("team") && <TeamVoyageCard today={today} highlightId={salesPersonId} highlightName={self ? null : name} />}

      <div className="grid gap-4 lg:grid-cols-3">
        {!hidden.has("stack") && (
          <WinStackCard title={`${owner} win stack`} items={winStack(rows, month.from, month.to)} goal={prefs.goals?.wins ?? defaults.wins} today={today} />
        )}
        {!hidden.has("bests") && <BestsCard bests={personalBests(rows, today, streak)} />}
        {!hidden.has("highFives") && (
          <HighFivesCard
            salesPersonId={salesPersonId}
            name={name}
            self={self}
            mySalesPersonId={profile?.sales_person_id ?? null}
            today={today}
            selectId={HIGH_FIVE_FIELD}
            onGiven={(to) => setNotice(to ? `High-five sent to ${to}.` : "High-five sent.")}
          />
        )}
      </div>

      {notice && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-control bg-ink px-4 py-2.5 text-body font-medium text-white shadow-[0_8px_24px_rgba(25,36,59,0.25)]"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
