import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router";
import { Alert, Card, Spinner } from "../../components/ui";
import { fetchLaneHistory } from "../../lib/api";
import { displayName, fmtDayMonth, shipmentLabel } from "../../lib/display";
import { laneStats } from "../../lib/enquiryDetails";
import { errorMessage, fmtMoney } from "../../lib/format";
import { MODE_LABELS, type EnquiryRow } from "../../lib/types";
import { laneLabel, seasonStart } from "../../lib/workdays";

/** Earlier enquiries on the same route and mode this year, with what the won ones were bought and sold for. */
export function LaneCard({ row, today }: { row: EnquiryRow; today: string }) {
  const since = seasonStart(today);
  const pol = row.pol?.trim() ?? "";
  const pod = row.pod?.trim() ?? "";
  const hasRoute = !!pol && !!pod;
  const lane = useQuery({
    queryKey: ["lane-history", pol.toUpperCase(), pod.toUpperCase(), since],
    queryFn: () => fetchLaneHistory(pol, pod, since),
    enabled: hasRoute,
    staleTime: 60_000,
  });
  const stats = useMemo(() => (lane.data ? laneStats(lane.data, row, since) : null), [lane.data, row, since]);
  const mode = row.shipment_mode ? MODE_LABELS[row.shipment_mode] : "";

  return (
    <Card title={hasRoute ? `${laneLabel(row.pol, row.pod)} before` : "This route before"}>
      {!hasRoute ? (
        <p className="text-body text-ink-muted">The enquiry has no POL and POD yet, so there is no route to compare.</p>
      ) : lane.isLoading ? (
        <Spinner label="Loading the route's history…" />
      ) : lane.error ? (
        <Alert>{errorMessage(lane.error)}</Alert>
      ) : (
        stats && (
          <>
            <p className="text-body text-ink-heading">
              Other {mode ? `${mode} ` : ""}enquiries this year: <b className="tabular-nums text-ink">{stats.enquiries}</b> · won{" "}
              <b className="tabular-nums text-confirmed">{stats.won}</b> · still open <b className="tabular-nums text-ink">{stats.open}</b>
            </p>
            {stats.wins.length > 0 ? (
              <ul className="mt-2">
                {stats.wins.map((w) => (
                  <li key={w.id} className="border-t border-line py-2 first:border-t-0">
                    <Link to={`/enquiries/${w.id}`} className="group block">
                      <span className="flex justify-between gap-3 text-body">
                        <span className="min-w-0 truncate text-ink">
                          <b className="font-semibold">{w.confirmed_date ? fmtDayMonth(w.confirmed_date, today) : ""}</b> · {shipmentLabel(w)} ·{" "}
                          {displayName(w.customer_name)}
                        </span>
                        {w.profit != null && <span className="shrink-0 font-semibold tabular-nums text-confirmed">+{fmtMoney(w.profit)}</span>}
                      </span>
                      <span className="flex justify-between gap-3 text-meta text-ink-muted">
                        <span className="min-w-0 truncate">
                          <span className="tabular-nums text-primary group-hover:underline">{w.reference}</span>
                          {w.agent_name ? ` · ${displayName(w.agent_name)}` : ""}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {w.buy_total != null || w.sell_total != null ? `${fmtMoney(w.buy_total) || "—"} → ${fmtMoney(w.sell_total) || "—"}` : "No prices"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body text-ink-muted">No other {mode ? `${mode} ` : ""}job on this route was confirmed this year.</p>
            )}
            <p className="mt-2 border-t border-line pt-2 text-meta text-ink-muted">
              Buy → sell in USD. Only confirmed jobs carry prices in the register, so lost quotes don't show what we lost at.
            </p>
          </>
        )
      )}
    </Card>
  );
}
