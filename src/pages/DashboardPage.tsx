import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { SalespersonTable } from "../components/SalespersonTable";
import { Alert, Card, Empty, Spinner } from "../components/ui";
import { countRegister, fetchFollowUps, fetchSalespersonSummary } from "../lib/api";
import { displayName } from "../lib/display";
import { addDays, errorMessage, firstOfMonth, fmtDate, todayIso } from "../lib/format";
import { STALE_DAYS, staleQuoteFilters } from "../lib/followUps";
import type { EnquiryRow } from "../lib/types";
import { KpiStrip } from "./dashboard/KpiStrip";
import { PersonPicker } from "./window/PersonPicker";
import { TeamVoyageCard } from "./voyage/TeamVoyage";

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

  const people = useQuery({ queryKey: ["dashboard", "people", monthStart, today], queryFn: () => fetchSalespersonSummary(monthStart, today) });
  const awaitingQuote = useQuery({ queryKey: ["dashboard", "follow", "new", since], queryFn: () => fetchFollowUps("new", since) });
  const awaitingConfirm = useQuery({ queryKey: ["dashboard", "follow", "quoted", since], queryFn: () => fetchFollowUps("quoted", since) });
  const stale = useQuery({ queryKey: ["dashboard", "stale-quotes", today], queryFn: () => countRegister(staleQuoteFilters(today)) });

  const error = people.error ?? awaitingQuote.error ?? awaitingConfirm.error;

  return (
    <div className="space-y-6">
      {error && <Alert>{errorMessage(error)}</Alert>}
      <KpiStrip today={today} />

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
