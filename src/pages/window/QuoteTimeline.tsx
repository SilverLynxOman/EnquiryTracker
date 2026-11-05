import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { Button, buttonClass } from "../../components/ui";
import { displayName } from "../../lib/display";
import { chasedLabel, STALE_DAYS, type FollowUpBand } from "../../lib/followUps";
import { TIMELINE_DAYS, WINDOW_MIN_WINS, type CustomerRecord, type WaitStatus, type WindowSort, type WindowView } from "../../lib/quoteWindow";
import { MODE_LABELS, type ShipmentMode, type WindowEnquiry } from "../../lib/types";
import { laneLabel } from "../../lib/workdays";

/** Where a day sits on the timeline, in % of its width: today at 3%, TIMELINE_DAYS at 97%. */
const pos = (days: number) => 3 + (Math.min(Math.max(days, 0), TIMELINE_DAYS) / TIMELINE_DAYS) * 94;

const MODE_DOT: Partial<Record<ShipmentMode, string>> = {
  FCL: "bg-mode-fcl",
  LCL: "bg-mode-lcl",
  AIR: "bg-mode-air",
  COURIER: "bg-mode-courier",
};

const WAIT: Record<WaitStatus, { label: string; chip: string; dot: string }> = {
  overdue: { label: "Overdue", chip: "bg-lost-bg text-lost", dot: "bg-lost-dot" },
  due_today: { label: "Quote today", chip: "bg-await-bg text-await", dot: "bg-await-dot" },
  new: { label: "New", chip: "bg-selected text-primary", dot: "bg-await-dot" },
};

const AGE_BANDS: { band: FollowUpBand; label: string; bar: string }[] = [
  { band: "14-30", label: "14–30 days", bar: "bg-cancelled-dot/45" },
  { band: "31-90", label: "31–90 days", bar: "bg-cancelled-dot" },
  { band: "90+", label: "Over 90 days", bar: "bg-ink-muted" },
];

const row = "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5";
const infoCol = "min-w-0 flex-[1_1_15rem]";
const trackCol = "relative h-7 min-w-0 flex-[2_1_14rem]";
const actionCol = "flex shrink-0 items-center justify-end gap-1.5 sm:w-60";
const dotClass = "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface";

function ModeTag({ mode }: { mode: ShipmentMode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className={`size-2 rounded-full ${MODE_DOT[mode] ?? "bg-mode-other"}`} />
      {MODE_LABELS[mode]}
    </span>
  );
}

/** A customer who nearly always confirms, or one who never has. */
function CustomerTag({ record }: { record: CustomerRecord }) {
  if (record.enquiries >= 5 && record.wins / record.enquiries >= 0.7) {
    return (
      <span className="shrink-0 rounded-full bg-confirmed-bg px-2 py-0.5 text-meta font-medium text-confirmed">
        {Math.round((record.wins / record.enquiries) * 100)}% won
      </span>
    );
  }
  if (record.enquiries >= 2 && record.wins === 0) {
    return <span className="shrink-0 rounded-full bg-cancelled-bg px-2 py-0.5 text-meta font-medium text-cancelled">Not won yet</span>;
  }
  return null;
}

const recordText = (r: CustomerRecord) => (r.enquiries <= 1 ? "first enquiry this year" : `${r.wins} won of ${r.enquiries} this year`);

function Info({ e, tag, children }: { e: WindowEnquiry; tag?: ReactNode; children: ReactNode }) {
  const lane = laneLabel(e.pol, e.pod);
  return (
    <div className={infoCol}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold text-ink" title={e.customer_name}>
          {displayName(e.customer_name) || "No customer"}
        </span>
        {tag}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-muted">
        <Link to={`/enquiries/${e.id}`} className="font-medium tabular-nums text-primary hover:underline">
          {e.reference}
        </Link>
        {lane && <span>{lane}</span>}
        {e.shipment_mode && <ModeTag mode={e.shipment_mode} />}
        {children}
      </div>
    </div>
  );
}

export interface WindowHistory {
  /** Wins with a quote date this year. */
  wins: number;
  /** Share of them confirmed within the win window, and before a quote goes stale. */
  inWindow: number;
  inTimeline: number;
}

/** The Window's main panel: every open quote on a timeline of days since it was sent, the win window shaded. */
export function QuoteTimeline({
  view,
  windowDays,
  history,
  owner,
  ownerId,
  sort,
  onSort,
  today,
  canEdit,
  canChase,
  busy,
  personName,
  stale,
  staleLink,
  onQuoted,
  onChase,
  onWon,
  onMarkLost,
}: {
  view: WindowView;
  windowDays: number;
  history: WindowHistory;
  /** "your" on the viewer's own page, otherwise "Vivek's". */
  owner: string;
  /** The page's sales person: their own follow-ups need no name. */
  ownerId: string;
  sort: WindowSort;
  onSort: (sort: WindowSort) => void;
  today: string;
  canEdit: boolean;
  /** The viewer can log follow-ups here: it is their own page. */
  canChase: boolean;
  /** The enquiry being saved. */
  busy: string | null;
  personName: (salesPersonId: string) => string;
  /** Stale counts by Follow-ups band, null while loading. */
  stale: Record<FollowUpBand, number> | null;
  staleLink: (band?: FollowUpBand) => string;
  onQuoted: (e: WindowEnquiry) => void;
  onChase: (e: WindowEnquiry, done: boolean) => void;
  onWon: (e: WindowEnquiry) => void;
  onMarkLost: (e: WindowEnquiry) => void;
}) {
  const navigate = useNavigate();
  const boundary = 3 + (Math.min(windowDays + 0.5, TIMELINE_DAYS) / TIMELINE_DAYS) * 94;
  const pct = (share: number) => Math.round(share * 100);
  const judged = history.wins >= WINDOW_MIN_WINS;
  const intro = judged
    ? `Of ${owner} ${history.wins} wins this year, ${pct(history.inWindow)}% were confirmed within ${windowDays} days of the quote and ${pct(history.inTimeline)}% within two weeks. Follow up while a quote is inside the window.`
    : `Most wins are confirmed within days of the quote, so follow up early. The window is set from ${owner} own wins once there are ${WINDOW_MIN_WINS} this year.`;
  const latePct = pct(1 - history.inTimeline);
  const lateText = judged ? (latePct === 0 ? `None of ${owner} wins this year came this late.` : `Only ${latePct} in 100 of ${owner} wins this year came this late.`) : "Quotes this old rarely turn into jobs.";
  const staleTotal = stale ? stale["14-30"] + stale["31-90"] + stale["90+"] : null;

  const menu = (e: WindowEnquiry): MenuItem[] => [
    ...(canEdit ? [{ label: "Mark lost…", icon: "close" as const, onSelect: () => onMarkLost(e) }] : []),
    {
      label: canEdit ? "Edit enquiry" : "Open full record",
      icon: canEdit ? ("edit" as const) : ("external" as const),
      onSelect: () => navigate(`/enquiries/${e.id}`),
    },
  ];
  const more = (e: WindowEnquiry) => (
    <Menu
      label={`More actions for ${e.reference}`}
      trigger={<Icon name="more" />}
      triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-row-hover hover:text-ink"
      items={menu(e)}
    />
  );

  return (
    <section aria-labelledby="window-title" className="rounded-panel border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 max-w-2xl">
          <h2 id="window-title" className="text-body font-semibold text-ink">
            Every open quote, by days since it was sent
          </h2>
          <p className="mt-0.5 text-meta text-ink-muted">{intro}</p>
        </div>
        <div role="group" aria-label="Order of quotes" className="inline-flex gap-1 rounded-panel border border-line p-0.5">
          {(["newest", "customers"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              onClick={() => onSort(s)}
              className={`h-8 rounded-control px-2.5 text-control font-medium transition-colors duration-150 ${
                sort === s ? "bg-selected text-primary" : "text-ink-muted hover:bg-row-hover hover:text-ink"
              }`}
            >
              {s === "newest" ? "Newest first" : "Best customers first"}
            </button>
          ))}
        </div>
      </header>

      <div aria-hidden="true" className="hidden items-end gap-x-4 border-y border-line bg-table-head px-4 py-2 text-meta text-ink-muted sm:flex">
        <span className={`${infoCol} font-medium text-ink-heading`}>Quote</span>
        <div className="relative h-9 min-w-0 flex-[2_1_14rem]">
          <span className="absolute left-0 top-0 truncate font-medium text-primary" style={{ width: `${boundary}%` }}>
            Win window · first {windowDays} days
          </span>
          <span className="absolute right-0 top-0 truncate pl-2 font-medium text-await" style={{ left: `${boundary}%` }}>
            Last chance
          </span>
          <span className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap" style={{ left: "3%" }}>
            Today
          </span>
          <span className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(7)}%` }}>
            1 week
          </span>
          <span className="absolute bottom-0 right-[3%] translate-x-1/2 whitespace-nowrap">{TIMELINE_DAYS} days</span>
        </div>
        <span className={`${actionCol} font-medium text-ink-heading`}>Next step</span>
      </div>

      <h3 className="px-4 pb-1 pt-3 text-meta font-semibold text-ink-heading">Waiting for a quote · {view.waiting.length}</h3>
      {view.waiting.length === 0 ? (
        <p className="border-b border-line px-4 pb-3 text-meta text-ink-muted">Nothing is waiting for a quote.</p>
      ) : (
        <ul className="divide-y divide-line border-b border-line">
          {view.waiting.map((w) => {
            const s = WAIT[w.status];
            const wait = w.days === 0 ? "arrived today" : w.days === 1 ? "waiting since yesterday" : `waiting ${w.days} days`;
            return (
              <li key={w.row.id} className={row}>
                <Info e={w.row} tag={<span className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-medium ${s.chip}`}>{s.label}</span>}>
                  <span>{wait}</span>
                  <span>· {recordText(w.customer)}</span>
                </Info>
                <div aria-hidden="true" className={trackCol}>
                  <div className="absolute inset-x-0 inset-y-1.5 rounded-control bg-table-head" />
                  <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-await-dot/35" style={{ left: "3%", width: `${pos(w.days) - 3}%` }} />
                  <div className={`${dotClass} ${s.dot}`} style={{ left: `${pos(w.days)}%` }} />
                </div>
                <div className={actionCol}>
                  {canEdit && (
                    <Button variant="secondary" size="sm" loading={busy === w.row.id} onClick={() => onQuoted(w.row)}>
                      Mark quoted
                      <span className="sr-only"> {w.row.reference}</span>
                    </Button>
                  )}
                  {more(w.row)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="px-4 pb-1 pt-3 text-meta font-semibold text-ink-heading">Quoted, waiting for the customer · {view.quotes.length}</h3>
      {view.quotes.length === 0 ? (
        <p className="px-4 pb-3 text-meta text-ink-muted">No open quotes from the last two weeks.</p>
      ) : (
        <ul className="divide-y divide-line">
          {view.quotes.map((q) => {
            const age = q.days === 0 ? "quoted today" : q.days === 1 ? "quoted yesterday" : `quoted ${q.days} days ago`;
            const chase = q.lastChase;
            return (
              <li key={q.row.id} className={row}>
                <Info e={q.row} tag={<CustomerTag record={q.customer} />}>
                  <span>{age}</span>
                  <span>· {recordText(q.customer)}</span>
                  {chase && (
                    <span className="text-ink-heading">
                      · {chasedLabel(chase.followed_up_on, today)}
                      {chase.sales_person_id !== ownerId && ` by ${personName(chase.sales_person_id)}`}
                    </span>
                  )}
                  <span className="sr-only">. {q.inWindow ? "Inside" : "Past"} the win window.</span>
                </Info>
                <div aria-hidden="true" className={trackCol}>
                  <div className="absolute inset-y-1.5 left-0 rounded-l-control bg-selected" style={{ width: `${boundary}%` }} />
                  <div className="absolute inset-y-1.5 right-0 rounded-r-control bg-await-bg" style={{ left: `${boundary}%` }} />
                  <div
                    className={`absolute top-1/2 h-0.5 -translate-y-1/2 ${q.inWindow ? "bg-primary/40" : "bg-await-dot/45"}`}
                    style={{ left: "3%", width: `${pos(q.days) - 3}%` }}
                  />
                  <div className={`${dotClass} ${q.inWindow ? "bg-primary" : "bg-await-dot"}`} style={{ left: `${pos(q.days)}%` }} />
                </div>
                <div className={actionCol}>
                  {canChase && (
                    <Button
                      variant={q.chasedToday ? "ghost" : "secondary"}
                      size="sm"
                      aria-pressed={q.chasedToday}
                      loading={busy === q.row.id}
                      onClick={() => onChase(q.row, !q.chasedToday)}
                      title={q.chasedToday ? "Logged for today. Click to undo." : "Log that you followed up on this quote today"}
                    >
                      {busy !== q.row.id && <Icon name={q.chasedToday ? "check" : "phone"} className={`size-3.5 ${q.chasedToday ? "text-confirmed" : ""}`} />}
                      {q.chasedToday ? "Chased today" : "Followed up"}
                      <span className="sr-only"> {q.row.reference}</span>
                    </Button>
                  )}
                  {canEdit && (
                    <Button variant="secondary" size="sm" onClick={() => onWon(q.row)} title="Confirm the job: opens the enquiry with today's confirmation date">
                      Won
                      <span className="sr-only"> {q.row.reference}</span>
                    </Button>
                  )}
                  {more(q.row)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={`${row} rounded-b-panel border-t border-line bg-page py-3`}>
        <div className={infoCol}>
          <p className="font-semibold text-ink">
            {staleTotal === null ? "Quotes" : `${staleTotal.toLocaleString()} ${staleTotal === 1 ? "quote" : "quotes"}`} waiting {STALE_DAYS} days or more
          </p>
          <p className="text-meta text-ink-muted">{lateText} Close the lost ones so this page shows what is really open.</p>
        </div>
        <div className="min-w-0 flex-[2_1_14rem]">
          {stale && staleTotal !== null && staleTotal > 0 && (
            <div
              role="img"
              aria-label={AGE_BANDS.map((b) => `${stale[b.band]} quoted ${b.label === "Over 90 days" ? "over 90 days" : b.label} ago`).join(", ")}
              className="flex h-3.5 gap-0.5"
            >
              {AGE_BANDS.filter((b) => stale[b.band] > 0).map((b) => (
                <div key={b.band} className={`min-w-1.5 first:rounded-l-full last:rounded-r-full ${b.bar}`} style={{ flexGrow: stale[b.band], flexBasis: 0 }} />
              ))}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted">
            {AGE_BANDS.map((b) => (
              <Link key={b.band} to={staleLink(b.band)} className="hover:text-ink hover:underline">
                {b.label} · <b className="font-semibold text-ink">{stale?.[b.band]?.toLocaleString() ?? "–"}</b>
              </Link>
            ))}
          </div>
          {!!stale?.unquoted && (
            <Link to={staleLink("unquoted")} className="mt-1 inline-block text-meta font-medium text-primary hover:underline">
              Also {stale.unquoted.toLocaleString()} {stale.unquoted === 1 ? "enquiry" : "enquiries"} never quoted
            </Link>
          )}
        </div>
        <div className={actionCol}>
          <Link to={staleLink()} className={buttonClass("secondary", "sm")}>
            Review and close
          </Link>
        </div>
      </div>
    </section>
  );
}
