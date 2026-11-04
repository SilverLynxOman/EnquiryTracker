import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { EnquiryList } from "../../components/EnquiryList";
import { SalespersonTable } from "../../components/SalespersonTable";
import { Alert, Button, Card, Empty, Field, Spinner, Stat, inputClass } from "../../components/ui";
import { fetchPeriodRows, fetchSalespersonSummary } from "../../lib/api";
import { addDays, errorMessage, fmtMoney, todayIso } from "../../lib/format";
import {
  EARLIER_SECTION_TITLE,
  buildPeriodReport,
  dayPeriod,
  modeTotals,
  monthPeriod,
  periodFileName,
  periodTitle,
  shiftPeriod,
  weekPeriod,
  type ModeTotal,
  type Period,
  type PeriodKind,
} from "../../lib/reports";
import { MODE_LABELS } from "../../lib/types";

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

const WORDING: Record<PeriodKind, { current: string; unit: string; within: string; of: (iso: string) => Period }> = {
  daily: { current: "Today", unit: "day", within: "that day", of: dayPeriod },
  weekly: { current: "This week", unit: "week", within: "in the week", of: weekPeriod },
  monthly: { current: "This month", unit: "month", within: "in the month", of: monthPeriod },
};

function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const { kind } = period;
  const w = WORDING[kind];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Button variant="secondary" onClick={() => onChange(shiftPeriod(period, -1))} aria-label={`Previous ${w.unit}`} title={`Previous ${w.unit}`}>
        ‹
      </Button>
      {kind === "daily" && (
        <Field label="Date">
          <input
            type="date"
            className={inputClass}
            value={period.from}
            onChange={(e) => isDate(e.target.value) && onChange(dayPeriod(e.target.value))}
          />
        </Field>
      )}
      {kind === "weekly" && (
        <>
          <Field label="From">
            <input
              type="date"
              className={inputClass}
              value={period.from}
              onChange={(e) => isDate(e.target.value) && onChange({ kind, from: e.target.value, to: addDays(e.target.value, 6) })}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={inputClass}
              min={period.from}
              value={period.to}
              onChange={(e) => isDate(e.target.value) && e.target.value >= period.from && onChange({ kind, from: period.from, to: e.target.value })}
            />
          </Field>
        </>
      )}
      {kind === "monthly" && (
        <Field label="Month">
          <input
            type="month"
            className={inputClass}
            value={period.from.slice(0, 7)}
            onChange={(e) => isDate(`${e.target.value}-01`) && onChange(monthPeriod(`${e.target.value}-01`))}
          />
        </Field>
      )}
      <Button variant="secondary" onClick={() => onChange(shiftPeriod(period, 1))} aria-label={`Next ${w.unit}`} title={`Next ${w.unit}`}>
        ›
      </Button>
      <Button variant="ghost" onClick={() => onChange(w.of(todayIso()))}>
        {w.current}
      </Button>
      {kind === "weekly" && <span className="pb-1.5 text-xs text-slate-500">Weeks run Saturday to Friday.</span>}
    </div>
  );
}

function ModeTable({ modes }: { modes: ModeTotal[] }) {
  if (!modes.length) return <Empty>No enquiries.</Empty>;
  const t = modes.reduce(
    (a, m) => ({ enquiries: a.enquiries + m.enquiries, confirmed: a.confirmed + m.confirmed, profit: a.profit + m.profit }),
    { enquiries: 0, confirmed: 0, profit: 0 },
  );
  return (
    <table className="min-w-full text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr className="border-b border-slate-200 text-right">
          <th className="py-1.5 pr-3 text-left">Mode</th>
          <th className="px-2">Inquiries</th>
          <th className="px-2">Confirmed</th>
          <th className="px-2">Units</th>
          <th className="pl-2">Profit</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {modes.map((m) => (
          <tr key={m.mode} className="border-b border-slate-100 text-right">
            <td className="py-1.5 pr-3 text-left">{MODE_LABELS[m.mode]}</td>
            <td className="px-2">{m.enquiries}</td>
            <td className="px-2">{m.confirmed}</td>
            <td className="px-2">{m.units || ""}</td>
            <td className="pl-2">{fmtMoney(m.profit)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot className="font-semibold tabular-nums">
        <tr className="text-right">
          <td className="py-1.5 pr-3 text-left">Total</td>
          <td className="px-2">{t.enquiries}</td>
          <td className="px-2">{t.confirmed}</td>
          <td className="px-2" />
          <td className="pl-2">{fmtMoney(Math.round(t.profit * 100) / 100)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Daily, weekly and monthly report: the period's enquiries, earlier enquiries confirmed in it, and totals. */
export default function PeriodReportPage({ kind }: { kind: PeriodKind }) {
  const [params, setParams] = useSearchParams();
  const period = readPeriod(kind, params);
  const { from, to } = period;
  const withSummary = kind !== "daily";
  const w = WORDING[kind];
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ["reports", "period", from, to],
    queryFn: async () => {
      const { raised, confirmed } = await fetchPeriodRows(from, to);
      return { report: buildPeriodReport(period, raised, confirmed), modes: modeTotals(raised, confirmed) };
    },
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: ["reports", "summary", from, to],
    queryFn: () => fetchSalespersonSummary(from, to),
    enabled: withSummary,
    placeholderData: keepPreviousData,
  });

  const stale = data.isPlaceholderData || (withSummary && summary.isPlaceholderData);
  const ready = !!data.data && !stale && (!withSummary || !!summary.data);
  const report = data.data?.report;
  const error = data.error ?? (withSummary ? summary.error : null);

  async function doExport() {
    if (!data.data) return;
    setExporting(true);
    setExportError(null);
    try {
      const [{ periodReportWorkbook }, { saveWorkbook }] = await Promise.all([
        import("../../lib/excel/exportReports"),
        import("../../lib/excel/exportRegister"),
      ]);
      const extra = withSummary && summary.data ? { rows: summary.data, modes: data.data.modes } : undefined;
      saveWorkbook(periodReportWorkbook(period, data.data.report, extra), periodFileName(period));
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title={periodTitle(period)}
        actions={
          <Button variant="secondary" onClick={doExport} disabled={!ready || exporting}>
            {exporting ? "Exporting…" : "Export to Excel"}
          </Button>
        }
      >
        <PeriodPicker period={period} onChange={(p) => setParams(writePeriod(p), { replace: true })} />
      </Card>

      {(error || exportError) && <Alert>{exportError ?? errorMessage(error)}</Alert>}

      {!report ? (
        data.isLoading && <Spinner />
      ) : (
        <div className={`space-y-4 transition-opacity ${stale ? "opacity-60" : ""}`} aria-busy={stale}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Enquiries"
              value={report.enquiries}
              sub={report.cancelled ? `raised ${w.within}; ${report.cancelled} cancelled not counted` : `raised ${w.within}`}
            />
            <Stat
              label="Confirmations"
              value={report.confirmations}
              sub={`${report.confirmations - report.earlier.length} raised ${w.within} + ${report.earlier.length} earlier`}
            />
            <Stat label="Sales" value={fmtMoney(report.confirmedSell)} sub="confirmed jobs" />
            <Stat label="Profit" value={fmtMoney(report.confirmedProfit)} sub="confirmed jobs" />
          </div>

          {withSummary && (
            <div className="grid gap-4 xl:grid-cols-3">
              <Card title="Sales persons" className="xl:col-span-2">
                {!summary.data ? <Spinner /> : !summary.data.length ? <Empty>No enquiries or confirmations.</Empty> : <SalespersonTable rows={summary.data} />}
              </Card>
              <Card title="Shipment modes">{data.data && <ModeTable modes={data.data.modes} />}</Card>
            </div>
          )}

          <Card title={`Enquiries raised (${report.raised.length})`}>
            <EnquiryList rows={report.raised} empty={`No enquiries raised ${w.within}.`} />
          </Card>
          <Card
            title={
              <>
                Earlier enquiries confirmed {w.within} ({report.earlier.length})
                <span className="ml-2 text-xs font-normal text-slate-500">“{EARLIER_SECTION_TITLE[kind]}” in the Excel export</span>
              </>
            }
          >
            <EnquiryList rows={report.earlier} empty="None." />
          </Card>
        </div>
      )}
    </div>
  );
}
