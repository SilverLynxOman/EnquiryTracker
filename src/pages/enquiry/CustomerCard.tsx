import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router";
import { Alert, Card, Spinner } from "../../components/ui";
import { fetchCustomerNotDuplicates, fetchCustomerSummaries } from "../../lib/api";
import { DEFAULT_MIN_SCORE, findDuplicatePairs, matchKey, pairKey } from "../../lib/customerDuplicates";
import { displayName, fmtDayMonth, shipmentLabel } from "../../lib/display";
import type { CustomerStats } from "../../lib/enquiryDetails";
import { STALE_DAYS } from "../../lib/followUps";
import { errorMessage } from "../../lib/format";
import { DEFAULT_VIEW, writeRegisterView } from "../../lib/registerView";
import type { CustomerSummary, EnquiryRow } from "../../lib/types";
import { laneLabel } from "../../lib/workdays";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** 41927 → "41.9k", 785 → "785". */
function compact(n: number): string {
  return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

/** Other customers whose names probably mean the same company (as the Customers page finds them). */
function useLookalikes(customerId: string): CustomerSummary[] {
  const summaries = useQuery({ queryKey: ["customers", "summary"], queryFn: fetchCustomerSummaries, staleTime: 300_000 });
  const notDuplicates = useQuery({ queryKey: ["customers", "not-duplicates"], queryFn: fetchCustomerNotDuplicates, staleTime: 300_000 });
  return useMemo(() => {
    if (!summaries.data || !notDuplicates.data) return [];
    const dismissed = new Set(notDuplicates.data.map((p) => pairKey(p.a, p.b)));
    const byId = new Map(summaries.data.map((s) => [s.id, s]));
    return findDuplicatePairs(summaries.data, dismissed, DEFAULT_MIN_SCORE)
      .filter((p) => p.a === customerId || p.b === customerId)
      .map((p) => byId.get(p.a === customerId ? p.b : p.a))
      .filter((s): s is CustomerSummary => !!s);
  }, [summaries.data, notDuplicates.data, customerId]);
}

/** The customer behind the enquiry: who to talk to, and their record with us this year. */
export function CustomerCard({
  row,
  today,
  stats,
  loading,
  error,
}: {
  row: EnquiryRow;
  today: string;
  stats: CustomerStats | undefined;
  loading: boolean;
  error: unknown;
}) {
  const lookalikes = useLookalikes(row.customer_id);
  const registerLink = `/enquiries?${writeRegisterView({ ...DEFAULT_VIEW, period: "all", q: row.customer_name }).toString()}`;
  const open = stats ? stats.awaiting + stats.quoted : 0;

  return (
    <Card
      title="Customer"
      actions={
        <Link to={registerLink} className="text-meta font-medium text-primary hover:underline">
          All their enquiries
        </Link>
      }
    >
      <div className="text-title font-semibold text-ink">{displayName(row.customer_name)}</div>
      {(row.contact_name || row.contact_email || row.contact_phone) && (
        <p className="mt-1 text-body text-ink-heading">
          {row.contact_name && <span className="font-medium text-ink">{row.contact_name}</span>}
          {row.contact_email && <span className="block break-all text-meta">{row.contact_email}</span>}
          {row.contact_phone && <span className="block text-meta tabular-nums">{row.contact_phone}</span>}
        </p>
      )}

      {loading ? (
        <Spinner label="Loading their record…" />
      ) : error ? (
        <div className="mt-3">
          <Alert>{errorMessage(error)}</Alert>
        </div>
      ) : (
        stats && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-control border border-line bg-line">
              <div className="bg-surface px-3 py-2">
                <div className="text-title font-semibold tabular-nums text-ink">{stats.enquiries}</div>
                <div className="text-meta text-ink-muted">{stats.enquiries === 1 ? "enquiry" : "enquiries"} this year</div>
              </div>
              <div className="bg-surface px-3 py-2">
                <div className="text-title font-semibold tabular-nums text-confirmed">{stats.won} won</div>
                <div className="text-meta text-ink-muted">{stats.enquiries ? `${Math.round((stats.won / stats.enquiries) * 100)}% of them` : "None yet"}</div>
              </div>
              <div className="bg-surface px-3 py-2">
                <div className="text-title font-semibold tabular-nums text-ink">USD {compact(stats.sold)}</div>
                <div className="text-meta text-ink-muted">sold this year</div>
              </div>
              <div className="bg-surface px-3 py-2">
                <div className="text-title font-semibold tabular-nums text-ink">USD {compact(stats.profit)}</div>
                <div className="text-meta text-ink-muted">profit on those jobs</div>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-body text-ink-heading">
              {stats.usualDays != null && (
                <li>Usually confirms {stats.usualDays === 0 ? "on the day of the quote" : `${plural(stats.usualDays, "day")} after the quote`}.</li>
              )}
              {stats.lastWin?.confirmed_date && (
                <li>
                  Last win {fmtDayMonth(stats.lastWin.confirmed_date, today)}:{" "}
                  <Link to={`/enquiries/${stats.lastWin.id}`} className="font-medium tabular-nums text-primary hover:underline">
                    {stats.lastWin.reference}
                  </Link>
                  , {shipmentLabel(stats.lastWin)} {laneLabel(stats.lastWin.pol, stats.lastWin.pod)}
                </li>
              )}
              {open > 0 && (
                <li>
                  Also open:{" "}
                  {[
                    stats.awaiting ? `${stats.awaiting} awaiting a quote` : "",
                    stats.quoted ? `${stats.quoted} quoted${stats.stale ? `, ${stats.stale} of them ${STALE_DAYS}+ days ago` : ""}` : "",
                  ]
                    .filter(Boolean)
                    .join("; ")}
                  .
                </li>
              )}
            </ul>
          </>
        )
      )}

      {lookalikes.length > 0 && (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-control bg-await-bg px-3 py-2 text-meta text-await">
          <span>
            Also in the customer list:{" "}
            {lookalikes
              .slice(0, 3)
              .map((c) => `${displayName(c.name)} (${c.enquiries === 1 ? "1 enquiry" : `${c.enquiries} enquiries`})`)
              .join(", ")}
            . The same company?
          </span>
          <Link to={`/customers?q=${encodeURIComponent(matchKey(row.customer_name).split(" ")[0] ?? "")}`} className="font-semibold underline">
            Review
          </Link>
        </div>
      )}
    </Card>
  );
}
