import { Link } from "react-router";
import { fmtDate, fmtMoney } from "../lib/format";
import { round2 } from "../lib/normalize";
import type { EnquiryRow } from "../lib/types";
import { Empty, StatusBadge } from "./ui";

const total = (rows: EnquiryRow[], pick: (r: EnquiryRow) => number | null) =>
  round2(rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0));

/** Read-only register table used by the reports, numbered like the SL. NO. column, with money totals. */
export function EnquiryList({ rows, empty }: { rows: EnquiryRow[]; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-2 py-2 text-right">#</th>
            <th className="px-2 py-2">Ref</th>
            <th className="px-2 py-2">Enquiry</th>
            <th className="px-2 py-2">Quoted</th>
            <th className="px-2 py-2">Confirmed</th>
            <th className="px-2 py-2">Customer</th>
            <th className="px-2 py-2">Subject</th>
            <th className="px-2 py-2">Mode / Qty</th>
            <th className="px-2 py-2 text-right">Buy</th>
            <th className="px-2 py-2 text-right">Sell</th>
            <th className="px-2 py-2 text-right">Profit</th>
            <th className="px-2 py-2">Agent</th>
            <th className="px-2 py-2">Sales</th>
            <th className="px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{i + 1}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                <Link to={`/enquiries/${r.id}`} className="text-indigo-700 hover:underline">
                  {r.reference}
                </Link>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.enquiry_date)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.quoted_date)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(r.confirmed_date)}</td>
              <td className="max-w-48 truncate px-2 py-1.5" title={r.customer_name}>
                {r.customer_name}
              </td>
              <td className="max-w-64 truncate px-2 py-1.5 text-slate-600" title={r.subject ?? ""}>
                {r.subject}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <span className="text-slate-500">{r.trade_type}</span> {r.qty_text}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.buy_total)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.sell_total)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{fmtMoney(r.profit)}</td>
              <td className="max-w-32 truncate px-2 py-1.5" title={r.agent_name ?? ""}>
                {r.agent_name}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">{r.sales_person_name}</td>
              <td className="px-2 py-1.5">
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 font-semibold tabular-nums">
          <tr>
            <td colSpan={8} className="px-2 py-1.5 text-right text-slate-500">
              Total
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtMoney(total(rows, (r) => r.buy_total))}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtMoney(total(rows, (r) => r.sell_total))}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtMoney(total(rows, (r) => r.profit))}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
