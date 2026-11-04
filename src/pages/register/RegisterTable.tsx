import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { Button, StatusBadge } from "../../components/ui";
import { displayName, fmtDateLong, initials, nextStep, shipmentLabel, shortPort, statusDetail, TRADE_LABELS } from "../../lib/display";
import { fmtMoney } from "../../lib/format";
import type { ColumnPrefs } from "../../lib/registerView";
import type { EnquiryRow } from "../../lib/types";

// Optional columns step aside, by the table's own width (container queries), when space runs short:
// Sales & agent first, then Shipment, Route and Profit. Everything stays available in the details drawer.
const AUTO_HIDE = {
  people: "hidden @min-[1040px]:table-cell",
  shipment: "hidden @min-[880px]:table-cell",
  route: "hidden @min-[720px]:table-cell",
  profit: "hidden @min-[600px]:table-cell",
  // Phone widths: the next step moves to the drawer (tap the row), then the status moves under the customer.
  next: "hidden @min-[560px]:table-cell",
  status: "hidden @min-[460px]:table-cell",
} as const;

const th = "sticky top-0 z-10 h-10 border-b border-line bg-table-head px-3 text-left text-meta font-medium whitespace-nowrap text-ink-heading";
const td = "border-b border-line px-3 py-2 align-middle";

export interface RowActions {
  onSelect: (row: EnquiryRow) => void;
  onMarkQuoted: (row: EnquiryRow) => void;
  onConfirm: (row: EnquiryRow) => void;
  menuItems: (row: EnquiryRow) => MenuItem[];
  quotingId: string | null;
  selectLink: (row: EnquiryRow) => string;
}

export function Route({ row }: { row: EnquiryRow }) {
  if (!row.pol && !row.pod) return <span className="text-ink-muted">No ports yet</span>;
  return (
    <span title={[row.pol, row.pod].filter(Boolean).join(" → ")}>
      <span className="whitespace-nowrap">{shortPort(row.pol) || "?"}</span>
      <span className="mx-1 text-ink-muted" aria-label="to">
        →
      </span>
      <span className="whitespace-nowrap">{shortPort(row.pod) || "?"}</span>
    </span>
  );
}

function NextStepButton({ row, selected, canEdit, actions }: { row: EnquiryRow; selected: boolean; canEdit: boolean; actions: RowActions }) {
  const step = nextStep(row, canEdit);
  const variant = selected ? "primary" : "secondary";
  const arrow = <Icon name="arrowRight" className="size-3.5" />;
  if (step === "quote") {
    const busy = actions.quotingId === row.id;
    return (
      <Button variant={variant} loading={busy} disabled={actions.quotingId !== null && !busy} onClick={() => actions.onMarkQuoted(row)}>
        {busy ? "Saving…" : "Mark quoted"}
        {!busy && arrow}
      </Button>
    );
  }
  if (step === "confirm") {
    return (
      <Button variant={variant} onClick={() => actions.onConfirm(row)}>
        Confirm job{arrow}
      </Button>
    );
  }
  return (
    <Button variant={variant} onClick={() => actions.onSelect(row)}>
      View details{arrow}
    </Button>
  );
}

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <tr key={i} aria-hidden="true">
          <td colSpan={columns} className={td}>
            <div className="flex h-10 items-center gap-6 motion-safe:animate-pulse">
              <div className="h-3 w-20 rounded bg-line" />
              <div className="h-3 w-48 rounded bg-line" />
              <div className="h-3 w-32 rounded bg-line" />
              <div className="h-3 flex-1 rounded bg-line" />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

export function RegisterTable({
  rows,
  loading,
  selectedId,
  canEdit,
  today,
  columns,
  sort,
  onToggleSort,
  actions,
  empty,
}: {
  rows: EnquiryRow[];
  loading: boolean;
  selectedId: string;
  canEdit: boolean;
  today: string;
  columns: ColumnPrefs;
  sort: "asc" | "desc";
  onToggleSort: () => void;
  actions: RowActions;
  empty: ReactNode;
}) {
  const colCount = 5 + Object.values(columns).filter(Boolean).length;
  // Route under the customer name when its own column is hidden (by choice, or by the narrow-table rule).
  const routeFallback = columns.route ? "@min-[720px]:hidden" : "";

  function onRowClick(e: MouseEvent<HTMLTableRowElement>, row: EnquiryRow) {
    if ((e.target as HTMLElement).closest("a, button, input, select, label")) return;
    actions.onSelect(row);
  }

  return (
    <table className="w-full border-separate border-spacing-0 text-body">
      <caption className="sr-only">Enquiries. Select a reference to see its details.</caption>
      <thead>
        <tr>
          <th scope="col" className={`${th} pl-4`} aria-sort={sort === "asc" ? "ascending" : "descending"}>
            <button type="button" onClick={onToggleSort} className="inline-flex items-center gap-1 rounded-control hover:text-ink" title="Change sort order">
              Enquiry
              <Icon name={sort === "asc" ? "chevronUp" : "chevronDown"} className="size-3.5" />
              <span className="sr-only">{sort === "asc" ? ", oldest first" : ", newest first"}</span>
            </button>
          </th>
          <th scope="col" className={`${th} w-[24%]`}>
            Customer
          </th>
          {columns.route && (
            <th scope="col" className={`${th} w-[18%] ${AUTO_HIDE.route}`}>
              Route
            </th>
          )}
          {columns.shipment && (
            <th scope="col" className={`${th} ${AUTO_HIDE.shipment}`}>
              Shipment
            </th>
          )}
          <th scope="col" className={`${th} w-[17%] ${AUTO_HIDE.status}`}>
            Status
          </th>
          {columns.people && (
            <th scope="col" className={`${th} ${AUTO_HIDE.people}`}>
              Sales &amp; agent
            </th>
          )}
          {columns.profit && (
            <th scope="col" className={`${th} text-right ${AUTO_HIDE.profit}`}>
              Profit
            </th>
          )}
          <th scope="col" className={`${th} ${AUTO_HIDE.next}`}>
            Next step
          </th>
          <th scope="col" className={`${th} w-12 pr-3`}>
            <span className="sr-only">More actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <SkeletonRows columns={colCount} />
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={colCount} className="px-4">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r) => {
            const selected = r.id === selectedId;
            const detail = statusDetail(r, today);
            return (
              <tr
                key={r.id}
                aria-current={selected || undefined}
                onClick={(e) => onRowClick(e, r)}
                className={`cursor-pointer transition-colors duration-150 ${selected ? "bg-selected" : "hover:bg-row-hover"}`}
              >
                <td className={`${td} relative pl-4 whitespace-nowrap ${selected ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary" : ""}`}>
                  <Link
                    to={actions.selectLink(r)}
                    replace
                    data-row-link={r.id}
                    onClick={(e) => {
                      // A plain click opens the drawer (moving focus into it); Ctrl/Cmd-click still opens a new tab.
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      actions.onSelect(r);
                    }}
                    className="rounded-control text-control font-semibold tabular-nums text-primary hover:underline"
                  >
                    {r.reference}
                  </Link>
                  <div className="text-meta text-ink-muted tabular-nums">{fmtDateLong(r.enquiry_date)}</div>
                </td>
                <td className={td}>
                  <div className="line-clamp-2 font-semibold text-ink" title={r.customer_name}>
                    {displayName(r.customer_name)}
                  </div>
                  <div className={`text-meta text-ink-heading ${routeFallback}`}>
                    <Route row={r} />
                  </div>
                  <div className="mt-1 @min-[460px]:hidden">
                    <StatusBadge status={r.status} />
                  </div>
                </td>
                {columns.route && (
                  <td className={`${td} text-meta text-ink-heading ${AUTO_HIDE.route}`}>
                    <Route row={r} />
                  </td>
                )}
                {columns.shipment && (
                  <td className={`${td} whitespace-nowrap ${AUTO_HIDE.shipment}`}>
                    <div className="font-medium tabular-nums">{shipmentLabel(r) || <span className="text-ink-muted">Not set</span>}</div>
                    <div className="text-meta text-ink-muted">{r.trade_type ? TRADE_LABELS[r.trade_type] : "No direction"}</div>
                  </td>
                )}
                <td className={`${td} ${AUTO_HIDE.status}`}>
                  <StatusBadge status={r.status} />
                  <div className="mt-0.5">
                    {detail.longWait ? (
                      <span className="inline-flex items-center gap-1 rounded bg-await-bg px-1.5 text-meta font-medium text-await">
                        <Icon name="clock" className="size-3.5" />
                        {detail.text}
                      </span>
                    ) : (
                      <span className="text-meta text-ink-muted">{detail.text}</span>
                    )}
                  </div>
                </td>
                {columns.people && (
                  <td className={`${td} ${AUTO_HIDE.people}`}>
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-table-head text-[0.6875rem] font-semibold text-ink-heading ring-1 ring-line"
                      >
                        {initials(r.sales_person_name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.sales_person_name ? displayName(r.sales_person_name) : <span className="text-ink-muted">Unassigned</span>}</div>
                        <div className="truncate text-meta text-ink-muted">{r.agent_name ? displayName(r.agent_name) : "No agent"}</div>
                      </div>
                    </div>
                  </td>
                )}
                {columns.profit && (
                  <td className={`${td} text-right whitespace-nowrap tabular-nums ${AUTO_HIDE.profit}`}>
                    {r.profit != null ? (
                      <>
                        <div className="font-semibold">{fmtMoney(r.profit)}</div>
                        {r.sell_total != null && <div className="text-meta text-ink-muted">on {fmtMoney(r.sell_total)}</div>}
                      </>
                    ) : (
                      <span className="text-ink-muted" aria-label="No profit yet">
                        —
                      </span>
                    )}
                  </td>
                )}
                <td className={`${td} whitespace-nowrap ${AUTO_HIDE.next}`}>
                  <NextStepButton row={r} selected={selected} canEdit={canEdit} actions={actions} />
                </td>
                <td className={`${td} pr-3 text-right`}>
                  {selected ? (
                    <span className="inline-flex size-8 items-center justify-center text-primary" title="Shown in the details panel">
                      <Icon name="chevronRight" />
                      <span className="sr-only">Selected, details shown</span>
                    </span>
                  ) : (
                    <Menu
                      label={`More actions for ${r.reference}`}
                      trigger={<Icon name="more" />}
                      triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-surface hover:text-ink"
                      items={actions.menuItems(r)}
                    />
                  )}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
