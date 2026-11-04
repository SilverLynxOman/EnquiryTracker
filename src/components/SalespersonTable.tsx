import { fmtMoney } from "../lib/format";
import { summaryTotals } from "../lib/reports";
import type { SalespersonSummaryRow } from "../lib/types";

/** The weekly DATA sheet: per sales person, enquiries raised and jobs confirmed in the range. */
export function SalespersonTable({ rows }: { rows: SalespersonSummaryRow[] }) {
  const totals = summaryTotals(rows);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr className="border-b border-slate-200 text-right">
            <th className="py-1.5 pr-3 text-left">Person</th>
            <th className="px-2">Inquiries</th>
            <th className="px-2">Confirmed</th>
            <th className="px-2" title="Confirmed jobs from enquiries raised in the range + from earlier enquiries">
              New + old
            </th>
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
              <td className="pl-2">{fmtMoney(r.profit)}</td>
            </tr>
          ))}
        </tbody>
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
      </table>
    </div>
  );
}
