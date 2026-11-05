import { useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import type { DuplicateGroup } from "../../lib/customerDuplicates";
import { displayName, fmtDateLong } from "../../lib/display";
import type { MasterSummary } from "../../lib/types";
import type { MasterKind } from "./kinds";
import { enquiriesLink, th, td } from "./shared";

/**
 * Likely duplicates, one row group per company or place. Every name in a group starts ticked: untick the ones that
 * are different, then merge the rest (admins) or mark them as different (editors).
 */
export function DuplicateGroups({
  kind,
  groups,
  canEdit,
  isAdmin,
  distinctPending,
  onMerge,
  onDistinct,
}: {
  kind: MasterKind;
  groups: DuplicateGroup<MasterSummary>[];
  canEdit: boolean;
  isAdmin: boolean;
  distinctPending: boolean;
  onMerge: (rows: MasterSummary[]) => void;
  onDistinct: (rows: MasterSummary[]) => void;
}) {
  // Ids are unique across groups, so one set of unticked ids covers every group.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const cols = (canEdit ? 1 : 0) + 4 + (kind.extra ? 1 : 0);

  return (
    <table className="w-full border-separate border-spacing-0 text-body">
      <caption className="sr-only">
        {kind.title} that are probably the same, in groups. {canEdit && "Untick any name that is different."}
      </caption>
      <thead>
        <tr>
          {canEdit && (
            <th scope="col" className={`${th} w-10 pl-4`}>
              <span className="sr-only">Include</span>
            </th>
          )}
          <th scope="col" className={`${th} ${canEdit ? "" : "pl-4"}`}>
            {kind.column}
          </th>
          <th scope="col" className={`${th} w-28 text-right`}>
            Enquiries
          </th>
          <th scope="col" className={`${th} hidden w-28 text-right @min-[640px]:table-cell`}>
            Confirmed
          </th>
          <th scope="col" className={`${th} hidden w-36 @min-[520px]:table-cell`}>
            Last enquiry
          </th>
          {kind.extra && (
            <th scope="col" className={`${th} hidden w-28 pr-4 text-right @min-[760px]:table-cell`}>
              {kind.extra.header}
            </th>
          )}
        </tr>
      </thead>
      {groups.map((g) => {
        const ticked = g.members.filter((c) => !unticked.has(c.id));
        const enquiries = g.members.reduce((n, c) => n + c.enquiries, 0);
        const lead = displayName(g.members[0].name);
        return (
          <tbody key={g.members[0].id}>
            <tr>
              <th scope="rowgroup" colSpan={cols} className="border-b border-line px-4 pt-4 pb-2 text-left font-normal">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-ink">{lead}</span>
                    <span className="text-meta text-ink-muted">
                      {" "}
                      · {g.members.length} names · {enquiries.toLocaleString()} {enquiries === 1 ? "enquiry" : "enquiries"} ·{" "}
                      {g.score === 1 ? kind.sameReason : "similar spelling"}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={ticked.length < 2 || distinctPending}
                        onClick={() => onDistinct(ticked)}
                        title="Stop suggesting the ticked names as one"
                      >
                        Not the same
                      </Button>
                      {isAdmin && (
                        <Button variant="secondary" size="sm" disabled={ticked.length < 2} onClick={() => onMerge(ticked)}>
                          <Icon name="merge" className="size-3.5" />
                          {ticked.length < g.members.length ? `Merge ${ticked.length} ticked…` : "Merge…"}
                          <span className="sr-only"> {lead} group</span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </th>
            </tr>
            {g.members.map((c, i) => {
              const cell = `${td} ${i === g.members.length - 1 ? "" : "border-b-0"}`;
              const name = displayName(c.name);
              return (
                <tr key={c.id} className={`hover:bg-row-hover ${unticked.has(c.id) ? "text-ink-muted" : ""}`}>
                  {canEdit && (
                    <td className={`${cell} pl-4`}>
                      <input
                        type="checkbox"
                        className="size-4 align-middle accent-primary"
                        aria-label={`Include ${name}`}
                        checked={!unticked.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                    </td>
                  )}
                  <td className={`${cell} ${canEdit ? "" : "pl-4"}`}>
                    <div className="font-medium" title={c.name}>
                      {name}
                    </div>
                    {c.aliases.length > 0 && (
                      <div className="text-meta text-ink-muted">
                        {kind.formerLabel}: {c.aliases.map(displayName).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className={`${cell} text-right tabular-nums`}>
                    <Link
                      to={enquiriesLink(c.name)}
                      className="text-primary hover:underline"
                      aria-label={`${c.enquiries} ${c.enquiries === 1 ? "enquiry" : "enquiries"} with ${name}`}
                    >
                      {c.enquiries.toLocaleString()}
                    </Link>
                  </td>
                  <td className={`${cell} hidden text-right tabular-nums @min-[640px]:table-cell`}>{c.confirmed.toLocaleString()}</td>
                  <td className={`${cell} hidden text-meta tabular-nums text-ink-muted @min-[520px]:table-cell`}>
                    {c.last_enquiry ? fmtDateLong(c.last_enquiry) : "—"}
                  </td>
                  {kind.extra && (
                    <td className={`${cell} hidden pr-4 text-right tabular-nums @min-[760px]:table-cell`}>{kind.extra.cell(c)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        );
      })}
    </table>
  );
}
