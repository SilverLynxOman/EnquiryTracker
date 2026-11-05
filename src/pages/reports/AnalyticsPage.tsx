import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { MonthlyProfitChart } from "../../components/MonthlyProfitChart";
import { Icon } from "../../components/icons";
import { Alert, Button, Empty, Spinner, inputClass } from "../../components/ui";
import { fetchBreakdown, fetchMonthlyTrend } from "../../lib/api";
import { errorMessage, fmtDate, fmtMoney, fmtPercent, todayIso } from "../../lib/format";
import { shiftYear } from "../../lib/kpiPeriods";
import { DIMENSIONS, breakdownLabel, monthName, percent, rangeLabel } from "../../lib/reports";
import type { BreakdownDimension, BreakdownRow, MonthlyTrendRow } from "../../lib/types";
import { KpiTiles, MiniBar, ReportHeader, Segmented, bareInput, type KpiTileData } from "./parts";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function presets(today: string) {
  const [year, month] = today.split("-").map(Number);
  // The current month and the 11 before it.
  const start12 = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);
  return [
    { key: "year", label: "This year", from: `${year}-01-01`, to: today },
    { key: "12m", label: "Last 12 months", from: start12, to: today },
    { key: "last", label: "Last year", from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
}

type SortKey = "enquiries" | "confirmed" | "conversion" | "sell_total" | "profit" | "label";

const TOP = 25;

function sortRows(rows: BreakdownRow[], key: SortKey): BreakdownRow[] {
  const value = (r: BreakdownRow) => (key === "conversion" ? (percent(r.confirmed, r.enquiries) ?? -1) : key === "label" ? 0 : r[key]);
  return [...rows].sort((a, b) => (key === "label" ? a.label.localeCompare(b.label) : value(b) - value(a) || b.enquiries - a.enquiries));
}

function trendTotals(rows: MonthlyTrendRow[]) {
  return rows.reduce(
    (t, r) => ({
      enquiries: t.enquiries + r.enquiries,
      quoted: t.quoted + r.quoted,
      converted: t.converted + r.converted,
      converted_profit: t.converted_profit + r.converted_profit,
      confirmed: t.confirmed + r.confirmed,
      confirmed_sell: t.confirmed_sell + r.confirmed_sell,
      confirmed_profit: t.confirmed_profit + r.confirmed_profit,
    }),
    { enquiries: 0, quoted: 0, converted: 0, converted_profit: 0, confirmed: 0, confirmed_sell: 0, confirmed_profit: 0 },
  );
}

type Totals = ReturnType<typeof trendTotals>;

const monthTitle = (iso: string) => `${monthName(iso).slice(0, 1)}${monthName(iso).slice(1, 3).toLowerCase()} ${iso.slice(0, 4)}`;

function TrendTable({ rows }: { rows: MonthlyTrendRow[] }) {
  const t = trendTotals(rows);
  const line = (r: Omit<MonthlyTrendRow, "month">) => (
    <>
      <td className="px-2">{r.enquiries.toLocaleString()}</td>
      <td className="px-2">{r.quoted.toLocaleString()}</td>
      <td className="px-2">{r.converted.toLocaleString()}</td>
      <td className="px-2">
        <span className="inline-flex items-center justify-end gap-2">
          {fmtPercent(r.converted, r.enquiries)}
          <MiniBar pct={percent(r.converted, r.enquiries) ?? 0} colour="var(--color-kpi-confirmed)" className="w-12" />
        </span>
      </td>
      <td className="border-r border-line px-2">{fmtMoney(r.converted_profit)}</td>
      <td className="px-2">{r.confirmed.toLocaleString()}</td>
      <td className="px-2">{fmtMoney(r.confirmed_sell)}</td>
      <td className="pl-2">{fmtMoney(r.confirmed_profit)}</td>
    </>
  );
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-meta text-ink-heading font-medium">
          <tr className="text-right">
            <th />
            <th colSpan={5} className="border-r border-line px-2 pb-1 text-center font-medium normal-case">
              Enquiries raised in the month
            </th>
            <th colSpan={3} className="px-2 pb-1 text-center font-medium normal-case">
              Jobs confirmed in the month
            </th>
          </tr>
          <tr className="border-b border-line text-right">
            <th className="py-1.5 pr-3 text-left">Month</th>
            <th className="px-2">Enquiries</th>
            <th className="px-2">Quoted</th>
            <th className="px-2">Confirmed</th>
            <th className="px-2">Conv.</th>
            <th className="border-r border-line px-2">Profit</th>
            <th className="px-2">Jobs</th>
            <th className="px-2">Sales</th>
            <th className="pl-2">Profit</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={r.month} className="border-b border-line text-right hover:bg-row-hover">
              <td className="whitespace-nowrap py-1.5 pr-3 text-left">{monthTitle(r.month)}</td>
              {line(r)}
            </tr>
          ))}
        </tbody>
        <tfoot className="font-semibold tabular-nums">
          <tr className="text-right">
            <td className="py-1.5 pr-3 text-left">Total</td>
            {line({ ...t, converted_profit: Math.round(t.converted_profit * 100) / 100, confirmed_sell: Math.round(t.confirmed_sell * 100) / 100, confirmed_profit: Math.round(t.confirmed_profit * 100) / 100 })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type Metric = "profit" | "sales" | "enquiries" | "conversion";

const METRICS: { value: Metric; label: string; title: string; note: string }[] = [
  { value: "profit", label: "Profit", title: "Profit per month", note: "by confirmation date" },
  { value: "sales", label: "Sales", title: "Sales per month", note: "by confirmation date" },
  { value: "enquiries", label: "Enquiries", title: "Enquiries per month", note: "by enquiry date, cancelled not counted" },
  { value: "conversion", label: "Conversion", title: "Conversion per month", note: "share of the month's enquiries now confirmed" },
];

function metricPoint(m: Metric, r: MonthlyTrendRow) {
  switch (m) {
    case "profit":
      return { value: r.confirmed_profit, note: `${r.confirmed} job${r.confirmed === 1 ? "" : "s"}` };
    case "sales":
      return { value: r.confirmed_sell, note: `${r.confirmed} job${r.confirmed === 1 ? "" : "s"}` };
    case "enquiries":
      return { value: r.enquiries, note: `${r.quoted} quoted` };
    case "conversion":
      return { value: percent(r.converted, r.enquiries) ?? 0, note: `${r.converted} of ${r.enquiries}` };
  }
}

function MonthByMonth({ rows }: { rows: MonthlyTrendRow[] }) {
  const [metric, setMetric] = useState<Metric>("profit");
  const [view, setView] = useState<"chart" | "table">("chart");
  const m = METRICS.find((x) => x.value === metric)!;
  const t = trendTotals(rows);
  const nothing = metric === "profit" || metric === "sales" ? t.confirmed === 0 : t.enquiries === 0;
  return (
    <section className="rounded-panel border border-line bg-surface">
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <h2 className="text-body font-semibold text-ink">{view === "chart" ? m.title : "Month by month"}</h2>
        {view === "chart" && <span className="text-meta text-ink-muted">{m.note}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {view === "chart" && <Segmented label="Measure" value={metric} onChange={setMetric} options={METRICS} />}
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
      </header>
      <div className="p-4">
        {view === "table" ? (
          <TrendTable rows={rows} />
        ) : nothing ? (
          <Empty>Nothing to chart in this range.</Empty>
        ) : (
          <MonthlyProfitChart
            key={metric}
            label={`${m.title}, ${m.note}`}
            format={metric === "conversion" ? (v) => `${v.toFixed(1)}%` : metric === "enquiries" ? (v) => v.toLocaleString("en-US") : fmtMoney}
            data={rows.map((r) => ({ month: r.month, ...metricPoint(metric, r) }))}
          />
        )}
      </div>
    </section>
  );
}

function BreakdownTable({ rows, dimension }: { rows: BreakdownRow[]; dimension: BreakdownDimension }) {
  const [sort, setSort] = useState<SortKey>("enquiries");
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => breakdownLabel(dimension, r.label).toLowerCase().includes(needle)) : rows;
  const sorted = sortRows(filtered, sort);
  const shown = showAll || needle ? sorted : sorted.slice(0, TOP);
  const totalProfit = rows.reduce((t, r) => t + r.profit, 0);
  const header = (key: SortKey, label: string, className = "px-2") => (
    <th className={className} aria-sort={sort === key ? (key === "label" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setSort(key)} className={`hover:text-ink ${sort === key ? "text-primary" : ""}`}>
        {label}
        {sort === key && <span aria-hidden> {key === "label" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter names…" aria-label="Filter names" className={`${inputClass} h-8 w-56 pl-8`} />
        </div>
        <span className="text-meta text-ink-muted">
          {needle ? `${filtered.length} of ${rows.length}` : `${rows.length.toLocaleString()} in total`}
        </span>
      </div>
      {!rows.length ? (
        <Empty>No enquiries in this range.</Empty>
      ) : !filtered.length ? (
        <Empty>Nothing matches “{q}”.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-meta text-ink-heading font-medium">
              <tr className="border-b border-line text-right">
                {header("label", "Name", "py-1.5 pr-3 text-left")}
                {header("enquiries", "Enquiries")}
                <th className="px-2">Quoted</th>
                {header("confirmed", "Confirmed")}
                <th className="px-2">Lost</th>
                {header("conversion", "Conversion")}
                {header("sell_total", "Sales")}
                {header("profit", "Profit")}
                <th className="px-2">Share of profit</th>
                <th className="pl-2">Profit / job</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {shown.map((r) => {
                const conv = percent(r.confirmed, r.enquiries);
                const share = totalProfit > 0 ? (r.profit / totalProfit) * 100 : 0;
                return (
                  <tr key={r.label} className="border-b border-line text-right hover:bg-row-hover">
                    <td className="max-w-80 truncate py-1.5 pr-3 text-left font-medium" title={r.label}>
                      {breakdownLabel(dimension, r.label)}
                    </td>
                    <td className="px-2">{r.enquiries}</td>
                    <td className="px-2">{r.quoted}</td>
                    <td className="px-2">{r.confirmed}</td>
                    <td className="px-2">{r.lost || ""}</td>
                    <td className="px-2">
                      <span className="inline-flex items-center justify-end gap-2">
                        {conv == null ? "—" : `${conv.toFixed(1)}%`}
                        <MiniBar pct={conv ?? 0} colour="var(--color-kpi-confirmed)" className="w-14" />
                      </span>
                    </td>
                    <td className="px-2">{fmtMoney(r.sell_total)}</td>
                    <td className="px-2 font-semibold">{fmtMoney(r.profit)}</td>
                    <td className="px-2">
                      <span className="inline-flex items-center justify-end gap-2">
                        {share ? `${share.toFixed(share < 10 ? 1 : 0)}%` : ""}
                        <MiniBar pct={share} className="w-14" />
                      </span>
                    </td>
                    <td className="pl-2">{r.confirmed ? fmtMoney(Math.round(r.profit / r.confirmed)) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!needle && sorted.length > TOP && (
        <div className="mt-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show top ${TOP}` : `Show all ${sorted.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

function kpiTiles(t: Totals, p: Totals | null): KpiTileData[] {
  const conv = (x: Totals) => (x.enquiries ? (x.converted / x.enquiries) * 100 : null);
  const margin = (x: Totals) => (x.confirmed_sell ? (x.confirmed_profit / x.confirmed_sell) * 100 : null);
  return [
    { colour: "enquiries", label: "Enquiries", hint: "Raised in the range, cancelled not counted", kind: "count", value: t.enquiries, previous: p?.enquiries },
    {
      colour: "quoted",
      label: "Quoted",
      hint: "Enquiries raised in the range that have been quoted",
      kind: "count",
      value: t.quoted,
      previous: p?.quoted,
    },
    {
      colour: "conversion",
      label: "Conversion",
      hint: "Share of the range's enquiries that are now confirmed",
      kind: "rate",
      value: conv(t),
      previous: p ? conv(p) : null,
      sub: `${t.converted.toLocaleString()} confirmed`,
    },
    { colour: "sales", label: "Sales", hint: "Sales on jobs confirmed in the range", kind: "money", value: t.confirmed_sell, previous: p?.confirmed_sell },
    {
      colour: "profit",
      label: "Profit",
      hint: "Profit on jobs confirmed in the range",
      kind: "money",
      value: t.confirmed_profit,
      previous: p?.confirmed_profit,
      sub: `${t.confirmed.toLocaleString()} jobs`,
    },
    {
      colour: "margin",
      label: "Margin",
      hint: "Profit as a share of sales",
      kind: "rate",
      value: margin(t),
      previous: p ? margin(p) : null,
      sub: t.confirmed ? `${fmtMoney(Math.round(t.confirmed_profit / t.confirmed))} per job` : undefined,
    },
  ];
}

/** Conversion and profit by month and by sales person, customer, agent, lane, mode and trade type. */
export default function AnalyticsPage() {
  const today = todayIso();
  const ranges = presets(today);
  const [params, setParams] = useSearchParams();
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const valid = isDate(fromParam) && isDate(toParam) && fromParam <= toParam;
  const from = valid ? fromParam : ranges[0].from;
  const to = valid ? toParam : ranges[0].to;
  const dimension = (DIMENSIONS.find((d) => d.key === params.get("by")) ?? DIMENSIONS[0]).key;
  const preset = ranges.find((r) => r.from === from && r.to === to)?.key;
  const [custom, setCustom] = useState(!preset);
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const update = (patch: Record<string, string>) => setParams({ from, to, by: dimension, ...patch }, { replace: true });

  const trend = useQuery({
    queryKey: ["reports", "trend", from, to],
    queryFn: () => fetchMonthlyTrend(from, to),
    placeholderData: keepPreviousData,
  });
  const lastYear = useQuery({
    queryKey: ["reports", "trend", shiftYear(from), shiftYear(to)],
    queryFn: () => fetchMonthlyTrend(shiftYear(from), shiftYear(to)),
  });
  const breakdownQuery = (d: BreakdownDimension) => ({
    queryKey: ["reports", "breakdown", from, to, d],
    queryFn: () => fetchBreakdown(from, to, d),
  });
  const breakdown = useQuery({ ...breakdownQuery(dimension), placeholderData: keepPreviousData });

  async function doExport() {
    if (!trend.data) return;
    setExporting(true);
    setExportError(null);
    try {
      const [{ analyticsWorkbook }, { saveWorkbook }, breakdowns] = await Promise.all([
        import("../../lib/excel/exportReports"),
        import("../../lib/excel/exportRegister"),
        Promise.all(
          DIMENSIONS.map(async (d) => ({ dimension: d.key, title: d.plural, rows: await queryClient.fetchQuery(breakdownQuery(d.key)) })),
        ),
      ]);
      const name = `Enquiry Analytics ${fmtDate(from).replace(/\./g, "-")} to ${fmtDate(to).replace(/\./g, "-")}.xlsx`;
      saveWorkbook(analyticsWorkbook(from, to, trend.data, breakdowns), name);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const totals = trend.data ? trendTotals(trend.data) : null;
  const prevTotals = lastYear.data ? trendTotals(lastYear.data) : null;
  const base = prevTotals && (prevTotals.enquiries || prevTotals.confirmed) ? prevTotals : null;
  const error = trend.error ?? breakdown.error ?? exportError;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const vs = sameYear ? `same dates ${Number(from.slice(0, 4)) - 1}` : "a year earlier";

  return (
    <div className="space-y-4">
      <ReportHeader
        title={rangeLabel(from, to, true)}
        sub="Analytics · enquiries raised in the range, cancelled not counted"
        onExport={doExport}
        exporting={exporting}
        canExport={!!trend.data && !trend.isPlaceholderData && !exporting}
      >
        <Segmented
          label="Range"
          value={custom ? "custom" : (preset ?? "custom")}
          onChange={(k) => {
            if (k === "custom") return setCustom(true);
            setCustom(false);
            const r = ranges.find((x) => x.key === k)!;
            update({ from: r.from, to: r.to });
          }}
          options={[...ranges.map((r) => ({ value: r.key, label: r.label })), { value: "custom", label: "Custom" }]}
        />
        {(custom || !preset) && (
          <div className="flex items-center overflow-hidden rounded-control border border-control bg-surface">
            <input type="date" aria-label="From" className={bareInput} value={from} max={to} onChange={(e) => isDate(e.target.value) && e.target.value <= to && update({ from: e.target.value })} />
            <span className="text-ink-muted" aria-hidden>
              –
            </span>
            <input type="date" aria-label="To" className={bareInput} value={to} min={from} onChange={(e) => isDate(e.target.value) && e.target.value >= from && update({ to: e.target.value })} />
          </div>
        )}
      </ReportHeader>

      {error && <Alert>{typeof error === "string" ? error : errorMessage(error)}</Alert>}

      {!trend.data || !totals ? (
        trend.isLoading && <Spinner />
      ) : (
        <div className={`space-y-4 transition-opacity ${trend.isPlaceholderData ? "opacity-60" : ""}`}>
          <KpiTiles tiles={kpiTiles(totals, base)} vs={vs} />
          <MonthByMonth rows={trend.data} />
        </div>
      )}

      <section className="rounded-panel border border-line bg-surface">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="px-1 text-body font-semibold text-ink">Breakdown by</h2>
          <div role="tablist" aria-label="Group by" className="flex flex-wrap gap-1">
            {DIMENSIONS.map((d) => {
              const on = d.key === dimension;
              return (
                <button
                  key={d.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => update({ by: d.key })}
                  className={`h-8 rounded-control px-2.5 text-control transition-colors ${on ? "bg-selected font-semibold text-primary" : "font-medium text-ink-heading hover:bg-row-hover"}`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </header>
        <div className="p-4">
          <p className="mb-3 text-meta text-ink-muted">
            Enquiries raised {fmtDate(from)} – {fmtDate(to)} (cancelled not counted) and what became of them. Sales and profit are for the ones now
            confirmed.
          </p>
          {!breakdown.data ? (
            breakdown.isLoading && <Spinner />
          ) : (
            <div className={`transition-opacity ${breakdown.isPlaceholderData ? "opacity-60" : ""}`}>
              <BreakdownTable key={dimension} rows={breakdown.data} dimension={dimension} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
