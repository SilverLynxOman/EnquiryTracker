import { Link, useNavigate } from "react-router";
import { Icon } from "../../components/icons";
import { Menu, type MenuItem } from "../../components/Menu";
import { displayName, fmtDateLong } from "../../lib/display";
import type { CustomerSummary } from "../../lib/types";
import { enquiriesLink, th, td } from "./shared";

/** Every customer with its counts. Admins tick rows to merge customers the duplicate finder did not pair. */
export function CustomerTable({
  rows,
  selected,
  canEdit,
  isAdmin,
  onToggle,
  onRename,
}: {
  rows: CustomerSummary[];
  selected: ReadonlySet<string>;
  canEdit: boolean;
  isAdmin: boolean;
  onToggle: (id: string) => void;
  onRename: (customer: CustomerSummary) => void;
}) {
  const navigate = useNavigate();
  const menu = (c: CustomerSummary): MenuItem[] => [
    { label: "View enquiries", icon: "register", onSelect: () => navigate(enquiriesLink(c.name)) },
    ...(canEdit ? [{ label: "Rename…", icon: "edit" as const, onSelect: () => onRename(c) }] : []),
  ];

  return (
    <table className="w-full border-separate border-spacing-0 text-body">
      <caption className="sr-only">Customers{isAdmin && ". Tick two or more to merge them."}</caption>
      <thead>
        <tr>
          {isAdmin && (
            <th scope="col" className={`${th} w-10 pl-4`}>
              <span className="sr-only">Select</span>
            </th>
          )}
          <th scope="col" className={`${th} ${isAdmin ? "" : "pl-4"}`}>
            Customer
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
          <th scope="col" className={`${th} hidden w-24 text-right @min-[760px]:table-cell`}>
            Contacts
          </th>
          <th scope="col" className={`${th} w-12 pr-3`}>
            <span className="sr-only">More actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const name = displayName(c.name);
          const on = selected.has(c.id);
          return (
            <tr key={c.id} className={on ? "bg-selected" : "hover:bg-row-hover"}>
              {isAdmin && (
                <td className={`${td} pl-4`}>
                  <input
                    type="checkbox"
                    className="size-4 align-middle accent-primary"
                    aria-label={`Select ${name}`}
                    checked={on}
                    onChange={() => onToggle(c.id)}
                  />
                </td>
              )}
              <td className={`${td} ${isAdmin ? "" : "pl-4"}`}>
                <div className="font-medium" title={c.name}>
                  {name}
                </div>
                {c.aliases.length > 0 && <div className="text-meta text-ink-muted">Former names: {c.aliases.map(displayName).join(", ")}</div>}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                <Link to={enquiriesLink(c.name)} className="text-primary hover:underline" aria-label={`${c.enquiries} ${c.enquiries === 1 ? "enquiry" : "enquiries"} of ${name}`}>
                  {c.enquiries.toLocaleString()}
                </Link>
              </td>
              <td className={`${td} hidden text-right tabular-nums @min-[640px]:table-cell`}>{c.confirmed.toLocaleString()}</td>
              <td className={`${td} hidden text-meta tabular-nums text-ink-muted @min-[520px]:table-cell`}>
                {c.last_enquiry ? fmtDateLong(c.last_enquiry) : "No enquiries"}
              </td>
              <td className={`${td} hidden text-right tabular-nums @min-[760px]:table-cell`}>{c.contacts || "—"}</td>
              <td className={`${td} pr-3 text-right`}>
                <Menu
                  label={`More actions for ${name}`}
                  trigger={<Icon name="more" />}
                  triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-surface hover:text-ink"
                  items={menu(c)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
