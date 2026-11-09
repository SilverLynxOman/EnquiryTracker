import type { ReactNode, RefObject } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { Alert, Button, buttonClass, IconButton, Spinner, StatusBadge } from "../../components/ui";
import { displayName, fmtDateLong, nextStep, shipmentLabel, statusDetail, TRADE_LABELS } from "../../lib/display";
import { describeCommission } from "../../lib/commission";
import { fmtMoney, fmtPercent } from "../../lib/format";
import { MODE_LABELS, type EnquiryRow } from "../../lib/types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-meta font-semibold text-ink-heading">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v || <span className="text-ink-muted">Not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Progress({ row, today }: { row: EnquiryRow; today: string }) {
  const closed = row.status === "lost" || row.status === "cancelled" || row.status === "not_genuine";
  const steps = [
    { label: "Enquiry received", date: row.enquiry_date, done: true },
    { label: "Quote sent", date: row.quoted_date, done: !!row.quoted_date },
    closed
      ? { label: row.status === "lost" ? "Lost" : "Cancelled", date: null, done: false, closed: true }
      : { label: "Job confirmed", date: row.confirmed_date, done: !!row.confirmed_date },
  ];
  const waiting = statusDetail(row, today);
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 pb-3 last:pb-0">
          {i < steps.length - 1 && (
            <span aria-hidden="true" className={`absolute left-[9px] top-5 h-[calc(100%-1.25rem)] w-0.5 ${steps[i + 1].done ? "bg-primary" : "bg-line"}`} />
          )}
          <span
            aria-hidden="true"
            className={`relative z-[1] flex size-5 shrink-0 items-center justify-center rounded-full ${
              "closed" in s && s.closed ? "bg-lost-bg text-lost ring-1 ring-lost/40" : s.done ? "bg-primary text-white" : "bg-surface ring-2 ring-line"
            }`}
          >
            {"closed" in s && s.closed ? <Icon name="close" className="size-3" /> : s.done && <Icon name="check" className="size-3" />}
          </span>
          <div className="min-w-0 text-body">
            <div className="font-medium text-ink">
              {s.label}
              <span className="sr-only">{s.done ? ", done" : "closed" in s && s.closed ? "" : ", not yet"}</span>
            </div>
            <div className="text-meta text-ink-muted tabular-nums">
              {s.date
                ? fmtDateLong(s.date)
                : "closed" in s && s.closed
                  ? row.closure_reason || "No reason recorded"
                  : i === steps.findIndex((x) => !x.done)
                    ? waiting.text
                    : "Not yet"}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function EnquiryDrawer({
  row,
  loading,
  error,
  canEdit,
  today,
  quoting,
  headingRef,
  menuItems,
  onClose,
  onMarkQuoted,
  onConfirm,
}: {
  row: EnquiryRow | undefined;
  loading: boolean;
  error: unknown;
  canEdit: boolean;
  today: string;
  quoting: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  menuItems: (row: EnquiryRow) => MenuItem[];
  onClose: () => void;
  onMarkQuoted: (row: EnquiryRow) => void;
  onConfirm: (row: EnquiryRow) => void;
}) {
  const step = row ? nextStep(row, canEdit) : "view";
  const route = row ? [row.pol, row.pod].filter(Boolean).map((p) => displayName(p)).join(" → ") : "";

  return (
    <aside
      aria-labelledby="enquiry-drawer-title"
      className="fixed inset-y-0 right-0 top-14 z-20 flex w-full max-w-[380px] flex-col border-l border-line bg-surface shadow-[-8px_0_24px_rgba(25,36,59,0.12)] xl:sticky xl:top-[4.5rem] xl:z-auto xl:h-[max(23rem,calc(100dvh-12.5rem))] xl:w-[380px] xl:max-w-none xl:shrink-0 xl:rounded-panel xl:border xl:shadow-none"
    >
      <header className="border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          {row && <span className="text-control font-semibold tabular-nums text-ink">{row.reference}</span>}
          {row && <StatusBadge status={row.status} />}
          <div className="ml-auto flex items-center">
            {row && (
              <Menu
                label={`More actions for ${row.reference}`}
                trigger={<Icon name="more" />}
                triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-row-hover hover:text-ink"
                items={menuItems(row)}
              />
            )}
            <IconButton icon="close" label="Close details" onClick={onClose} />
          </div>
        </div>
        <h2 id="enquiry-drawer-title" ref={headingRef} tabIndex={-1} className="mt-1.5 text-title font-semibold text-ink focus:outline-none">
          {row ? displayName(row.customer_name) : "Enquiry details"}
        </h2>
        {row?.subject && <p className="text-meta text-ink-muted">{row.subject}</p>}
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {loading && <Spinner />}
        {error != null && <Alert>This enquiry could not be loaded. It may have been deleted.</Alert>}
        {row && (
          <>
            <Section title="Progress">
              <Progress row={row} today={today} />
            </Section>
            <Section title="Job">
              <Rows
                items={[
                  ["Shipment", row.shipment_mode ? MODE_LABELS[row.shipment_mode] : ""],
                  ...(row.qty_text && row.qty_text.trim().toUpperCase() !== (row.shipment_mode ? MODE_LABELS[row.shipment_mode].toUpperCase() : "")
                    ? ([["Quantity", <span className="tabular-nums">{shipmentLabel({ shipment_mode: "FCL", qty_text: row.qty_text })}</span>]] as [string, ReactNode][])
                    : []),
                  ["Direction", row.trade_type ? TRADE_LABELS[row.trade_type] : ""],
                  ["Route", route],
                  ["Agent", row.agent_name ? displayName(row.agent_name) : "No agent"],
                  ["Sales person", row.sales_person_name ? displayName(row.sales_person_name) : "Unassigned"],
                ]}
              />
            </Section>
            <Section title={`Rates (${row.currency})`}>
              {row.buy_total == null && row.sell_total == null ? (
                <p className="text-body text-ink-muted">No rates entered yet.</p>
              ) : (
              <Rows
                items={[
                  ["Buy total", row.buy_total != null ? <span className="tabular-nums">{fmtMoney(row.buy_total)}</span> : ""],
                  ["Sell total", row.sell_total != null ? <span className="tabular-nums">{fmtMoney(row.sell_total)}</span> : ""],
                  [
                    "Profit",
                    row.profit != null ? (
                      <span className="tabular-nums">
                        <span className="font-semibold">{fmtMoney(row.profit)}</span>
                        {row.sell_total ? <span className="text-ink-muted">, {fmtPercent(row.profit, row.sell_total)} margin</span> : null}
                      </span>
                    ) : (
                      ""
                    ),
                  ],
                ]}
              />
              )}
              {row.commission_amount != null && (
                <Rows
                  items={[
                    [
                      "Commission",
                      <span className="tabular-nums">
                        {describeCommission(
                          { amount: row.commission_amount, currency: row.commission_currency ?? null, perUnit: !!row.commission_per_unit },
                          row.units,
                        )}
                      </span>,
                    ],
                  ]}
                />
              )}
            </Section>
            {row.remarks && (
              <Section title="Remarks">
                <p className="text-body whitespace-pre-line text-ink">{row.remarks}</p>
              </Section>
            )}
            <p className="text-meta text-ink-muted">
              {row.source === "import" ? "Imported from Excel" : "Entered in the app"} on {fmtDateLong(row.created_at)}
            </p>
          </>
        )}
      </div>

      {row && (
        <footer className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          {step === "quote" && (
            <Button loading={quoting} onClick={() => onMarkQuoted(row)}>
              {quoting ? "Saving…" : "Mark quoted"}
            </Button>
          )}
          {step === "confirm" && <Button onClick={() => onConfirm(row)}>Confirm job</Button>}
          <Link to={`/enquiries/${row.id}`} className={buttonClass(step === "view" ? "primary" : "secondary")}>
            Open enquiry
            <Icon name="arrowRight" className="size-3.5" />
          </Link>
        </footer>
      )}
    </aside>
  );
}
