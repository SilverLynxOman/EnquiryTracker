import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Alert, Card, Empty, Spinner, Stat } from "../components/ui";
import { fetchFollowUps, fetchPeriodStats, fetchSalespersonSummary } from "../lib/api";
import { addDays, errorMessage, firstOfMonth, fmtDate, fmtMoney, fmtPercent, todayIso } from "../lib/format";
import type { EnquiryRow, PeriodStats } from "../lib/types";

function StatsRow({ title, stats }: { title: string; stats: PeriodStats | undefined }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Enquiries" value={stats?.enquiries ?? "—"} />
        <Stat label="Quoted" value={stats?.quoted ?? "—"} />
        <Stat label="Confirmed" value={stats?.confirmed ?? "—"} sub="by confirmation date" />
        <Stat
          label="Conversion"
          value={stats ? fmtPercent(stats.converted, stats.enquiries) : "—"}
          sub={stats ? `${stats.converted} of ${stats.enquiries} enquiries confirmed` : undefined}
        />
        <Stat label="Profit" value={stats ? fmtMoney(stats.profit) : "—"} sub={stats ? `on sales of ${fmtMoney(stats.sell_total)}` : undefined} />
      </div>
    </div>
  );
}

function FollowUpList({ title, rows, count, dateOf }: { title: string; rows: EnquiryRow[]; count: number; dateOf: (r: EnquiryRow) => string | null }) {
  return (
    <Card title={`${title} (${count})`}>
      {rows.length === 0 ? (
        <Empty>Nothing waiting.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/enquiries/${r.id}`} className="flex items-baseline gap-3 py-1.5 hover:bg-slate-50">
                <span className="w-20 shrink-0 font-mono text-xs text-slate-500">{r.reference}</span>
                <span className="min-w-0 flex-1 truncate">{r.customer_name}</span>
                <span className="shrink-0 text-xs text-slate-500">{r.sales_person_name}</span>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-500">{fmtDate(dateOf(r))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const today = todayIso();
  const monthStart = firstOfMonth(today);
  const since = addDays(today, -30);

  const todayStats = useQuery({ queryKey: ["dashboard", "stats", today, today], queryFn: () => fetchPeriodStats(today, today) });
  const monthStats = useQuery({ queryKey: ["dashboard", "stats", monthStart, today], queryFn: () => fetchPeriodStats(monthStart, today) });
  const people = useQuery({ queryKey: ["dashboard", "people", monthStart, today], queryFn: () => fetchSalespersonSummary(monthStart, today) });
  const awaitingQuote = useQuery({ queryKey: ["dashboard", "follow", "new", since], queryFn: () => fetchFollowUps("new", since) });
  const awaitingConfirm = useQuery({ queryKey: ["dashboard", "follow", "quoted", since], queryFn: () => fetchFollowUps("quoted", since) });

  const error = todayStats.error ?? monthStats.error ?? people.error ?? awaitingQuote.error ?? awaitingConfirm.error;
  const totals = people.data?.reduce(
    (t, r) => ({
      total_enquiries: t.total_enquiries + r.total_enquiries,
      confirmed: t.confirmed + r.confirmed,
      confirmed_new: t.confirmed_new + r.confirmed_new,
      confirmed_old: t.confirmed_old + r.confirmed_old,
      fcl_jobs: t.fcl_jobs + r.fcl_jobs,
      fcl_units: t.fcl_units + r.fcl_units,
      air: t.air + r.air,
      lcl: t.lcl + r.lcl,
      courier: t.courier + r.courier,
      other: t.other + r.other,
      profit: t.profit + Number(r.profit),
    }),
    { total_enquiries: 0, confirmed: 0, confirmed_new: 0, confirmed_old: 0, fcl_jobs: 0, fcl_units: 0, air: 0, lcl: 0, courier: 0, other: 0, profit: 0 },
  );

  return (
    <div className="space-y-6">
      {error && <Alert>{errorMessage(error)}</Alert>}
      <StatsRow title={`Today — ${fmtDate(today)}`} stats={todayStats.data} />
      <StatsRow title={`Month to date — ${fmtDate(monthStart)} to ${fmtDate(today)}`} stats={monthStats.data} />

      <div className="grid gap-4 lg:grid-cols-2">
        <FollowUpList
          title="Awaiting quote (last 30 days)"
          rows={awaitingQuote.data?.rows ?? []}
          count={awaitingQuote.data?.count ?? 0}
          dateOf={(r) => r.enquiry_date}
        />
        <FollowUpList
          title="Quoted, awaiting confirmation (last 30 days)"
          rows={awaitingConfirm.data?.rows ?? []}
          count={awaitingConfirm.data?.count ?? 0}
          dateOf={(r) => r.quoted_date}
        />
      </div>

      <Card title="Sales persons — this month">
        {people.isLoading ? (
          <Spinner />
        ) : !people.data?.length ? (
          <Empty>No enquiries this month yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr className="border-b border-slate-200 text-right">
                  <th className="py-1.5 pr-3 text-left">Person</th>
                  <th className="px-2">Inquiries</th>
                  <th className="px-2">Confirmed</th>
                  <th className="px-2">New + old</th>
                  <th className="px-2">FCL</th>
                  <th className="px-2">Units</th>
                  <th className="px-2">Air</th>
                  <th className="px-2">LCL</th>
                  <th className="px-2">Courier</th>
                  <th className="px-2">Other</th>
                  <th className="pl-2">Profit</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {people.data.map((r) => (
                  <tr key={r.sales_person} className="border-b border-slate-100 text-right">
                    <td className="py-1.5 pr-3 text-left">{r.sales_person}</td>
                    <td className="px-2">{r.total_enquiries}</td>
                    <td className="px-2">{r.confirmed}</td>
                    <td className="px-2 text-slate-500">
                      {r.confirmed_new}+{r.confirmed_old}
                    </td>
                    <td className="px-2">{r.fcl_jobs || ""}</td>
                    <td className="px-2">{r.fcl_units || ""}</td>
                    <td className="px-2">{r.air || ""}</td>
                    <td className="px-2">{r.lcl || ""}</td>
                    <td className="px-2">{r.courier || ""}</td>
                    <td className="px-2">{r.other || ""}</td>
                    <td className="pl-2">{fmtMoney(Number(r.profit))}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="font-semibold tabular-nums">
                  <tr className="text-right">
                    <td className="py-1.5 pr-3 text-left">Total</td>
                    <td className="px-2">{totals.total_enquiries}</td>
                    <td className="px-2">{totals.confirmed}</td>
                    <td className="px-2 text-slate-500">
                      {totals.confirmed_new}+{totals.confirmed_old}
                    </td>
                    <td className="px-2">{totals.fcl_jobs}</td>
                    <td className="px-2">{totals.fcl_units}</td>
                    <td className="px-2">{totals.air}</td>
                    <td className="px-2">{totals.lcl}</td>
                    <td className="px-2">{totals.courier}</td>
                    <td className="px-2">{totals.other}</td>
                    <td className="pl-2">{fmtMoney(totals.profit)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
