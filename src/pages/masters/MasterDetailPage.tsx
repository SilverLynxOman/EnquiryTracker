import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import {
  Alert,
  Button,
  buttonClass,
  inputClass,
  Spinner,
  StatusBadge,
} from "../../components/ui";
import { fetchMasterHistory } from "../../lib/api";
import { displayName, fmtDateLong } from "../../lib/display";
import { errorMessage, todayIso } from "../../lib/format";
import {
  agoLabel,
  daysSince,
  laneOf,
  lifecycle,
} from "../../lib/masterActivity";
import {
  breakdown,
  monthSeries,
  rankOf,
  tally,
  usualGap,
  windowCompare,
  type DetailRow,
} from "../../lib/masterDetail";
import type { Status } from "../../lib/types";
import {
  ModeRing,
  modeColour,
  modeLabel,
  MonthChart,
  ShareBars,
  usd,
} from "./DetailCharts";
import type { MasterKind } from "./kinds";
import { RenameDialog } from "./RenameDialog";
import { enquiriesLink, td, th } from "./shared";

type Colour = "enquiries" | "confirmed" | "conversion" | "profit" | "sales";

/** One headline figure, coloured like the Dashboard and Reports tiles. */
function Tile({
  colour,
  label,
  value,
  children,
  hint,
}: {
  colour: Colour;
  label: string;
  value: string;
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <div
      title={hint}
      className="relative overflow-hidden rounded-panel border px-4 pt-3.5 pb-3"
      style={{
        background: `var(--color-kpi-${colour}-bg)`,
        borderColor: `color-mix(in srgb, var(--color-kpi-${colour}) 18%, transparent)`,
      }}
    >
      <span
        className="absolute inset-x-0 top-0 h-[3px] opacity-75"
        style={{ background: `var(--color-kpi-${colour})` }}
        aria-hidden
      />
      <div className="flex items-center gap-1.5 text-meta font-medium text-ink-heading">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: `var(--color-kpi-${colour})` }}
          aria-hidden
        />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
        {value}
      </div>
      <div className="mt-0.5 min-h-[1.125rem] text-meta text-ink-muted">
        {children}
      </div>
    </div>
  );
}

/** ▲ 12% / ▼ 3 pts, green or red; nothing when there is nothing to compare. */
function Change({
  cur,
  prev,
  points,
}: {
  cur: number;
  prev: number;
  points?: boolean;
}) {
  if (!points && !prev) return null;
  const d = points ? cur - prev : ((cur - prev) / prev) * 100;
  const flat = Math.abs(d) < (points ? 0.5 : 1);
  const text = points
    ? `${Math.abs(Math.round(d))} pts`
    : `${Math.abs(d) >= 1000 ? "999+" : Math.abs(Math.round(d))}%`;
  return (
    <span
      className={`mr-1 font-semibold whitespace-nowrap ${flat ? "text-ink-muted" : d > 0 ? "text-up" : "text-down"}`}
    >
      <span aria-hidden>{flat ? "" : d > 0 ? "▲ " : "▼ "}</span>
      <span className="sr-only">
        {flat ? "no change " : d > 0 ? "up " : "down "}
      </span>
      {text}
    </span>
  );
}

function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-panel border border-line bg-surface p-4 ${className}`}
    >
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        {aside && (
          <span className="ml-auto text-meta text-ink-muted">{aside}</span>
        )}
      </header>
      {children}
    </section>
  );
}

const STATUS_FILTERS: { key: Status | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "confirmed", label: "Confirmed" },
  { key: "quoted", label: "Quoted" },
  { key: "new", label: "Awaiting quote" },
];
const PAGE = 100;

/** Every enquiry of the customer or agent, searchable and filtered by status. */
function History({ rows, agent }: { rows: DetailRow[]; agent: boolean }) {
  const [status, setStatus] = useState<Status | "all">("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (!needle ||
        [
          r.reference,
          r.pol,
          r.pod,
          agent ? r.customer_name : r.sales_person_name,
        ].some((v) => v?.toLowerCase().includes(needle))),
  );
  useEffect(() => setLimit(PAGE), [status, needle]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-[1_1_200px] sm:max-w-72">
          <span className="sr-only">Search the history</span>
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            className={`${inputClass} pl-8`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Reference, port${agent ? ", customer" : " or sales person"}…`}
          />
        </label>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Status"
        >
          {STATUS_FILTERS.filter(
            (f) => f.key === "all" || counts.get(f.key),
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={`rounded-full border px-2.5 py-1 text-meta font-medium ${
                status === f.key
                  ? "border-primary/40 bg-selected text-primary"
                  : "border-line bg-surface text-ink-heading hover:text-ink"
              }`}
            >
              {f.label}{" "}
              <span className="tabular-nums opacity-75">
                {f.key === "all" ? rows.length : counts.get(f.key)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[560px] overflow-auto rounded-control border border-line">
        <table className="w-full border-separate border-spacing-0 text-body">
          <thead>
            <tr>
              <th scope="col" className={`${th} pl-4`}>
                Reference
              </th>
              <th scope="col" className={th}>
                Date
              </th>
              <th scope="col" className={th}>
                Lane
              </th>
              <th scope="col" className={th}>
                Mode
              </th>
              <th scope="col" className={`${th} hidden md:table-cell`}>
                {agent ? "Customer" : "Sales person"}
              </th>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={`${th} pr-4 text-right`}>
                Profit
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={r.id} className="hover:bg-row-hover">
                <td className={`${td} pl-4 whitespace-nowrap`}>
                  <Link
                    to={`/enquiries/${r.id}`}
                    className="font-medium text-primary tabular-nums hover:underline"
                  >
                    {r.reference}
                  </Link>
                </td>
                <td
                  className={`${td} text-meta whitespace-nowrap text-ink-muted`}
                >
                  {fmtDateLong(r.enquiry_date)}
                </td>
                <td
                  className={`${td} max-w-[280px] truncate`}
                  title={laneOf(r) ?? undefined}
                >
                  {laneOf(r) ? (
                    displayName(laneOf(r))
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className={td}>
                  {r.shipment_mode ? (
                    <span className="inline-flex items-center gap-1.5 text-meta whitespace-nowrap text-ink-heading">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: modeColour(r.shipment_mode) }}
                        aria-hidden
                      />
                      {modeLabel(r.shipment_mode)}
                    </span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td
                  className={`${td} hidden max-w-[220px] truncate text-meta text-ink-heading md:table-cell`}
                >
                  {displayName(agent ? r.customer_name : r.sales_person_name) ||
                    "—"}
                </td>
                <td className={td}>
                  <StatusBadge status={r.status} />
                </td>
                <td className={`${td} pr-4 text-right tabular-nums`}>
                  {r.status === "confirmed" && r.profit != null ? (
                    usd(r.profit)
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-ink-muted"
                >
                  No enquiries match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <div className="mt-3 text-center">
          <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, shown.length - limit)} more of{" "}
            {shown.length - limit}
          </Button>
        </div>
      )}
    </>
  );
}

const LIFE_CHIP = {
  new: ["bg-selected text-primary", "New this month"],
  active: ["bg-confirmed-bg text-confirmed", "Active"],
  quiet: ["bg-await-bg text-await", "Quiet"],
  dormant: ["bg-cancelled-bg text-cancelled", "Dormant"],
  none: ["bg-cancelled-bg text-cancelled", "No enquiries"],
} as const;

/**
 * One customer's or agent's page: headline figures, its month-by-month record, what it ships, its lanes, who handles
 * it (or, for an agent, the customers it brings) and every enquiry.
 */
export default function MasterDetailPage({ kind }: { kind: MasterKind }) {
  const { id = "" } = useParams();
  const { canEdit, isAdmin } = useAuth();
  const canRename = kind.renameNeedsAdmin ? isAdmin : canEdit;
  const [renaming, setRenaming] = useState(false);
  const agent = kind.key === "agents";
  const today = todayIso();

  const summary = useQuery({
    queryKey: [kind.key, "summary"],
    queryFn: kind.fetchSummaries,
  });
  const history = useQuery({
    queryKey: [kind.key, "history", id],
    queryFn: () => fetchMasterHistory(kind.key as "customers" | "agents", id),
  });
  const master = summary.data?.find((m) => m.id === id);
  useEffect(() => {
    if (!master) return;
    const before = document.title;
    document.title = `${displayName(master.name)} · ${kind.title}`;
    return () => {
      document.title = before;
    };
  }, [master, kind.title]);

  const stats = useMemo(() => {
    const rows = history.data;
    if (!rows || !summary.data) return null;
    const all = summary.data;
    const company = all.reduce(
      (t, m) => ({ e: t.e + m.enquiries, c: t.c + m.confirmed }),
      { e: 0, c: 0 },
    );
    const total = tally(rows);
    const first = rows.length ? rows[rows.length - 1].enquiry_date : null;
    const last = rows.length ? rows[0].enquiry_date : null;
    return {
      total,
      first,
      last,
      rate: total.enquiries ? (total.confirmed / total.enquiries) * 100 : null,
      companyRate: company.e ? (company.c / company.e) * 100 : null,
      window: windowCompare(rows, today),
      gap: usualGap(rows),
      rank: rankOf(id, all),
      of: all.filter((m) => m.enquiries > 0).length,
      life: lifecycle(first, last, today),
      months: monthSeries(rows, today),
      modes: breakdown(rows, (r) => r.shipment_mode),
      lanes: breakdown(rows, laneOf),
      people: breakdown(rows, (r) =>
        agent ? r.customer_name : r.sales_person_name,
      ),
      agents: agent ? [] : breakdown(rows, (r) => r.agent_name),
    };
  }, [history.data, summary.data, id, today, agent]);

  const back = (
    <Link
      to={`/${kind.key}`}
      className="inline-flex items-center gap-1 text-meta font-medium text-primary hover:underline"
    >
      <Icon name="chevronLeft" className="size-3.5" />
      All {kind.title.toLowerCase()}
    </Link>
  );

  if (summary.error || history.error)
    return <Alert>{errorMessage(summary.error ?? history.error)}</Alert>;
  if (summary.data && !master)
    return (
      <div className="space-y-3">
        {back}
        <Alert kind="warning">
          This {kind.noun} no longer exists. It may have been merged into
          another one.
        </Alert>
      </div>
    );
  if (!master || !stats) return <Spinner />;

  const { total, window: win } = stats;
  const rate = stats.rate === null ? null : Math.round(stats.rate);
  const companyRate =
    stats.companyRate === null ? null : Math.round(stats.companyRate);
  const [lifeClass, lifeLabel] = LIFE_CHIP[stats.life];
  const notes =
    "notes" in master && typeof master.notes === "string" ? master.notes : null;
  const formers = [...new Set(master.aliases.map(displayName))];
  const best = stats.months.reduce(
    (b, m, i, a) => (m.enquiries > a[b].enquiries ? i : b),
    0,
  );
  const since = stats.last ? daysSince(stats.last, today) : null;
  const customerIds = new Map(
    (history.data ?? []).map((r) => [r.customer_name, r.customer_id]),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,20rem)] flex-1">
          {back}
          <h1
            className="mt-1 text-2xl leading-8 font-semibold tracking-tight text-ink"
            title={master.name}
          >
            {displayName(master.name)}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-ink-muted">
            <span
              className={`rounded-full px-2 py-px font-medium ${lifeClass}`}
            >
              {lifeLabel}
            </span>
            {stats.rank && (
              <span className="rounded-full bg-selected px-2 py-px font-medium text-primary">
                #{stats.rank} of {stats.of.toLocaleString()}{" "}
                {kind.title.toLowerCase()} by enquiries
              </span>
            )}
            {stats.first && (
              <span>First enquiry {fmtDateLong(stats.first)}</span>
            )}
            {formers.length > 0 && (
              <span title={formers.join("\n")}>
                · {kind.formerLabel}: {formers.slice(0, 2).join(", ")}
                {formers.length > 2 && ` +${formers.length - 2} more`}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRename && (
            <Button variant="ghost" onClick={() => setRenaming(true)}>
              <Icon name="edit" className="size-4" />
              Rename…
            </Button>
          )}
          <Link
            to={enquiriesLink(master.name)}
            className={buttonClass("secondary")}
          >
            <Icon name="register" className="size-4" />
            View in register
          </Link>
        </div>
      </div>

      <section
        aria-label="Key figures"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5"
      >
        <Tile
          colour="enquiries"
          label="Enquiries"
          value={total.enquiries.toLocaleString()}
          hint="Last 90 days against the 90 days before"
        >
          <Change cur={win.current.enquiries} prev={win.previous.enquiries} />
          {win.current.enquiries} in the last 90 days
        </Tile>
        <Tile
          colour="confirmed"
          label="Confirmed jobs"
          value={total.confirmed.toLocaleString()}
        >
          {(total.enquiries - total.confirmed).toLocaleString()} quoted or
          awaiting
        </Tile>
        <Tile
          colour="conversion"
          label="Win rate"
          value={rate === null ? "—" : `${rate}%`}
          hint={
            agent
              ? "Agents are mostly recorded once a job is confirmed, so their win rate reads high."
              : undefined
          }
        >
          {rate !== null && companyRate !== null && (
            <>
              <Change cur={rate} prev={companyRate} points />
              vs {agent ? "all agents" : "company"} {companyRate}%
            </>
          )}
        </Tile>
        <Tile colour="profit" label="Profit" value={usd(total.profit)}>
          {total.confirmed
            ? `${usd(total.profit / total.confirmed)} per confirmed job`
            : "No confirmed jobs yet"}
        </Tile>
        <Tile
          colour="sales"
          label="Last enquiry"
          value={stats.last ? agoLabel(stats.last, today) : "—"}
          hint={stats.last ? fmtDateLong(stats.last) : undefined}
        >
          {stats.gap !== null ? (
            <span
              className={
                since !== null && since > stats.gap * 3
                  ? "font-medium text-down"
                  : undefined
              }
            >
              Usually every{" "}
              {stats.gap === 0
                ? "day"
                : stats.gap === 1
                  ? "day"
                  : `${stats.gap} days`}
            </span>
          ) : (
            stats.last && fmtDateLong(stats.last)
          )}
        </Tile>
      </section>

      {total.enquiries > 0 ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <Panel
              title="Month by month"
              aside={
                stats.months[best].enquiries
                  ? `Best month: ${fmtDateLong(`${stats.months[best].month}-01`).slice(3)} (${stats.months[best].enquiries})`
                  : undefined
              }
            >
              <MonthChart months={stats.months} />
            </Panel>
            <Panel
              title={agent ? "What comes through them" : "What they ship"}
              aside="win rate by mode"
            >
              {stats.modes.length ? (
                <ModeRing modes={stats.modes} companyRate={companyRate} />
              ) : (
                <p className="text-meta text-ink-muted">
                  No shipment modes recorded.
                </p>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Top lanes" aside="green: confirmed">
              {stats.lanes.length ? (
                <ShareBars items={stats.lanes} label={displayName} />
              ) : (
                <p className="text-meta text-ink-muted">No lanes recorded.</p>
              )}
            </Panel>
            <Panel
              title={agent ? "Customers through this agent" : "Handled by"}
            >
              <ShareBars
                items={stats.people}
                label={displayName}
                href={
                  agent
                    ? (name) =>
                        customerIds.get(name) &&
                        `/customers/${customerIds.get(name)}`
                    : undefined
                }
              />
              {stats.agents.length > 0 && (
                <p className="mt-4 border-t border-line pt-3 text-meta text-ink-muted">
                  Agents used:{" "}
                  {stats.agents.slice(0, 4).map((a, i) => (
                    <span key={a.value}>
                      {i > 0 && ", "}
                      <span className="font-medium text-ink-heading">
                        {displayName(a.value)}
                      </span>{" "}
                      ({a.enquiries})
                    </span>
                  ))}
                  {stats.agents.length > 4 &&
                    ` and ${stats.agents.length - 4} more`}
                </p>
              )}
            </Panel>
          </div>

          {(notes || (!agent && !!master.contacts)) && (
            <Panel title="Notes">
              {notes && (
                <p className="text-body whitespace-pre-line text-ink">
                  {notes}
                </p>
              )}
              {!agent && !!master.contacts && (
                <p className="mt-1 text-meta text-ink-muted">
                  {master.contacts} contact{" "}
                  {master.contacts === 1 ? "person" : "people"}
                </p>
              )}
            </Panel>
          )}

          <Panel
            title="Full history"
            aside={
              stats.first
                ? `${total.enquiries.toLocaleString()} enquiries since ${fmtDateLong(stats.first)}`
                : undefined
            }
          >
            <History key={id} rows={history.data ?? []} agent={agent} />
          </Panel>
        </>
      ) : (
        <Panel title="Full history">
          <p className="text-body text-ink-muted">No enquiries yet.</p>
        </Panel>
      )}

      {renaming && (
        <RenameDialog
          kind={kind}
          row={master}
          onClose={() => setRenaming(false)}
          onRenamed={() => setRenaming(false)}
        />
      )}
    </div>
  );
}
