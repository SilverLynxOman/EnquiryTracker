import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Alert, Button, Empty } from "../components/ui";
import { fetchSalesPersons, fetchUsers, unlinkSalesPerson, updateUser } from "../lib/api";
import { errorMessage } from "../lib/format";
import type { UserAccount } from "../lib/types";
import { applyChange, changeNotice, linkedTo, ROLE_META, ROLES, sharedLinks, userName, type UserChange } from "../lib/users";
import { SharedLinkDialog } from "./users/SharedLinkDialog";
import { cellKey, UserTable, type PendingValues } from "./users/UserTable";

const USERS = ["admin-users"] as const;

const keyOf = (c: UserChange) => cellKey(c.user.id, "role" in c ? "role" : "salesPerson");
const valueOf = (c: UserChange) => ("role" in c ? c.role : c.salesPersonId);

/** Admins only: every staff login, with its role and linked sales person changed in place. */
export default function UsersPage() {
  const { session, profile, isAdmin, profileLoading, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: USERS, queryFn: fetchUsers, enabled: isAdmin });
  const people = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000, enabled: isAdmin });

  const [pending, setPending] = useState<PendingValues>(new Map());
  /** A sales person chosen for a login while other logins are linked to it: asked about first. */
  const [shareAsk, setShareAsk] = useState<{
    user: UserAccount;
    salesPersonId: string;
    others: UserAccount[];
    choice?: "move" | "both";
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const shared = useMemo(() => sharedLinks(users.data ?? []), [users.data]);
  const personName = (id: string | null) => (id ? (people.data?.find((p) => p.id === id)?.name ?? null) : null);

  const save = useMutation({
    mutationFn: async (change: UserChange) => {
      if ("role" in change) return updateUser(change.user.id, { role: change.role });
      // Link first, then unlink the others: if the second step fails, both are linked and the table says so.
      await updateUser(change.user.id, { sales_person_id: change.salesPersonId });
      if (!change.moveLink || !change.salesPersonId) return;
      try {
        await unlinkSalesPerson(change.salesPersonId, change.user.id);
      } catch (e) {
        throw new Error(`The link was saved, but the other login is still linked too. ${errorMessage(e)}`);
      }
    },
    onMutate: (change) => {
      setFailure(null);
      setPending((prev) => new Map(prev).set(keyOf(change), valueOf(change)));
      // The logins on that sales person before the change, for the confirmation.
      return { others: "role" in change || !change.salesPersonId ? [] : linkedTo(users.data ?? [], change.salesPersonId, change.user.id) };
    },
    onSuccess: (_done, change, { others }) => {
      const salesPerson = "role" in change ? null : personName(change.salesPersonId);
      queryClient.setQueryData<UserAccount[]>(USERS, (list) => list && applyChange(list, change, salesPerson));
      setShareAsk(null);
      setNotice(changeNotice(change, others, salesPerson));
      // An admin who links themself to a sales person gets their open quotes (The Window) as home page straight away.
      if (change.user.id === session?.user.id) refreshProfile();
    },
    onError: (e, change) => setFailure(`${userName(change.user)} was not changed. ${errorMessage(e)}`),
    onSettled: (_done, _error, change) => {
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(keyOf(change));
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: USERS });
    },
  });

  const chooseSalesPerson = (user: UserAccount, salesPersonId: string | null) => {
    const others = salesPersonId ? linkedTo(users.data ?? [], salesPersonId, user.id) : [];
    if (salesPersonId && others.length) {
      setFailure(null);
      setShareAsk({ user, salesPersonId, others });
    } else {
      save.mutate({ user, salesPersonId });
    }
  };

  const answer = (choice: "move" | "both") => {
    if (!shareAsk) return;
    setShareAsk({ ...shareAsk, choice });
    save.mutate({ user: shareAsk.user, salesPersonId: shareAsk.salesPersonId, moveLink: choice === "move" });
  };

  const loading = profileLoading || users.isPending || people.isPending;
  const loadError = users.error ?? people.error;
  const retry = () => {
    if (users.error) void users.refetch();
    if (people.error) void people.refetch();
  };
  const count = users.data?.length;

  return (
    <div className="space-y-3">
      {/* Opened from the avatar menu, so no navigation item names the page: this header does. */}
      <div className="flex h-12 items-center justify-between gap-4 border-b border-line">
        <h1 className="text-title font-semibold text-ink">Users and roles</h1>
        <div className="flex items-center gap-2 text-meta text-ink-muted">
          {users.isFetching && !users.isPending && (
            <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
          )}
          {count !== undefined && `${count.toLocaleString()} ${count === 1 ? "login" : "logins"}`}
        </div>
      </div>

      {!profileLoading && !isAdmin ? (
        <section className="rounded-panel border border-line bg-surface">
          <Empty>
            {profile
              ? "Only administrators can see and change users. Ask one if your role or sales person should change."
              : "Your role could not be read, so this page stays closed. Reload the page to try again."}
          </Empty>
        </section>
      ) : (
        <>
          {loadError && (
            <Alert
              action={
                <Button variant="secondary" size="sm" onClick={retry}>
                  Try again
                </Button>
              }
            >
              Could not load the {users.error ? "users" : "sales persons"}. {errorMessage(loadError)}
            </Alert>
          )}
          {failure && !shareAsk && (
            <Alert
              action={
                <Button variant="ghost" size="sm" onClick={() => setFailure(null)}>
                  Dismiss
                </Button>
              }
            >
              {failure}
            </Alert>
          )}

          {/* Nothing to list after a failed first load: the alert above says so. */}
          {(users.data && people.data) || (loading && !loadError) ? (
            <section className="@container overflow-hidden rounded-panel border border-line bg-surface" aria-busy={loading || users.isFetching}>
              {/* relative: screen-reader-only text inside the table is positioned here, so it scrolls with the table. */}
              <div className="relative overflow-x-auto">
                {!users.data || !people.data ? (
                  <div className="space-y-3 p-4" aria-hidden="true">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="h-11 animate-pulse rounded-control bg-table-head" />
                    ))}
                  </div>
                ) : users.data.length ? (
                  <UserTable
                    users={users.data}
                    salesPersons={people.data}
                    meId={session?.user.id}
                    shared={shared}
                    pending={pending}
                    onRole={(user, role) => save.mutate({ user, role })}
                    onSalesPerson={chooseSalesPerson}
                  />
                ) : (
                  <Empty>No logins yet. Invite staff from the Supabase dashboard, as described below.</Empty>
                )}
              </div>
              <footer className="space-y-1 border-t border-line px-4 py-3 text-meta text-ink-muted">
                <p>
                  {ROLES.map((r, i) => (
                    <Fragment key={r}>
                      {i > 0 && " · "}
                      <span className="font-medium text-ink-heading">{ROLE_META[r].label}:</span> {ROLE_META[r].can}
                    </Fragment>
                  ))}
                  .
                </p>
                <p>
                  Link each sales person's login to their name in the register: their open quotes become their home page. Managers and
                  pricing stay unlinked and keep the dashboard.
                </p>
                <p>
                  To add someone, invite them in the Supabase dashboard (Authentication → Users → Invite user). They appear here as
                  viewers.
                </p>
              </footer>
            </section>
          ) : null}
        </>
      )}

      {shareAsk && (
        <SharedLinkDialog
          user={shareAsk.user}
          salesPersonName={personName(shareAsk.salesPersonId)}
          others={shareAsk.others}
          saving={pending.has(cellKey(shareAsk.user.id, "salesPerson")) ? (shareAsk.choice ?? null) : null}
          error={failure}
          onMove={() => answer("move")}
          onLinkBoth={() => answer("both")}
          onClose={() => (setShareAsk(null), setFailure(null))}
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
