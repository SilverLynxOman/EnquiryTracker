import { Link, useNavigate } from "react-router";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { displayName, fmtDateLong } from "../../lib/display";
import { agoLabel, winRate } from "../../lib/masterActivity";
import type { MasterKind } from "./kinds";
import { enquiriesLink, th, td, type MasterRow } from "./shared";

export type SortKey = "name" | "enquiries" | "rate" | "last";

/** 12-month enquiry trend as a small line; the last point (this month) is marked. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (!values.length) return <span className="block h-6 w-24 animate-pulse rounded bg-table-head" aria-hidden="true" />;
  const w = 96;
  const h = 24;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)] as const);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="block overflow-visible">
      <polyline
        points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        className="stroke-primary/70"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} className="fill-primary" />
    </svg>
  );
}

function Badge({ tone, children }: { tone: "dup" | "new" | "dormant"; children: string }) {
  const cls = {
    dup: "border border-await/25 bg-await-bg text-await",
    new: "bg-selected text-primary",
    dormant: "bg-cancelled-bg text-cancelled",
  }[tone];
  return <span className={`shrink-0 rounded-full px-2 py-px text-[11px] leading-4 font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

/** Remembered names as they read (keys differing only in punctuation show once), the first two and a count. */
function Aliases({ label, aliases }: { label: string; aliases: string[] }) {
  const names = [...new Set(aliases.map(displayName))];
  if (!names.length) return null;
  return (
    <div className="text-meta text-ink-muted" title={names.join("\n")}>
      {label}: {names.slice(0, 2).join(", ")}
      {names.length > 2 && ` +${names.length - 2} more`}
    </div>
  );
}

/**
 * Every row of one list: trend, win rate, how recent, and who handles it. Clicking a row opens its details; admins
 * tick rows to merge ones the duplicate finder did not pair.
 */
export function MasterTable({
  kind,
  rows,
  today,
  sort,
  dir,
  selected,
  openId,
  canRename,
  isAdmin,
  onSort,
  onToggle,
  onOpen,
  onRename,
}: {
  kind: MasterKind;
  rows: MasterRow[];
  today: string;
  sort: SortKey;
  dir: "asc" | "desc";
  selected: ReadonlySet<string>;
  openId: string | null;
  canRename: boolean;
  isAdmin: boolean;
  onSort: (key: SortKey) => void;
  onToggle: (id: string) => void;
  onOpen: (row: MasterRow) => void;
  onRename: (row: MasterRow) => void;
}) {
  const navigate = useNavigate();
  // An extra column with nothing in it (no customer has contacts yet) is left out.
  const extra = kind.extra && (kind.key !== "customers" || rows.some((r) => !!r.contacts)) ? kind.extra : undefined;
  const menu = (r: MasterRow): MenuItem[] => [
    { label: "Details", icon: "columns", onSelect: () => onOpen(r) },
    { label: "View enquiries", icon: "register", onSelect: () => navigate(enquiriesLink(r.name)) },
    ...(canRename ? [{ label: "Rename…", icon: "edit" as const, onSelect: () => onRename(r) }] : []),
  ];

  const header = (key: SortKey, label: string, className = "") => {
    const on = sort === key;
    return (
      <th scope="col" className={`${th} ${className}`} aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => onSort(key)}
          className={`inline-flex items-center gap-1 rounded hover:text-ink ${on ? "text-ink" : ""} ${className.includes("text-right") ? "flex-row-reverse" : ""}`}
        >
          {label}
          <Icon name={on && dir === "asc" ? "chevronUp" : "chevronDown"} className={`size-3.5 ${on ? "text-primary" : "opacity-0"}`} />
        </button>
      </th>
    );
  };

  return (
    <table className="w-full border-separate border-spacing-0 text-body">
      <caption className="sr-only">
        {kind.title}. Select a row for its details{isAdmin && "; tick two or more to merge them"}.
      </caption>
      <thead>
        <tr>
          {isAdmin && (
            <th scope="col" className={`${th} w-10 pl-4`}>
              <span className="sr-only">Select</span>
            </th>
          )}
          {header("name", kind.column, isAdmin ? "" : "pl-4")}
          <th scope="col" className={`${th} hidden w-32 @min-[880px]:table-cell`}>
            Last 12 months
          </th>
          {header("enquiries", "Enquiries", "w-24 text-right")}
          {header("rate", "Win rate", "hidden w-32 text-right @min-[640px]:table-cell")}
          {header("last", "Last enquiry", "hidden w-32 @min-[520px]:table-cell")}
          <th scope="col" className={`${th} hidden w-36 @min-[1040px]:table-cell`}>
            Mostly handled by
          </th>
          {extra && (
            <th scope="col" className={`${th} hidden w-28 text-right @min-[760px]:table-cell`}>
              {extra.header}
            </th>
          )}
          <th scope="col" className={`${th} w-12 pr-3`}>
            <span className="sr-only">More actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const name = displayName(r.name);
          const on = selected.has(r.id);
          const open = openId === r.id;
          const rate = winRate(r);
          return (
            <tr
              key={r.id}
              onClick={(e) => {
                // Clicks on links, buttons and boxes inside the row do their own thing.
                if ((e.target as HTMLElement).closest("a, button, input, [role=menu]")) return;
                onOpen(r);
              }}
              className={`cursor-pointer ${open ? "bg-selected" : on ? "bg-selected/60" : "hover:bg-row-hover"}`}
            >
              {isAdmin && (
                <td className={`${td} pl-4`}>
                  <input
                    type="checkbox"
                    className="size-4 align-middle accent-primary"
                    aria-label={`Select ${name}`}
                    checked={on}
                    onChange={() => onToggle(r.id)}
                  />
                </td>
              )}
              <td className={`${td} ${isAdmin ? "" : "pl-4"}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <button type="button" onClick={() => onOpen(r)} className="min-w-0 text-left font-medium hover:text-primary" title={r.name}>
                    {name}
                  </button>
                  {r.duplicate && <Badge tone="dup">Possible duplicate</Badge>}
                  {r.life === "new" && <Badge tone="new">New</Badge>}
                  {r.life === "dormant" && <Badge tone="dormant">Dormant</Badge>}
                </div>
                <Aliases label={kind.formerLabel} aliases={r.aliases} />

              </td>
              <td className={`${td} hidden @min-[880px]:table-cell`}>
                <Sparkline values={r.monthly} label={`Enquiries per month, last 12 months: ${r.monthly.join(", ")}`} />
              </td>
              <td className={`${td} text-right tabular-nums`}>
                <Link
                  to={enquiriesLink(r.name)}
                  className="font-medium text-primary hover:underline"
                  aria-label={`${r.enquiries} ${r.enquiries === 1 ? "enquiry" : "enquiries"} with ${name}`}
                >
                  {r.enquiries.toLocaleString()}
                </Link>
              </td>
              <td className={`${td} hidden @min-[640px]:table-cell`}>
                {rate === null ? (
                  <span className="block text-right text-ink-muted">—</span>
                ) : (
                  <div className="flex items-center justify-end gap-2" title={`${r.confirmed} of ${r.enquiries} confirmed`}>
                    <span className="text-meta tabular-nums text-ink-heading">{Math.round(rate * 100)}%</span>
                    <span className="h-1.5 w-14 overflow-hidden rounded-full bg-table-head" aria-hidden="true">
                      <span className="block h-full rounded-full bg-confirmed-dot" style={{ width: `${Math.round(rate * 100)}%` }} />
                    </span>
                  </div>
                )}
              </td>
              <td className={`${td} hidden text-meta whitespace-nowrap @min-[520px]:table-cell`}>
                {r.last_enquiry ? (
                  <span className={r.life === "dormant" ? "text-lost" : "text-ink-muted"} title={fmtDateLong(r.last_enquiry)}>
                    {agoLabel(r.last_enquiry, today)}
                  </span>
                ) : (
                  <span className="text-ink-muted">No enquiries</span>
                )}
              </td>
              <td className={`${td} hidden text-meta text-ink-heading @min-[1040px]:table-cell`}>{r.top_sales ? displayName(r.top_sales) : "—"}</td>
              {extra && <td className={`${td} hidden text-right tabular-nums @min-[760px]:table-cell`}>{extra.cell(r)}</td>}
              <td className={`${td} pr-3 text-right`}>
                <Menu
                  label={`More actions for ${name}`}
                  trigger={<Icon name="more" />}
                  triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-surface hover:text-ink"
                  items={menu(r)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
