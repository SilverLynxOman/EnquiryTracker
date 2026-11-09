import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Alert, Card, Spinner } from "../../components/ui";
import { fetchAudit, fetchProfileNames } from "../../lib/api";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import { errorMessage, fmtDate, fmtDateTime } from "../../lib/format";
import type { AuditEntry, EnquiryRow, FollowUpRecord } from "../../lib/types";

const FIELD_LABELS: Record<string, string> = {
  enquiry_date: "Enquiry date",
  quoted_date: "Quoted date",
  confirmed_date: "Confirmation date",
  closure: "Closed as",
  closure_reason: "Reason",
  customer_id: "Customer",
  // Written by merge_customers / merge_agents: names instead of ids, since the old one no longer exists.
  customer: "Customer",
  agent: "Agent",
  subject: "Subject",
  trade_type: "Mode",
  qty_text: "Qty",
  shipment_mode: "Shipment",
  units: "Units",
  container_type: "Container",
  currency: "Currency",
  buy_rate: "Buy rate",
  buy_total: "Buy total",
  sell_rate: "Sell rate",
  sell_total: "Sell total",
  pol: "POL",
  pod: "POD",
  agent_id: "Agent",
  sales_person_id: "Sales person",
  remarks: "Remarks",
  reference: "Reference",
  contact_id: "Contact",
  requirements: "Requirements",
};

const CLOSURE_LABELS: Record<string, string> = { lost: "Lost", cancelled: "Cancelled", not_genuine: "Not genuine" };

function showValue(field: string, v: unknown): ReactNode {
  if (v == null || v === "") return <span className="text-ink-muted">—</span>;
  if (field === "closure") return CLOSURE_LABELS[String(v)] ?? String(v);
  if (field.endsWith("_id")) return <span className="text-ink-muted">(changed)</span>;
  if (field.endsWith("_date")) return fmtDate(String(v));
  return String(v);
}

type Item = { at: string; key: string; audit?: AuditEntry; chase?: FollowUpRecord };

/** Every change to the enquiry and every follow-up logged on it, newest first. */
export function HistoryCard({ enquiry, chases, names, today }: { enquiry: EnquiryRow; chases: FollowUpRecord[]; names: Map<string, string>; today: string }) {
  const audit = useQuery({ queryKey: ["audit", enquiry.id], queryFn: () => fetchAudit(enquiry.id) });
  const people = useQuery({ queryKey: ["profile-names"], queryFn: fetchProfileNames, staleTime: 300_000 });
  const who = (uid: string | null) => (uid ? (people.data?.get(uid) ?? "Unknown user") : "System");

  // A follow-up has a day, not a time: it sorts at noon, Oman time.
  const items: Item[] = [
    ...(audit.data ?? []).map((a) => ({ at: new Date(a.changed_at).toISOString(), key: `a${a.id}`, audit: a })),
    ...chases.map((c) => ({ at: new Date(`${c.followed_up_on}T12:00:00+04:00`).toISOString(), key: `f${c.sales_person_id}${c.followed_up_on}`, chase: c })),
  ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));

  return (
    <Card title="History">
      {audit.isLoading ? (
        <Spinner />
      ) : audit.error ? (
        <Alert>{errorMessage(audit.error)}</Alert>
      ) : (
        <ol className="space-y-3 text-body">
          {items.map(({ key, audit: a, chase: c }) =>
            c ? (
              <li key={key} className="border-l-2 border-primary/40 pl-3">
                <div className="text-meta text-ink-muted">{dayWithWeekday(c.followed_up_on, today)}</div>
                <div>Followed up by {names.get(c.sales_person_id) ?? "a colleague"}</div>
              </li>
            ) : (
              a && (
                <li key={key} className="border-l-2 border-line pl-3">
                  <div className="text-meta text-ink-muted">
                    {fmtDateTime(a.changed_at)} · {who(a.changed_by)}
                    {a.import_batch_id && <span className="ml-1 rounded bg-table-head px-1">Excel import</span>}
                  </div>
                  {a.action === "insert" && <div>Created</div>}
                  {a.action === "delete" && <div>Deleted</div>}
                  {a.action === "update" && a.changes && (
                    <ul className="mt-0.5 space-y-0.5">
                      {Object.entries(a.changes as Record<string, { old: unknown; new: unknown; merged?: boolean }>)
                        // Commission columns are read from the remarks, whose change is listed already.
                        .filter(([field]) => !field.startsWith("commission_"))
                        .map(([field, ch]) => (
                          <li key={field}>
                            <span className="text-ink-muted">{FIELD_LABELS[field] ?? field}:</span> {showValue(field, ch.old)} → {showValue(field, ch.new)}
                            {ch.merged && <span className="text-ink-muted"> (customers merged)</span>}
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              )
            ),
          )}
          <li className="pl-3 text-meta text-ink-muted">
            Record created {fmtDateTime(enquiry.created_at)} (
            {enquiry.source === "import" ? "from Excel" : enquiry.source === "email" ? "from an e-mail" : "in the app"})
          </li>
        </ol>
      )}
    </Card>
  );
}
