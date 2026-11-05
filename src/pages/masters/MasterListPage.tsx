import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import { controlBase, SelectBox } from "../../components/SelectBox";
import { Alert, Button, Empty } from "../../components/ui";
import { groupDuplicates, pairKey } from "../../lib/customerDuplicates";
import { displayName } from "../../lib/display";
import { errorMessage } from "../../lib/format";
import { nameKey } from "../../lib/normalize";
import type { MasterSummary, NotDuplicatePair } from "../../lib/types";
import { Pagination } from "../register/Pagination";
import { DuplicateGroups } from "./DuplicateGroups";
import type { MasterKind } from "./kinds";
import { MasterTable } from "./MasterTable";
import { MergeDialog } from "./MergeDialog";
import { RenameDialog } from "./RenameDialog";

type Tab = "duplicates" | "all";

/** How alike two names must be to be suggested. "Likely" is tuned on the 2026 register. */
const MATCH_LEVELS = {
  close: { label: "Close matches", min: 0.85 },
  likely: { label: "Likely matches", min: 0.75 },
  broad: { label: "Broad matches", min: 0.65 },
} as const;
type MatchLevel = keyof typeof MATCH_LEVELS;

const SORTS = {
  name: { label: "Name A–Z", compare: (a: MasterSummary, b: MasterSummary) => a.name.localeCompare(b.name) },
  enquiries: { label: "Most enquiries", compare: (a: MasterSummary, b: MasterSummary) => b.enquiries - a.enquiries || a.name.localeCompare(b.name) },
  recent: {
    label: "Latest enquiry",
    compare: (a: MasterSummary, b: MasterSummary) => (b.last_enquiry ?? "").localeCompare(a.last_enquiry ?? "") || a.name.localeCompare(b.name),
  },
} as const;
type SortKey = keyof typeof SORTS;

/** Name or one of its remembered names contains the search text (punctuation-insensitive). */
function matches(c: MasterSummary, q: string): boolean {
  if (!q) return true;
  return (nameKey(c.name) ?? "").includes(q) || c.aliases.some((a) => a.includes(q));
}

/** One master list (customers, agents or port names): possible duplicates and the full list. */
export default function MasterListPage({ kind }: { kind: MasterKind }) {
  const { canEdit, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "all" ? "all" : "duplicates";
  const level: MatchLevel = (params.get("match") as MatchLevel) in MATCH_LEVELS ? (params.get("match") as MatchLevel) : "likely";
  const sort: SortKey = (params.get("sort") as SortKey) in SORTS ? (params.get("sort") as SortKey) : "name";
  const q = params.get("q") ?? "";
  const canRename = kind.renameNeedsAdmin ? isAdmin : canEdit;

  const [search, setSearch] = useState(q);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [merging, setMerging] = useState<MasterSummary[] | null>(null);
  const [renaming, setRenaming] = useState<MasterSummary | null>(null);
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
  };

  // Search as you type, after a pause.
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => update({ q: search.trim() }), 250);
    return () => clearTimeout(t);
  }, [search, q]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const summaries = useQuery({ queryKey: [kind.key, "summary"], queryFn: kind.fetchSummaries });
  const notDuplicates = useQuery({ queryKey: [kind.key, "not-duplicates"], queryFn: kind.fetchNotDuplicates });

  const byId = useMemo(() => new Map((summaries.data ?? []).map((c) => [c.id, c])), [summaries.data]);
  const dismissed = useMemo(() => new Set((notDuplicates.data ?? []).map((p) => pairKey(p.a, p.b))), [notDuplicates.data]);
  const groups = useMemo(() => {
    if (!summaries.data || !notDuplicates.data) return [];
    const list = summaries.data;
    return groupDuplicates(list, kind.findPairs(list, dismissed, MATCH_LEVELS[level].min));
  }, [summaries.data, notDuplicates.data, dismissed, level, kind]);

  const key = nameKey(q) ?? "";
  const shownGroups = useMemo(() => groups.filter((g) => g.members.some((c) => matches(c, key))), [groups, key]);
  const shownRows = useMemo(() => (summaries.data ?? []).filter((c) => matches(c, key)).sort(SORTS[sort].compare), [summaries.data, key, sort]);
  const pageRows = shownRows.slice(page * size, (page + 1) * size);
  const selectedRows = [...selected].map((id) => byId.get(id)).filter((c): c is MasterSummary => !!c);

  const distinct = useMutation({
    mutationFn: (list: MasterSummary[]) => kind.markDistinct(list.map((c) => c.id)),
    onSuccess: (_n, list) => {
      void queryClient.invalidateQueries({ queryKey: [kind.key, "not-duplicates"] });
      setNotice(`${list.map((c) => displayName(c.name)).join(" and ")} marked as different.`);
    },
  });
  const undo = useMutation({
    mutationFn: kind.undoNotDuplicate,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [kind.key, "not-duplicates"] }),
  });

  const loading = summaries.isLoading || notDuplicates.isLoading;
  const loadError = summaries.error ?? notDuplicates.error;
  const tabs: { key: Tab; label: string; count: number | undefined }[] = [
    { key: "duplicates", label: "Possible duplicates", count: loading ? undefined : shownGroups.length },
    { key: "all", label: `All ${kind.nouns}`, count: loading ? undefined : shownRows.length },
  ];
  const clearSearch = () => (setSearch(""), update({ q: "" }));

  return (
    <div className="space-y-3">
      <div className="flex h-12 items-stretch justify-between gap-4 border-b border-line">
        <div role="group" aria-label={`${kind.title} lists`} className="-mb-px flex min-w-0 items-stretch overflow-x-auto">
          {tabs.map((t, i) => {
            const on = t.key === tab;
            return (
              <Fragment key={t.key}>
                {i > 0 && <span aria-hidden="true" className="my-auto h-4 w-px shrink-0 bg-line" />}
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ tab: t.key === "all" ? "all" : "" })}
                  className={`relative flex shrink-0 items-center gap-2 rounded-t-control px-3 text-body transition-colors duration-150 ${
                    on
                      ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                      : "font-medium text-ink-heading hover:text-ink"
                  }`}
                >
                  {t.label}
                  <span
                    className={`min-w-6 rounded-full px-1.5 text-center text-meta font-medium tabular-nums ${
                      on ? "bg-selected text-primary" : "bg-table-head text-ink-muted"
                    }`}
                  >
                    {t.count?.toLocaleString() ?? "–"}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className="hidden shrink-0 items-center text-meta text-ink-muted sm:flex">
          {summaries.data && `${summaries.data.length.toLocaleString()} ${kind.nouns}`}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form role="search" className="relative min-w-56 flex-[1_1_18rem] lg:max-w-md" onSubmit={(e) => (e.preventDefault(), update({ q: search.trim() }))}>
          <label htmlFor="master-search" className="sr-only">
            Search {kind.nouns}
          </label>
          <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-muted" />
          <input
            id="master-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={kind.searchPlaceholder}
            className={`${controlBase} w-full pl-9 pr-3 font-normal placeholder:text-ink-muted [&::-webkit-search-cancel-button]:cursor-pointer`}
          />
        </form>
        {tab === "duplicates" ? (
          <SelectBox label="How alike" value={level} onChange={(v) => update({ match: v === "likely" ? "" : v })} className="w-44">
            {Object.entries(MATCH_LEVELS).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </SelectBox>
        ) : (
          <SelectBox label="Sort by" value={sort} onChange={(v) => update({ sort: v === "name" ? "" : v })} className="w-44">
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </SelectBox>
        )}
        {tab === "all" && isAdmin && selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-meta text-ink-muted" aria-live="polite">
              {selected.size} selected
            </span>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              variant="secondary"
              disabled={selected.size < 2}
              onClick={() => setMerging(selectedRows)}
              title={selected.size < 2 ? `Select at least two ${kind.nouns}` : undefined}
            >
              <Icon name="merge" />
              Merge selected…
            </Button>
          </div>
        )}
      </div>

      {tab === "duplicates" && canEdit && !isAdmin && (
        <Alert kind="info">You can mark names as different. Merging {kind.nouns} is for administrators.</Alert>
      )}
      {loadError && (
        <Alert action={<Button variant="secondary" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: [kind.key] })}>Try again</Button>}>
          Could not load the {kind.nouns}. {errorMessage(loadError)}
        </Alert>
      )}
      {distinct.error && <Alert>Could not mark them as different. {errorMessage(distinct.error)}</Alert>}

      <section className="@container overflow-hidden rounded-panel border border-line bg-surface" aria-busy={loading || summaries.isFetching}>
        {loading ? (
          <div className="space-y-3 p-4" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-control bg-table-head" />
            ))}
          </div>
        ) : tab === "duplicates" ? (
          shownGroups.length ? (
            <div className="relative overflow-x-auto">
              <DuplicateGroups
                kind={kind}
                groups={shownGroups}
                canEdit={canEdit}
                isAdmin={isAdmin}
                distinctPending={distinct.isPending}
                onMerge={setMerging}
                onDistinct={(list) => distinct.mutate(list)}
              />
            </div>
          ) : (
            <Empty action={q && <Button variant="secondary" onClick={clearSearch}>Clear search</Button>}>
              {q ? `No possible duplicates match “${q}”.` : `No possible duplicates. Every ${kind.noun} name is distinct enough.`}
            </Empty>
          )
        ) : shownRows.length ? (
          <>
            <div className="relative overflow-x-auto">
              <MasterTable
                kind={kind}
                rows={pageRows}
                selected={selected}
                canRename={canRename}
                isAdmin={isAdmin}
                onToggle={(id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(id)) next.add(id);
                    return next;
                  })
                }
                onRename={setRenaming}
              />
            </div>
            <Pagination page={page} size={size} total={shownRows.length} onPage={setPage} onSize={(s) => (setSize(s), setPage(0))} />
          </>
        ) : (
          <Empty action={q && <Button variant="secondary" onClick={clearSearch}>Clear search</Button>}>
            {q ? `No ${kind.nouns} match “${q}”.` : `No ${kind.nouns} yet. They are added with enquiries and imports.`}
          </Empty>
        )}
      </section>

      {tab === "duplicates" && !!notDuplicates.data?.length && (
        <NotDuplicateList pairs={notDuplicates.data} byId={byId} canEdit={canEdit} undoing={undo.isPending} onUndo={(p) => undo.mutate(p)} />
      )}

      {merging && (
        <MergeDialog
          kind={kind}
          rows={merging}
          onClose={() => setMerging(null)}
          onMerged={(r) => {
            setMerging(null);
            setSelected(new Set());
            setNotice(
              `Merged ${r.merged + 1} ${kind.nouns} into ${displayName(r.name)}: ${r.enquiries.toLocaleString()} ${r.enquiries === 1 ? "enquiry" : "enquiries"} changed.`,
            );
          }}
        />
      )}
      {renaming && (
        <RenameDialog
          kind={kind}
          row={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(name) => {
            setRenaming(null);
            setNotice(`Renamed to ${displayName(name)}.`);
          }}
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

/** Pairs marked as different, with a way back. Pairs whose names no longer exist (merged since) are left out. */
function NotDuplicateList({
  pairs,
  byId,
  canEdit,
  undoing,
  onUndo,
}: {
  pairs: NotDuplicatePair[];
  byId: Map<string, MasterSummary>;
  canEdit: boolean;
  undoing: boolean;
  onUndo: (pair: NotDuplicatePair) => void;
}) {
  const shown = pairs.filter((p) => byId.has(p.a) && byId.has(p.b));
  if (!shown.length) return null;
  return (
    <details className="rounded-panel border border-line bg-surface">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 text-body font-medium text-ink-heading hover:text-ink">
        <Icon name="chevronRight" className="size-4 transition-transform duration-150 [details[open]_&]:rotate-90" />
        Marked as different ({shown.length})
      </summary>
      <ul className="border-t border-line">
        {shown.map((p) => (
          <li key={pairKey(p.a, p.b)} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 last:border-b-0">
            <span>
              {displayName(byId.get(p.a)?.name)} <span className="text-ink-muted">and</span> {displayName(byId.get(p.b)?.name)}
            </span>
            {canEdit && (
              <Button variant="ghost" size="sm" disabled={undoing} onClick={() => onUndo(p)}>
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
