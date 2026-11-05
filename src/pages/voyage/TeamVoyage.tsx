import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import { Alert, Button, buttonClass, inputClass, Spinner } from "../../components/ui";
import { fetchTeamConfirmedByMonth, fetchTeamGoal, fetchTeamWins, saveTeamGoal } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import { lastOfMonth, monthPeriod } from "../../lib/reports";
import { crewOf, defaultTeamGoal, teamRecord, type CrewMember } from "../../lib/teamVoyage";
import type { TeamWin } from "../../lib/types";
import { lastMonthAtThisPoint, monthLabel, monthPace, previousMonth } from "../../lib/workdays";
import { CREW_BG, TeamShip, type ShipSlot } from "./TeamShip";

/** This month's confirmed jobs against the team goal (set by an admin, or "beat last month"). */
export function useTeamVoyage(today: string, refetchInterval?: number) {
  const month = monthPeriod(today);
  const prev = previousMonth(today);
  const prevMonth = monthPeriod(prev);
  const yearBack = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
  const wins = useQuery({ queryKey: ["voyage", "wins", month.from, month.to], queryFn: () => fetchTeamWins(month.from, month.to), refetchInterval });
  const prevWins = useQuery({ queryKey: ["voyage", "wins", prevMonth.from, prevMonth.to], queryFn: () => fetchTeamWins(prevMonth.from, prevMonth.to) });
  const goal = useQuery({ queryKey: ["voyage", "goal", month.from], queryFn: () => fetchTeamGoal(month.from), refetchInterval });
  // The whole team's months, also for sales staff (the register shows them only their own enquiries).
  const trend = useQuery({ queryKey: ["voyage", "trend", yearBack, prev], queryFn: () => fetchTeamConfirmedByMonth(yearBack, lastOfMonth(prev)) });

  const lastMonth = trend.data?.find((m) => m.month === prev)?.confirmed ?? 0;
  const loaded = wins.data?.length ?? 0;
  const target = goal.data ?? defaultTeamGoal(lastMonth);
  const pace = monthPace(today);
  return {
    month: month.from,
    wins: wins.data ?? [],
    crew: crewOf(wins.data ?? []),
    loaded,
    target,
    goalIsSet: goal.data != null,
    goalError: goal.error,
    lastMonth,
    lastMonthLabel: monthLabel(prev),
    /** Last month after as many working days as this one has behind it (null on the first working day). */
    lastPoint: pace.done > 0 && prevWins.data ? lastMonthAtThisPoint(prevWins.data.map((w) => w.confirmed_date), today, pace) : null,
    record: teamRecord(trend.data ?? [], month.from),
    pace,
    loading: wins.isLoading || trend.isLoading,
    error: wins.error ?? trend.error,
  };
}

export type TeamVoyage = ReturnType<typeof useTeamVoyage>;

/** One slot per container up to the goal (or beyond, once the goal is passed). */
export function shipSlots(wins: TeamWin[], crew: CrewMember[], target: number): ShipSlot[] {
  const byId = new Map(crew.map((c) => [c.id, c]));
  const capacity = Math.max(target, wins.length);
  return Array.from({ length: capacity }, (_, i) => {
    const w = wins[i];
    if (!w) {
      const next = i === wins.length;
      return { key: `slot-${i}`, colour: null, next, title: next ? `Container ${i + 1}: the next win` : `Container ${i + 1}` };
    }
    const member = byId.get(w.sales_person_id ?? "");
    return {
      key: w.id,
      colour: member?.colour ?? 0,
      title: `Container ${i + 1}: ${member?.name ?? "Unassigned"}${w.reference ? `, ${w.reference}` : ""}`,
    };
  });
}

/** "8 more to draw level with October" / "3 ahead of October at this point". */
export function comparedWithLastMonth(v: TeamVoyage): string | null {
  if (!v.lastPoint) return null;
  const diff = v.loaded - v.lastPoint.byNow;
  if (diff > 0) return `${diff} ahead of ${v.lastMonthLabel} at this point.`;
  if (diff === 0) return `Level with ${v.lastMonthLabel} at this point.`;
  return `${-diff} more to draw level with ${v.lastMonthLabel} at this point.`;
}

export function shipLabel(v: TeamVoyage): string {
  const crew = v.crew.map((c) => `${c.name} ${c.wins}`).join(", ");
  return `${v.loaded} of ${v.target} containers loaded this month${crew ? `: ${crew}` : ""}.`;
}

export function CrewChip({ member, link }: { member: CrewMember; link: boolean }) {
  const content = (
    <>
      <span className={`stripes h-3 w-5 shrink-0 rounded-[2px] ${CREW_BG[member.colour] ?? CREW_BG[0]}`} aria-hidden="true" />
      <span className="font-medium text-ink">{member.name}</span>
      <span className="tabular-nums text-ink-muted">{member.wins}</span>
    </>
  );
  const cls = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-meta";
  return link && member.id ? (
    <Link to={`/plan/${member.id}`} className={`${cls} hover:border-control hover:bg-row-hover`} title={`Open ${member.name}'s open quotes`}>
      {content}
    </Link>
  ) : (
    <span className={cls}>{content}</span>
  );
}

function GoalEditor({ month, current, onDone }: { month: string; current: number; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(current));
  const save = useMutation({
    mutationFn: (n: number) => saveTeamGoal(month, n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voyage", "goal"] });
      onDone();
    },
  });
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= 100000;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate(n);
      }}
    >
      <label className="block">
        <span className="mb-1 block text-meta font-medium text-ink-heading">Team goal for {monthLabel(month)} (confirmed jobs)</span>
        <input type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} w-32`} autoFocus />
      </label>
      <Button type="submit" variant="secondary" loading={save.isPending} disabled={!valid}>
        Save goal
      </Button>
      <Button variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      {save.error && <p className="w-full text-meta text-lost">The goal could not be saved. {errorMessage(save.error)}</p>}
    </form>
  );
}

/** The team ship as a card on the managers' dashboard. */
export function TeamVoyageCard({
  today,
  personLinks = false,
  actions,
}: {
  today: string;
  /** Crew chips open that sales person's open quotes (The Window). */
  personLinks?: boolean;
  actions?: ReactNode;
}) {
  const { isAdmin } = useAuth();
  const v = useTeamVoyage(today);
  const [editing, setEditing] = useState(false);
  const slots = shipSlots(v.wins, v.crew, v.target);
  const left = Math.max(0, v.target - v.loaded);

  return (
    <section className="rounded-panel border border-line bg-surface">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
          <Icon name="ship" className="size-4 text-ink-heading" />
          The {monthLabel(v.month)} voyage
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {isAdmin && !editing && !v.goalError && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Icon name="target" />
              {v.goalIsSet ? "Change goal" : "Set goal"}
            </Button>
          )}
          <Link to="/tv" className={buttonClass("secondary", "sm")}>
            <Icon name="tv" />
            TV view
          </Link>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {v.error ? (
          <Alert>The team voyage could not be loaded. {errorMessage(v.error)}</Alert>
        ) : v.loading ? (
          <Spinner />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <p className="text-ink">
                <span className="text-figure font-bold">{v.loaded}</span>
                <span className="text-body text-ink-heading"> of {v.target} containers loaded. </span>
                <span className="text-body text-ink-muted">{comparedWithLastMonth(v) ?? "One container per confirmed job."}</span>
              </p>
              <dl className="flex flex-wrap gap-x-5 gap-y-1 text-meta">
                <div className="flex gap-1">
                  <dt className="text-ink-muted">Goal</dt>
                  <dd className="font-medium text-ink">{v.goalIsSet ? "set by management" : `beat ${v.lastMonthLabel} (${v.lastMonth})`}</dd>
                </div>
                {v.lastPoint && (
                  <div className="flex gap-1" title={`Jobs confirmed in the first ${v.pace.done} working days of ${v.lastMonthLabel}`}>
                    <dt className="text-ink-muted">{v.lastMonthLabel} at this point</dt>
                    <dd className={`font-medium ${v.loaded >= v.lastPoint.byNow ? "text-confirmed" : "text-ink"}`}>{v.lastPoint.byNow}</dd>
                  </div>
                )}
                {v.record && (
                  <div className="flex gap-1">
                    <dt className="text-ink-muted">Record</dt>
                    <dd className="font-medium text-ink">
                      {v.record.confirmed} in {monthLabel(v.record.month)}
                    </dd>
                  </div>
                )}
                <div className="flex gap-1">
                  <dt className="text-ink-muted">To go</dt>
                  <dd className="font-medium text-ink">{left === 0 ? "goal reached" : left}</dd>
                </div>
              </dl>
            </div>
            {editing && <GoalEditor month={v.month} current={v.target} onDone={() => setEditing(false)} />}
            <TeamShip slots={slots} label={shipLabel(v)} />
            <div className="flex flex-wrap items-center gap-2">
              {v.crew.length === 0 ? (
                <p className="text-meta text-ink-muted">No confirmed jobs yet this month. The first container is up for grabs.</p>
              ) : (
                v.crew.map((m) => <CrewChip key={m.id || "unassigned"} member={m} link={personLinks} />)
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
