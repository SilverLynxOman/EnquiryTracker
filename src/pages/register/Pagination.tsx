import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import { PAGE_SIZES, pageItems } from "../../lib/registerView";

export function Pagination({
  page,
  size,
  total,
  onPage,
  onSize,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total ? page * size + 1 : 0;
  const last = Math.min(total, (page + 1) * size);
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-2">
      <div className="flex items-center gap-3 text-meta text-ink-muted">
        <span className="tabular-nums" aria-live="polite">
          Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
        </span>
        <span aria-hidden="true" className="h-4 w-px bg-line" />
        <label className="relative flex items-center">
          <span className="sr-only">Rows per page</span>
          <select
            value={size}
            onChange={(e) => onSize(Number(e.target.value))}
            className="h-9 appearance-none rounded-control border border-control bg-surface pl-2.5 pr-8 text-control font-medium text-ink hover:border-ink-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
          <Icon name="chevronDown" className="pointer-events-none absolute right-2 size-4 text-ink-muted" />
        </label>
      </div>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-1">
          <Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>
            <Icon name="chevronLeft" className="size-3.5" />
            Previous
          </Button>
          {pageItems(page, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap${i}`} className="px-1 text-meta text-ink-muted" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-label={`Page ${p + 1}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
                className={`h-9 min-w-9 rounded-control px-2 text-control font-medium tabular-nums transition-colors duration-150 ${
                  p === page ? "bg-primary text-white" : "text-ink ring-1 ring-inset ring-control hover:bg-row-hover"
                }`}
              >
                {p + 1}
              </button>
            ),
          )}
          <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
            Next
            <Icon name="chevronRight" className="size-3.5" />
          </Button>
        </nav>
      )}
    </div>
  );
}
