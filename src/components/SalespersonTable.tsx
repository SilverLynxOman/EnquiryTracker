import { Link } from "react-router";
import { displayName } from "../lib/display";
import { fmtMoney } from "../lib/format";
import { notGenuineIsHigh, notGenuineShare, summaryTotals, type SummaryTotals } from "../lib/reports";
import type { SalespersonSummaryRow } from "../lib/types";
import { Icon } from "./icons";

/**
 * The weekly DATA sheet: per sales person, enquiries raised and jobs confirmed in the range. When anyone marked
 * enquiries not genuine, a column shows how many and what share of their enquiries, with a warning for anyone far
 * above the team (src/lib/reports.ts, notGenuineIsHigh); `notGenuineLink` turns each count into a link to that list.
 */
export function SalespersonTable({
  rows,
  showConversion = false,
  notGenuineLink,
}: {
  rows: SalespersonSummaryRow[];
  showConversion?: boolean;
  notGenuineLink?: (salesPerson: string) => string | null;
}) {
  const totals = summaryTotals(rows);
  const showNotGenuine = totals.not_genuine > 0;
  const pct = (r: Pick<SummaryTotals, "total_enquiries" | "not_genuine">) => `${Math.round(notGenuineShare(r) * 100)}%`;
  const notGenuine = (r: SalespersonSummaryRow) => {
    if (!r.not_genuine) return <td className="bg-not-genuine-bg/40 px-2 text-ink-muted">—</td>;
    const high = notGenuineIsHigh(r, totals);
    const to = notGenuineLink?.(r.sales_person);
    const count = to ? (
      <Link to={to} className="font-medium text-not-genuine underline-offset-2 hover:underline">
        {r.not_genuine}
      </Link>
    ) : (
      <span className="font-medium text-not-genuine">{r.not_genuine}</span>
    );
    return (
      <td className="bg-not-genuine-bg/40 px-2">
        <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
          {high && (
            <span
              className="inline-flex items-center gap-1 rounded bg-await-bg px-1.5 text-meta font-medium text-await"
              title="Marked not genuine at least twice as often as the team. Worth a look: these enquiries no longer count in their conversion."
            >
              <Icon name="alert" className="size-3.5" />
              Much higher than the team
            </span>
          )}
          {count}
          <span className="text-meta text-ink-muted">· {pct(r)}</span>
        </span>
      </td>
    );
  };
  const conv = (r: { total_enquiries: number; confirmed_new: number }) => {
    if (!r.total_enquiries) return <td className="px-2 text-ink-muted">—</td>;
    const pct = (r.confirmed_new / r.total_enquiries) * 100;
    return (
      <td className="px-2">
        <span className="inline-flex items-center justify-end gap-2">
          {pct.toFixed(0)}%
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-table-head" aria-hidden>
            <span className="block h-full rounded-full bg-kpi-confirmed" style={{ width: `${Math.min(pct, 100)}%` }} />
          </span>
        </span>
      </td>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-meta text-ink-heading font-medium">
          <tr className="border-b border-line text-right">
            <th className="py-1.5 pr-3 text-left">Person</th>
            <th className="px-2">Inquiries</th>
            {showNotGenuine && (
              <th className="bg-not-genuine-bg px-2 text-not-genuine" title="Enquiries marked not genuine (not counted in Inquiries), and their share of the person's enquiries">
                Not genuine
              </th>
            )}
            <th className="px-2">Confirmed</th>
            <th className="px-2" title="Confirmed jobs from enquiries raised in the range + from earlier enquiries">
              New + old
            </th>
            {showConversion && (
              <th className="px-2" title="Share of the enquiries raised in the range that were confirmed within it">
                Conv.
              </th>
            )}
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
          {rows.map((r) => (
            <tr key={r.sales_person} className="border-b border-line text-right">
              <td className="py-1.5 pr-3 text-left">{displayName(r.sales_person)}</td>
              <td className="px-2">{r.total_enquiries}</td>
              {showNotGenuine && notGenuine(r)}
              <td className="px-2">{r.confirmed}</td>
              <td className="px-2 text-ink-muted">
                {r.confirmed_new}+{r.confirmed_old}
              </td>
              {showConversion && conv(r)}
              <td className="px-2">{r.fcl_jobs || ""}</td>
              <td className="px-2">{r.fcl_units || ""}</td>
              <td className="px-2">{r.air || ""}</td>
              <td className="px-2">{r.lcl || ""}</td>
              <td className="px-2">{r.courier || ""}</td>
              <td className="px-2">{r.other || ""}</td>
              <td className="pl-2">{fmtMoney(r.profit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="font-semibold tabular-nums">
          <tr className="text-right">
            <td className="py-1.5 pr-3 text-left">Total</td>
            <td className="px-2">{totals.total_enquiries}</td>
            {showNotGenuine && (
              <td className="bg-not-genuine-bg/40 px-2">
                <span className="text-not-genuine">{totals.not_genuine}</span> <span className="text-meta font-normal text-ink-muted">· {pct(totals)}</span>
              </td>
            )}
            <td className="px-2">{totals.confirmed}</td>
            <td className="px-2 text-ink-muted">
              {totals.confirmed_new}+{totals.confirmed_old}
            </td>
            {showConversion && conv(totals)}
            <td className="px-2">{totals.fcl_jobs}</td>
            <td className="px-2">{totals.fcl_units}</td>
            <td className="px-2">{totals.air}</td>
            <td className="px-2">{totals.lcl}</td>
            <td className="px-2">{totals.courier}</td>
            <td className="px-2">{totals.other}</td>
            <td className="pl-2">{fmtMoney(totals.profit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
