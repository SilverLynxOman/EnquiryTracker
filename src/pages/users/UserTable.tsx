import type { ReactNode } from "react";
import { Icon } from "../../components/icons";
import { controlBase } from "../../components/SelectBox";
import { displayName } from "../../lib/display";
import type { NamedRef, Role, UserAccount } from "../../lib/types";
import { addedOn, joinNames, lastSignIn, linkedTo, ROLE_META, ROLES, userName } from "../../lib/users";

const th = "sticky top-0 z-10 h-10 border-b border-line bg-table-head px-3 text-left text-meta font-medium whitespace-nowrap text-ink-heading";
const td = "border-b border-line px-3 py-2 align-middle";

export type UserField = "role" | "salesPerson";
/** Values being saved, by `cellKey`. A cell shows its value until the save ends. */
export type PendingValues = ReadonlyMap<string, string | null>;
export const cellKey = (userId: string, field: UserField) => `${userId}:${field}`;

/** Every login with its role and sales person. Choosing a value saves it at once (the page does the saving). */
export function UserTable({
  users,
  salesPersons,
  meId,
  shared,
  pending,
  onRole,
  onSalesPerson,
}: {
  users: UserAccount[];
  /** Active sales persons, the ones a login can be linked to. */
  salesPersons: NamedRef[];
  /** The signed-in admin, who cannot change their own role. */
  meId: string | undefined;
  /** Logins whose sales person is linked to other logins too (sharedLinks). */
  shared: Map<string, UserAccount[]>;
  pending: PendingValues;
  onRole: (user: UserAccount, role: Role) => void;
  onSalesPerson: (user: UserAccount, salesPersonId: string | null) => void;
}) {
  return (
    <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-body">
      <caption className="sr-only">Staff logins. A role or sales person is saved as soon as you choose it.</caption>
      <thead>
        <tr>
          <th scope="col" className={`${th} pl-4`}>
            User
          </th>
          <th scope="col" className={`${th} w-40`}>
            Role
          </th>
          <th scope="col" className={`${th} w-64`}>
            Sales person
          </th>
          <th scope="col" className={`${th} hidden w-44 @min-[800px]:table-cell`}>
            Last signed in
          </th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => {
          const name = userName(u);
          const me = u.id === meId;
          const roleKey = cellKey(u.id, "role");
          const personKey = cellKey(u.id, "salesPerson");
          const role = pending.has(roleKey) ? (pending.get(roleKey) as Role) : u.role;
          const person = pending.has(personKey) ? (pending.get(personKey) ?? null) : u.sales_person_id;
          // A link to a sales person who has since been made inactive stays visible (and can be removed).
          const inactive = person !== null && !salesPersons.some((p) => p.id === person);
          const others = shared.get(u.id);
          return (
            <tr key={u.id} className="hover:bg-row-hover [&:last-child>td]:border-b-0">
              <td className={`${td} pl-4`}>
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{name}</span>
                  {me && <span className="rounded-full bg-table-head px-1.5 text-meta font-medium text-ink-muted">You</span>}
                </div>
                <div className="text-meta break-all text-ink-muted">{u.email ?? "No e-mail address"}</div>
                <div className="text-meta text-ink-muted @min-[800px]:hidden">
                  {u.last_sign_in_at ? `Last signed in: ${lastSignIn(u.last_sign_in_at)}` : `Not signed in yet · ${addedOn(u.created_at)}`}
                </div>
              </td>
              <td className={td}>
                {me ? (
                  <>
                    <div>{ROLE_META[u.role].label}</div>
                    <div className="text-meta text-ink-muted">Set by another admin</div>
                  </>
                ) : (
                  <CellSelect label={`Role of ${name}`} value={role} saving={pending.has(roleKey)} onChange={(v) => onRole(u, v as Role)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_META[r].label}
                      </option>
                    ))}
                  </CellSelect>
                )}
              </td>
              <td className={td}>
                <CellSelect
                  label={`Sales person of ${name}`}
                  value={person ?? ""}
                  saving={pending.has(personKey)}
                  onChange={(v) => onSalesPerson(u, v || null)}
                >
                  <option value="">Not linked</option>
                  {inactive && <option value={person}>{displayName(u.sales_person_name) || "Unknown sales person"} (inactive)</option>}
                  {salesPersons.map((p) => {
                    // Say who has a sales person already, so a second link is never a surprise.
                    const taken = p.id === person ? [] : linkedTo(users, p.id, u.id).map(userName);
                    return (
                      <option key={p.id} value={p.id}>
                        {displayName(p.name)}
                        {taken.length > 0 && ` — linked to ${joinNames(taken)}`}
                      </option>
                    );
                  })}
                </CellSelect>
                {others && (
                  <div className="mt-1 flex items-start gap-1 text-meta font-medium text-await">
                    <Icon name="alert" className="mt-0.5 size-3.5" />
                    <span>Also linked to {joinNames(others.map(userName))}</span>
                  </div>
                )}
              </td>
              <td className={`${td} hidden text-meta tabular-nums text-ink-muted @min-[800px]:table-cell`}>
                {lastSignIn(u.last_sign_in_at)}
                {!u.last_sign_in_at && <div>{addedOn(u.created_at)}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A native select for a table cell: outlined like the toolbar controls, with a spinner while its value saves. */
function CellSelect({
  label,
  value,
  saving,
  onChange,
  children,
}: {
  label: string;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        // Not disabled while saving: that would drop keyboard focus. A second change waits for the first instead.
        onChange={(e) => !saving && onChange(e.target.value)}
        className={`${controlBase} w-full appearance-none pr-8 pl-2.5`}
      >
        {children}
      </select>
      {saving ? (
        <span className="pointer-events-none absolute right-2.5 size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
      ) : (
        <Icon name="chevronDown" className="pointer-events-none absolute right-2.5 size-4 text-ink-muted" />
      )}
    </label>
  );
}
