import { useEffect, useRef, useState } from "react";
import { fmtMoney } from "../lib/format";

export interface MonthValue {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  value: number;
  /** Shown in the tooltip under the value, e.g. "158 jobs". */
  note?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEIGHT = 220;
const M = { top: 22, right: 8, bottom: 28, left: 52 };
const BAR_MAX = 24;
const RADIUS = 4;
const COLOR = "#4f46e5"; // indigo-600, validated against the white card surface
const COLOR_ACTIVE = "#6366f1"; // indigo-500: the hovered column lifts
const GRID = "#e2e8f0"; // slate-200
const AXIS_TEXT = "#64748b"; // slate-500

/** Clean tick step (1, 2, 2.5 or 5 × 10^n) for about `count` intervals. */
function niceStep(range: number, count = 4): number {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function ticksFor(values: number[]): number[] {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const step = niceStep(hi - lo || 1);
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) out.push(v);
  return out;
}

/** Full figures under 10,000; compact (25K, 1.2M) on an axis that reaches it. One style per axis. */
function tickFormatter(ticks: number[]): (v: number) => string {
  const compact = Math.max(...ticks.map(Math.abs)) >= 10_000;
  return (v) => {
    if (!compact || v === 0) return v.toLocaleString("en-US");
    const a = Math.abs(v);
    return a >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : `${+(v / 1e3).toFixed(1)}K`;
  };
}

/** Column from the baseline to `yEnd`, rounded at the data end only. */
function columnPath(x: number, w: number, yBase: number, yEnd: number): string {
  const h = Math.abs(yBase - yEnd);
  if (h < 0.5) return "";
  const r = Math.min(RADIUS, h, w / 2);
  const dir = yEnd < yBase ? 1 : -1; // 1 = grows upwards
  const corner = yEnd + dir * r;
  return [
    `M${x},${yBase}`,
    `V${corner}`,
    `Q${x},${yEnd} ${x + r},${yEnd}`,
    `H${x + w - r}`,
    `Q${x + w},${yEnd} ${x + w},${corner}`,
    `V${yBase}`,
    "Z",
  ].join(" ");
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Single-series column chart of a monthly amount. The table next to it carries every value. */
export function MonthlyProfitChart({ data, label }: { data: MonthValue[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const ticks = ticksFor(data.map((d) => d.value));
  const fmtTick = tickFormatter(ticks);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const y = (v: number) => M.top + ((hi - v) / (hi - lo || 1)) * plotH;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(BAR_MAX, band - 2));
  const multiYear = new Set(data.map((d) => d.month.slice(0, 4))).size > 1;
  const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]}${multiYear ? ` ${iso.slice(2, 4)}` : ""}`;
  const fullMonth = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  // Thin out month labels when they would collide (about 44px each).
  const labelEvery = Math.max(1, Math.ceil(44 / (band || 44)));
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -Infinity) ? i : best), 0);

  const activeDatum = active == null ? null : data[active];
  const tipX = active == null ? 0 : M.left + band * (active + 0.5);
  const tipY = activeDatum ? Math.min(y(activeDatum.value), y(0)) - 8 : 0;
  const tipAlign = active === 0 ? "translate(-12px, -100%)" : active === data.length - 1 ? "translate(calc(-100% + 12px), -100%)" : "translate(-50%, -100%)";

  return (
    <div ref={ref} className="relative" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`${label}, column chart. Every value is in the table below.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#cbd5e1" : GRID} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT} className="tabular-nums">
                {fmtTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = M.left + band * i + (band - barW) / 2;
            return (
              <g key={d.month}>
                <path d={columnPath(x, barW, y(0), y(d.value))} fill={active === i ? COLOR_ACTIVE : COLOR} />
                {i % labelEvery === 0 && (
                  <text x={M.left + band * (i + 0.5)} y={HEIGHT - M.bottom + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                    {monthLabel(d.month)}
                  </text>
                )}
                {i === peak && d.value > 0 && (
                  <text x={M.left + band * (i + 0.5)} y={y(d.value) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="#334155" className="tabular-nums">
                    {fmtTick(d.value)}
                  </text>
                )}
                {/* Hit target: the whole month band, bigger than the column. */}
                <rect
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${fullMonth(d.month)}: ${fmtMoney(d.value)}${d.note ? `, ${d.note}` : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  style={{ outline: "none" }}
                />
              </g>
            );
          })}
          {active != null && (
            <rect
              x={M.left + band * active + 1}
              y={M.top}
              width={Math.max(0, band - 2)}
              height={plotH}
              fill="none"
              stroke="#c7d2fe"
              strokeWidth={1}
              rx={4}
              pointerEvents="none"
            />
          )}
        </svg>
      )}
      {activeDatum && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: tipX, top: tipY, transform: tipAlign }}
        >
          <div className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoney(activeDatum.value)}</div>
          <div className="text-slate-500">
            {fullMonth(activeDatum.month)}
            {activeDatum.note ? ` · ${activeDatum.note}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
