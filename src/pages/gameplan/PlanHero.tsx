import type { ReactNode } from "react";
import { Icon } from "../../components/icons";
import { dayLabel, RANKS, type Level, type MonthPace, type Streak, type WeekDay } from "../../lib/gamePlan";
import type { Vibe } from "../../lib/types";

/** Literal class names so Tailwind generates them. Text on every vibe is ink (4.5:1 or better). */
export const VIBE_BG: Record<Vibe, string> = {
  sun: "bg-vibe-sun",
  mint: "bg-vibe-mint",
  sky: "bg-vibe-sky",
  peach: "bg-vibe-peach",
};

const DAY_LOOK: Record<WeekDay["status"], { dot: string; text: string }> = {
  hit: { dot: "border-flame bg-flame text-white", text: "every enquiry quoted in time" },
  miss: { dot: "border-control bg-surface text-ink-muted", text: "a quote went out late" },
  pending: { dot: "border-dashed border-flame bg-surface", text: "still in time" },
  quiet: { dot: "border-line bg-surface", text: "no new enquiries" },
  upcoming: { dot: "border-line bg-surface", text: "still to come" },
};

function SunRays() {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return { deg, x1: 130 + 76 * Math.sin(r), y1: 130 - 76 * Math.cos(r), x2: 130 + 106 * Math.sin(r), y2: 130 - 106 * Math.cos(r) };
  });
  return (
    <svg viewBox="0 0 260 260" aria-hidden="true" className="pointer-events-none absolute -top-20 -right-16 size-64 text-white/45">
      <circle cx="130" cy="130" r="58" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="10" strokeLinecap="round">
        {rays.map((l) => (
          <line key={l.deg} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </g>
    </svg>
  );
}

function StreakCard({ streak, week }: { streak: Streak; week: WeekDay[] }) {
  return (
    <div className="flex items-center gap-4 rounded-panel bg-surface p-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-panel bg-flame-soft text-flame">
        <Icon name="flame" className="size-8" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-figure font-bold text-ink">{streak.current}-day streak</div>
        <p className="text-meta text-ink-muted">Days in a row with every enquiry quoted by the next working day.</p>
        <ol className="mt-2 flex flex-wrap gap-2" aria-label="This week">
          {week.map((d) => (
            <li key={d.day} className="flex flex-col items-center gap-1">
              <span className={`flex size-7 items-center justify-center rounded-full border-2 ${DAY_LOOK[d.status].dot}`} title={`${d.label}: ${DAY_LOOK[d.status].text}`}>
                {d.status === "hit" && <Icon name="check" className="size-3.5" />}
                {d.status === "miss" && <Icon name="close" className="size-3.5" />}
              </span>
              <span className={`text-meta ${d.isToday ? "font-semibold text-ink" : "text-ink-muted"}`}>
                {d.label}
                <span className="sr-only">: {DAY_LOOK[d.status].text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function LevelCard({ level, xpToday, season }: { level: Level; xpToday: number; season: string }) {
  const next = RANKS[Math.min(level.level, RANKS.length - 1)];
  return (
    <div className="rounded-panel bg-surface p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-meta font-medium text-ink-muted">
            Season {season} · level {level.level}
          </div>
          <div className="text-figure font-bold text-ink">{level.rank}</div>
        </div>
        <div className="text-meta tabular-nums text-ink-muted">
          {level.into.toLocaleString("en-US")} / {level.span.toLocaleString("en-US")} XP
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={`Progress through level ${level.level}`}
        aria-valuemin={0}
        aria-valuemax={level.span}
        aria-valuenow={level.into}
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-selected"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((level.into / level.span) * 100)}%` }} />
      </div>
      <p className="mt-2 text-meta text-ink-muted">
        {xpToday > 0 ? `+${xpToday} XP today. ` : ""}
        {(level.span - level.into).toLocaleString("en-US")} XP to level {level.level + 1}
        {level.level < RANKS.length ? `, ${next}` : ""}.
      </p>
    </div>
  );
}

export function PlanHero({
  name,
  today,
  pace,
  headline,
  why,
  streak,
  week,
  level,
  xpToday,
  vibe,
  action,
}: {
  name: string;
  today: string;
  pace: MonthPace;
  headline: string;
  why: string | null;
  streak: Streak;
  week: WeekDay[];
  /** Hidden when the person switched XP off. */
  level: Level | null;
  xpToday: number;
  vibe: Vibe;
  action?: ReactNode;
}) {
  return (
    <section className={`relative overflow-hidden rounded-panel px-5 py-6 sm:px-8 sm:py-8 ${VIBE_BG[vibe]}`}>
      <SunRays />
      <div className="relative flex flex-wrap items-stretch gap-6">
        <div className="flex min-w-0 flex-[1_1_26rem] flex-col justify-center gap-3 text-ink">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta font-semibold text-ink-heading">
              {dayLabel(today)} · day {pace.day} of {pace.total}
            </p>
            {action}
          </div>
          <h1 className="text-hero font-extrabold">Let's go, {name}.</h1>
          <p className="max-w-2xl text-title font-medium">{headline}</p>
          {why && (
            <p className="inline-flex w-fit max-w-full items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-body font-medium text-white">
              <Icon name="star" className="size-4 text-vibe-sun" />
              <span className="min-w-0 truncate">Working for: {why}</span>
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_19rem] flex-col justify-center gap-3">
          <StreakCard streak={streak} week={week} />
          {level && <LevelCard level={level} xpToday={xpToday} season={today.slice(0, 4)} />}
        </div>
      </div>
    </section>
  );
}
