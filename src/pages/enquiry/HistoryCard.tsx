import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Alert, Card, Spinner } from "../../components/ui";
import { fetchAudit, fetchProfileNames } from "../../lib/api";
import { muscatDate } from "../../lib/emailDrafts";
import type { HistoryEvent } from "../../lib/enquiryBrief";
import { dayWithWeekday, muscatTime, whenSent } from "../../lib/enquiryDetails";
import { errorMessage, fmtDate, fmtDateTime } from "../../lib/format";
import type { AuditEntry, EnquiryRow, FollowUpRecord } from "../../lib/types";
import { ProofLink, proofTitle, type PageActions } from "./shared";

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

export type HistoryItem = { at: string; key: string; audit?: AuditEntry; chase?: FollowUpRecord; event?: HistoryEvent };

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A day without a time (a follow-up, a hand-over known by its day) sorts at noon, Oman time. */
const noon = (day: string) => `${day}T12:00:00+04:00`;

/** The moment something happened as a sortable timestamp; "" when it cannot be read, which sorts last. */
function stamp(at: string): string {
  const time = Date.parse(DAY_ONLY.test(at) ? noon(at) : at);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

/** The register's changes, the follow-ups logged and what the e-mails show, as one list, newest first. */
export function historyItems(audit: AuditEntry[], chases: FollowUpRecord[], events: HistoryEvent[] = []): HistoryItem[] {
  return [
    ...audit.map((a): HistoryItem => ({ at: stamp(a.changed_at), key: `a${a.id}`, audit: a })),
    ...chases.map((c): HistoryItem => ({ at: stamp(c.followed_up_on), key: `f${c.sales_person_id}${c.followed_up_on}`, chase: c })),
    ...events.map((e, i): HistoryItem => ({ at: stamp(e.at), key: `e${i}${e.kind}${e.at}`, event: e })),
  ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

/** When an e-mail event happened: the day, and the time unless the event's own words already say it. */
function eventWhen(event: HistoryEvent, today: string): string {
  if (DAY_ONLY.test(event.at)) return dayWithWeekday(event.at, today);
  if (!stamp(event.at)) return "";
  return event.text.includes(muscatTime(event.at)) ? dayWithWeekday(muscatDate(event.at), today) : whenSent(event.at, today);
}

/** Something the e-mails show and the register does not: a chase, a hand-over, a reply sent from the app. */
function EventItem({ event, today, actions }: { event: HistoryEvent; today: string; actions?: Pick<PageActions, "onOpenMail"> }) {
  const when = eventWhen(event, today);
  return (
    <li className="border-l-2 border-dashed border-primary/50 pl-3">
      <div className="text-meta text-ink-muted">
        {when && <span className="tabular-nums">{when}</span>}
        <span className={`rounded bg-table-head px-1 ${when ? "ml-1" : ""}`}>from the e-mails</span>
      </div>
      <div className="break-words">
        {event.proof && actions ? (
          <ProofLink proof={event.proof} actions={actions}>
            {event.text}
          </ProofLink>
        ) : (
          <span title={event.proof ? proofTitle(event.proof) : undefined}>{event.text}</span>
        )}
      </div>
    </li>
  );
}

/**
 * Every change to the enquiry and every follow-up logged on it, newest first. What the e-mails show (a chase by
 * e-mail, the customer asking again, a hand-over, a reply sent from the app) is listed among them by its time,
 * marked "from the e-mails".
 */
export function HistoryCard({
  enquiry,
  chases,
  names,
  today,
  events,
  actions,
}: {
  enquiry: EnquiryRow;
  chases: FollowUpRecord[];
  names: Map<string, string>;
  today: string;
  /** What the e-mails show that the register does not record. */
  events?: HistoryEvent[];
  /** Opens the e-mail an event was read from; without it the event says who wrote it and when on hover. */
  actions?: Pick<PageActions, "onOpenMail">;
}) {
  const audit = useQuery({ queryKey: ["audit", enquiry.id], queryFn: () => fetchAudit(enquiry.id) });
  const people = useQuery({ queryKey: ["profile-names"], queryFn: fetchProfileNames, staleTime: 300_000 });
  const who = (uid: string | null) => (uid ? (people.data?.get(uid) ?? "Unknown user") : "System");
  const items = historyItems(audit.data ?? [], chases, events);

  return (
    <Card title="History">
      {audit.isLoading ? (
        <Spinner />
      ) : audit.error ? (
        <Alert>{errorMessage(audit.error)}</Alert>
      ) : (
        <ol className="space-y-3 text-body">
          {items.map(({ key, audit: a, chase: c, event: e }) =>
            e ? (
              <EventItem key={key} event={e} today={today} actions={actions} />
            ) : c ? (
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
