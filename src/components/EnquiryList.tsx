import { Link } from "react-router";
import { displayName } from "../lib/display";
import { fmtDate, fmtMoney } from "../lib/format";
import { round2 } from "../lib/normalize";
import type { EnquiryRow } from "../lib/types";
import { Empty, StatusBadge } from "./ui";

const total = (rows: EnquiryRow[], pick: (r: EnquiryRow) => number | null) =>
  round2(rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0));

/**
 * Read-only register table used by the reports, numbered like the SL. NO. column, with money totals.
 * The on-screen columns are the ones people scan; the Excel export keeps every register column.
 */
export function EnquiryList({ rows, empty, showConfirmed = false }: { rows: EnquiryRow[]; empty: string; showConfirmed?: boolean }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const lead = showConfirmed ? 9 : 8;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-meta">
        <thead className="bg-table-head text-left text-ink-heading font-medium">
          <tr>
            <th className="px-2 py-2 text-right">#</th>
            <th className="px-2 py-2">Ref</th>
            <th className="px-2 py-2">Enquiry</th>
            {showConfirmed && <th className="px-2 py-2">Confirmed</th>}
            <th className="px-2 py-2">Customer</th>
            <th className="px-2 py-2">Subject</th>
            <th className="px-2 py-2">Mode / Qty</th>
            <th className="px-2 py-2">Sales</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2 text-right">Sell</th>
            <th className="px-2 py-2 text-right">Profit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-row-hover">
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{i + 1}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-control font-semibold tabular-nums">
                <Link to={`/enquiries/${r.id}`} className="text-primary hover:underline">
                  {r.reference}
                </Link>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.enquiry_date)}</td>
              {showConfirmed && <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.confirmed_date)}</td>}
              <td className="max-w-56 truncate px-2 py-1.5 font-medium" title={[r.customer_name, r.agent_name && `Agent: ${r.agent_name}`].filter(Boolean).join("\n")}>
                {displayName(r.customer_name)}
              </td>
              <td className="max-w-72 truncate px-2 py-1.5 text-ink-muted" title={r.subject ?? ""}>
                {r.subject}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">
                {r.trade_type && <span className="mr-1 rounded border border-line px-1 text-[0.6875rem] text-ink-muted">{r.trade_type}</span>}
                {r.qty_text}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">{r.sales_person_name}</td>
              <td className="px-2 py-1.5">
                <StatusBadge status={r.status} />
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" title={r.buy_total != null ? `Buy ${fmtMoney(r.buy_total)}` : undefined}>
                {fmtMoney(r.sell_total)}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{fmtMoney(r.profit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-line font-semibold tabular-nums">
          <tr>
            <td colSpan={lead} className="px-2 py-1.5 text-right text-ink-muted">
              Total of {rows.length}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtMoney(total(rows, (r) => r.sell_total))}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtMoney(total(rows, (r) => r.profit))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
