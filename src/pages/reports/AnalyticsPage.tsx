import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { MonthlyProfitChart } from "../../components/MonthlyProfitChart";
import { Alert, Button, Card, Empty, Field, Spinner, Stat, inputClass } from "../../components/ui";
import { fetchBreakdown, fetchMonthlyTrend } from "../../lib/api";
import { errorMessage, fmtDate, fmtMoney, fmtPercent, todayIso } from "../../lib/format";
import { DIMENSIONS, breakdownLabel, monthName, percent } from "../../lib/reports";
import type { BreakdownDimension, BreakdownRow, MonthlyTrendRow } from "../../lib/types";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function presets(today: string) {
  const [year, month] = today.split("-").map(Number);
  // The current month and the 11 before it.
  const start12 = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);
  return [
    { label: "This year", from: `${year}-01-01`, to: today },
    { label: "Last 12 months", from: start12, to: today },
    { label: "Last year", from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
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

const monthTitle = (iso: string) => `${monthName(iso).slice(0, 1)}${monthName(iso).slice(1, 3).toLowerCase()} ${iso.slice(0, 4)}`;

function TrendTable({ rows }: { rows: MonthlyTrendRow[] }) {
  const t = trendTotals(rows);
  const line = (r: Omit<MonthlyTrendRow, "month">) => (
    <>
      <td className="px-2">{r.enquiries.toLocaleString()}</td>
      <td className="px-2">{r.quoted.toLocaleString()}</td>
      <td className="px-2">{r.converted.toLocaleString()}</td>
      <td className="px-2">{fmtPercent(r.converted, r.enquiries)}</td>
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
            <tr key={r.month} className="border-b border-line text-right">
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

function BreakdownTable({ rows, dimension }: { rows: BreakdownRow[]; dimension: BreakdownDimension }) {
  const [sort, setSort] = useState<SortKey>("enquiries");
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return <Empty>No enquiries in this range.</Empty>;
  const sorted = sortRows(rows, sort);
  const shown = showAll ? sorted : sorted.slice(0, TOP);
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
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-meta text-ink-heading font-medium">
            <tr className="border-b border-line text-right">
              {header("label", "Name", "py-1.5 pr-3 text-left")}
              {header("enquiries", "Enquiries")}
              <th className="px-2">Quoted</th>
              {header("confirmed", "Confirmed")}
              <th className="px-2">Lost</th>
              {header("conversion", "Conv.")}
              {header("sell_total", "Sales")}
              {header("profit", "Profit")}
              <th className="pl-2">Profit / job</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {shown.map((r) => (
              <tr key={r.label} className="border-b border-line text-right">
                <td className="max-w-80 truncate py-1.5 pr-3 text-left" title={r.label}>
                  {breakdownLabel(dimension, r.label)}
                </td>
                <td className="px-2">{r.enquiries}</td>
                <td className="px-2">{r.quoted}</td>
                <td className="px-2">{r.confirmed}</td>
                <td className="px-2">{r.lost || ""}</td>
                <td className="px-2">{fmtPercent(r.confirmed, r.enquiries)}</td>
                <td className="px-2">{fmtMoney(r.sell_total)}</td>
                <td className="px-2">{fmtMoney(r.profit)}</td>
                <td className="pl-2">{r.confirmed ? fmtMoney(Math.round(r.profit / r.confirmed)) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > TOP && (
        <div className="mt-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show top ${TOP}` : `Show all ${sorted.length}`}
          </Button>
        </div>
      )}
    </>
  );
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
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const update = (patch: Record<string, string>) => setParams({ from, to, by: dimension, ...patch }, { replace: true });

  const trend = useQuery({
    queryKey: ["reports", "trend", from, to],
    queryFn: () => fetchMonthlyTrend(from, to),
    placeholderData: keepPreviousData,
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
  const error = trend.error ?? breakdown.error ?? exportError;
  const activeLabel = DIMENSIONS.find((d) => d.key === dimension)!.label;

  return (
    <div className="space-y-4">
      <Card
        title={`Analytics — ${fmtDate(from)} to ${fmtDate(to)}`}
        actions={
          <Button variant="secondary" onClick={doExport} disabled={!trend.data || trend.isPlaceholderData || exporting}>
            {exporting ? "Exporting…" : "Export to Excel"}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          {ranges.map((r) => (
            <Button key={r.label} variant={r.from === from && r.to === to ? "primary" : "secondary"} onClick={() => update({ from: r.from, to: r.to })}>
              {r.label}
            </Button>
          ))}
          <Field label="From">
            <input type="date" className={inputClass} value={from} max={to} onChange={(e) => isDate(e.target.value) && e.target.value <= to && update({ from: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className={inputClass} value={to} min={from} onChange={(e) => isDate(e.target.value) && e.target.value >= from && update({ to: e.target.value })} />
          </Field>
        </div>
      </Card>

      {error && <Alert>{typeof error === "string" ? error : errorMessage(error)}</Alert>}

      {!trend.data || !totals ? (
        trend.isLoading && <Spinner />
      ) : (
        <div className={`space-y-4 transition-opacity ${trend.isPlaceholderData ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Enquiries" value={totals.enquiries.toLocaleString()} sub="raised in the range, cancelled not counted" />
            <Stat
              label="Conversion"
              value={fmtPercent(totals.converted, totals.enquiries)}
              sub={`${totals.converted.toLocaleString()} of those confirmed`}
            />
            <Stat label="Jobs confirmed" value={totals.confirmed.toLocaleString()} sub={`sales ${fmtMoney(Math.round(totals.confirmed_sell))}`} />
            <Stat label="Profit" value={fmtMoney(Math.round(totals.confirmed_profit))} sub="on jobs confirmed in the range" />
          </div>

          <Card title="Profit per month" actions={<span className="text-meta text-ink-muted">by confirmation date</span>}>
            {totals.confirmed === 0 ? (
              <Empty>No confirmed jobs in this range.</Empty>
            ) : (
              <MonthlyProfitChart
                label="Profit per month, by confirmation date"
                data={trend.data.map((r) => ({ month: r.month, value: r.confirmed_profit, note: `${r.confirmed} job${r.confirmed === 1 ? "" : "s"}` }))}
              />
            )}
          </Card>

          <Card title="Month by month">
            <TrendTable rows={trend.data} />
          </Card>
        </div>
      )}

      <Card
        title={`By ${activeLabel.toLowerCase()}`}
        actions={
          <div className="flex flex-wrap gap-1" role="group" aria-label="Group by">
            {DIMENSIONS.map((d) => (
              <Button key={d.key} size="sm" variant={d.key === dimension ? "primary" : "ghost"} aria-pressed={d.key === dimension} onClick={() => update({ by: d.key })}>
                {d.label}
              </Button>
            ))}
          </div>
        }
      >
        <p className="mb-3 text-meta text-ink-muted">
          Enquiries raised {fmtDate(from)} – {fmtDate(to)} (cancelled not counted) and what became of them. Sales and profit are for the
          ones now confirmed.
        </p>
        {!breakdown.data ? (
          breakdown.isLoading && <Spinner />
        ) : (
          <div className={`transition-opacity ${breakdown.isPlaceholderData ? "opacity-60" : ""}`}>
            <BreakdownTable key={dimension} rows={breakdown.data} dimension={dimension} />
          </div>
        )}
      </Card>
    </div>
  );
}
