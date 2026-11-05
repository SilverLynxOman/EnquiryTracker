import { Card } from "../../components/ui";
import { fmtDayMonth } from "../../lib/display";
import { bestNote, goalPace, type Best, type PeriodCounts, type StackItem } from "../../lib/gamePlan";
import { MODE_LABELS, type GoalType, type ShipmentMode } from "../../lib/types";

const UNIT: Record<GoalType, [string, string]> = { wins: ["win", "wins"], quotes: ["quote", "quotes"] };
const unit = (type: GoalType, n: number) => UNIT[type][n === 1 ? 0 : 1];

const RING = 2 * Math.PI * 70;

/** The monthly goal as a ring, with a marker where a steady pace stands today. */
export function GoalCard({
  title,
  type,
  value,
  target,
  hint,
  share,
  marker,
  counts,
}: {
  title: string;
  type: GoalType;
  value: number;
  target: number;
  /** Where the goal comes from: "Goal: beat October (35)" or "Your own goal". */
  hint: string;
  /** Share of the goal a steady pace has reached today (0–1), and what the marker means. */
  share: number;
  marker: string;
  counts: PeriodCounts;
}) {
  const pace = goalPace(value, target, share);
  const filled = Math.min(value / target, 1) * RING;
  const paceText = {
    smashed: "Goal smashed! Time to raise the bar.",
    ahead: "Ahead of pace. Brilliant, keep it up.",
    on_pace: "On pace. Keep the rhythm going.",
    behind: `${pace.gap} more ${unit(type, pace.gap)} puts you back on pace.`,
  }[pace.status];
  const quickShare = counts.quotes ? Math.round((counts.quick / counts.quotes) * 100) : 0;

  return (
    <Card title={title} actions={<span className="rounded-full bg-selected px-2 py-0.5 text-meta font-medium text-primary">{type === "wins" ? "Wins" : "Quotes"}</span>}>
      <div className="flex flex-col items-center gap-3">
        <div className="relative size-48">
          <svg
            viewBox="0 0 180 180"
            className="size-48"
            role="img"
            aria-label={`${value} of ${target} ${unit(type, target)} this month. A steady pace would be at ${Math.round(target * share)} today.`}
          >
            <circle cx="90" cy="90" r="70" fill="none" strokeWidth="18" className="stroke-selected" />
            <circle
              cx="90"
              cy="90"
              r="70"
              fill="none"
              strokeWidth="18"
              strokeLinecap="round"
              className="stroke-primary"
              strokeDasharray={`${filled.toFixed(1)} ${RING.toFixed(1)}`}
              transform="rotate(-90 90 90)"
            />
            <line x1="90" y1="5" x2="90" y2="35" strokeWidth="4" strokeLinecap="round" className="stroke-flame" transform={`rotate(${(share * 360).toFixed(1)} 90 90)`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
            <div className="text-hero font-extrabold text-ink">{value}</div>
            <div className="text-meta text-ink-muted">
              of {target} {unit(type, target)}
            </div>
          </div>
        </div>
        <p className={`text-center text-body font-semibold ${pace.status === "behind" ? "text-await" : "text-confirmed"}`}>{paceText}</p>
        <div className="space-y-0.5 text-center text-meta text-ink-muted">
          <p className="flex items-center justify-center gap-1.5">
            <span className="h-1 w-3 shrink-0 rounded-full bg-flame" aria-hidden="true" />
            {marker}
          </p>
          <p>{hint}</p>
        </div>
        <dl className="grid w-full grid-cols-3 gap-2">
          {[
            ["Enquiries", counts.enquiries],
            ["Quotes sent", counts.quotes],
            ["Quick quotes", `${quickShare}%`],
          ].map(([label, n]) => (
            <div key={label} className="rounded-control bg-table-head px-3 py-2">
              <dt className="text-meta text-ink-muted">{label}</dt>
              <dd className="text-figure font-bold text-ink">{n}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

/** Literal class names so Tailwind generates them. White text on each passes 4.5:1. */
const MODE_BG: Partial<Record<ShipmentMode, string>> = {
  FCL: "bg-mode-fcl",
  LCL: "bg-mode-lcl",
  AIR: "bg-mode-air",
  COURIER: "bg-mode-courier",
};

/** At most this many containers are drawn; the rest are counted. */
const MAX_STACK = 30;
/** Empty slots drawn after the next one, so a big goal doesn't turn into a wall of empty boxes. */
const EMPTY_SLOTS = 4;
const CELL = "basis-[calc(25%-0.375rem)]";

/** This month's confirmed jobs as containers stacked on a deck, then the next slot to fill. */
export function WinStackCard({ title, items, goal, today }: { title: string; items: StackItem[]; goal: number; today: string }) {
  const left = Math.max(0, goal - items.length);
  const shown = items.slice(0, MAX_STACK);
  const empty = left > 1 ? Math.min(left - 1, EMPTY_SLOTS) : 0;
  return (
    <Card title={title} actions={<span className="text-meta font-medium text-ink-heading">{left > 0 ? `${items.length} of ${goal} · ${left} to go` : "Goal reached!"}</span>}>
      <p className="text-meta text-ink-muted">Every confirmed job loads a container. Fill the deck and the goal is yours.</p>
      <ul className="mt-3 flex flex-wrap-reverse content-start gap-2" aria-label={`${items.length} confirmed ${items.length === 1 ? "job" : "jobs"} this month`}>
        {shown.map((item) => (
          <li
            key={item.id}
            className={`stripes flex h-16 ${CELL} flex-col justify-between rounded-[3px] px-2 py-1.5 text-white ${item.mode ? (MODE_BG[item.mode] ?? "bg-mode-other") : "bg-mode-other"}`}
            title={`${item.reference} · ${item.lane}`}
          >
            <span className="flex justify-between gap-1 text-meta font-semibold">
              <span>{item.mode ? MODE_LABELS[item.mode] : "Job"}</span>
              <span className="tabular-nums">{fmtDayMonth(item.date, today)}</span>
            </span>
            <span className="truncate text-meta">{item.lane || item.reference}</span>
          </li>
        ))}
        {items.length > MAX_STACK && (
          <li className={`flex h-16 ${CELL} items-center justify-center rounded-[3px] bg-table-head text-meta font-semibold text-ink-heading`}>
            +{items.length - MAX_STACK} more
          </li>
        )}
        <li className={`flex h-16 ${CELL} items-center justify-center rounded-[3px] border-2 border-dashed border-primary bg-selected text-meta font-semibold text-primary`}>
          + Next win
        </li>
        {Array.from({ length: empty }, (_, i) => (
          <li key={`slot-${i}`} aria-hidden="true" className={`h-16 ${CELL} rounded-[3px] border-2 border-dashed border-line`} />
        ))}
      </ul>
      <div className="mx-[-0.25rem] h-2.5 rounded-b-panel bg-ship-hull" aria-hidden="true" />
    </Card>
  );
}

/** This week's quotes, this month's wins and the streak against this season's records. */
export function BestsCard({ bests }: { bests: Best[] }) {
  return (
    <Card title="Beat your best">
      <ul className="space-y-4">
        {bests.map((b) => {
          const record = b.best > 0 && (b.current > b.best || (b.key === "streak" && b.current >= b.best));
          const pct = b.best > 0 ? Math.min(b.current / b.best, 1) * 100 : b.current > 0 ? 100 : 0;
          return (
            <li key={b.key}>
              <div className="flex justify-between gap-2 text-body">
                <span className="font-semibold text-ink">{b.label}</span>
                <span className="text-meta text-ink-muted">{b.best > 0 ? `record ${b.best}` : "no record yet"}</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-selected" aria-hidden="true">
                <div className={`h-full rounded-full ${record ? "bg-confirmed-dot" : "bg-flame"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className={`mt-1 text-meta ${record ? "font-medium text-confirmed" : "text-ink-muted"}`}>{bestNote(b)}</p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
