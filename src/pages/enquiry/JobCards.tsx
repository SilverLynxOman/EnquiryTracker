import type { ReactNode } from "react";
import { Card } from "../../components/ui";
import { describeCommission } from "../../lib/commission";
import { displayName, shipmentLabel, TRADE_LABELS } from "../../lib/display";
import { fmtMoney, fmtPercent } from "../../lib/format";
import { MODE_LABELS, type EnquiryRow } from "../../lib/types";

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-meta text-ink-muted">{label}</dt>
          <dd className="break-words text-body text-ink">{value || <span className="text-ink-muted">Not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1 text-meta font-semibold text-ink-heading">{title}</h3>
      {children}
    </section>
  );
}

/** What was asked for: the register's job columns, the contact, requirements and remarks. */
export function ShipmentCard({ row }: { row: EnquiryRow }) {
  const mode = row.shipment_mode ? MODE_LABELS[row.shipment_mode] : "";
  const qty = row.qty_text ? shipmentLabel({ shipment_mode: "FCL", qty_text: row.qty_text }) : "";
  const contact = row.contact_name || row.contact_email || row.contact_phone ? (
    <>
      {row.contact_name && <span className="font-medium">{row.contact_name}</span>}
      {row.contact_email && <span className="block text-meta text-ink-heading">{row.contact_email}</span>}
      {row.contact_phone && <span className="block text-meta tabular-nums text-ink-heading">{row.contact_phone}</span>}
    </>
  ) : (
    ""
  );
  const items: [string, ReactNode][] = [
    ["Shipment", mode],
    ...(qty && qty.toUpperCase() !== mode.toUpperCase() ? ([["Quantity", <span className="tabular-nums">{qty}</span>]] as [string, ReactNode][]) : []),
    ["Direction", row.trade_type ? TRADE_LABELS[row.trade_type] : ""],
    ["Port of loading", displayName(row.pol)],
    ["Port of discharge", displayName(row.pod)],
    ["Agent", row.agent_name ? displayName(row.agent_name) : "No agent"],
    ["Sales person", row.sales_person_name ? displayName(row.sales_person_name) : "Unassigned"],
    ["Contact", contact],
  ];
  return (
    <Card title="Shipment">
      <Facts items={items} />
      {row.requirements && (
        <Block title="Requirements">
          <p className="whitespace-pre-line text-body text-ink">{row.requirements}</p>
        </Block>
      )}
      {row.remarks && (
        <Block title="Remarks">
          <p className="whitespace-pre-line text-body text-ink">{row.remarks}</p>
        </Block>
      )}
      {row.subject && <p className="mt-4 border-t border-line pt-3 text-meta text-ink-muted">Subject: {row.subject}</p>}
    </Card>
  );
}

/** Buy, sell and profit as the register holds them. */
export function RatesCard({ row }: { row: EnquiryRow }) {
  const hasRates = row.buy_total != null || row.sell_total != null;
  const perUnit = (row.units ?? 0) > 1;
  const money = (n: number | null) => (n == null ? <span className="text-ink-muted">Not entered</span> : fmtMoney(n));
  return (
    <Card title={`Rates (${row.currency.trim()})`}>
      {!hasRates ? (
        <p className="text-body text-ink-muted">
          No rates entered yet.
          {row.status === "confirmed" && <span className="text-await"> Without a sell amount, the reports miss this job's profit.</span>}
        </p>
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="text-left text-meta text-ink-muted">
              <th scope="col" className="pb-1 font-medium">
                <span className="sr-only">Side</span>
              </th>
              {perUnit && (
                <th scope="col" className="pb-1 text-right font-medium">
                  Per unit
                </th>
              )}
              <th scope="col" className="pb-1 text-right font-medium">
                Total{perUnit ? ` (${row.units} units)` : ""}
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-normal text-ink-heading">
                Buy
              </th>
              {perUnit && <td className="py-1.5 text-right">{money(row.buy_rate)}</td>}
              <td className="py-1.5 text-right">{money(row.buy_total)}</td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-normal text-ink-heading">
                Sell
              </th>
              {perUnit && <td className="py-1.5 text-right">{money(row.sell_rate)}</td>}
              <td className="py-1.5 text-right">{money(row.sell_total)}</td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-semibold text-ink">
                Profit
              </th>
              {perUnit && <td />}
              <td className={`py-1.5 text-right font-semibold ${row.profit != null && row.profit < 0 ? "text-lost" : "text-ink"}`}>
                {row.profit == null ? "—" : fmtMoney(row.profit)}
                {row.profit != null && row.sell_total ? (
                  <span className="ml-1 font-normal text-ink-muted">({fmtPercent(row.profit, row.sell_total)})</span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {row.commission_amount != null && (
        <p className="mt-3 border-t border-line pt-3 text-body text-ink-heading">
          Commission:{" "}
          <span className="font-medium tabular-nums text-ink">
            {describeCommission({ amount: row.commission_amount, currency: row.commission_currency ?? null, perUnit: !!row.commission_per_unit }, row.units)}
          </span>
        </p>
      )}
    </Card>
  );
}
