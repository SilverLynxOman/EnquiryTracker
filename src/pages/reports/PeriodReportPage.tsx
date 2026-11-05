import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { SalespersonTable } from "../../components/SalespersonTable";
import { Alert, Button, Empty, Spinner } from "../../components/ui";
import { fetchLastActiveDay, fetchPeriodRows, fetchSalespersonSummary } from "../../lib/api";
import { addDays, errorMessage, fmtMoney, todayIso } from "../../lib/format";
import {
  EARLIER_SECTION_TITLE,
  buildPeriodReport,
  comparePeriod,
  dailySeries,
  dayPeriod,
  daysInRange,
  modeTotals,
  monthPace,
  monthPeriod,
  periodFileName,
  periodHeading,
  reportFigures,
  shiftPeriod,
  topCustomers,
  weekPeriod,
  type Period,
  type PeriodKind,
  type ReportFigures,
} from "../../lib/reports";
import { displayName } from "../../lib/display";
import { BarList, DayChart, EmptyPeriod, KpiTiles, ModeBars, ReportHeader, ReportLists, Stepper, bareInput, type KpiTileData } from "./parts";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Period from the URL: ?date= (daily), ?from=&to= (weekly, any range), ?month=YYYY-MM (monthly). */
function readPeriod(kind: PeriodKind, p: URLSearchParams): Period {
  const today = todayIso();
  if (kind === "daily") {
    const date = p.get("date");
    return dayPeriod(isDate(date) ? date : today);
  }
  if (kind === "monthly") {
    const first = `${p.get("month")}-01`;
    return monthPeriod(isDate(first) ? first : today);
  }
  const from = p.get("from");
  const to = p.get("to");
  if (isDate(from) && isDate(to) && from <= to) return { kind, from, to };
  return weekPeriod(isDate(from) ? from : today);
}

function writePeriod(p: Period): URLSearchParams {
  if (p.kind === "daily") return new URLSearchParams({ date: p.from });
  if (p.kind === "monthly") return new URLSearchParams({ month: p.from.slice(0, 7) });
  return new URLSearchParams({ from: p.from, to: p.to });
}

const WORDING: Record<PeriodKind, { current: string; unit: string; within: string; raised: string; of: (iso: string) => Period }> = {
  daily: { current: "Today", unit: "day", within: "that day", raised: "Raised that day", of: dayPeriod },
  weekly: { current: "This week", unit: "week", within: "in the week", raised: "Raised in the week", of: weekPeriod },
  monthly: { current: "This month", unit: "month", within: "in the month", raised: "Raised in the month", of: monthPeriod },
};

function PeriodControls({ period, today, onChange }: { period: Period; today: string; onChange: (p: Period) => void }) {
  const { kind } = period;
  const w = WORDING[kind];
  const current = w.of(today);
  const isCurrent = current.from === period.from && current.to === period.to;
  return (
    <>
      <Stepper unit={w.unit} onStep={(s) => onChange(shiftPeriod(period, s))}>
        {kind === "daily" && (
          <input
            type="date"
            aria-label="Date"
            className={bareInput}
            value={period.from}
            onChange={(e) => isDate(e.target.value) && onChange(dayPeriod(e.target.value))}
          />
        )}
        {kind === "weekly" && (
          <>
            <input
              type="date"
              aria-label="From"
              className={bareInput}
              value={period.from}
              onChange={(e) => isDate(e.target.value) && onChange({ kind, from: e.target.value, to: addDays(e.target.value, 6) })}
            />
            <span className="self-center text-ink-muted" aria-hidden>
              –
            </span>
            <input
              type="date"
              aria-label="To"
              className={bareInput}
              min={period.from}
              value={period.to}
              onChange={(e) => isDate(e.target.value) && e.target.value >= period.from && onChange({ kind, from: period.from, to: e.target.value })}
            />
          </>
        )}
        {kind === "monthly" && (
          <input
            type="month"
            aria-label="Month"
            className={bareInput}
            value={period.from.slice(0, 7)}
            onChange={(e) => isDate(`${e.target.value}-01`) && onChange(monthPeriod(`${e.target.value}-01`))}
          />
        )}
      </Stepper>
      <Button variant="ghost" onClick={() => onChange(current)} disabled={isCurrent}>
        {w.current}
      </Button>
    </>
  );
}

function subtitle(p: Period, today: string): string {
  if (p.kind === "daily") return p.from === today ? "Daily report · today" : "Daily report";
  if (p.kind === "monthly") {
    const all = daysInRange(p.from, p.to);
    return today >= p.from && today < p.to ? `Monthly report · ${daysInRange(p.from, today)} of ${all} days so far` : "Monthly report";
  }
  const days = daysInRange(p.from, p.to);
  return days === 7 ? "Weekly report · Saturday to Friday" : `Report over ${days} days`;
}

function tiles(f: ReportFigures, prev: ReportFigures | null, earlier: number, cancelled: number, pace: number | null, within: string): KpiTileData[] {
  const margin = (x: ReportFigures) => (x.sales ? (x.profit / x.sales) * 100 : null);
  const pct = f.enquiries ? Math.round((f.quoted / f.enquiries) * 100) : null;
  return [
    {
      colour: "enquiries",
      label: "Enquiries",
      hint: `Enquiries raised ${within}, cancelled not counted`,
      kind: "count",
      value: f.enquiries,
      previous: prev?.enquiries,
      sub: cancelled ? `${cancelled} cancelled` : undefined,
    },
    {
      colour: "quoted",
      label: "Quoted",
      hint: `Enquiries raised ${within} that have been quoted`,
      kind: "count",
      value: f.quoted,
      previous: prev?.quoted,
      sub: pct != null && !prev ? `${pct}% of enquiries` : undefined,
    },
    {
      colour: "confirmed",
      label: "Confirmations",
      hint: `Jobs confirmed ${within}, whenever the enquiry was raised`,
      kind: "count",
      value: f.confirmations,
      previous: prev?.confirmations,
      sub: f.confirmations ? `${f.confirmations - earlier} new + ${earlier} earlier` : undefined,
    },
    { colour: "sales", label: "Sales", hint: `Sales on jobs confirmed ${within}`, kind: "money", value: f.sales, previous: prev?.sales },
    {
      colour: "profit",
      label: "Profit",
      hint: `Profit on jobs confirmed ${within}`,
      kind: "money",
      value: f.profit,
      previous: prev?.profit,
      sub: pace != null && f.profit ? `pace ${fmtMoney(pace)}` : undefined,
    },
    {
      colour: "margin",
      label: "Margin",
      hint: "Profit as a share of sales",
      kind: "rate",
      value: margin(f),
      previous: prev ? margin(prev) : null,
      sub: f.confirmations ? `${fmtMoney(Math.round(f.profit / f.confirmations))} per job` : undefined,
    },
  ];
}

function Panel({ title, note, children, className = "" }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-panel border border-line bg-surface ${className}`}>
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        {note && <span className="text-meta text-ink-muted">{note}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Daily, weekly and monthly report: key figures, summaries, and the period's enquiries. */
export default function PeriodReportPage({ kind }: { kind: PeriodKind }) {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const period = readPeriod(kind, params);
  const { from, to } = period;
  const w = WORDING[kind];
  const cmp = comparePeriod(period, today);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const go = (p: Period) => setParams(writePeriod(p), { replace: true });

  const data = useQuery({
    queryKey: ["reports", "period", from, to],
    queryFn: async () => {
      const { raised, confirmed } = await fetchPeriodRows(from, to);
      return {
        report: buildPeriodReport(period, raised, confirmed),
        modes: modeTotals(raised, confirmed),
        figures: reportFigures(raised, confirmed),
        days: kind === "daily" ? [] : dailySeries(period, raised, confirmed),
        customers: topCustomers(confirmed),
      };
    },
    placeholderData: keepPreviousData,
  });
  const previous = useQuery({
    queryKey: ["reports", "figures", cmp.previous.from, cmp.previous.to],
    queryFn: async () => {
      const { raised, confirmed } = await fetchPeriodRows(cmp.previous.from, cmp.previous.to);
      return reportFigures(raised, confirmed);
    },
    enabled: today >= from,
  });
  const summary = useQuery({
    queryKey: ["reports", "summary", from, to],
    queryFn: () => fetchSalespersonSummary(from, to),
    placeholderData: keepPreviousData,
  });

  const d = data.data;
  const stale = data.isPlaceholderData || summary.isPlaceholderData;
  const empty = !!d && !stale && d.report.raised.length === 0 && d.report.confirmations === 0;
  const lastActive = useQuery({
    queryKey: ["reports", "lastActive", from],
    queryFn: () => fetchLastActiveDay(from),
    enabled: empty,
  });
  const ready = !!d && !stale && !!summary.data;
  const error = data.error ?? summary.error ?? previous.error;

  // Like-for-like: a running period is measured on its days so far against the same days before it.
  const prevFigures = previous.data && (previous.data.enquiries || previous.data.confirmations) ? previous.data : null;

  async function doExport() {
    if (!d) return;
    setExporting(true);
    setExportError(null);
    try {
      const [{ periodReportWorkbook }, { saveWorkbook }] = await Promise.all([
        import("../../lib/excel/exportReports"),
        import("../../lib/excel/exportRegister"),
      ]);
      const extra = kind !== "daily" && summary.data ? { rows: summary.data, modes: d.modes } : undefined;
      saveWorkbook(periodReportWorkbook(period, d.report, extra), periodFileName(period));
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const people = !summary.data ? (
    <Spinner />
  ) : !summary.data.length ? (
    <Empty>No enquiries or confirmations.</Empty>
  ) : (
    <SalespersonTable rows={summary.data} showConversion />
  );

  return (
    <div className="space-y-4">
      <ReportHeader title={periodHeading(period)} sub={subtitle(period, today)} onExport={doExport} exporting={exporting} canExport={ready && !exporting}>
        <PeriodControls period={period} today={today} onChange={go} />
      </ReportHeader>

      {(error || exportError) && <Alert>{exportError ?? errorMessage(error)}</Alert>}

      {!d ? (
        data.isLoading && <Spinner />
      ) : (
        <div className={`space-y-4 transition-opacity ${stale ? "opacity-60" : ""}`} aria-busy={stale}>
          <KpiTiles tiles={tiles(d.figures, prevFigures, d.report.earlier.length, d.report.cancelled, monthPace(period, today, d.figures.profit), w.within)} vs={cmp.label} />

          {empty ? (
            <EmptyPeriod
              what={kind === "daily" ? `on ${periodHeading(period)}` : kind === "weekly" ? "in this week" : "in this month"}
              lastActive={lastActive.isLoading ? undefined : (lastActive.data ?? null)}
              onJump={(day) => go(w.of(day))}
              extra={
                kind === "daily" ? (
                  <Link to={`../weekly?${writePeriod(weekPeriod(from))}`} className="inline-flex h-9 items-center px-3 text-control font-medium text-primary hover:underline">
                    See this week
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              {kind === "daily" && (
                <div className="grid gap-4 xl:grid-cols-3">
                  <Panel title="By sales person" className="xl:col-span-2">
                    {people}
                  </Panel>
                  <Panel title="Shipment modes">
                    <ModeBars modes={d.modes} />
                  </Panel>
                </div>
              )}

              {kind === "weekly" && (
                <>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Panel title="Day by day">
                      <DayChart days={d.days} today={today} />
                    </Panel>
                    <Panel title="Shipment modes">
                      <ModeBars modes={d.modes} />
                    </Panel>
                  </div>
                  <Panel title="Sales persons" note="FCL units and modes as in the Excel DATA sheet">
                    {people}
                  </Panel>
                </>
              )}

              {kind === "monthly" && (
                <>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <Panel title={`Day by day — ${periodHeading(period)}`} className="xl:col-span-2">
                      <DayChart days={d.days} today={today} />
                    </Panel>
                    <Panel title="Top customers" note="by profit on confirmed jobs">
                      <BarList
                        empty="No confirmed jobs yet."
                        rows={d.customers.map((c) => ({
                          key: c.name,
                          label: displayName(c.name),
                          value: c.profit,
                          display: fmtMoney(Math.round(c.profit)),
                          extra: `${c.jobs} job${c.jobs === 1 ? "" : "s"}`,
                        }))}
                      />
                      <Link to={`../analytics?from=${from}&to=${to}&by=customer`} className="mt-4 inline-block text-meta font-medium text-primary hover:underline">
                        All customers in Analytics →
                      </Link>
                    </Panel>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <Panel title="Sales persons" className="xl:col-span-2">
                      {people}
                    </Panel>
                    <Panel title="Shipment modes">
                      <ModeBars modes={d.modes} />
                    </Panel>
                  </div>
                </>
              )}

              <ReportLists
                raised={d.report.raised}
                earlier={d.report.earlier}
                raisedLabel={w.raised}
                earlierLabel={`Earlier enquiries confirmed ${w.within}`}
                earlierNote={`“${EARLIER_SECTION_TITLE[kind]}” in the Excel export`}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
