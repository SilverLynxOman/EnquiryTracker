import { daysBetween, displayName, shortPort } from "./display";
import { addDays } from "./format";
import { monthPeriod, weekPeriod } from "./reports";
import type { FollowUpLog, GoalType, PlanEnquiry, ShipmentMode, TeamWin } from "./types";

// The game plan (a sales person's home page) and the team voyage. Every number on those pages is computed here
// from register rows: activity only (quotes, wins, streaks, follow-ups), never money. Pure functions, so they
// are unit-tested in gamePlan.test.ts. Rules for how they look: docs/DESIGN.md, "Game plan".

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "November" */
export function monthLabel(iso: string): string {
  return MONTH_NAMES[Number(iso.slice(5, 7)) - 1];
}

/** "Thursday 5 November" */
export function dayLabel(iso: string): string {
  return `${DAY_NAMES[weekday(iso)]} ${Number(iso.slice(8, 10))} ${monthLabel(iso)}`;
}

/** The previous calendar month's first day. */
export function previousMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

// --- Working days --------------------------------------------------------------

/** Oman's working week runs Sunday to Thursday. Public holidays are not known to the app. */
export function isWorkingDay(iso: string): boolean {
  const day = weekday(iso);
  return day !== 5 && day !== 6;
}

/** The first working day after the date. */
export function nextWorkingDay(iso: string): string {
  let d = addDays(iso, 1);
  while (!isWorkingDay(d)) d = addDays(d, 1);
  return d;
}

export interface MonthPace {
  /** Working days in the month. */
  total: number;
  /** Working days before today. */
  done: number;
  /** Today as "day N of total" (on a weekend: the working days so far). */
  day: number;
  /** Share of the month's working days behind us: where a steady pace stands at the start of today (0–1). */
  share: number;
}

export function monthPace(today: string): MonthPace {
  const { from, to } = monthPeriod(today);
  let total = 0;
  let done = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    total++;
    if (d < today) done++;
  }
  return { total, done, day: done + (isWorkingDay(today) ? 1 : 0), share: total ? done / total : 0 };
}

/** The date of a month's Nth working day; its last working day when it has fewer (null for N below 1). */
export function nthWorkingDay(monthIso: string, n: number): string | null {
  if (n < 1) return null;
  const { from, to } = monthPeriod(monthIso);
  let count = 0;
  let last: string | null = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    count++;
    last = d;
    if (count === n) return d;
  }
  return last;
}

export interface LastMonthPoint {
  /** Last month's count after as many working days as this month has behind it. */
  byNow: number;
  /** Last month's whole count. */
  total: number;
}

/**
 * Where last month stood at this point. Confirmations bunch up later in a month, so this is a fairer yardstick
 * than a straight line (or a projection) early on: the team had 25 of October's 161 jobs after five working days.
 */
export function lastMonthAtThisPoint(dates: (string | null)[], today: string, pace: MonthPace): LastMonthPoint {
  const prev = monthPeriod(previousMonth(today));
  const inPrev = dates.filter((d): d is string => !!d && d >= prev.from && d <= prev.to);
  const cutoff = nthWorkingDay(prev.from, pace.done);
  return { byNow: cutoff ? inPrev.filter((d) => d <= cutoff).length : 0, total: inPrev.length };
}

/** Where a steady pace stands today (0–1): last month's shape when it had enough activity, otherwise working days. */
export function paceShare(last: LastMonthPoint, pace: MonthPace, minimum = 5): number {
  return last.total >= minimum ? last.byNow / last.total : pace.share;
}

// --- Quick quotes and the streak -----------------------------------------------

/** A quote is quick when it goes out by the end of the next working day after the enquiry arrived. */
export function quoteDeadline(enquiryDate: string): string {
  return nextWorkingDay(enquiryDate);
}

export function isQuickQuote(e: Pick<PlanEnquiry, "enquiry_date" | "quoted_date">): boolean {
  return !!e.quoted_date && e.quoted_date <= quoteDeadline(e.enquiry_date);
}

/** hit: every enquiry that arrived that day was quoted quickly. pending: some still can be. miss: one was not. */
export type DayStatus = "hit" | "miss" | "pending";

/** The quick-quote result of every day on which enquiries arrived. Cancelled, and lost without a quote, don't count. */
export function quickQuoteDays(rows: PlanEnquiry[], today: string): Map<string, DayStatus> {
  const out = new Map<string, DayStatus>();
  for (const e of rows) {
    if (e.enquiry_date > today || e.status === "cancelled" || (e.status === "lost" && !e.quoted_date)) continue;
    let status: DayStatus = "hit";
    if (!isQuickQuote(e)) status = !e.quoted_date && today <= quoteDeadline(e.enquiry_date) ? "pending" : "miss";
    const prev = out.get(e.enquiry_date);
    if (!prev || status === "miss" || (status === "pending" && prev === "hit")) out.set(e.enquiry_date, status);
  }
  return out;
}

export interface Streak {
  /** Days in a row, up to now, on which every enquiry was quoted quickly. Pending days neither add nor break. */
  current: number;
  /** Longest run reaching into the season (`since` onwards). */
  best: number;
  /** Days still pending: quoting their enquiries in time adds them to the streak. */
  pending: number;
}

export function quickQuoteStreak(days: Map<string, DayStatus>, since: string): Streak {
  let current = 0;
  let best = 0;
  let pending = 0;
  for (const day of [...days.keys()].sort()) {
    const status = days.get(day);
    if (status === "pending") {
      pending++;
    } else if (status === "miss") {
      current = 0;
    } else {
      current++;
      if (day >= since) best = Math.max(best, current);
    }
  }
  return { current, best, pending };
}

export interface WeekDay {
  day: string;
  label: string;
  status: DayStatus | "quiet" | "upcoming";
  isToday: boolean;
}

const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu"];

/** Sunday to Thursday of the current week (the app's weeks run Saturday to Friday). */
export function streakWeek(days: Map<string, DayStatus>, today: string): WeekDay[] {
  const saturday = weekPeriod(today).from;
  return WEEK_LABELS.map((label, i) => {
    const day = addDays(saturday, i + 1);
    return { day, label, isToday: day === today, status: day > today ? "upcoming" : (days.get(day) ?? "quiet") };
  });
}

// --- XP and levels (a season is a calendar year) ----------------------------------

export const XP = { quote: 10, quickBonus: 10, win: 50, followUp: 5, highFive: 5 } as const;

export const RANKS = [
  "Cadet", "Deckhand", "Able seaman", "Bosun", "Navigator", "Second mate", "First mate", "Captain", "Commodore", "Admiral",
] as const;

export function seasonStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/** XP at which a level starts: 0, 500, 1,500, 3,000 … (each level takes 500 XP more than the one before). */
export function levelStart(level: number): number {
  return 250 * level * (level - 1);
}

export interface Level {
  level: number;
  rank: string;
  /** XP earned inside this level, and the XP the level spans. */
  into: number;
  span: number;
}

export function levelFor(xp: number): Level {
  let level = 1;
  while (levelStart(level + 1) <= xp) level++;
  const start = levelStart(level);
  return { level, rank: RANKS[Math.min(level, RANKS.length) - 1], into: xp - start, span: levelStart(level + 1) - start };
}

export interface ActivityCounts {
  followUps: number;
  highFives: number;
}

/** XP for quotes, quick quotes and wins dated from `since` to `today`, plus follow-ups and high-fives given. */
export function xpEarned(rows: PlanEnquiry[], since: string, today: string, counts: ActivityCounts): number {
  let xp = counts.followUps * XP.followUp + counts.highFives * XP.highFive;
  for (const e of rows) {
    if (e.quoted_date && e.quoted_date >= since && e.quoted_date <= today) xp += XP.quote + (isQuickQuote(e) ? XP.quickBonus : 0);
    if (e.status === "confirmed" && e.confirmed_date && e.confirmed_date >= since && e.confirmed_date <= today) xp += XP.win;
  }
  return xp;
}

// --- Today's game plan ------------------------------------------------------------

/** Enquiries waiting longer than this are left to the register's Awaiting quote tab. */
export const QUOTE_WINDOW_DAYS = 30;
export const MAX_QUOTE_MISSIONS = 6;
/** Follow-ups: quotes 3 to 30 days old, freshest first, three a day. A followed-up quote rests for a week. */
export const FOLLOW_UP_FROM_DAYS = 3;
export const FOLLOW_UP_TO_DAYS = 30;
export const FOLLOW_UPS_PER_DAY = 3;
export const FOLLOW_UP_REST_DAYS = 7;

export type MissionKind = "quote" | "follow_up" | "high_five";

export interface Mission {
  key: string;
  kind: MissionKind;
  title: string;
  detail: string;
  done: boolean;
  /** XP the mission earns (or earned). */
  xp: number;
  enquiryId?: string;
  reference?: string;
}

export interface GamePlan {
  missions: Mission[];
  /** Awaiting quote in the window beyond the missions shown. */
  moreToQuote: number;
  /** Awaiting quote for longer than the window. */
  olderWaiting: number;
}

function waitText(days: number): string {
  if (days <= 0) return "arrived today";
  if (days === 1) return "waiting since yesterday";
  return `waiting ${days} days`;
}

export function buildGamePlan(input: {
  rows: PlanEnquiry[];
  today: string;
  followUps: FollowUpLog[];
  highFiveGivenToday: boolean;
}): GamePlan {
  const { rows, today, followUps } = input;
  const customer = (e: PlanEnquiry) => displayName(e.customer_name);
  const oldestFirst = (date: (e: PlanEnquiry) => string) => (a: PlanEnquiry, b: PlanEnquiry) =>
    date(a).localeCompare(date(b)) || a.reference.localeCompare(b.reference);

  const waiting = rows.filter((e) => e.status === "new").sort(oldestFirst((e) => e.enquiry_date));
  const recent = waiting.filter((e) => daysBetween(e.enquiry_date, today) <= QUOTE_WINDOW_DAYS);
  const quoteTodo: Mission[] = recent.slice(0, MAX_QUOTE_MISSIONS).map((e) => ({
    key: `quote:${e.id}`,
    kind: "quote",
    title: `Quote ${customer(e)}`,
    detail: `${e.reference} · ${waitText(daysBetween(e.enquiry_date, today))}`,
    done: false,
    xp: XP.quote + (today <= quoteDeadline(e.enquiry_date) ? XP.quickBonus : 0),
    enquiryId: e.id,
    reference: e.reference,
  }));
  const quoteDone: Mission[] = rows
    .filter((e) => e.quoted_date === today)
    .sort(oldestFirst((e) => e.enquiry_date))
    .map((e) => ({
      key: `quote:${e.id}`,
      kind: "quote",
      title: `Quote ${customer(e)}`,
      detail: `${e.reference} · quoted today`,
      done: true,
      xp: XP.quote + (isQuickQuote(e) ? XP.quickBonus : 0),
      enquiryId: e.id,
      reference: e.reference,
    }));

  const lastFollowUp = new Map<string, string>();
  for (const f of followUps) {
    if (f.followed_up_on > (lastFollowUp.get(f.enquiry_id) ?? "")) lastFollowUp.set(f.enquiry_id, f.followed_up_on);
  }
  const byId = new Map(rows.map((e) => [e.id, e]));
  const followDone: Mission[] = [...new Set(followUps.filter((f) => f.followed_up_on === today).map((f) => f.enquiry_id))]
    .map((id) => byId.get(id))
    .filter((e): e is PlanEnquiry => !!e)
    .map((e) => ({
      key: `follow:${e.id}`,
      kind: "follow_up",
      title: `Follow up ${customer(e)}`,
      detail: `${e.reference} · followed up today`,
      done: true,
      xp: XP.followUp,
      enquiryId: e.id,
      reference: e.reference,
    }));
  const followTodo: Mission[] = rows
    .filter((e) => {
      if (e.status !== "quoted" || !e.quoted_date) return false;
      const age = daysBetween(e.quoted_date, today);
      const last = lastFollowUp.get(e.id);
      return age >= FOLLOW_UP_FROM_DAYS && age <= FOLLOW_UP_TO_DAYS && !(last && daysBetween(last, today) < FOLLOW_UP_REST_DAYS);
    })
    .sort((a, b) => (b.quoted_date ?? "").localeCompare(a.quoted_date ?? "") || a.reference.localeCompare(b.reference))
    .slice(0, Math.max(0, FOLLOW_UPS_PER_DAY - followDone.length))
    .map((e) => {
      const age = daysBetween(e.quoted_date ?? today, today);
      return {
        key: `follow:${e.id}`,
        kind: "follow_up",
        title: `Follow up ${customer(e)}`,
        detail: `${e.reference} · quoted ${plural(age, "day")} ago${age >= 14 ? ". Win it or close it." : ""}`,
        done: false,
        xp: XP.followUp,
        enquiryId: e.id,
        reference: e.reference,
      };
    });

  const highFive: Mission = {
    key: "high-five",
    kind: "high_five",
    title: "Give a teammate a high-five",
    detail: input.highFiveGivenToday ? "Given today. Nice one." : "Celebrate a win or say thanks.",
    done: input.highFiveGivenToday,
    xp: XP.highFive,
  };

  return {
    missions: [...quoteTodo, ...quoteDone, ...followTodo, ...followDone, highFive],
    moreToQuote: recent.length - quoteTodo.length,
    olderWaiting: waiting.length - recent.length,
  };
}

/** The line under the greeting. */
export function planHeadline(missions: Mission[], streak: Streak): string {
  const left = missions.filter((m) => !m.done).length;
  if (left === 0) {
    return streak.current >= 2 ? `Game plan complete, on a ${streak.current}-day streak. That's momentum.` : "Game plan complete. That's momentum.";
  }
  const lead = `${plural(left, "mission")} left on today's plan.`;
  if (streak.pending > 0) return `${lead} Quote the new enquiries in time and your streak grows to ${streak.current + streak.pending}.`;
  if (streak.current >= 2) return `${lead} Your ${streak.current}-day streak is safe.`;
  return `${lead} Let's get ${left === 1 ? "it" : "them"} done.`;
}

// --- Monthly goal, personal bests, win stack ------------------------------------------

export interface PeriodCounts {
  enquiries: number;
  quotes: number;
  quick: number;
  wins: number;
}

export function countsBetween(rows: PlanEnquiry[], from: string, to: string): PeriodCounts {
  const within = (d: string | null) => !!d && d >= from && d <= to;
  const out: PeriodCounts = { enquiries: 0, quotes: 0, quick: 0, wins: 0 };
  for (const e of rows) {
    if (within(e.enquiry_date) && e.status !== "cancelled") out.enquiries++;
    if (within(e.quoted_date)) {
      out.quotes++;
      if (isQuickQuote(e)) out.quick++;
    }
    if (e.status === "confirmed" && within(e.confirmed_date)) out.wins++;
  }
  return out;
}

/** Without a goal of their own: beat last month (at least 3 wins, or 10 quotes in steps of 5). */
export function defaultGoal(type: GoalType, lastMonth: PeriodCounts): number {
  return type === "wins" ? Math.max(3, lastMonth.wins + 1) : Math.max(10, Math.ceil((lastMonth.quotes + 1) / 5) * 5);
}

export const GOAL_STEP: Record<GoalType, number> = { wins: 1, quotes: 5 };

export type PaceStatus = "smashed" | "ahead" | "on_pace" | "behind";

/**
 * Against the pace marker (`share` of the target by today). Within one of the marker counts as on pace, so 4 wins
 * against an expected 4.1 isn't "behind". `gap` is how many more get a goal back on pace.
 */
export function goalPace(value: number, target: number, share: number): { status: PaceStatus; gap: number } {
  if (value >= target) return { status: "smashed", gap: 0 };
  const expected = target * share;
  if (value >= expected + 1) return { status: "ahead", gap: 0 };
  if (value >= Math.floor(expected)) return { status: "on_pace", gap: 0 };
  return { status: "behind", gap: Math.floor(expected) - value };
}

/** Where a default goal comes from: "Goal: beat October (35)", or a starter goal after a month with none. */
export function goalSource(type: GoalType, target: number, lastMonth: PeriodCounts, lastMonthName: string): string {
  const last = type === "wins" ? lastMonth.wins : lastMonth.quotes;
  return last > 0 ? `Goal: beat ${lastMonthName} (${last})` : `Goal: a first target of ${target}`;
}

export interface Best {
  key: "week_quotes" | "month_wins" | "streak";
  label: string;
  unit: string;
  current: number;
  /** The record this season: earlier weeks / months, or the longest streak (which may be the current one). */
  best: number;
}

export function personalBests(rows: PlanEnquiry[], today: string, streak: Streak): Best[] {
  const season = seasonStart(today);
  const thisWeek = weekPeriod(today).from;
  const thisMonth = today.slice(0, 7);
  const weeks = new Map<string, number>();
  const months = new Map<string, number>();
  for (const e of rows) {
    if (e.quoted_date && e.quoted_date >= season && e.quoted_date <= today) {
      const w = weekPeriod(e.quoted_date).from;
      weeks.set(w, (weeks.get(w) ?? 0) + 1);
    }
    if (e.status === "confirmed" && e.confirmed_date && e.confirmed_date >= season && e.confirmed_date <= today) {
      const m = e.confirmed_date.slice(0, 7);
      months.set(m, (months.get(m) ?? 0) + 1);
    }
  }
  const before = (map: Map<string, number>, current: string) => Math.max(0, ...[...map].filter(([k]) => k !== current).map(([, n]) => n));
  return [
    { key: "week_quotes", label: "Quotes this week", unit: "quote", current: weeks.get(thisWeek) ?? 0, best: before(weeks, thisWeek) },
    { key: "month_wins", label: "Wins this month", unit: "win", current: months.get(thisMonth) ?? 0, best: before(months, thisMonth) },
    { key: "streak", label: "Quick-quote streak", unit: "day", current: streak.current, best: streak.best },
  ];
}

export function bestNote(b: Best): string {
  const n = (count: number) => plural(count, b.unit);
  const more = (count: number) => `${count} more ${b.unit}${count === 1 ? "" : "s"}`;
  if (b.best === 0) return b.current > 0 ? `${n(b.current)} so far. Your first record is being set.` : "No record yet. The first one is yours to set.";
  if (b.key === "streak" && b.current >= b.best) return `${n(b.current)}: your best this season. Every quick day adds to it.`;
  if (b.current > b.best) return `New record: ${n(b.current)}, beating ${b.best}.`;
  return `${n(b.current)} so far. ${more(b.best - b.current + 1)} for a new record.`;
}

/** "Shanghai → Sohar" (ports without their country). */
export function laneLabel(pol: string | null, pod: string | null): string {
  const from = shortPort(pol);
  const to = shortPort(pod);
  return from || to ? `${from || "?"} → ${to || "?"}` : "";
}

export interface StackItem {
  id: string;
  reference: string;
  mode: ShipmentMode | null;
  lane: string;
  date: string;
}

/** The sales person's confirmed jobs in the range, oldest first: one container each. */
export function winStack(rows: PlanEnquiry[], from: string, to: string): StackItem[] {
  return rows
    .filter((e) => e.status === "confirmed" && !!e.confirmed_date && e.confirmed_date >= from && e.confirmed_date <= to)
    .sort((a, b) => (a.confirmed_date ?? "").localeCompare(b.confirmed_date ?? "") || a.reference.localeCompare(b.reference))
    .map((e) => ({ id: e.id, reference: e.reference, mode: e.shipment_mode, lane: laneLabel(e.pol, e.pod), date: e.confirmed_date ?? "" }));
}

// --- Team voyage: one container per confirmed job ------------------------------------

export const CREW_COLOURS = 12;

export interface CrewMember {
  /** Sales person id; "" for jobs without one. */
  id: string;
  name: string;
  wins: number;
  /** 1–12 (`--color-crew-N`) in order of each person's first win this month, so colours never move; 0 when unassigned. */
  colour: number;
}

export function crewOf(wins: TeamWin[]): CrewMember[] {
  const byId = new Map<string, CrewMember>();
  let next = 0;
  for (const w of wins) {
    const id = w.sales_person_id ?? "";
    let member = byId.get(id);
    if (!member) {
      member = { id, name: id ? displayName(w.sales_person_name) || "Unknown" : "Unassigned", wins: 0, colour: id ? (next++ % CREW_COLOURS) + 1 : 0 };
      byId.set(id, member);
    }
    member.wins++;
  }
  return [...byId.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}

/** Without a goal set by an admin: beat last month. */
export function defaultTeamGoal(lastMonthConfirmed: number): number {
  return Math.max(10, lastMonthConfirmed + 1);
}

/** Rows of containers on the ship, so a bigger goal makes a longer ship rather than a taller one. */
export function shipRows(capacity: number): number {
  if (capacity <= 40) return 4;
  if (capacity <= 90) return 5;
  if (capacity <= 160) return 6;
  if (capacity <= 250) return 7;
  return 8;
}

/** "SILVER LYNX COMPANY LLC" → "SILVER LYNX": the name painted on the hull. */
export function shipName(company: string | undefined): string {
  const name = (company ?? "")
    .toUpperCase()
    .replace(/\b(COMPANY|CO|LLC|L\.L\.C|SAOC|SAOG|SPC|LTD|LIMITED|WLL)\b\.?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || "ENQUIRY TRACKER";
}

export interface MonthTotal {
  month: string;
  confirmed: number;
}

/** The best month before the current one (null without history). */
export function teamRecord(months: MonthTotal[], currentMonth: string): MonthTotal | null {
  let best: MonthTotal | null = null;
  for (const m of months) {
    if (m.month < currentMonth && (!best || m.confirmed > best.confirmed)) best = m;
  }
  return best && best.confirmed > 0 ? best : null;
}
