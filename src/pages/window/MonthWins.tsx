import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Card } from "../../components/ui";
import { displayName, fmtDayMonth } from "../../lib/display";
import type { MonthWins } from "../../lib/quoteWindow";
import { MODE_LABELS } from "../../lib/types";
import { laneLabel, monthLabel, previousMonth } from "../../lib/workdays";

/** A round top for the chart's scale, and its step: at most four steps. */
function niceScale(max: number): { top: number; step: number } {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) {
    if (max / step <= 4) return { top: Math.max(step, Math.ceil(max / step) * step), step };
  }
  const step = Math.ceil(max / 4);
  return { top: step * 4, step };
}

const L = 30;
const R = 350;
const T = 24;
const B = 148;

/** Wins added up day by day this month, against last month's line. */
export function MonthWinsCard({ month, today, owner }: { month: MonthWins; today: string; owner: string }) {
  const thisName = monthLabel(today);
  const lastMonthIso = previousMonth(today);
  const lastName = monthLabel(lastMonthIso);
  const diff = month.total - month.lastByNow;
  const { top, step } = niceScale(Math.max(month.lastTotal, month.total, 4));
  const span = Math.max(month.monthDays, month.lastMonth.length);
  const x = (day: number) => L + ((day - 1) / (span - 1)) * (R - L);
  const y = (v: number) => B - (v / top) * (B - T);
  const path = (series: number[]) => series.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const day = month.thisMonth.length;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const lastEnd = month.lastMonth.length;
  const nowX = x(Math.max(day, 1));
  const nowY = y(month.total);
  const labelLeft = nowX > (L + R) / 2;

  const best = month.best;
  let foot =
    best && best.month === lastMonthIso && best.wins === month.lastTotal
      ? `${lastName} was ${owner} best month this year: ${best.wins} wins.`
      : best
        ? `${owner === "your" ? "Your" : owner} best month this year: ${monthLabel(best.month)}, ${best.wins} wins.`
        : `${lastName} finished on ${month.lastTotal} ${month.lastTotal === 1 ? "win" : "wins"}.`;
  if (best && month.total <= best.wins) foot += ` ${best.wins + 1} would make ${thisName} the best yet.`;

  return (
    <Card title={`${thisName} so far`}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-figure font-bold tabular-nums text-ink">{month.total}</span>
        <span className="text-body text-ink-heading">{month.total === 1 ? "win" : "wins"}</span>
        {diff > 0 ? (
          <span className="rounded-full bg-confirmed-bg px-2 py-0.5 text-meta font-medium text-confirmed">
            {diff} ahead of {lastName}
          </span>
        ) : diff === 0 ? (
          <span className="rounded-full bg-table-head px-2 py-0.5 text-meta font-medium text-ink-heading">Level with {lastName}</span>
        ) : (
          <span className="text-meta text-ink-muted">
            {lastName} had {month.lastByNow} by now
          </span>
        )}
      </p>
      <svg
        viewBox="0 0 360 176"
        className="mt-2 block w-full"
        role="img"
        aria-label={`Wins added up day by day. ${thisName}: ${month.total} after ${day} days. ${lastName}: ${month.lastByNow} at this point, ${month.lastTotal} in all.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={R} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth="1" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-muted text-[11px] tabular-nums">
              {t}
            </text>
          </g>
        ))}
        {[1, 10, 20, span].map((d) => (
          <text key={d} x={x(d)} y={168} textAnchor="middle" className="fill-ink-muted text-[11px] tabular-nums">
            {d}
          </text>
        ))}
        <line x1={nowX} x2={nowX} y1={T - 6} y2={B} className="stroke-control" strokeWidth="1" strokeDasharray="3 3" />
        {lastEnd > 1 && <path d={path(month.lastMonth)} fill="none" className="stroke-cancelled-dot" strokeWidth="2" strokeLinejoin="round" />}
        {lastEnd > 0 && <circle cx={x(lastEnd)} cy={y(month.lastTotal)} r="3.5" className="fill-cancelled-dot" />}
        {day > 1 && <path d={path(month.thisMonth)} fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        <circle cx={nowX} cy={nowY} r="4.5" className="fill-primary stroke-surface" strokeWidth="2" />
        <text x={labelLeft ? nowX - 8 : nowX + 8} y={nowY - 9} textAnchor={labelLeft ? "end" : "start"} className="fill-primary text-[12px] font-bold">
          {thisName} · {month.total}
        </text>
        {lastEnd > 0 && (
          <text x={x(lastEnd)} y={Math.max(12, y(month.lastTotal) - 9)} textAnchor="end" className="fill-ink-muted text-[12px] font-semibold">
            {lastName} · {month.lastTotal}
          </text>
        )}
      </svg>
      <p className="mt-1 text-meta text-ink-muted">{foot}</p>
    </Card>
  );
}

const SHOWN = 6;

/** This month's confirmed jobs, latest first. */
export function WonCard({ month, today, registerLink }: { month: MonthWins; today: string; registerLink: string }) {
  const shown = month.wins.slice(0, SHOWN);
  return (
    <Card title={`Won this month · ${month.total}`}>
      {shown.length === 0 ? (
        <p className="text-meta text-ink-muted">No confirmed jobs yet this month. The first one is up for grabs.</p>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-confirmed-bg text-confirmed">
                <Icon name="check" className="size-3" />
              </span>
              <div className="min-w-0">
                <Link to={`/enquiries/${e.id}`} className="block truncate font-medium text-ink hover:underline" title={e.customer_name}>
                  {displayName(e.customer_name) || e.reference}
                </Link>
                <p className="text-meta text-ink-muted">
                  {[laneLabel(e.pol, e.pod), e.shipment_mode ? MODE_LABELS[e.shipment_mode] : null, e.confirmed_date ? fmtDayMonth(e.confirmed_date, today) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {month.wins.length > shown.length && (
        <Link to={registerLink} className="mt-3 inline-block text-meta font-medium text-primary hover:underline">
          All {month.wins.length} in the register
        </Link>
      )}
      {month.sameDay >= 2 && (
        <p className="mt-3 border-t border-line pt-3 text-meta text-ink-muted">
          {month.sameDay === month.wins.length ? `All ${month.sameDay}` : `${month.sameDay} of ${month.wins.length}`} were confirmed on the day of the quote.
        </p>
      )}
    </Card>
  );
}
