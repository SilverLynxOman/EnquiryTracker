import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { SalespersonTable } from "../components/SalespersonTable";
import { Alert, Card, Empty, Spinner, Stat } from "../components/ui";
import { countRegister, fetchFollowUps, fetchPeriodStats, fetchSalespersonSummary } from "../lib/api";
import { displayName } from "../lib/display";
import { addDays, errorMessage, firstOfMonth, fmtDate, fmtMoney, fmtPercent, todayIso } from "../lib/format";
import { STALE_DAYS, staleQuoteFilters } from "../lib/followUps";
import type { EnquiryRow, PeriodStats } from "../lib/types";
import { PersonPicker } from "./window/PersonPicker";
import { TeamVoyageCard } from "./voyage/TeamVoyage";

function StatsRow({ title, stats }: { title: string; stats: PeriodStats | undefined }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-ink-heading">{title}</h2>
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

function FollowUpList({
  title,
  rows,
  count,
  dateOf,
  actions,
}: {
  title: string;
  rows: EnquiryRow[];
  count: number;
  dateOf: (r: EnquiryRow) => string | null;
  actions?: ReactNode;
}) {
  return (
    <Card title={`${title} (${count})`} actions={actions}>
      {rows.length === 0 ? (
        <Empty>Nothing waiting.</Empty>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/enquiries/${r.id}`} className="flex items-baseline gap-3 py-1.5 hover:bg-row-hover">
                <span className="w-20 shrink-0 text-control font-semibold tabular-nums text-primary">{r.reference}</span>
                <span className="min-w-0 flex-1 truncate">{displayName(r.customer_name)}</span>
                <span className="shrink-0 text-meta text-ink-muted">{displayName(r.sales_person_name)}</span>
                <span className="w-20 shrink-0 text-right text-meta tabular-nums text-ink-muted">{fmtDate(dateOf(r))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { seesAll } = useAuth();
  const today = todayIso();
  const monthStart = firstOfMonth(today);
  const since = addDays(today, -30);

  const todayStats = useQuery({ queryKey: ["dashboard", "stats", today, today], queryFn: () => fetchPeriodStats(today, today) });
  const monthStats = useQuery({ queryKey: ["dashboard", "stats", monthStart, today], queryFn: () => fetchPeriodStats(monthStart, today) });
  const people = useQuery({ queryKey: ["dashboard", "people", monthStart, today], queryFn: () => fetchSalespersonSummary(monthStart, today) });
  const awaitingQuote = useQuery({ queryKey: ["dashboard", "follow", "new", since], queryFn: () => fetchFollowUps("new", since) });
  const awaitingConfirm = useQuery({ queryKey: ["dashboard", "follow", "quoted", since], queryFn: () => fetchFollowUps("quoted", since) });
  const stale = useQuery({ queryKey: ["dashboard", "stale-quotes", today], queryFn: () => countRegister(staleQuoteFilters(today)) });

  const error = todayStats.error ?? monthStats.error ?? people.error ?? awaitingQuote.error ?? awaitingConfirm.error;

  return (
    <div className="space-y-6">
      {error && <Alert>{errorMessage(error)}</Alert>}
      <StatsRow title={`Today — ${fmtDate(today)}`} stats={todayStats.data} />
      <StatsRow title={`Month to date — ${fmtDate(monthStart)} to ${fmtDate(today)}`} stats={monthStats.data} />

      {/* Sales staff see only their own enquiries: no links to other people's open quotes. */}
      <TeamVoyageCard today={today} personLinks={seesAll} actions={seesAll ? <PersonPicker /> : undefined} />

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
          actions={
            !!stale.data && (
              <Link to="/follow-ups" className="text-meta font-medium text-primary hover:underline">
                {stale.data.toLocaleString()} waiting {STALE_DAYS}+ days → Follow-ups
              </Link>
            )
          }
        />
      </div>

      <Card title="Sales persons — this month">
        {people.isLoading ? (
          <Spinner />
        ) : !people.data?.length ? (
          <Empty>No enquiries this month yet.</Empty>
        ) : (
          <SalespersonTable rows={people.data} />
        )}
      </Card>
    </div>
  );
}
