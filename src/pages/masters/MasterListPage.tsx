import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/icons";
import { controlBase } from "../../components/SelectBox";
import { Alert, Button, Empty } from "../../components/ui";
import { fetchMasterActivity } from "../../lib/api";
import { groupDuplicates, pairKey } from "../../lib/customerDuplicates";
import { displayName } from "../../lib/display";
import { errorMessage, todayIso } from "../../lib/format";
import { groupActivity, lifecycle, monthlyCounts, ranked, winRate } from "../../lib/masterActivity";
import { nameKey } from "../../lib/normalize";
import type { MasterSummary } from "../../lib/types";
import { Pagination } from "../register/Pagination";
import type { MasterKind } from "./kinds";
import { MasterDrawer } from "./MasterDrawer";
import { MasterTable, type SortKey } from "./MasterTable";
import { MergeDialog } from "./MergeDialog";
import { RenameDialog } from "./RenameDialog";
import { MATCH_LEVELS, ReviewQueue, type MatchLevel } from "./ReviewQueue";
import type { MasterRow } from "./shared";

const FILTERS = {
  all: "All",
  active: "Active",
  dormant: "Dormant",
  new: "New this month",
  former: "Has former names",
  duplicates: "Possible duplicates",
} as const;
type Filter = keyof typeof FILTERS;

const SORT_KEYS: SortKey[] = ["name", "enquiries", "rate", "last"];

function keep(r: MasterRow, f: Filter): boolean {
  switch (f) {
    case "active":
      return r.life === "active" || r.life === "new";
    case "dormant":
      return r.life === "dormant";
    case "new":
      return r.life === "new";
    case "former":
      return r.aliases.length > 0;
    case "duplicates":
      return r.duplicate;
    default:
      return true;
  }
}

function compare(key: SortKey): (a: MasterRow, b: MasterRow) => number {
  const byName = (a: MasterRow, b: MasterRow) => a.name.localeCompare(b.name);
  switch (key) {
    case "enquiries":
      return (a, b) => a.enquiries - b.enquiries || byName(a, b);
    case "rate":
      return (a, b) => (winRate(a) ?? -1) - (winRate(b) ?? -1) || a.enquiries - b.enquiries || byName(a, b);
    case "last":
      return (a, b) => (a.last_enquiry ?? "").localeCompare(b.last_enquiry ?? "") || byName(a, b);
    default:
      return byName;
  }
}

/** Name or one of its remembered names contains the search text (punctuation-insensitive). */
function matches(c: MasterSummary, q: string): boolean {
  if (!q) return true;
  return (nameKey(c.name) ?? "").includes(q) || c.aliases.some((a) => a.includes(q));
}

/**
 * One master list (customers, agents or port names). The list is the page: tiles and chips filter it, a row opens its
 * details, and possible duplicates are reviewed one group at a time from a banner that shows only while some wait.
 */
export default function MasterListPage({ kind }: { kind: MasterKind }) {
  const { canEdit, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const reviewing = params.get("view") === "review";
  const filter: Filter = (params.get("f") as Filter) in FILTERS ? (params.get("f") as Filter) : "all";
  const level: MatchLevel = (params.get("match") as MatchLevel) in MATCH_LEVELS ? (params.get("match") as MatchLevel) : "likely";
  const sort: SortKey = SORT_KEYS.includes(params.get("sort") as SortKey) ? (params.get("sort") as SortKey) : "enquiries";
  const dir = params.get("dir") === "asc" || (params.get("dir") !== "desc" && sort === "name") ? "asc" : "desc";
  const openId = params.get("id");
  const q = params.get("q") ?? "";
  const canRename = kind.renameNeedsAdmin ? isAdmin : canEdit;

  const [search, setSearch] = useState(q);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [merging, setMerging] = useState<MasterSummary[] | null>(null);
  const [renaming, setRenaming] = useState<MasterSummary | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);

  const update = useCallback(
    (changes: Record<string, string>) => {
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
      if (!("id" in changes && Object.keys(changes).length === 1)) setPage(0);
    },
    [setParams],
  );

  // Search as you type, after a pause.
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => update({ q: search.trim() }), 250);
    return () => clearTimeout(t);
  }, [search, q, update]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const summaries = useQuery({ queryKey: [kind.key, "summary"], queryFn: kind.fetchSummaries });
  const notDuplicates = useQuery({ queryKey: [kind.key, "not-duplicates"], queryFn: kind.fetchNotDuplicates });
  // Shared by the three lists: one light fetch of every enquiry for trends, lanes and recent enquiries.
  const activity = useQuery({ queryKey: ["masters", "activity"], queryFn: fetchMasterActivity, staleTime: 60_000 });

  const byMaster = useMemo(() => (activity.data ? groupActivity(kind.key, activity.data) : undefined), [activity.data, kind.key]);
  const dismissed = useMemo(() => new Set((notDuplicates.data ?? []).map((p) => pairKey(p.a, p.b))), [notDuplicates.data]);
  const groups = useMemo(() => {
    if (!summaries.data || !notDuplicates.data) return [];
    return groupDuplicates(summaries.data, kind.findPairs(summaries.data, dismissed, MATCH_LEVELS[level].min));
  }, [summaries.data, notDuplicates.data, dismissed, level, kind]);
  const duplicateIds = useMemo(() => new Set(groups.flatMap((g) => g.members.map((m) => m.id))), [groups]);

  const rows: MasterRow[] = useMemo(
    () =>
      (summaries.data ?? []).map((s) => {
        const list = byMaster?.get(s.id);
        const first = list?.length ? list[list.length - 1].enquiry_date : null;
        return {
          ...s,
          first_enquiry: first,
          monthly: byMaster ? monthlyCounts(list ?? [], today).map((m) => m.enquiries) : [],
          top_sales: list ? (ranked(list.map((r) => r.sales_person))[0]?.value ?? null) : null,
          // Until the activity is in, "new" cannot be told apart from "active".
          life: lifecycle(first ?? (byMaster ? null : "0000-01-01"), s.last_enquiry, today),
          duplicate: duplicateIds.has(s.id),
        };
      }),
    [summaries.data, byMaster, duplicateIds, today],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const rowGroups = useMemo(() => groups.map((g) => ({ ...g, members: g.members.map((m) => byId.get(m.id) ?? (m as MasterRow)) })), [groups, byId]);

  const key = nameKey(q) ?? "";
  const searched = useMemo(() => rows.filter((r) => matches(r, key)), [rows, key]);
  const shown = useMemo(() => {
    const c = compare(sort);
    return searched.filter((r) => keep(r, filter)).sort((a, b) => (dir === "asc" ? c(a, b) : c(b, a)));
  }, [searched, filter, sort, dir]);
  const pageRows = shown.slice(page * size, (page + 1) * size);
  const selectedRows = [...selected].map((id) => byId.get(id)).filter((c): c is MasterRow => !!c);
  const openRow = openId ? byId.get(openId) : undefined;

  const counts = useMemo(() => {
    const n = (f: Filter) => rows.filter((r) => keep(r, f)).length;
    const enquiries = rows.reduce((s, r) => s + r.enquiries, 0);
    const confirmed = rows.reduce((s, r) => s + r.confirmed, 0);
    return { all: rows.length, active: n("active"), dormant: n("dormant"), new: n("new"), former: n("former"), duplicates: n("duplicates"), rate: enquiries ? confirmed / enquiries : null };
  }, [rows]);

  const loading = summaries.isLoading || notDuplicates.isLoading;
  const loadError = summaries.error ?? notDuplicates.error;
  const clearAll = () => (setSearch(""), update({ q: "", f: "" }));
  const sortBy = (k: SortKey) =>
    update(k === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: k === "enquiries" ? "" : k, dir: "" });
  const closeDrawer = useCallback(() => update({ id: "" }), [update]);

  const toast = notice && (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-control bg-ink py-2.5 pr-2 pl-4 text-body font-medium text-white shadow-[0_8px_24px_rgba(25,36,59,0.25)]"
    >
      {notice.text}
      {notice.undo && (
        <button
          type="button"
          className="rounded px-2 py-0.5 font-semibold text-[#c9c2f5] hover:bg-white/10"
          onClick={() => (notice.undo?.(), setNotice(null))}
        >
          Undo
        </button>
      )}
    </div>
  );

  const dialogs = (
    <>
      {merging && (
        <MergeDialog
          kind={kind}
          rows={merging}
          onClose={() => setMerging(null)}
          onMerged={(r) => {
            setMerging(null);
            setSelected(new Set());
            setNotice({
              text: `Merged ${r.merged + 1} ${kind.nouns} into ${displayName(r.name)}: ${r.enquiries.toLocaleString()} ${r.enquiries === 1 ? "enquiry" : "enquiries"} changed.`,
            });
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
            setNotice({ text: `Renamed to ${displayName(name)}.` });
          }}
        />
      )}
      {toast}
    </>
  );

  if (reviewing) {
    return (
      <>
        <ReviewQueue
          kind={kind}
          groups={rowGroups}
          activity={byMaster}
          notDuplicates={notDuplicates.data ?? []}
          byId={byId}
          level={level}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onLevel={(v) => update({ match: v === "likely" ? "" : v })}
          onBack={() => update({ view: "" })}
          onNotice={(text, undo) => setNotice({ text, undo })}
        />
        {dialogs}
      </>
    );
  }

  const tiles: { f: Filter | null; label: string; value: string; sub: string }[] = [
    { f: "active", label: "Active", value: counts.active.toLocaleString(), sub: "enquiry in the last 90 days" },
    { f: "dormant", label: "Dormant", value: counts.dormant.toLocaleString(), sub: "no enquiry for 6 months" },
    { f: "new", label: "New this month", value: counts.new.toLocaleString(), sub: "first enquiry this month" },
    { f: null, label: "Win rate", value: counts.rate === null ? "—" : `${Math.round(counts.rate * 100)}%`, sub: "confirmed of all enquiries" },
  ];
  const chips = (["all", "active", "dormant", "former", ...(counts.duplicates ? ["duplicates" as const] : [])] as Filter[]).filter(
    (f) => f !== "former" || counts.former > 0,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 pt-1 lg:grid-cols-4">
        {tiles.map((t) => {
          const on = t.f !== null && filter === t.f;
          const body = (
            <>
              <div className="text-meta font-medium text-ink-muted">{t.label}</div>
              <div className="mt-0.5 text-2xl leading-8 font-semibold tabular-nums text-ink">{loading ? "–" : t.value}</div>
              <div className="text-meta text-ink-muted">{t.sub}</div>
            </>
          );
          const cls = `rounded-panel border bg-surface px-4 py-3 text-left transition-[border-color,box-shadow] duration-150 ${
            on ? "border-primary ring-1 ring-primary" : "border-line"
          }`;
          return t.f ? (
            <button key={t.label} type="button" aria-pressed={on} onClick={() => update({ f: on ? "" : t.f! })} className={`${cls} hover:border-control/60`}>
              {body}
            </button>
          ) : (
            <div key={t.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>

      {!loading && groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-await/25 bg-await-bg px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-[#fef3c7] text-await" aria-hidden="true">
            <Icon name="merge" className="size-4" />
          </span>
          <div className="min-w-56 flex-1">
            <div className="font-semibold text-ink">
              {groups.length} possible duplicate {groups.length === 1 ? "group" : "groups"} to review
            </div>
            <div className="text-meta text-ink-heading">
              {duplicateIds.size} {kind.noun} names look like the same {kind.key === "ports" ? "place" : "company"}. Merging keeps reports and follow-ups accurate.
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => update({ f: "duplicates" })}>
            Show in list
          </Button>
          <Button onClick={() => update({ view: "review", id: "" })}>
            Review now
            <Icon name="arrowRight" className="size-4" />
          </Button>
        </div>
      )}

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
        <div role="group" aria-label="Filter" className="flex flex-wrap items-center gap-1.5">
          {chips.map((f) => {
            const on = filter === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => update({ f: f === "all" ? "" : f })}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-colors duration-150 ${
                  on ? "border-primary/30 bg-selected text-primary" : "border-line bg-surface text-ink-heading hover:text-ink"
                }`}
              >
                {FILTERS[f]}
                <span className={`tabular-nums ${on ? "text-primary" : "text-ink-muted"}`}>{loading ? "–" : counts[f].toLocaleString()}</span>
              </button>
            );
          })}
          {!loading && !groups.length && !loadError && (
            <span className="inline-flex h-7 items-center gap-1 rounded-full border border-confirmed/25 bg-confirmed-bg px-2.5 text-meta text-confirmed">
              <Icon name="check" className="size-3.5" />
              No possible duplicates
            </span>
          )}
        </div>
        {isAdmin && selected.size > 0 && (
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

      {loadError && (
        <Alert action={<Button variant="secondary" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: [kind.key] })}>Try again</Button>}>
          Could not load the {kind.nouns}. {errorMessage(loadError)}
        </Alert>
      )}
      {activity.error && <Alert kind="warning">Trends and recent enquiries could not be loaded. {errorMessage(activity.error)}</Alert>}

      <section className="@container overflow-hidden rounded-panel border border-line bg-surface" aria-busy={loading || summaries.isFetching}>
        {loading ? (
          <div className="space-y-3 p-4" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-control bg-table-head" />
            ))}
          </div>
        ) : shown.length ? (
          <>
            <div className="relative overflow-x-auto">
              <MasterTable
                kind={kind}
                rows={pageRows}
                today={today}
                sort={sort}
                dir={dir}
                selected={selected}
                openId={openId}
                canRename={canRename}
                isAdmin={isAdmin}
                onSort={sortBy}
                onToggle={(id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(id)) next.add(id);
                    return next;
                  })
                }
                onOpen={(r) => update({ id: r.id })}
                onRename={setRenaming}
              />
            </div>
            <Pagination page={page} size={size} total={shown.length} onPage={setPage} onSize={(s) => (setSize(s), setPage(0))} />
          </>
        ) : (
          <Empty action={(q || filter !== "all") && <Button variant="secondary" onClick={clearAll}>Clear search and filters</Button>}>
            {q || filter !== "all" ? `No ${kind.nouns} match.` : `No ${kind.nouns} yet. They are added with enquiries and imports.`}
          </Empty>
        )}
      </section>

      {openRow && (
        <MasterDrawer
          kind={kind}
          row={openRow}
          rows={byMaster ? (byMaster.get(openRow.id) ?? []) : undefined}
          today={today}
          canRename={canRename}
          onRename={setRenaming}
          onClose={closeDrawer}
        />
      )}
      {dialogs}
    </div>
  );
}
