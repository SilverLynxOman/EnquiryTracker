import type { ReactNode } from "react";
import { Card } from "../../components/ui";
import { displayName, shipmentLabel, TRADE_LABELS } from "../../lib/display";
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
