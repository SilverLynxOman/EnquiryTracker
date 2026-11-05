import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Icon } from "../components/icons";
import { controlBase, SelectBox } from "../components/SelectBox";
import { Alert, Button, Empty } from "../components/ui";
import {
  closeEnquiriesAsLost,
  fetchFollowUpHistory,
  logFollowUp,
  undoFollowUp,
  countRegister,
  fetchRegisterIds,
  fetchSalesPersons,
  queryFollowUps,
  reopenEnquiries,
  type SortDirection,
} from "../lib/api";
import { displayName } from "../lib/display";
import { errorMessage, todayIso } from "../lib/format";
import { bandFilters, FOLLOW_UP_BANDS, isFollowUpBand, latestFollowUps, STALE_DAYS, type FollowUpBand } from "../lib/followUps";
import type { EnquiryRow } from "../lib/types";
import { FollowUpTable } from "./followups/FollowUpTable";
import { MarkLostDialog } from "./followups/MarkLostDialog";
import { Pagination } from "./register/Pagination";

/** `sp` in the URL: a sales person id, or "all". Without it, a sales user sees their own enquiries first. */
const ALL_PEOPLE = "all";

export default function FollowUpsPage() {
  const { profile, canEdit } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = todayIso();

  const band: FollowUpBand = isFollowUpBand(params.get("band")) ? (params.get("band") as FollowUpBand) : "14-30";
  const sp = params.get("sp") ?? profile?.sales_person_id ?? ALL_PEOPLE;
  const salesPersonId = sp === ALL_PEOPLE ? "" : sp;
  const q = params.get("q") ?? "";
  const sort: SortDirection = params.get("sort") === "asc" ? "asc" : "desc";

  const [search, setSearch] = useState(q);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** Rows the dialog is about to close: the selection, or the one row whose menu was used. */
  const [closing, setClosing] = useState<{ ids: string[]; references: string[] } | null>(null);
  const [closed, setClosed] = useState<{ ids: string[]; reason: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const update = (changes: Record<string, string>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
    setPage(0);
    setSelected(new Set());
  };

  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => update({ q: search.trim() }), 300);
    return () => clearTimeout(t);
  }, [search, q]);

  const filters = bandFilters(band, today, { salesPersonId, q });
  const people = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000 });
  const list = useQuery({
    queryKey: ["follow-ups", "list", filters, page, size, sort],
    queryFn: () => queryFollowUps(filters, page, size, sort),
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({
    queryKey: ["follow-ups", "counts", today, salesPersonId, q],
    queryFn: async () => {
      const values = await Promise.all(FOLLOW_UP_BANDS.map((b) => countRegister(bandFilters(b.key, today, { salesPersonId, q }))));
      return Object.fromEntries(FOLLOW_UP_BANDS.map((b, i) => [b.key, values[i]])) as Record<FollowUpBand, number>;
    },
    placeholderData: keepPreviousData,
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.count ?? 0;
  const references = useMemo(() => new Map(rows.map((r) => [r.id, r.reference])), [rows]);

  // Follow-ups logged on these rows (shared with The Window), and logging one as the signed-in sales person.
  const mySalesPersonId = profile?.sales_person_id ?? null;
  const rowIds = rows.map((r) => r.id);
  const history = useQuery({
    queryKey: ["follow-ups", "log", rowIds],
    queryFn: () => fetchFollowUpHistory(rowIds),
    enabled: rowIds.length > 0,
    placeholderData: keepPreviousData,
  });
  const lastFollowUp = useMemo(() => latestFollowUps(history.data ?? []), [history.data]);
  const mineToday = useMemo(
    () => new Set((history.data ?? []).filter((h) => h.sales_person_id === mySalesPersonId && h.followed_up_on === today).map((h) => h.enquiry_id)),
    [history.data, mySalesPersonId, today],
  );
  const names = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, displayName(p.name)])), [people.data]);
  const chase = useMutation({
    mutationFn: ({ row, done }: { row: EnquiryRow; done: boolean }) =>
      (done ? logFollowUp : undoFollowUp)(row.id, mySalesPersonId as string, today),
    onSuccess: (_v, { row, done }) => {
      setNotice(done ? `${row.reference}: follow-up logged for today.` : `${row.reference}: today's follow-up removed.`);
      void queryClient.invalidateQueries({ queryKey: ["follow-ups", "log"] });
      void queryClient.invalidateQueries({ queryKey: ["window"] });
    },
  });

  const selectAll = useMutation({
    mutationFn: () => fetchRegisterIds(filters),
    onSuccess: (ids) => setSelected(new Set(ids)),
  });

  const markLost = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) => closeEnquiriesAsLost(ids, reason),
    onSuccess: (ids, { reason }) => {
      setClosing(null);
      setSelected(new Set());
      setClosed({ ids, reason: reason.trim() });
      void queryClient.invalidateQueries();
    },
  });

  const undo = useMutation({
    mutationFn: (ids: string[]) => reopenEnquiries(ids),
    onSuccess: (n) => {
      setClosed(null);
      setNotice(`${n.toLocaleString()} ${n === 1 ? "enquiry" : "enquiries"} reopened.`);
      void queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const togglePage = (select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (select) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  const openDialog = (ids: string[]) => {
    markLost.reset();
    setClosing({ ids, references: ids.map((id) => references.get(id)).filter((r): r is string => !!r) });
  };

  const personName = people.data?.find((p) => p.id === salesPersonId)?.name;
  const quoted = band !== "unquoted";
  const current = FOLLOW_UP_BANDS.find((b) => b.key === band)!;
  const error = list.error ?? counts.error ?? selectAll.error ?? undo.error ?? history.error ?? chase.error;

  return (
    <div className="space-y-3">
      <div className="flex h-12 items-stretch justify-between gap-4 border-b border-line">
        <div role="group" aria-label="How long they have waited" className="-mb-px flex min-w-0 items-stretch overflow-x-auto">
          {FOLLOW_UP_BANDS.map((b, i) => {
            const on = b.key === band;
            return (
              <Fragment key={b.key}>
                {i > 0 && <span aria-hidden="true" className="my-auto h-4 w-px shrink-0 bg-line" />}
                <button
                  type="button"
                  aria-pressed={on}
                  title={b.description}
                  onClick={() => update({ band: b.key === "14-30" ? "" : b.key })}
                  className={`relative flex shrink-0 items-center gap-2 rounded-t-control px-3 text-body transition-colors duration-150 ${
                    on
                      ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                      : "font-medium text-ink-heading hover:text-ink"
                  }`}
                >
                  {b.label}
                  <span
                    className={`min-w-6 rounded-full px-1.5 text-center text-meta font-medium tabular-nums ${
                      on ? "bg-selected text-primary" : "bg-table-head text-ink-muted"
                    }`}
                  >
                    {counts.data?.[b.key]?.toLocaleString() ?? "–"}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-meta text-ink-muted lg:flex">
          {(list.isFetching || counts.isFetching) && (
            <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
          )}
          Open for {STALE_DAYS} days or more
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form role="search" className="relative min-w-56 flex-[1_1_18rem] lg:max-w-md" onSubmit={(e) => (e.preventDefault(), update({ q: search.trim() }))}>
          <label htmlFor="follow-up-search" className="sr-only">
            Search follow-ups
          </label>
          <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-muted" />
          <input
            id="follow-up-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, customer, port or agent"
            className={`${controlBase} w-full pl-9 pr-3 font-normal placeholder:text-ink-muted [&::-webkit-search-cancel-button]:cursor-pointer`}
          />
        </form>
        <SelectBox label="Sales person" icon="user" value={sp} onChange={(v) => update({ sp: v })} className="w-52">
          <option value={ALL_PEOPLE}>All sales persons</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {displayName(p.name)}
            </option>
          ))}
        </SelectBox>

        {canEdit && selected.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-meta text-ink-muted" aria-live="polite">
              {selected.size.toLocaleString()} selected
            </span>
            {selected.size < total && (
              <Button variant="ghost" onClick={() => selectAll.mutate()} loading={selectAll.isPending}>
                Select all {total.toLocaleString()}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button variant="secondary" onClick={() => openDialog([...selected])}>
              <Icon name="close" />
              Mark lost…
            </Button>
          </div>
        )}
      </div>

      {closed && (
        <Alert
          kind="success"
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => undo.mutate(closed.ids)} loading={undo.isPending}>
                Undo
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setClosed(null)}>
                Dismiss
              </Button>
            </div>
          }
        >
          {closed.ids.length.toLocaleString()} {closed.ids.length === 1 ? "enquiry" : "enquiries"} marked as lost: “{closed.reason}”.
        </Alert>
      )}
      {error && (
        <Alert action={<Button variant="secondary" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: ["follow-ups"] })}>Try again</Button>}>
          {errorMessage(error)}
        </Alert>
      )}

      <section className="@container overflow-hidden rounded-panel border border-line bg-surface" aria-busy={list.isFetching}>
        {/* relative: screen-reader-only text inside the table is positioned here, so it scrolls with the table. */}
        <div className="relative overflow-x-auto">
          <FollowUpTable
            rows={rows}
            loading={list.isLoading || list.isPlaceholderData}
            today={today}
            canEdit={canEdit}
            quoted={quoted}
            selected={selected}
            sort={sort}
            onToggleSort={() => update({ sort: sort === "asc" ? "" : "asc" })}
            onToggle={toggle}
            onTogglePage={togglePage}
            onConfirm={(r: EnquiryRow) => navigate(`/enquiries/${r.id}?confirm=1`)}
            onMarkLost={(r: EnquiryRow) => openDialog([r.id])}
            lastFollowUp={lastFollowUp}
            mineToday={mineToday}
            personName={(id) => names.get(id) ?? "a colleague"}
            canLogFollowUp={!!mySalesPersonId}
            followUpSaving={chase.isPending ? (chase.variables?.row.id ?? null) : null}
            onToggleFollowUp={(row, done) => chase.mutate({ row, done })}
            empty={
              <Empty
                action={
                  salesPersonId || q ? (
                    <Button variant="secondary" onClick={() => (setSearch(""), update({ sp: ALL_PEOPLE, q: "" }))}>
                      Show all sales persons
                    </Button>
                  ) : undefined
                }
              >
                {`Nothing in “${current.label}”`}
                {personName ? ` for ${displayName(personName)}` : ""}
                {q ? ` matching “${q}”` : ""}.
              </Empty>
            }
          />
        </div>
        {total > 0 && <Pagination page={page} size={size} total={total} onPage={setPage} onSize={(s) => (setSize(s), setPage(0))} />}
      </section>

      {closing && (
        <MarkLostDialog
          count={closing.ids.length}
          references={closing.references}
          saving={markLost.isPending}
          error={markLost.error}
          onClose={() => setClosing(null)}
          onConfirm={(reason) => markLost.mutate({ ids: closing.ids, reason })}
        />
      )}

      {notice && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-control bg-ink px-4 py-2.5 text-body font-medium text-white shadow-[0_8px_24px_rgba(25,36,59,0.25)]"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
