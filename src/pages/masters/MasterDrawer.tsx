import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Button, buttonClass, IconButton, StatusBadge } from "../../components/ui";
import { displayName, fmtDateLong } from "../../lib/display";
import { agoLabel, laneOf, monthlyCounts, ranked, winRate, type ActivityRow } from "../../lib/masterActivity";
import type { MasterKind } from "./kinds";
import { enquiriesLink, type MasterRow } from "./shared";

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-meta font-semibold text-ink-heading">{title}</h3>
      {children}
    </section>
  );
}

function Tags({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="rounded-control border border-line bg-table-head px-2 py-0.5 text-meta text-ink">
          {t}
        </span>
      ))}
    </div>
  );
}

/** One customer, agent or port: its numbers, monthly trend, recent enquiries, lanes and sales people. */
export function MasterDrawer({
  kind,
  row,
  rows,
  today,
  canRename,
  onRename,
  onClose,
}: {
  kind: MasterKind;
  row: MasterRow;
  /** Its enquiries, newest first; undefined while loading. */
  rows: ActivityRow[] | undefined;
  today: string;
  canRename: boolean;
  onRename: (row: MasterRow) => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [row.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("dialog, [role=menu]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = rows ?? [];
  const months = monthlyCounts(list, today);
  const max = Math.max(1, ...months.map((m) => m.enquiries));
  const rate = winRate(row);
  // For a port, its lanes are the routes through it; for customers and agents, the routes they ask for.
  const lanes = ranked(list.map(laneOf)).slice(0, 5);
  const sales = ranked(list.map((r) => r.sales_person)).slice(0, 4);
  const notes = "notes" in row && typeof row.notes === "string" ? row.notes : null;

  return (
    <>
      <div className="fixed inset-0 top-14 z-30 bg-ink/20" aria-hidden="true" onClick={onClose} />
      <aside
        aria-labelledby="master-drawer-title"
        className="fixed inset-y-0 right-0 top-14 z-30 flex w-full max-w-[460px] flex-col border-l border-line bg-surface shadow-[-8px_0_24px_rgba(25,36,59,0.12)]"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id="master-drawer-title" ref={heading} tabIndex={-1} className="text-lg leading-7 font-semibold text-ink outline-none" title={row.name}>
              {displayName(row.name)}
            </h2>
            <p className="text-meta text-ink-muted">
              {row.first_enquiry ? `First enquiry ${fmtDateLong(row.first_enquiry)}` : `No enquiries yet`}
              {row.last_enquiry && ` · last ${agoLabel(row.last_enquiry, today).toLowerCase()}`}
            </p>
          </div>
          <IconButton icon="close" label="Close details" onClick={onClose} />
        </header>

        <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Enquiries", row.enquiries.toLocaleString()],
              ["Confirmed", row.confirmed.toLocaleString()],
              ["Win rate", rate === null ? "—" : `${Math.round(rate * 100)}%`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-control bg-table-head px-3 py-2">
                <div className="text-meta text-ink-muted">{k}</div>
                <div className="text-lg leading-6 font-semibold tabular-nums text-ink">{v}</div>
              </div>
            ))}
          </div>

          <Section title="Enquiries by month">
            {rows ? (
              <>
                <div className="flex h-16 items-end gap-1" role="img" aria-label={months.map((m) => `${MONTH.format(new Date(m.month))}: ${m.enquiries}`).join(", ")}>
                  {months.map((m, i) => (
                    <span
                      key={m.month}
                      title={`${MONTH.format(new Date(m.month))}: ${m.enquiries} enquiries, ${m.confirmed} confirmed`}
                      className={`flex-1 rounded-t-[3px] ${i === months.length - 1 ? "bg-primary" : "bg-primary/30"}`}
                      style={{ height: `${Math.max(4, (m.enquiries / max) * 100)}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex gap-1 text-[10px] text-ink-muted" aria-hidden="true">
                  {months.map((m) => (
                    <span key={m.month} className="flex-1 text-center">
                      {MONTH.format(new Date(m.month)).charAt(0)}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-20 animate-pulse rounded-control bg-table-head" />
            )}
          </Section>

          <Section title="Recent enquiries">
            {rows ? (
              list.length ? (
                <ul className="divide-y divide-line">
                  {list.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <Link to={`/enquiries/${r.id}`} className="flex items-center justify-between gap-3 py-1.5 text-meta hover:text-primary">
                        <span className="min-w-0">
                          <span className="font-medium tabular-nums text-ink">{r.reference}</span>
                          <span className="text-ink-muted">
                            {" "}
                            · {fmtDateLong(r.enquiry_date)}
                            {laneOf(r) && ` · ${displayName(laneOf(r))}`}
                          </span>
                        </span>
                        <StatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-meta text-ink-muted">No enquiries.</p>
              )
            ) : (
              <div className="h-24 animate-pulse rounded-control bg-table-head" />
            )}
            {row.enquiries > 0 && (
              <Link to={enquiriesLink(row.name)} className="mt-2 inline-flex items-center gap-1 text-meta font-medium text-primary hover:underline">
                Open all {row.enquiries.toLocaleString()} in the register
                <Icon name="arrowRight" className="size-3.5" />
              </Link>
            )}
          </Section>

          {lanes.length > 0 && (
            <Section title={kind.key === "ports" ? "Routes through this port" : "Top lanes"}>
              <Tags items={lanes.map((l) => `${displayName(l.value)} · ${l.count}`)} />
            </Section>
          )}

          {sales.length > 0 && (
            <Section title="Handled by">
              <Tags items={sales.map((s) => `${displayName(s.value)} · ${Math.round(s.share * 100)}%`)} />
            </Section>
          )}

          {row.aliases.length > 0 && (
            <Section title={kind.formerLabel}>
              <Tags items={row.aliases.map(displayName)} />
              <p className="mt-1.5 text-meta text-ink-muted">Imports that use these go to {displayName(row.name)}.</p>
            </Section>
          )}

          {kind.key === "customers" && !!row.contacts && (
            <Section title="Contacts">
              <p className="text-body text-ink">
                {row.contacts} contact {row.contacts === 1 ? "person" : "people"}
              </p>
            </Section>
          )}

          {notes && (
            <Section title="Notes">
              <p className="whitespace-pre-line text-body text-ink">{notes}</p>
            </Section>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
          {canRename && (
            <Button variant="ghost" onClick={() => onRename(row)}>
              <Icon name="edit" className="size-4" />
              Rename…
            </Button>
          )}
          <Link to={enquiriesLink(row.name)} className={buttonClass("secondary")}>
            <Icon name="register" className="size-4" />
            View enquiries
          </Link>
          {kind.key !== "ports" && (
            <Link to={`/${kind.key}/${row.id}`} className={buttonClass("primary")}>
              <Icon name="chart" className="size-4" />
              Full view
            </Link>
          )}
        </footer>
      </aside>
    </>
  );
}
