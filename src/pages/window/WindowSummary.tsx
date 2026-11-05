import type { ReactNode } from "react";
import { Link } from "react-router";
import { STALE_DAYS } from "../../lib/followUps";
import { TIMELINE_DAYS, type WindowView } from "../../lib/quoteWindow";

function Cell({ label, figure, note, won = false }: { label: ReactNode; figure: ReactNode; note: ReactNode; won?: boolean }) {
  return (
    <div className={`px-4 py-3 ${won ? "bg-confirmed-bg text-confirmed" : "bg-surface"}`}>
      <p className={`flex items-center gap-1.5 text-meta ${won ? "" : "text-ink-muted"}`}>{label}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">{figure}</div>
      <p className={`text-meta ${won ? "" : "text-ink-muted"}`}>{note}</p>
    </div>
  );
}

const figure = "text-figure font-bold tabular-nums";

/** The strip above the timeline: what to quote, what is in and past the win window, what is stale, what was won. */
export function WindowSummary({
  view,
  windowDays,
  staleQuotes,
  staleLink,
  won,
  lastByNow,
  monthName,
  lastMonthName,
}: {
  view: WindowView;
  windowDays: number;
  /** Quotes waiting STALE_DAYS or more (null while loading). */
  staleQuotes: number | null;
  staleLink: string;
  won: number;
  lastByNow: number;
  monthName: string;
  lastMonthName: string;
}) {
  const ahead = won - lastByNow;
  return (
    <section
      aria-label="Open quotes at a glance"
      className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-px overflow-hidden rounded-panel border border-line bg-line"
    >
      <Cell
        label="To quote"
        figure={
          <>
            <span className={`${figure} text-ink`}>{view.waiting.length}</span>
            {view.overdue > 0 && <span className="rounded-full bg-lost-bg px-2 py-0.5 text-meta font-medium text-lost">{view.overdue} overdue</span>}
          </>
        }
        note="Due by the end of the next working day"
      />
      <Cell
        label={
          <>
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-primary" />
            In the win window
          </>
        }
        figure={<span className={`${figure} text-ink`}>{view.inWindow}</span>}
        note={`Quoted in the last ${windowDays} days`}
      />
      <Cell
        label={
          <>
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-await-dot" />
            Last chance
          </>
        }
        figure={<span className={`${figure} text-ink`}>{view.lastChance}</span>}
        note={`Quoted ${windowDays + 1}–${TIMELINE_DAYS} days ago`}
      />
      <Cell
        label={`Waiting ${STALE_DAYS} days or more`}
        figure={<span className={`${figure} text-ink-heading`}>{staleQuotes?.toLocaleString() ?? "–"}</span>}
        note={
          <Link to={staleLink} className="font-medium text-primary hover:underline">
            Review and close
          </Link>
        }
      />
      <Cell
        won
        label={`Won in ${monthName}`}
        figure={
          <>
            <span className={figure}>{won}</span>
            {ahead > 0 && <span className="text-meta font-semibold">+{ahead} on {lastMonthName}</span>}
          </>
        }
        note={`${lastMonthName} at this point: ${lastByNow}`}
      />
    </section>
  );
}
