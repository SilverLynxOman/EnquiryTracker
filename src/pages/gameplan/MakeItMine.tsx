import { useState } from "react";
import { Button, Card, inputClass } from "../../components/ui";
import { GOAL_STEP } from "../../lib/gamePlan";
import type { GamePlanPrefs, GoalType, PlanSection, Vibe } from "../../lib/types";
import { VIBE_BG } from "./PlanHero";

const VIBES: { key: Vibe; label: string }[] = [
  { key: "sun", label: "Sunshine" },
  { key: "mint", label: "Mint" },
  { key: "sky", label: "Sky" },
  { key: "peach", label: "Peach" },
];

const SECTIONS: { key: PlanSection; label: string }[] = [
  { key: "xp", label: "Levels and XP" },
  { key: "team", label: "Team voyage" },
  { key: "stack", label: "Win stack" },
  { key: "bests", label: "Beat your best" },
  { key: "highFives", label: "High-fives" },
];

const segment = (on: boolean) =>
  `h-9 flex-1 rounded-control px-3 text-control font-medium transition-colors duration-150 ${on ? "bg-surface text-ink ring-1 ring-control" : "text-ink-heading hover:text-ink"}`;

/** The person's own settings. Saved as they change; private to them (user_prefs, Row Level Security). */
export function MakeItMine({
  id,
  prefs,
  goalType,
  target,
  defaults,
  lastMonthLabel,
  saving,
  onChange,
}: {
  id: string;
  prefs: GamePlanPrefs;
  goalType: GoalType;
  target: number;
  defaults: Record<GoalType, number>;
  lastMonthLabel: string;
  saving: boolean;
  onChange: (next: GamePlanPrefs) => void;
}) {
  const [why, setWhy] = useState(prefs.why ?? "");
  const hidden = new Set(prefs.hidden ?? []);
  const step = GOAL_STEP[goalType];
  const custom = prefs.goals?.[goalType] !== undefined;
  const setGoal = (n: number) => onChange({ ...prefs, goals: { ...prefs.goals, [goalType]: Math.max(step, n) } });
  const saveWhy = () => {
    const text = why.trim();
    if (text !== (prefs.why ?? "")) onChange({ ...prefs, why: text || undefined });
  };

  return (
    <Card title="Make it mine" actions={<span className="text-meta text-ink-muted">{saving ? "Saving…" : "Only you see these settings"}</span>}>
      <div id={id} className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <div className="text-meta font-medium text-ink-heading">Goal I'm chasing</div>
          <div className="flex gap-1 rounded-control bg-table-head p-1" role="group" aria-label="Goal I'm chasing">
            {(["wins", "quotes"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={goalType === t} className={segment(goalType === t)} onClick={() => onChange({ ...prefs, goalType: t })}>
                {t === "wins" ? "Wins" : "Quotes"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="secondary" aria-label="Lower my goal" onClick={() => setGoal(target - step)}>
              −
            </Button>
            <div className="min-w-0 flex-1 text-center">
              <div className="text-figure font-bold text-ink">{target}</div>
              <div className="text-meta text-ink-muted">{goalType} this month</div>
            </div>
            <Button variant="secondary" aria-label="Raise my goal" onClick={() => setGoal(target + step)}>
              +
            </Button>
          </div>
          <p className="text-meta text-ink-muted">
            {custom ? (
              <>
                Your own goal.{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => {
                    const goals = { ...prefs.goals };
                    delete goals[goalType];
                    onChange({ ...prefs, goals });
                  }}
                >
                  Back to the default ({defaults[goalType]})
                </button>
              </>
            ) : (
              `Default: beat ${lastMonthLabel}. Aim a little higher; ambitious, not impossible.`
            )}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor={`${id}-why`} className="block text-meta font-medium text-ink-heading">
            What I'm working for
          </label>
          <input
            id={`${id}-why`}
            value={why}
            maxLength={80}
            placeholder="e.g. a family trip in December"
            onChange={(e) => setWhy(e.target.value)}
            onBlur={saveWhy}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveWhy();
            }}
            className={inputClass}
          />
          <p className="text-meta text-ink-muted">Shown on your banner as a daily reminder.</p>
        </div>

        <div className="space-y-2">
          <div className="text-meta font-medium text-ink-heading">Banner colour</div>
          <div className="flex gap-2" role="group" aria-label="Banner colour">
            {VIBES.map((v) => {
              const on = (prefs.vibe ?? "sun") === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  aria-label={v.label}
                  aria-pressed={on}
                  title={v.label}
                  className={`size-9 rounded-full ring-offset-2 transition-shadow duration-150 ${VIBE_BG[v.key]} ${on ? "ring-2 ring-ink" : "ring-1 ring-control"}`}
                  onClick={() => onChange({ ...prefs, vibe: v.key })}
                />
              );
            })}
          </div>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1 text-meta font-medium text-ink-heading">Show on my page</legend>
          {SECTIONS.map((s) => (
            <label key={s.key} className="flex min-h-8 items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={!hidden.has(s.key)}
                onChange={(e) => {
                  const next = new Set(hidden);
                  if (e.target.checked) next.delete(s.key);
                  else next.add(s.key);
                  onChange({ ...prefs, hidden: [...next] });
                }}
              />
              {s.label}
            </label>
          ))}
        </fieldset>
      </div>
    </Card>
  );
}
