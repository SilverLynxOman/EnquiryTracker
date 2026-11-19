import { Fragment } from "react";
import { STATUS_META } from "../../components/ui";
import type { StatusCounts } from "../../lib/api";
import type { Status } from "../../lib/types";

const TABS: { key: Status | ""; label: string }[] = [
  { key: "", label: "All enquiries" },
  { key: "new", label: STATUS_META.new.label },
  { key: "quoted", label: STATUS_META.quoted.label },
  { key: "confirmed", label: STATUS_META.confirmed.label },
  { key: "lost", label: STATUS_META.lost.label },
  { key: "cancelled", label: STATUS_META.cancelled.label },
  { key: "not_genuine", label: STATUS_META.not_genuine.label },
];

/** Status filter as compact text tabs with live counts (under the other filters). */
export function StatusTabs({
  active,
  counts,
  shown,
  refreshing,
  onChange,
}: {
  active: Status | "";
  counts: StatusCounts | undefined;
  /** Enquiries in the current view (all tabs' filters plus the status). */
  shown: number | undefined;
  refreshing: boolean;
  onChange: (status: Status | "") => void;
}) {
  return (
    <div className="flex h-12 items-stretch justify-between gap-4 border-b border-line">
      <div role="group" aria-label="Filter by status" className="-mb-px flex min-w-0 items-stretch overflow-x-auto">
        {TABS.map((t, i) => {
          const on = t.key === active;
          const count = counts?.[t.key || "all"];
          return (
            <Fragment key={t.key || "all"}>
              {i > 0 && <span aria-hidden="true" className="my-auto h-4 w-px shrink-0 bg-line" />}
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(t.key)}
                className={`relative flex shrink-0 items-center gap-2 rounded-t-control px-3 text-body transition-colors duration-150 ${
                  on
                    ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                    : "font-medium text-ink-heading hover:text-ink"
                }`}
              >
                {t.key && <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_META[t.key].dot}`} />}
                {t.label}
                <span
                  className={`min-w-6 rounded-full px-1.5 text-center text-meta font-medium tabular-nums ${
                    on ? "bg-selected text-primary" : "bg-table-head text-ink-muted"
                  }`}
                >
                  {count ?? "–"}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
      <div className="hidden shrink-0 items-center gap-2 text-meta text-ink-muted sm:flex" aria-live="polite">
        {refreshing && <span className="size-3 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />}
        {shown !== undefined && (
          <span className="tabular-nums">
            {shown.toLocaleString()} enquir{shown === 1 ? "y" : "ies"}
          </span>
        )}
      </div>
    </div>
  );
}
