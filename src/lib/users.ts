import { displayName, fmtDateLong } from "./display";
import type { Role, UserAccount } from "./types";

// Rules of the Users page (src/pages/UsersPage.tsx): how logins are named, what each role may do, sign-in times,
// and which logins share a sales person. The server side is supabase/migrations/20261105035359_admin_users.sql.

export const ROLES: Role[] = ["admin", "editor", "viewer"];

export const ROLE_META: Record<Role, { label: string; article: "a" | "an"; can: string }> = {
  admin: { label: "Admin", article: "an", can: "everything, including deleting enquiries and managing users" },
  editor: { label: "Editor", article: "an", can: "adds, edits and imports enquiries" },
  viewer: { label: "Viewer", article: "a", can: "reads only" },
};

/** One save on the Users page: a new role, or a new sales person (moveLink: unlink the other logins on it). */
export type UserChange =
  | { user: UserAccount; role: Role }
  | { user: UserAccount; salesPersonId: string | null; moveLink?: boolean };

/** The profile name, else the part of the e-mail address before the @. */
export function userName(u: Pick<UserAccount, "full_name" | "email">): string {
  return u.full_name?.trim() || u.email?.split("@")[0] || "Unnamed login";
}

/** "Ahmed", "Ahmed and Bilal", "Ahmed, Bilal and Chen". */
export function joinNames(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The other logins linked to this sales person. */
export function linkedTo(users: UserAccount[], salesPersonId: string, exceptUserId: string): UserAccount[] {
  return users.filter((u) => u.sales_person_id === salesPersonId && u.id !== exceptUserId);
}

/** For each login whose sales person is linked to other logins too: those other logins. */
export function sharedLinks(users: UserAccount[]): Map<string, UserAccount[]> {
  const out = new Map<string, UserAccount[]>();
  for (const u of users) {
    const others = u.sales_person_id ? linkedTo(users, u.sales_person_id, u.id) : [];
    if (others.length) out.set(u.id, others);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Today, 09:12", "Yesterday, 17:40", "03 Nov 2026", or "Not signed in yet", in the browser's time zone. */
export function lastSignIn(ts: string | null, now: Date = new Date()): string {
  if (!ts) return "Not signed in yet";
  const d = new Date(ts);
  const day = localDay(d);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (day === localDay(now)) return `Today, ${time}`;
  if (day === localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return `Yesterday, ${time}`;
  return fmtDateLong(day);
}

/** "Added 04 Nov 2026": when the login was invited or created. */
export function addedOn(ts: string): string {
  return `Added ${fmtDateLong(localDay(new Date(ts)))}`;
}

/** The list after a successful save, shown until the list has been read again. */
export function applyChange(users: UserAccount[], change: UserChange, salesPersonName: string | null): UserAccount[] {
  if ("role" in change) return users.map((u) => (u.id === change.user.id ? { ...u, role: change.role } : u));
  const { salesPersonId, moveLink } = change;
  return users.map((u) => {
    if (u.id === change.user.id) return { ...u, sales_person_id: salesPersonId, sales_person_name: salesPersonId ? salesPersonName : null };
    if (moveLink && salesPersonId && u.sales_person_id === salesPersonId) return { ...u, sales_person_id: null, sales_person_name: null };
    return u;
  });
}

/** The confirmation after a save. `others`: the logins that were linked to the sales person before it. */
export function changeNotice(change: UserChange, others: UserAccount[], salesPersonName: string | null): string {
  const name = userName(change.user);
  if ("role" in change) {
    const role = ROLE_META[change.role];
    return `${name} is now ${role.article} ${role.label.toLowerCase()}.`;
  }
  if (!change.salesPersonId) return `${name} is no longer linked to a sales person.`;
  const person = displayName(salesPersonName) || "the sales person";
  if (!others.length) return `${name} is now linked to ${person}.`;
  const otherNames = others.map(userName);
  if (change.moveLink) return `${name} is now linked to ${person}, in place of ${joinNames(otherNames)}.`;
  return `${joinNames([name, ...otherNames])} are now ${others.length === 1 ? "both" : "all"} linked to ${person}.`;
}
