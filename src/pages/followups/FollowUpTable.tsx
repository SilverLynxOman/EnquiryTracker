import { useEffect, useRef, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { Button } from "../../components/ui";
import { displayName, fmtDateLong, shortPort } from "../../lib/display";
import { fmtMoney } from "../../lib/format";
import { chasedLabel, waitingDays } from "../../lib/followUps";
import type { EnquiryRow, FollowUpRecord } from "../../lib/types";

const th = "sticky top-0 z-10 h-10 border-b border-line bg-table-head px-3 text-left text-meta font-medium whitespace-nowrap text-ink-heading";
const td = "border-b border-line px-3 py-2 align-middle";

/** Open enquiries that have waited too long, with a tick box per row for closing several at once. */
export function FollowUpTable({
  rows,
  loading,
  today,
  canEdit,
  quoted,
  selected,
  sort,
  onToggleSort,
  onToggle,
  onTogglePage,
  onConfirm,
  onMarkLost,
  lastFollowUp,
  mineToday,
  personName,
  canLogFollowUp,
  followUpSaving,
  onToggleFollowUp,
  empty,
}: {
  rows: EnquiryRow[];
  loading: boolean;
  today: string;
  canEdit: boolean;
  /** The band lists quotes (false: enquiries never quoted). */
  quoted: boolean;
  selected: ReadonlySet<string>;
  sort: "asc" | "desc";
  onToggleSort: () => void;
  onToggle: (id: string) => void;
  onTogglePage: (select: boolean) => void;
  onConfirm: (row: EnquiryRow) => void;
  onMarkLost: (row: EnquiryRow) => void;
  /** Latest follow-up logged on each row's enquiry, by anyone (follow_ups, shared with The Window). */
  lastFollowUp: ReadonlyMap<string, FollowUpRecord>;
  /** Enquiries the signed-in sales person has already chased today. */
  mineToday: ReadonlySet<string>;
  personName: (salesPersonId: string) => string;
  /** The signed-in user is a sales person, so can log follow-ups (only on quotes). */
  canLogFollowUp: boolean;
  /** Enquiry whose follow-up is being saved. */
  followUpSaving: string | null;
  onToggleFollowUp: (row: EnquiryRow, done: boolean) => void;
  empty: ReactNode;
}) {
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));
  const headBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headBox.current) headBox.current.indeterminate = someOnPage && !allOnPage;
  }, [someOnPage, allOnPage]);

  const navigate = useNavigate();
  const chasing = canLogFollowUp && quoted;
  const menu = (r: EnquiryRow): MenuItem[] => [
    ...(chasing
      ? [
          mineToday.has(r.id)
            ? { label: "Undo today's follow-up", icon: "refresh" as const, onSelect: () => onToggleFollowUp(r, false) }
            : { label: "Followed up today", icon: "send" as const, onSelect: () => onToggleFollowUp(r, true) },
        ]
      : []),
    ...(canEdit && quoted ? [{ label: "Confirm job…", icon: "check" as const, onSelect: () => onConfirm(r) }] : []),
    ...(canEdit ? [{ label: "Mark lost…", icon: "close" as const, onSelect: () => onMarkLost(r) }] : []),
    {
      label: canEdit ? "Edit enquiry" : "Open full record",
      icon: canEdit ? ("edit" as const) : ("external" as const),
      onSelect: () => navigate(`/enquiries/${r.id}`),
    },
  ];
  const colCount = canEdit ? 7 : 6;
  const dateWord = quoted ? "Quoted" : "Received";

  return (
    <table className="w-full border-separate border-spacing-0 text-body">
      <caption className="sr-only">
        {quoted ? "Quotes waiting for the customer" : "Enquiries waiting for a quote"}
        {canEdit && ". Tick rows to mark them as lost together."}
      </caption>
      <thead>
        <tr>
          {canEdit && (
            <th scope="col" className={`${th} w-10 pl-4`}>
              <input
                ref={headBox}
                type="checkbox"
                className="size-4 align-middle accent-primary"
                aria-label="Select all on this page"
                checked={allOnPage}
                disabled={!rows.length}
                onChange={(e) => onTogglePage(e.target.checked)}
              />
            </th>
          )}
          <th scope="col" className={`${th} ${canEdit ? "" : "pl-4"}`} aria-sort={sort === "asc" ? "ascending" : "descending"}>
            <button type="button" onClick={onToggleSort} className="inline-flex items-center gap-1 rounded-control hover:text-ink" title="Change sort order">
              Enquiry
              <Icon name={sort === "asc" ? "chevronUp" : "chevronDown"} className="size-3.5" />
              <span className="sr-only">{sort === "asc" ? ", longest waiting first" : ", most recent first"}</span>
            </button>
          </th>
          <th scope="col" className={`${th} w-[28%]`}>
            Customer
          </th>
          <th scope="col" className={`${th} hidden @min-[720px]:table-cell`}>
            Sales person
          </th>
          <th scope="col" className={`${th} hidden text-right @min-[600px]:table-cell`}>
            Quote
          </th>
          <th scope="col" className={`${th} text-right`}>
            Waiting
          </th>
          <th scope="col" className={`${th} w-12 pr-3`}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className={loading && rows.length ? "opacity-60" : ""}>
        {loading && !rows.length ? (
          Array.from({ length: 8 }, (_, i) => (
            <tr key={i} aria-hidden="true">
              <td colSpan={colCount} className={td}>
                <div className="h-9 animate-pulse rounded-control bg-table-head" />
              </td>
            </tr>
          ))
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={colCount} className={td}>
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r) => {
            const on = selected.has(r.id);
            const name = displayName(r.customer_name);
            const days = waitingDays(r, today);
            const last = lastFollowUp.get(r.id);
            const chasedToday = mineToday.has(r.id);
            return (
              <tr key={r.id} className={on ? "bg-selected" : "hover:bg-row-hover"}>
                {canEdit && (
                  <td className={`${td} pl-4`}>
                    <input
                      type="checkbox"
                      className="size-4 align-middle accent-primary"
                      aria-label={`Select ${r.reference}`}
                      checked={on}
                      onChange={() => onToggle(r.id)}
                    />
                  </td>
                )}
                <td className={`${td} ${canEdit ? "" : "pl-4"} whitespace-nowrap`}>
                  <Link to={`/enquiries/${r.id}`} className="text-control font-semibold tabular-nums text-primary hover:underline">
                    {r.reference}
                  </Link>
                  <div className="text-meta tabular-nums text-ink-muted">
                    {dateWord} {fmtDateLong(r.quoted_date ?? r.enquiry_date)}
                  </div>
                </td>
                <td className={td}>
                  <div className="font-semibold" title={r.customer_name}>
                    {name}
                  </div>
                  {(r.pol || r.pod) && (
                    <div className="text-meta text-ink-muted">
                      {shortPort(r.pol) || "?"} → {shortPort(r.pod) || "?"}
                    </div>
                  )}
                </td>
                <td className={`${td} hidden text-meta text-ink-muted @min-[720px]:table-cell`}>{displayName(r.sales_person_name) || "—"}</td>
                <td className={`${td} hidden text-right tabular-nums @min-[600px]:table-cell`}>
                  {r.sell_total != null ? fmtMoney(r.sell_total) : <span className="text-meta text-ink-muted">No amount</span>}
                </td>
                <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                  {days} {days === 1 ? "day" : "days"}
                  {last && (
                    <div className="text-meta text-ink-muted" title={`Logged by ${personName(last.sales_person_id)}`}>
                      {chasedLabel(last.followed_up_on, today)}
                      <span className="sr-only"> by {personName(last.sales_person_id)}</span>
                    </div>
                  )}
                </td>
                <td className={`${td} pr-3`}>
                  <div className="flex items-center justify-end gap-1">
                    {/* One next step per row: chasing for sales persons, confirming for everyone else who edits.
                        Wrapped: the button's own inline-flex would beat `hidden`. Narrower tables use the menu. */}
                    {chasing ? (
                      <span className="hidden @min-[860px]:inline-flex">
                        <Button
                          variant={chasedToday ? "ghost" : "secondary"}
                          size="sm"
                          aria-pressed={chasedToday}
                          loading={followUpSaving === r.id}
                          onClick={() => onToggleFollowUp(r, !chasedToday)}
                          title={chasedToday ? "Logged for today. Click to undo." : "Log that you followed up on this quote today"}
                        >
                          {chasedToday && followUpSaving !== r.id && <Icon name="check" className="size-3.5 text-confirmed" />}
                          {chasedToday ? "Chased today" : "Followed up"}
                          <span className="sr-only"> {r.reference}</span>
                        </Button>
                      </span>
                    ) : (
                      canEdit &&
                      quoted && (
                        <span className="hidden @min-[860px]:inline-flex">
                          <Button variant="secondary" size="sm" onClick={() => onConfirm(r)}>
                            Confirm job
                            <span className="sr-only"> {r.reference}</span>
                          </Button>
                        </span>
                      )
                    )}
                    <Menu
                      label={`More actions for ${r.reference}`}
                      trigger={<Icon name="more" />}
                      triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-surface hover:text-ink"
                      items={menu(r)}
                    />
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
