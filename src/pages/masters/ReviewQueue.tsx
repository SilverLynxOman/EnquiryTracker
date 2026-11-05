import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../components/icons";
import { SelectBox } from "../../components/SelectBox";
import { Alert, Button, inputClass } from "../../components/ui";
import { pairKey, type DuplicateGroup } from "../../lib/customerDuplicates";
import { displayName, fmtDateLong } from "../../lib/display";
import { errorMessage } from "../../lib/format";
import { laneOf, ranked, type ActivityRow } from "../../lib/masterActivity";
import { nameKey } from "../../lib/normalize";
import type { MergeResult, NotDuplicatePair } from "../../lib/types";
import type { MasterKind } from "./kinds";
import type { MasterRow } from "./shared";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const MATCH_LEVELS = {
  close: { label: "Close matches", min: 0.85 },
  likely: { label: "Likely matches", min: 0.75 },
  broad: { label: "Broad matches", min: 0.65 },
} as const;
export type MatchLevel = keyof typeof MATCH_LEVELS;

/** Words of `name` that the first name of the group does not have, marked. */
function Marked({ name, base }: { name: string; base: string }) {
  const known = new Set((nameKey(base) ?? "").split(" "));
  return (
    <>
      {displayName(name)
        .split(/(\s+)/)
        .map((part, i) =>
          /^\s+$/.test(part) || known.has(nameKey(part) ?? "") ? (
            <span key={i}>{part}</span>
          ) : (
            <mark key={i} className="rounded-sm bg-[#fde68a] px-px text-ink">
              {part}
            </mark>
          ),
        )}
    </>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-b-2 border-line bg-surface px-1.5 text-[11px] leading-4 font-medium text-ink-heading">{children}</kbd>;
}

/**
 * Possible duplicates one group at a time: the names side by side with their counts, lanes and sales people, the
 * one to keep, and Merge / Not the same / Skip. Merging is for admins; editors can mark names as different.
 */
export function ReviewQueue({
  kind,
  groups,
  activity,
  notDuplicates,
  byId,
  level,
  canEdit,
  isAdmin,
  onLevel,
  onBack,
  onNotice,
}: {
  kind: MasterKind;
  groups: DuplicateGroup<MasterRow>[];
  activity: Map<string, ActivityRow[]> | undefined;
  notDuplicates: NotDuplicatePair[];
  byId: Map<string, MasterRow>;
  level: MatchLevel;
  canEdit: boolean;
  isAdmin: boolean;
  onLevel: (level: MatchLevel) => void;
  onBack: () => void;
  onNotice: (text: string, undo?: () => void) => void;
}) {
  const queryClient = useQueryClient();
  const [pos, setPos] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<Record<string, ReadonlySet<string>>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  // Merged or dismissed groups drop out of `groups`, so the same position then shows the next one.
  const index = groups.length ? Math.min(pos, groups.length - 1) : 0;
  const group = groups[index] as DuplicateGroup<MasterRow> | undefined;
  const gid = group?.members[0].id ?? "";
  const out = left[gid] ?? new Set<string>();
  const included = group?.members.filter((m) => !out.has(m.id)) ?? [];
  const keepRow = included.find((m) => m.id === keep[gid]) ?? included[0];
  const finalName = names[gid] ?? keepRow?.name ?? "";
  const others = included.filter((m) => m !== keepRow);

  const merge = useMutation({
    mutationFn: () => kind.merge(keepRow, others, finalName.trim().toUpperCase() === keepRow.name ? null : finalName),
    onSuccess: (r: MergeResult) => {
      void queryClient.invalidateQueries();
      setReviewed((n) => n + 1);
      onNotice(`Merged ${r.merged + 1} ${kind.nouns} into ${displayName(r.name)}: ${r.enquiries.toLocaleString()} ${r.enquiries === 1 ? "enquiry" : "enquiries"} changed.`);
    },
  });
  const distinct = useMutation({
    mutationFn: (rows: MasterRow[]) => kind.markDistinct(rows.map((r) => r.id)),
    onSuccess: (_n, rows) => {
      void queryClient.invalidateQueries({ queryKey: [kind.key, "not-duplicates"] });
      setReviewed((n) => n + 1);
      const ids = rows.map((r) => r.id);
      const pairs = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => (a < b ? { a, b } : { a: b, b: a })));
      onNotice(`${rows.map((r) => displayName(r.name)).join(" and ")} marked as different.`, () => {
        void Promise.all(pairs.map((p) => kind.undoNotDuplicate(p))).then(() => {
          setReviewed((n) => Math.max(0, n - 1));
          void queryClient.invalidateQueries({ queryKey: [kind.key, "not-duplicates"] });
        });
      });
    },
  });
  const busy = merge.isPending || distinct.isPending;

  const choose = (m: MasterRow) => {
    setKeep((p) => ({ ...p, [gid]: m.id }));
    setNames((p) => ({ ...p, [gid]: m.name }));
  };
  const skip = () => setPos(groups.length ? (index + 1) % groups.length : 0);
  const notSame = () => included.length >= 2 && !busy && distinct.mutate(included);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, select, textarea, [contenteditable], dialog")) return;
      const k = e.key.toLowerCase();
      if (k === "s" || k === "arrowright") skip();
      else if (k === "arrowleft") setPos(groups.length ? (index - 1 + groups.length) % groups.length : 0);
      else if (k === "n" && canEdit) notSame();
      else if (/^[1-9]$/.test(k) && group && isAdmin) {
        const m = included[Number(k) - 1];
        if (m) choose(m);
      } else if (k === "escape") onBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = groups.length + reviewed;
  const shownPairs = useMemo(() => notDuplicates.filter((p) => byId.has(p.a) && byId.has(p.b)), [notDuplicates, byId]);
  const undoPair = useMutation({
    mutationFn: kind.undoNotDuplicate,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [kind.key, "not-duplicates"] }),
  });

  const facts = (m: MasterRow) => {
    const rows = activity?.get(m.id) ?? [];
    const lanes = ranked(rows.map(laneOf)).slice(0, 2);
    return [
      ["Enquiries", `${m.enquiries.toLocaleString()} (${m.confirmed.toLocaleString()} confirmed)`],
      ["Last", m.last_enquiry ? fmtDateLong(m.last_enquiry) : "No enquiries"],
      ["Sales", m.top_sales ? displayName(m.top_sales) : "—"],
      ["Lanes", lanes.length ? lanes.map((l) => `${displayName(l.value)} (${l.count})`).join(", ") : "—"],
      ...(kind.key === "customers" ? [["Contacts", String(m.contacts ?? 0)]] : []),
      ...(m.aliases.length ? [[kind.formerLabel, m.aliases.map(displayName).join(", ")]] : []),
    ] as [string, string][];
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon name="chevronLeft" className="size-4" />
          {kind.title}
        </Button>
        <h2 className="text-lg font-semibold text-ink">Review possible duplicates</h2>
        {total > 0 && (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-40 overflow-hidden rounded-full bg-table-head" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(100 * reviewed) / total}%` }} />
            </span>
            <span className="text-meta tabular-nums text-ink-muted">
              {reviewed} of {total} reviewed
            </span>
          </div>
        )}
        <SelectBox label="How alike" value={level} onChange={(v) => onLevel(v as MatchLevel)} className="ml-auto w-44">
          {Object.entries(MATCH_LEVELS).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </SelectBox>
      </div>

      {canEdit && !isAdmin && <Alert kind="info">You can mark names as different. Merging {kind.nouns} is for administrators.</Alert>}
      {merge.error && <Alert>Merge failed. {errorMessage(merge.error)}</Alert>}
      {distinct.error && <Alert>Could not mark them as different. {errorMessage(distinct.error)}</Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {group ? (
          <section className="rounded-panel border border-line bg-surface p-4 sm:p-5" aria-labelledby="review-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-meta text-ink-muted">
                  Group {index + 1} of {groups.length}
                </div>
                <h3 id="review-title" className="text-control font-semibold text-ink">
                  Are these the same {kind.key === "ports" ? "place" : "company"}?
                </h3>
              </div>
              <span className="rounded-full border border-await/25 bg-await-bg px-2.5 py-0.5 text-meta text-await">
                {group.score === 1 ? kind.sameReason.replace(/^./, (c) => c.toUpperCase()) : `Similar spelling · ${Math.round(group.score * 100)}% alike`}
              </span>
            </div>

            <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
              {group.members.map((m, i) => {
                const isOut = out.has(m.id);
                const isKeep = m === keepRow;
                return (
                  <div
                    key={m.id}
                    className={`relative grid content-start gap-3 rounded-panel border p-3.5 ${
                      isKeep ? "border-primary bg-selected/40 ring-1 ring-primary" : isOut ? "border-dashed border-line opacity-55" : "border-line"
                    }`}
                  >
                    {isKeep && isAdmin && (
                      <span className="absolute -top-2.5 right-3 rounded-full bg-primary px-2 text-[11px] leading-5 font-semibold text-white">Keep this name</span>
                    )}
                    <div className="font-semibold text-ink" title={m.name}>
                      {i === 0 ? displayName(m.name) : <Marked name={m.name} base={group.members[0].name} />}
                    </div>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-meta">
                      {facts(m).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-ink-muted">{k}</dt>
                          <dd className="break-words text-ink">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {canEdit && (
                      <div className="flex flex-wrap items-center gap-4 text-meta">
                        {isAdmin && (
                          <label className="inline-flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name={`keep-${gid}`}
                              className="size-4 accent-primary"
                              checked={isKeep}
                              disabled={isOut}
                              onChange={() => choose(m)}
                            />
                            Keep
                          </label>
                        )}
                        <label className="inline-flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={!isOut}
                            onChange={() =>
                              setLeft((p) => {
                                const next = new Set(out);
                                if (!next.delete(m.id)) next.add(m.id);
                                return { ...p, [gid]: next };
                              })
                            }
                          />
                          Include
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isAdmin && keepRow && (
              <div className="mt-4 rounded-control bg-table-head px-3.5 py-3">
                <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-meta font-medium text-ink-heading">{kind.nameLabel}</span>
                  <input
                    className={`${inputClass} min-w-56 flex-1 uppercase`}
                    value={finalName}
                    onChange={(e) => setNames((p) => ({ ...p, [gid]: e.target.value }))}
                  />
                </label>
                <p className="mt-2 text-meta text-ink-muted">
                  {plural(others.reduce((n, m) => n + m.enquiries, 0), "enquiry", "enquiries")} {kind.key === "ports" ? "change to" : "move to"} this name.{" "}
                  {kind.mergeNote(others.length)} A merge cannot be undone from the app.
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <div className="mr-auto hidden flex-wrap items-center gap-3 text-meta text-ink-muted sm:flex">
                {canEdit && (
                  <span>
                    <Kbd>N</Kbd> not the same
                  </span>
                )}
                <span>
                  <Kbd>S</Kbd> skip
                </span>
                {isAdmin && (
                  <span>
                    <Kbd>1</Kbd>–<Kbd>{group.members.length}</Kbd> name to keep
                  </span>
                )}
              </div>
              <Button variant="ghost" onClick={skip} disabled={busy || groups.length < 2}>
                Skip
              </Button>
              {canEdit && (
                <Button variant="secondary" onClick={notSame} disabled={busy || included.length < 2} title="Stop suggesting the included names as one">
                  Not the same
                </Button>
              )}
              {isAdmin && (
                <Button onClick={() => merge.mutate()} loading={merge.isPending} disabled={busy || included.length < 2 || !finalName.trim()}>
                  <Icon name="merge" className="size-4" />
                  {merge.isPending ? "Merging…" : included.length < group.members.length ? `Merge ${included.length} into one` : "Merge into one"}
                </Button>
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-panel border border-line bg-surface px-6 py-12 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-confirmed-bg text-confirmed">
              <Icon name="check" className="size-6" />
            </div>
            <h3 className="mt-3 text-control font-semibold text-ink">All caught up</h3>
            <p className="mt-1 text-body text-ink-muted">
              Every {kind.noun} name is distinct enough at “{MATCH_LEVELS[level].label.toLowerCase()}”. New look-alikes from imports show up here.
            </p>
            <Button variant="secondary" className="mt-4" onClick={onBack}>
              Back to {kind.nouns}
            </Button>
          </section>
        )}

        <aside className="overflow-hidden rounded-panel border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-body font-semibold text-ink">
            Queue <span className="text-meta font-normal text-ink-muted">{groups.length} left</span>
          </div>
          <ul className="max-h-[26rem] overflow-y-auto">
            {groups.map((g, i) => (
              <li key={g.members[0].id}>
                <button
                  type="button"
                  onClick={() => setPos(i)}
                  aria-current={i === index}
                  className={`flex w-full items-center justify-between gap-3 border-b border-line px-4 py-2 text-left text-meta last:border-b-0 ${
                    i === index ? "bg-selected font-medium text-ink" : "text-ink-heading hover:bg-row-hover"
                  }`}
                >
                  <span className="min-w-0 truncate">{displayName(g.members[0].name)}</span>
                  <span className="shrink-0 text-ink-muted">{g.members.length} names</span>
                </button>
              </li>
            ))}
          </ul>
          {shownPairs.length > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-4 py-2.5 text-meta font-medium text-ink-heading hover:text-ink">Marked as different ({shownPairs.length})</summary>
              <ul className="max-h-64 overflow-y-auto border-t border-line">
                {shownPairs.map((p) => (
                  <li key={pairKey(p.a, p.b)} className="flex items-center justify-between gap-2 border-b border-line px-4 py-1.5 text-meta last:border-b-0">
                    <span className="min-w-0">
                      {displayName(byId.get(p.a)?.name)} <span className="text-ink-muted">and</span> {displayName(byId.get(p.b)?.name)}
                    </span>
                    {canEdit && (
                      <Button variant="ghost" size="sm" disabled={undoPair.isPending} onClick={() => undoPair.mutate(p)}>
                        Undo
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
