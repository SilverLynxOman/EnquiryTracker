import { useMemo, useState, type ReactNode } from "react";
import { EnquiryList } from "../../components/EnquiryList";
import { Icon } from "../../components/icons";
import { Button, STATUS_META, inputClass } from "../../components/ui";
import { fmtMoney } from "../../lib/format";
import { kpiDelta, type KpiDef } from "../../lib/kpiPeriods";
import { shortDate, weekdayName, type DayCount, type ModeTotal } from "../../lib/reports";
import { MODE_LABELS, type EnquiryRow, type Status } from "../../lib/types";

// Building blocks shared by the daily / weekly / monthly reports and Analytics.

/** Segmented control: one choice of a few, e.g. Enquiries / Profit. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-panel bg-table-head p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-7 whitespace-nowrap rounded-control px-2.5 text-control transition-colors duration-150 ${
              on ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Heading row of a report: the period in words on the left, its controls and Export on the right. */
export function ReportHeader({ title, sub, children, onExport, exporting, canExport }: {
  title: ReactNode;
  sub: ReactNode;
  children: ReactNode;
  onExport: () => void;
  exporting: boolean;
  canExport: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-1">
      <div className="mr-auto min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="text-meta text-ink-muted">{sub}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button variant="secondary" onClick={onExport} disabled={!canExport} loading={exporting}>
        {!exporting && <Icon name="download" />}
        {exporting ? "Exporting…" : "Export to Excel"}
      </Button>
    </div>
  );
}

/** ‹ [picker] › stepper around a date input. */
export function Stepper({ unit, onStep, children }: { unit: string; onStep: (step: -1 | 1) => void; children: ReactNode }) {
  const arrow = "flex h-9 w-9 items-center justify-center text-ink-heading hover:bg-row-hover hover:text-ink";
  return (
    <div className="flex items-stretch overflow-hidden rounded-control border border-control bg-surface">
      <button type="button" className={arrow} onClick={() => onStep(-1)} aria-label={`Previous ${unit}`} title={`Previous ${unit}`}>
        <Icon name="chevronLeft" />
      </button>
      <div className="flex border-x border-line">{children}</div>
      <button type="button" className={arrow} onClick={() => onStep(1)} aria-label={`Next ${unit}`} title={`Next ${unit}`}>
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

/** Date input without its own border, for inside the stepper. */
export const bareInput = "h-9 border-0 bg-transparent px-2.5 text-control text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary";

/** Colour of each tile: the Dashboard KPI tokens in src/index.css. */
export type KpiColour = "enquiries" | "quoted" | "confirmed" | "conversion" | "sales" | "profit" | "margin" | "avgProfit";

export interface KpiTileData {
  colour: KpiColour;
  label: string;
  hint: string;
  kind: KpiDef["kind"];
  value: number | null;
  /** The comparison value; no change is shown without one. */
  previous?: number | null;
  /** Text after the change, or in its place. */
  sub?: ReactNode;
}

export function fmtKpi(kind: KpiDef["kind"], v: number | null | undefined): string {
  if (v == null) return "—";
  if (kind === "rate") return `${v.toFixed(1)}%`;
  if (kind === "money") return fmtMoney(Math.round(v));
  return v.toLocaleString("en-US");
}

/** The report's key figures as softly coloured tiles, each with its change against the comparison. */
export function KpiTiles({ tiles, vs }: { tiles: KpiTileData[]; vs?: string }) {
  return (
    <section aria-label="Key figures" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => {
        const zero = !t.value;
        const d = kpiDelta(t.kind, t.value, t.previous ?? null);
        const accent = zero ? "var(--color-control)" : `var(--color-kpi-${t.colour})`;
        return (
          <div
            key={t.label}
            title={t.hint}
            className="relative overflow-hidden rounded-panel border px-4 pb-3 pt-3.5"
            style={{
              background: zero ? "var(--color-surface)" : `var(--color-kpi-${t.colour}-bg)`,
              borderColor: zero ? "var(--color-line)" : `color-mix(in srgb, var(--color-kpi-${t.colour}) 18%, transparent)`,
            }}
          >
            <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent, opacity: zero ? 0.4 : 0.75 }} aria-hidden />
            <div className="flex items-center gap-1.5 text-meta font-medium text-ink-heading">
              <span className="size-2 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
              {t.label}
            </div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${zero ? "text-ink-muted/70" : "text-ink"}`}>{fmtKpi(t.kind, t.value)}</div>
            <div className="mt-0.5 flex min-h-[1.125rem] flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-ink-muted">
              {d && vs && (
                <>
                  <span
                    className={`whitespace-nowrap rounded-full bg-surface/80 px-1.5 text-[0.6875rem] font-semibold ${
                      d.direction === "up" ? "text-up" : d.direction === "down" ? "text-down" : "text-ink-muted"
                    }`}
                  >
                    <span aria-hidden>{d.direction === "up" ? "▲ " : d.direction === "down" ? "▼ " : ""}</span>
                    <span className="sr-only">{d.direction === "up" ? "up " : d.direction === "down" ? "down " : "no change "}</span>
                    {d.text}
                  </span>
                  <span className="whitespace-nowrap">vs {vs}</span>
                </>
              )}
              {t.sub && <span>{t.sub}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Thin horizontal bar, 0–100%. */
export function MiniBar({ pct, colour = "var(--color-primary)", className = "w-20" }: { pct: number; colour?: string; className?: string }) {
  return (
    <div className={`h-2 shrink-0 overflow-hidden rounded-full bg-table-head ${className}`} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(pct, 100))}%`, background: colour }} />
    </div>
  );
}

/** Ranked list of bars: name, bar, figure and a quieter second figure. */
export function BarList({ rows, empty }: { rows: { key: string; label: string; value: number; display: string; extra?: string }[]; empty: string }) {
  if (!rows.length) return <p className="py-6 text-center text-body text-ink-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(5rem,9rem)_1fr_4.5rem_4.5rem] items-center gap-3 text-body">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <MiniBar pct={(r.value / max) * 100} className="w-full" />
          <span className="text-right font-medium tabular-nums">{r.display}</span>
          <span className="text-right text-meta tabular-nums text-ink-muted">{r.extra}</span>
        </li>
      ))}
    </ul>
  );
}

/** Shipment modes as bars, by enquiries raised or by profit on confirmed jobs. */
export function ModeBars({ modes }: { modes: ModeTotal[] }) {
  const [by, setBy] = useState<"enquiries" | "profit">("enquiries");
  const rows = modes
    .filter((m) => (by === "enquiries" ? m.enquiries : m.profit))
    .sort((a, b) => (by === "enquiries" ? b.enquiries - a.enquiries : b.profit - a.profit))
    .map((m) =>
      by === "enquiries"
        ? { key: m.mode, label: MODE_LABELS[m.mode], value: m.enquiries, display: m.enquiries.toLocaleString(), extra: m.confirmed ? `${m.confirmed} conf.` : "" }
        : { key: m.mode, label: MODE_LABELS[m.mode], value: m.profit, display: fmtMoney(Math.round(m.profit)), extra: `${m.confirmed} job${m.confirmed === 1 ? "" : "s"}` },
    );
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Segmented
          label="Measure"
          value={by}
          onChange={setBy}
          options={[
            { value: "enquiries", label: "Enquiries" },
            { value: "profit", label: "Profit" },
          ]}
        />
      </div>
      <BarList rows={rows} empty={by === "enquiries" ? "No enquiries." : "No confirmed jobs."} />
    </>
  );
}

const ENQ_COLOUR = "color-mix(in srgb, var(--color-primary) 32%, white)";
const CONF_COLOUR = "var(--color-kpi-confirmed)";

/** Enquiries and confirmations per day, side by side. */
export function DayChart({ days, today }: { days: DayCount[]; today: string }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.enquiries, d.confirmed)));
  const many = days.length > 10;
  return (
    <div>
      <div className="mb-2 flex justify-end gap-4 text-meta text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: ENQ_COLOUR }} aria-hidden />
          Enquiries
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: CONF_COLOUR }} aria-hidden />
          Confirmed
        </span>
      </div>
      <div className="flex h-40 items-end gap-1 border-b border-line" role="img" aria-label="Enquiries and confirmations per day">
        {days.map((d) => (
          <div
            key={d.date}
            className={`group relative flex h-full flex-1 items-end justify-center gap-px rounded-t ${d.date === today ? "bg-selected" : ""}`}
            title={`${weekdayName(d.date)} ${shortDate(d.date)}: ${d.enquiries} enquiries, ${d.confirmed} confirmed`}
          >
            {(
              [
                [d.enquiries, ENQ_COLOUR],
                [d.confirmed, CONF_COLOUR],
              ] as const
            ).map(([n, colour], j) => (
              <div key={j} className="flex h-full w-[42%] max-w-5 flex-col items-center justify-end">
                {n > 0 && !many && <span className="mb-0.5 text-[0.625rem] font-medium leading-none tabular-nums text-ink-muted">{n}</span>}
                <div className="w-full rounded-t-sm" style={{ height: `${(n / max) * 85}%`, background: colour }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {days.map((d, i) => {
          const n = Number(d.date.slice(8, 10));
          const show = !many || i === 0 || i === days.length - 1 || n % 5 === 0;
          return (
            <span key={d.date} className={`flex-1 text-center text-[0.6875rem] tabular-nums ${d.date === today ? "font-semibold text-primary" : "text-ink-muted"}`}>
              {show ? (many ? n : `${weekdayName(d.date).slice(0, 3)} ${n}`) : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_FILTERS: ("" | Status)[] = ["", "new", "quoted", "confirmed", "lost", "cancelled"];

function matches(r: EnquiryRow, q: string): boolean {
  return [r.reference, r.customer_name, r.subject, r.agent_name, r.sales_person_name, r.pol, r.pod].some((v) => v?.toLowerCase().includes(q));
}

/** The period's enquiry lists as tabs, with a status filter and a search. */
export function ReportLists({ raised, earlier, raisedLabel, earlierLabel, earlierNote }: {
  raised: EnquiryRow[];
  earlier: EnquiryRow[];
  raisedLabel: string;
  earlierLabel: string;
  earlierNote: string;
}) {
  const [tab, setTab] = useState<"raised" | "earlier">("raised");
  const [status, setStatus] = useState<"" | Status>("");
  const [q, setQ] = useState("");
  const source = tab === "raised" ? raised : earlier;
  const counts = useMemo(() => {
    const c: Record<string, number> = { "": source.length };
    for (const r of source) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [source]);
  const needle = q.trim().toLowerCase();
  const rows = source.filter((r) => (!status || r.status === status) && (!needle || matches(r, needle)));
  const tabClass = (on: boolean) =>
    `flex h-8 items-center gap-1.5 rounded-control px-2.5 text-control transition-colors ${on ? "bg-selected font-semibold text-primary" : "font-medium text-ink-heading hover:bg-row-hover"}`;
  const count = (n: number, on: boolean) => (
    <span className={`rounded-full px-1.5 text-[0.6875rem] tabular-nums ${on ? "bg-surface text-primary" : "bg-table-head text-ink-heading"}`}>{n}</span>
  );

  return (
    <section className="rounded-panel border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div role="tablist" aria-label="Enquiry lists" className="flex flex-wrap gap-1">
          {(
            [
              ["raised", raisedLabel, raised.length],
              ["earlier", earlierLabel, earlier.length],
            ] as const
          ).map(([key, label, n]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              type="button"
              className={tabClass(tab === key)}
              onClick={() => {
                setTab(key);
                setStatus("");
              }}
              title={key === "earlier" ? earlierNote : undefined}
            >
              {label} {count(n, tab === key)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | Status)}
            className="h-8 rounded-control border border-control bg-surface px-2 text-control text-ink"
          >
            {STATUS_FILTERS.filter((s) => !s || counts[s]).map((s) => (
              <option key={s} value={s}>
                {s ? STATUS_META[s].label : "All statuses"} ({counts[s] ?? 0})
              </option>
            ))}
          </select>
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ref, customer, agent…"
              aria-label="Search the list"
              className={`${inputClass} h-8 w-56 pl-8`}
            />
          </div>
        </div>
      </header>
      <EnquiryList
        rows={rows}
        showConfirmed={tab === "earlier"}
        empty={source.length ? "Nothing matches the filter." : tab === "raised" ? "No enquiries raised." : "No earlier enquiries confirmed."}
      />
    </section>
  );
}

/** One calm message for a period with nothing in it, with a jump to the last day that had something. */
export function EmptyPeriod({ what, lastActive, onJump, extra }: {
  what: string;
  lastActive: string | null | undefined;
  onJump: (day: string) => void;
  extra?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-center rounded-panel border border-line bg-surface px-4 py-12 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-selected text-primary">
        <Icon name="calendar" className="size-5" />
      </div>
      <h2 className="text-base font-semibold text-ink">Nothing raised or confirmed {what}</h2>
      <p className="mt-1 text-body text-ink-muted">
        {lastActive === undefined
          ? " "
          : lastActive
            ? (
              <>
                The last day with activity was <b className="font-semibold text-ink">{weekdayName(lastActive)}, {shortDate(lastActive, true)}</b>.
              </>
            )
            : "There are no earlier enquiries."}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {lastActive && (
          <Button variant="secondary" onClick={() => onJump(lastActive)}>
            <Icon name="chevronLeft" /> Go to {shortDate(lastActive)}
          </Button>
        )}
        {extra}
      </div>
    </section>
  );
}

