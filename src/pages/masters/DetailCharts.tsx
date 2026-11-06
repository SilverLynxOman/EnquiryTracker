import { useState } from "react";
import { Link } from "react-router";
import { fmtMoney } from "../../lib/format";
import type { Tally } from "../../lib/masterDetail";
import { MODE_LABELS, type ShipmentMode } from "../../lib/types";

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
});
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthDate = (ym: string) => new Date(`${ym}-01T00:00:00Z`);
export const usd = (n: number) => `$${fmtMoney(Math.round(n))}`;
const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 100) : 0;

/** A round step above `max` for the axis: 1, 2, 5, 10, 20, 50… */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/**
 * Enquiries per month as bars, the confirmed part in green, with profit as a line on its own axis. Hovering (or
 * focusing) a month shows its figures.
 */
export function MonthChart({
  months,
}: {
  months: (Tally & { month: string })[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 680;
  const H = 240;
  const L = 34;
  const R = 52;
  const T = 12;
  const B = 26;
  const iw = W - L - R;
  const ih = H - T - B;
  const maxN = niceMax(Math.max(...months.map((m) => m.enquiries)));
  const maxP = niceMax(Math.max(...months.map((m) => m.profit)));
  const slot = iw / months.length;
  const bw = Math.min(28, slot * 0.6);
  const x = (i: number) => L + slot * (i + 0.5);
  const yN = (v: number) => T + ih - (v / maxN) * ih;
  const yP = (v: number) => T + ih - (v / maxP) * ih;
  const every = Math.ceil(months.length / 12);
  const shown = hover === null ? null : months[hover];
  const profitLine = months
    .map((m, i) => `${x(i).toFixed(1)},${yP(m.profit).toFixed(1)}`)
    .join(" ");

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Enquiries, confirmed and profit per month"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={L}
              x2={W - R}
              y1={T + ih * g}
              y2={T + ih * g}
              className="stroke-line"
            />
            <text
              x={L - 6}
              y={T + ih * g + 4}
              textAnchor="end"
              className="fill-ink-muted text-[11px]"
            >
              {Math.round(maxN * (1 - g))}
            </text>
            <text
              x={W - R + 6}
              y={T + ih * g + 4}
              className="fill-ink-muted text-[11px]"
            >
              {maxP >= 1000
                ? `$${((maxP * (1 - g)) / 1000).toFixed(maxP >= 10000 ? 0 : 1)}k`
                : `$${Math.round(maxP * (1 - g))}`}
            </text>
          </g>
        ))}
        {months.map((m, i) => (
          <g
            key={m.month}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <rect
              x={x(i) - slot / 2}
              y={T}
              width={slot}
              height={ih}
              className={hover === i ? "fill-row-hover" : "fill-transparent"}
            />
            <rect
              x={x(i) - bw / 2}
              y={yN(m.enquiries)}
              width={bw}
              height={Math.max(0, yN(m.confirmed) - yN(m.enquiries))}
              rx={3}
              style={{
                fill: "color-mix(in srgb, var(--color-primary) 30%, transparent)",
              }}
            />
            <rect
              x={x(i) - bw / 2}
              y={yN(m.confirmed)}
              width={bw}
              height={T + ih - yN(m.confirmed)}
              rx={3}
              className="fill-confirmed-dot"
            />
            {i % every === 0 || i === months.length - 1 ? (
              <text
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-ink-muted text-[11px]"
              >
                {MONTH.format(monthDate(m.month))}
                {(m.month.endsWith("-01") || i === 0) && months.length > 12
                  ? ` ${m.month.slice(2, 4)}`
                  : ""}
              </text>
            ) : null}
          </g>
        ))}
        <polyline
          points={profitLine}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          pointerEvents="none"
          style={{ stroke: "var(--color-kpi-conversion)" }}
        />
        {months.map((m, i) => (
          <circle
            key={m.month}
            cx={x(i)}
            cy={yP(m.profit)}
            r={hover === i ? 4.5 : 3}
            strokeWidth={2}
            pointerEvents="none"
            className="fill-surface"
            style={{ stroke: "var(--color-kpi-conversion)" }}
          />
        ))}
      </svg>
      {shown && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-control bg-ink px-2.5 py-1.5 text-meta whitespace-nowrap text-surface shadow"
          style={{
            left: `${Math.min(88, Math.max(12, (x(hover) / W) * 100))}%`,
          }}
        >
          <div className="font-semibold">
            {MONTH_YEAR.format(monthDate(shown.month))}
          </div>
          {shown.enquiries} enquiries · {shown.confirmed} confirmed
          <br />
          Profit {usd(shown.profit)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-confirmed-dot" aria-hidden />{" "}
          Confirmed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{
              background:
                "color-mix(in srgb, var(--color-primary) 30%, transparent)",
            }}
            aria-hidden
          />{" "}
          Quoted or awaiting
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-[3px] w-3 rounded-full"
            style={{ background: "var(--color-kpi-conversion)" }}
            aria-hidden
          />{" "}
          Profit (right axis)
        </span>
      </div>
      <table className="sr-only">
        <caption>Enquiries per month</caption>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{MONTH_YEAR.format(monthDate(m.month))}</th>
              <td>{m.enquiries} enquiries</td>
              <td>{m.confirmed} confirmed</td>
              <td>{usd(m.profit)} profit</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const MODE_COLOUR: Partial<Record<ShipmentMode, string>> = {
  FCL: "var(--color-mode-fcl)",
  LCL: "var(--color-mode-lcl)",
  AIR: "var(--color-mode-air)",
  COURIER: "var(--color-mode-courier)",
};
export const modeColour = (m: string) =>
  MODE_COLOUR[m as ShipmentMode] ?? "var(--color-mode-other)";
export const modeLabel = (m: string) => MODE_LABELS[m as ShipmentMode] ?? m;

/** Shipment modes as a ring, with each mode's share and win rate beside it. */
export function ModeRing({
  modes,
  companyRate,
}: {
  modes: (Tally & { value: string })[];
  companyRate: number | null;
}) {
  const total = modes.reduce((n, m) => n + m.enquiries, 0);
  const R = 62;
  const r = 40;
  let a0 = -Math.PI / 2;
  const at = (a: number, rad: number) =>
    `${(80 + rad * Math.cos(a)).toFixed(2)},${(80 + rad * Math.sin(a)).toFixed(2)}`;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 160 160" className="size-36 shrink-0" aria-hidden>
        {modes.length === 1 ? (
          <circle
            cx={80}
            cy={80}
            r={(R + r) / 2}
            fill="none"
            strokeWidth={R - r}
            style={{ stroke: modeColour(modes[0].value) }}
          />
        ) : (
          modes.map((m) => {
            const a1 = a0 + (m.enquiries / total) * Math.PI * 2;
            const big = a1 - a0 > Math.PI ? 1 : 0;
            const d = `M${at(a0, R)}A${R},${R} 0 ${big} 1 ${at(a1, R)}L${at(a1, r)}A${r},${r} 0 ${big} 0 ${at(a0, r)}Z`;
            a0 = a1;
            return (
              <path
                key={m.value}
                d={d}
                className="stroke-surface"
                strokeWidth={2}
                style={{ fill: modeColour(m.value) }}
              />
            );
          })
        )}
        <text
          x={80}
          y={80}
          textAnchor="middle"
          className="fill-ink text-[22px] font-bold"
        >
          {total.toLocaleString()}
        </text>
        <text
          x={80}
          y={98}
          textAnchor="middle"
          className="fill-ink-muted text-[11px]"
        >
          enquiries
        </text>
      </svg>
      <ul className="min-w-[180px] flex-1 space-y-2">
        {modes.map((m) => {
          const rate = pct(m.confirmed, m.enquiries);
          const good = companyRate === null || rate >= companyRate;
          return (
            <li key={m.value} className="flex items-center gap-2 text-body">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: modeColour(m.value) }}
                aria-hidden
              />
              <span className="w-24 font-medium text-ink">
                {modeLabel(m.value)}
              </span>
              <span className="flex-1 text-meta text-ink-muted tabular-nums">
                {m.enquiries} · {pct(m.enquiries, total)}%
              </span>
              <span
                className={`rounded-full px-2 py-px text-meta font-medium tabular-nums ${good ? "bg-confirmed-bg text-confirmed" : "bg-await-bg text-await"}`}
              >
                {rate}% won
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One bar per item: the confirmed part in green, the rest pale, scaled to the biggest item. */
export function ShareBars({
  items,
  label,
  href,
  limit = 8,
}: {
  items: (Tally & { value: string })[];
  label: (v: string) => string;
  /** Where an item's name links to, if anywhere. */
  href?: (v: string) => string | undefined | "" | null;
  limit?: number;
}) {
  const shown = items.slice(0, limit);
  const max = Math.max(1, ...shown.map((i) => i.enquiries));
  return (
    <ul className="space-y-3">
      {shown.map((i) => {
        const to = href?.(i.value);
        return (
          <li
            key={i.value}
            title={`${label(i.value)}: ${i.enquiries} enquiries, ${i.confirmed} confirmed`}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-body">
              {to ? (
                <Link
                  to={to}
                  className="min-w-0 truncate text-ink hover:text-primary hover:underline"
                >
                  {label(i.value)}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-ink">
                  {label(i.value)}
                </span>
              )}
              <span className="shrink-0 text-meta text-ink-muted tabular-nums">
                {i.enquiries} ·{" "}
                <span className="font-semibold text-confirmed">
                  {pct(i.confirmed, i.enquiries)}%
                </span>
              </span>
            </div>
            <div
              className="flex h-2.5 overflow-hidden rounded-full bg-table-head"
              aria-hidden
            >
              <span
                className="bg-confirmed-dot"
                style={{ width: `${(i.confirmed / max) * 100}%` }}
              />
              <span
                style={{
                  width: `${((i.enquiries - i.confirmed) / max) * 100}%`,
                  background:
                    "color-mix(in srgb, var(--color-primary) 30%, transparent)",
                }}
              />
            </div>
          </li>
        );
      })}
      {items.length > limit && (
        <li className="text-meta text-ink-muted">
          + {items.length - limit} more
        </li>
      )}
    </ul>
  );
}
