import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "../../components/ui";
import { fetchPeriodStats } from "../../lib/api";
import { addDays, errorMessage, fmtDate, fmtMoney } from "../../lib/format";
import {
  KPI_PERIODS,
  KPIS,
  compareLabel,
  compareRange,
  kpiBar,
  kpiDelta,
  kpiValues,
  periodRange,
  type DateRange,
  type KpiCompare,
  type KpiDef,
  type KpiPeriod,
} from "../../lib/kpiPeriods";

const STORE = "dashboard.kpi";

function load(): { period: KpiPeriod; compare: KpiCompare } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return {
      period: KPI_PERIODS.some((p) => p.value === v.period) ? v.period : "month",
      compare: v.compare === "lastYear" ? "lastYear" : "previous",
    };
  } catch {
    return { period: "month", compare: "previous" };
  }
}

function save(v: { period: KpiPeriod; compare: KpiCompare }) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* private window: the choice just isn't remembered */
  }
}

function useStats(range: DateRange) {
  return useQuery({
    queryKey: ["dashboard", "stats", range.from, range.to],
    queryFn: () => fetchPeriodStats(range.from, range.to),
  });
}

function fmtValue(kind: KpiDef["kind"], v: number | null | undefined): string {
  if (v == null) return "—";
  if (kind === "rate") return `${v.toFixed(1)}%`;
  if (kind === "money") return fmtMoney(Math.round(v));
  return v.toLocaleString("en-US");
}

const rangeText = (r: DateRange) => (r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} to ${fmtDate(r.to)}`);

/**
 * The eight dashboard KPIs in one strip. The big figure is the chosen period, measured
 * against the previous period (or the same dates last year); today's figure stays
 * underneath, or yesterday's when the period is today.
 */
export function KpiStrip({ today }: { today: string }) {
  const [{ period, compare }, setChoice] = useState(load);
  const choose = (next: { period: KpiPeriod; compare: KpiCompare }) => {
    setChoice(next);
    save(next);
  };

  const range = periodRange(period, today);
  const against = compareRange(period, compare, today);
  const pinnedDay = period === "today" ? addDays(today, -1) : today;

  const cur = useStats(range);
  const prev = useStats(against);
  const pinned = useStats({ from: pinnedDay, to: pinnedDay });
  const error = cur.error ?? prev.error ?? pinned.error;

  const C = cur.data ? kpiValues(cur.data) : null;
  // A comparison period with no enquiries (before the register started) has nothing to measure against.
  const noBase = !!prev.data && prev.data.enquiries === 0 && prev.data.confirmed === 0;
  const P = prev.data && !noBase ? kpiValues(prev.data) : null;
  const T = pinned.data ? kpiValues(pinned.data) : null;
  const vs = compareLabel(period, compare, today);
  const title = KPI_PERIODS.find((p) => p.value === period)!.title;

  return (
    <section aria-label="Key figures" className="rounded-panel border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-heading">
          {title} <span className="ml-1 font-normal text-ink-muted">{rangeText(range)}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-meta text-ink-muted">
            Compare with
            <select
              value={compare}
              onChange={(e) => choose({ period, compare: e.target.value as KpiCompare })}
              className="h-8 rounded-control border border-control bg-surface px-2 text-control text-ink"
            >
              <option value="previous">Previous period</option>
              <option value="lastYear">Same dates last year</option>
            </select>
          </label>
          <div role="group" aria-label="Period" className="inline-flex gap-0.5 rounded-panel bg-table-head p-1">
            {KPI_PERIODS.map((p) => {
              const on = p.value === period;
              return (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => choose({ period: p.value, compare })}
                  className={`h-7 rounded-control px-3 text-control transition-colors duration-150 ${
                    on ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3">
          <Alert>{errorMessage(error)}</Alert>
        </div>
      )}
      <div className="grid grid-cols-2 overflow-hidden rounded-panel border border-line sm:grid-cols-4 2xl:grid-cols-8">
        {KPIS.map((k) => {
          const c = C?.[k.key] ?? null;
          const p = P?.[k.key] ?? null;
          const d = kpiDelta(k.kind, c, p);
          return (
            <div
              key={k.key}
              title={k.hint}
              className="-mb-px -mr-px border-b border-r border-t-[3px] border-line px-4 py-3"
              style={{
                borderTopColor: `var(--color-kpi-${k.key})`,
                backgroundImage: `linear-gradient(var(--color-kpi-${k.key}-bg), var(--color-surface) 70%)`,
              }}
            >
              <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-ink-muted">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{C ? fmtValue(k.kind, c) : "—"}</div>
              <div className="mt-0.5 flex min-h-[1.125rem] flex-wrap items-baseline gap-x-1.5 text-meta">
                {d ? (
                  <span
                    className={`whitespace-nowrap font-semibold ${
                      d.direction === "up" ? "text-up" : d.direction === "down" ? "text-down" : "text-ink-muted"
                    }`}
                  >
                    <span aria-hidden>{d.direction === "up" ? "▲ " : d.direction === "down" ? "▼ " : ""}</span>
                    <span className="sr-only">{d.direction === "up" ? "up " : d.direction === "down" ? "down " : "no change "}</span>
                    {d.text}
                  </span>
                ) : (
                  P && <span className="text-ink-muted">{fmtValue(k.kind, p)}</span>
                )}
                {P && <span className="whitespace-nowrap text-ink-muted">vs {vs}</span>}
                {noBase && <span className="whitespace-nowrap text-ink-muted">No figures for {vs}</span>}
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-table-head" aria-hidden>
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${kpiBar(k.kind, c, p)}%`,
                    background: `var(--color-kpi-${k.key})`,
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between border-t border-dashed border-line pt-2 text-meta text-ink-muted">
                <span>{period === "today" ? "Yesterday" : "Today"}</span>
                <span className="font-semibold tabular-nums text-ink">{T ? fmtValue(k.kind, T[k.key]) : "—"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
