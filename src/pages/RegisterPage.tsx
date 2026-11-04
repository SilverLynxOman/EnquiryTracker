import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import type { MenuItem } from "../components/Menu";
import { Alert, Button, buttonClass, Empty } from "../components/ui";
import { fetchEnquiry, fetchSalesPersons, fetchStatusCounts, markQuoted, queryRegister } from "../lib/api";
import { errorMessage, todayIso } from "../lib/format";
import { DEFAULT_VIEW, OPTIONAL_COLUMNS, readRegisterView, viewFilters, writeRegisterView, type ColumnPrefs, type OptionalColumn, type RegisterView } from "../lib/registerView";
import type { EnquiryRow } from "../lib/types";
import { EnquiryDrawer } from "./register/EnquiryDrawer";
import { Pagination } from "./register/Pagination";
import { RegisterTable } from "./register/RegisterTable";
import { RegisterToolbar } from "./register/RegisterToolbar";
import { StatusTabs } from "./register/StatusTabs";

const COLUMN_PREFS_KEY = "register.columns";
const ALL_COLUMNS = Object.fromEntries(OPTIONAL_COLUMNS.map((c) => [c.key, true])) as ColumnPrefs;

/** Which optional columns this viewer chose to see; kept in this browser only. */
function useColumnPrefs(): [ColumnPrefs, (key: OptionalColumn) => void] {
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => {
    try {
      return { ...ALL_COLUMNS, ...JSON.parse(localStorage.getItem(COLUMN_PREFS_KEY) ?? "{}") };
    } catch {
      return ALL_COLUMNS;
    }
  });
  const toggle = (key: OptionalColumn) =>
    setPrefs((p) => {
      const next = { ...p, [key]: !p[key] };
      try {
        localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable (private window): the choice lasts until reload.
      }
      return next;
    });
  return [prefs, toggle];
}

export default function RegisterPage() {
  const [params, setParams] = useSearchParams();
  const view = readRegisterView(params);
  const today = todayIso();
  const filters = viewFilters(view, today);
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [columns, toggleColumn] = useColumnPrefs();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusDrawer = useRef(false);

  const update = useCallback(
    (patch: Partial<RegisterView>) => setParams(writeRegisterView({ ...readRegisterView(params), ...patch }), { replace: true }),
    [params, setParams],
  );

  const salesPersons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const register = useQuery({
    queryKey: ["register", "page", filters, view.page, view.size, view.sort],
    queryFn: () => queryRegister(filters, view.page, view.size, view.sort),
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({
    queryKey: ["register", "counts", { ...filters, status: "" }],
    queryFn: () => fetchStatusCounts(filters),
    placeholderData: keepPreviousData,
  });

  const rows = register.data?.rows ?? [];
  const total = register.data?.count ?? 0;
  const inPage = rows.find((r) => r.id === view.selected);
  const selectedQuery = useQuery({
    queryKey: ["enquiry", view.selected],
    queryFn: () => fetchEnquiry(view.selected),
    enabled: !!view.selected && !inPage && !register.isLoading,
  });
  const drawerRow = inPage ?? selectedQuery.data;

  // A page past the end (rows deleted, or a stale link) falls back to the last page.
  useEffect(() => {
    const pages = Math.max(1, Math.ceil(total / view.size));
    if (register.isSuccess && !register.isPlaceholderData && view.page >= pages) update({ page: pages - 1 });
  }, [register.isSuccess, register.isPlaceholderData, total, view.page, view.size, update]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const select = (row: EnquiryRow) => {
    focusDrawer.current = true;
    update({ selected: row.id });
  };
  const closeDrawer = useCallback(() => {
    const id = view.selected;
    update({ selected: "" });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row-link="${CSS.escape(id)}"]`)?.focus());
  }, [view.selected, update]);

  // Move focus into the drawer when the user opens it, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (view.selected && drawerRow && focusDrawer.current) {
      focusDrawer.current = false;
      headingRef.current?.focus();
    }
  }, [view.selected, drawerRow]);

  useEffect(() => {
    if (!view.selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="menu"]')) closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view.selected, closeDrawer]);

  const quote = useMutation({
    mutationFn: (row: EnquiryRow) => markQuoted(row.id, today),
    onMutate: () => setActionError(null),
    onSuccess: (_, row) => {
      for (const key of ["register", "dashboard", "reports", "enquiry"]) queryClient.invalidateQueries({ queryKey: [key] });
      setNotice(`${row.reference} marked as quoted today.`);
    },
    onError: (e, row) => setActionError(`${row.reference} could not be marked as quoted. ${errorMessage(e)}`),
  });

  const confirm = (row: EnquiryRow) => navigate(`/enquiries/${row.id}?confirm=1`);

  async function copyReference(row: EnquiryRow) {
    try {
      await navigator.clipboard.writeText(row.reference);
      setNotice(`${row.reference} copied.`);
    } catch {
      setActionError("The reference could not be copied. Select it and copy it instead.");
    }
  }

  const menuItems = (row: EnquiryRow): MenuItem[] => {
    const items: MenuItem[] = [];
    if (row.id !== view.selected) items.push({ label: "View details", icon: "chevronRight", onSelect: () => select(row) });
    items.push({ label: canEdit ? "Edit enquiry" : "Open full record", icon: canEdit ? "edit" : "external", onSelect: () => navigate(`/enquiries/${row.id}`) });
    if (canEdit && row.status === "new") items.push({ label: "Confirm job…", icon: "check", onSelect: () => confirm(row) });
    items.push({ label: "Copy reference", icon: "copy", onSelect: () => void copyReference(row) });
    return items;
  };

  const selectLink = (row: EnquiryRow) => `?${writeRegisterView({ ...view, selected: row.id }).toString()}`;

  const isFiltered = view.q || view.salesPersonId || view.mode || view.status || view.period !== DEFAULT_VIEW.period || view.basis !== DEFAULT_VIEW.basis;
  const empty = (
    <Empty
      action={
        isFiltered ? (
          <Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear all filters
          </Button>
        ) : canEdit ? (
          <div className="flex gap-2">
            <Link to="/enquiries/new" className={buttonClass("primary")}>
              New enquiry
            </Link>
            <Link to="/import" className={buttonClass("secondary")}>
              Import Excel
            </Link>
          </div>
        ) : undefined
      }
    >
      {isFiltered ? "No enquiries match these filters." : "No enquiries yet. Add one, or import the Excel register."}
    </Empty>
  );

  return (
    <div className="space-y-3">
      <StatusTabs
        active={view.status}
        counts={counts.data}
        shown={register.data ? total : undefined}
        refreshing={register.isFetching || counts.isFetching}
        onChange={(status) => update({ status, page: 0 })}
      />
      <RegisterToolbar view={view} update={update} salesPersons={salesPersons.data ?? []} columns={columns} onToggleColumn={toggleColumn} />

      {actionError && (
        <Alert action={<Button variant="ghost" size="sm" onClick={() => setActionError(null)}>Dismiss</Button>}>{actionError}</Alert>
      )}
      {(register.error || counts.error) && (
        <Alert
          action={
            <Button variant="secondary" size="sm" onClick={() => void Promise.all([register.refetch(), counts.refetch()])}>
              Try again
            </Button>
          }
        >
          The register could not be loaded. {errorMessage(register.error ?? counts.error)}
        </Alert>
      )}

      <div className="flex items-start gap-4">
        <section aria-label="Enquiries" className="@container min-w-0 flex-1 overflow-hidden rounded-panel border border-line bg-surface">
          <div
            className={`max-h-[max(20rem,calc(100dvh-15.5rem))] overflow-auto transition-opacity duration-150 ${register.isPlaceholderData ? "opacity-60" : ""}`}
            aria-busy={register.isFetching}
          >
            <RegisterTable
              rows={rows}
              loading={register.isLoading}
              selectedId={view.selected}
              canEdit={canEdit}
              today={today}
              columns={columns}
              sort={view.sort}
              onToggleSort={() => update({ sort: view.sort === "asc" ? "desc" : "asc", page: 0 })}
              empty={empty}
              actions={{
                onSelect: select,
                onMarkQuoted: (row) => quote.mutate(row),
                onConfirm: confirm,
                menuItems,
                quotingId: quote.isPending ? (quote.variables?.id ?? null) : null,
                selectLink,
              }}
            />
          </div>
          <Pagination
            page={view.page}
            size={view.size}
            total={total}
            onPage={(page) => update({ page })}
            onSize={(size) => update({ size, page: 0 })}
          />
        </section>

        {view.selected && (
          <EnquiryDrawer
            row={drawerRow}
            loading={!drawerRow && (selectedQuery.isLoading || register.isLoading)}
            error={!drawerRow ? selectedQuery.error : null}
            canEdit={canEdit}
            today={today}
            quoting={quote.isPending && quote.variables?.id === drawerRow?.id}
            headingRef={headingRef}
            menuItems={menuItems}
            onClose={closeDrawer}
            onMarkQuoted={(row) => quote.mutate(row)}
            onConfirm={confirm}
          />
        )}
      </div>

      {notice && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-control bg-ink px-4 py-2.5 text-body font-medium text-white shadow-[0_8px_24px_rgba(25,36,59,0.25)]"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
