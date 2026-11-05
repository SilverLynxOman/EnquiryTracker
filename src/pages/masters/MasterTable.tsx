import { Link, useNavigate } from "react-router";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { displayName, fmtDateLong } from "../../lib/display";
import type { MasterSummary } from "../../lib/types";
import type { MasterKind } from "./kinds";
import { enquiriesLink, th, td } from "./shared";

/** Every row of one list with its counts. Admins tick rows to merge ones the duplicate finder did not pair. */
export function MasterTable({
  kind,
  rows,
  selected,
  canRename,
  isAdmin,
  onToggle,
  onRename,
}: {
  kind: MasterKind;
  rows: MasterSummary[];
  selected: ReadonlySet<string>;
  canRename: boolean;
  isAdmin: boolean;
  onToggle: (id: string) => void;
  onRename: (row: MasterSummary) => void;
}) {
  const navigate = useNavigate();
  const menu = (r: MasterSummary): MenuItem[] => [
    { label: "View enquiries", icon: "register", onSelect: () => navigate(enquiriesLink(r.name)) },
    ...(canRename ? [{ label: "Rename…", icon: "edit" as const, onSelect: () => onRename(r) }] : []),
  ];

  return (
    <table className="w-full border-separate border-spacing-0 text-body">
      <caption className="sr-only">
        {kind.title}
        {isAdmin && ". Tick two or more to merge them."}
      </caption>
      <thead>
        <tr>
          {isAdmin && (
            <th scope="col" className={`${th} w-10 pl-4`}>
              <span className="sr-only">Select</span>
            </th>
          )}
          <th scope="col" className={`${th} ${isAdmin ? "" : "pl-4"}`}>
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
            <th scope="col" className={`${th} hidden w-28 text-right @min-[760px]:table-cell`}>
              {kind.extra.header}
            </th>
          )}
          <th scope="col" className={`${th} w-12 pr-3`}>
            <span className="sr-only">More actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const name = displayName(r.name);
          const on = selected.has(r.id);
          return (
            <tr key={r.id} className={on ? "bg-selected" : "hover:bg-row-hover"}>
              {isAdmin && (
                <td className={`${td} pl-4`}>
                  <input
                    type="checkbox"
                    className="size-4 align-middle accent-primary"
                    aria-label={`Select ${name}`}
                    checked={on}
                    onChange={() => onToggle(r.id)}
                  />
                </td>
              )}
              <td className={`${td} ${isAdmin ? "" : "pl-4"}`}>
                <div className="font-medium" title={r.name}>
                  {name}
                </div>
                {r.aliases.length > 0 && (
                  <div className="text-meta text-ink-muted">
                    {kind.formerLabel}: {r.aliases.map(displayName).join(", ")}
                  </div>
                )}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                <Link
                  to={enquiriesLink(r.name)}
                  className="text-primary hover:underline"
                  aria-label={`${r.enquiries} ${r.enquiries === 1 ? "enquiry" : "enquiries"} with ${name}`}
                >
                  {r.enquiries.toLocaleString()}
                </Link>
              </td>
              <td className={`${td} hidden text-right tabular-nums @min-[640px]:table-cell`}>{r.confirmed.toLocaleString()}</td>
              <td className={`${td} hidden text-meta tabular-nums text-ink-muted @min-[520px]:table-cell`}>
                {r.last_enquiry ? fmtDateLong(r.last_enquiry) : "No enquiries"}
              </td>
              {kind.extra && <td className={`${td} hidden text-right tabular-nums @min-[760px]:table-cell`}>{kind.extra.cell(r)}</td>}
              <td className={`${td} pr-3 text-right`}>
                <Menu
                  label={`More actions for ${name}`}
                  trigger={<Icon name="more" />}
                  triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-surface hover:text-ink"
                  items={menu(r)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
