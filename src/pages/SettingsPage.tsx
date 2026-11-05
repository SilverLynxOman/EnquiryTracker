import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Icon } from "../components/icons";
import { Alert, Button, Empty } from "../components/ui";
import { fetchSalesPersons, fetchUsers, unlinkSalesPerson, updateUser } from "../lib/api";
import { errorMessage } from "../lib/format";
import type { UserAccount } from "../lib/types";
import { accessState, applyChange, changeNotice, linkedTo, ROLE_META, ROLES, sharedLinks, userName, type UserChange } from "../lib/users";
import { InviteDialog } from "./settings/InviteDialog";
import { SharedLinkDialog } from "./settings/SharedLinkDialog";
import { UserActionDialog, type UserAction } from "./settings/UserActionDialog";
import { cellKey, UserTable, type PendingValues } from "./settings/UserTable";

const USERS = ["admin-users"] as const;

const keyOf = (c: UserChange) => cellKey(c.user.id, "role" in c ? "role" : "salesPerson");
const valueOf = (c: UserChange) => ("role" in c ? c.role : c.salesPersonId);

/**
 * Settings, for the organisation owner only (the menu shows it to no one else, and the database refuses others):
 * every staff login, its role, sales person and access, invitations and password resets.
 */
export default function SettingsPage() {
  const { session, profile, isOwner, profileLoading, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: USERS, queryFn: fetchUsers, enabled: isOwner });
  const people = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons, staleTime: 300_000, enabled: isOwner });

  const [pending, setPending] = useState<PendingValues>(new Map());
  /** A sales person chosen for a login while other logins are linked to it: asked about first. */
  const [shareAsk, setShareAsk] = useState<{
    user: UserAccount;
    salesPersonId: string;
    others: UserAccount[];
    choice?: "move" | "both";
  } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [acting, setActing] = useState<{ user: UserAccount; action: UserAction } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
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
      // The owner linking themself to a sales person gets their open quotes (The Window) as home page straight away.
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

  const chooseRole = (user: UserAccount, role: UserAccount["role"]) => {
    // Owners manage everyone, including you: asked first.
    if (role === "owner") setActing({ user, action: "make_owner" });
    else save.mutate({ user, role });
  };

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

  const done = (message: string) => {
    setInviting(false);
    setActing(null);
    setNotice(message);
    void queryClient.invalidateQueries({ queryKey: USERS });
    if (acting?.user.id === session?.user.id) refreshProfile();
  };

  const loading = profileLoading || users.isPending || people.isPending;
  const loadError = users.error ?? people.error;
  const retry = () => {
    if (users.error) void users.refetch();
    if (people.error) void people.refetch();
  };
  const list = users.data ?? [];
  const counts = { invited: list.filter((u) => accessState(u) === "invited").length, off: list.filter((u) => accessState(u) === "off").length };

  return (
    <div className="space-y-3">
      {/* Opened from the avatar menu, so no navigation item names the page: this header does. */}
      <div className="flex h-12 items-center justify-between gap-4 border-b border-line">
        <h1 className="text-title font-semibold text-ink">Settings</h1>
        {isOwner && (
          <Button onClick={() => setInviting(true)} disabled={!users.data || !people.data}>
            <Icon name="plus" />
            Invite someone
          </Button>
        )}
      </div>

      {!profileLoading && !isOwner ? (
        <section className="rounded-panel border border-line bg-surface">
          <Empty>
            {profile
              ? "Settings are for the organisation owner. Ask them if your role, sales person or access should change."
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
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
                <h2 className="text-body font-semibold text-ink">Users and access</h2>
                <div className="flex items-center gap-2 text-meta text-ink-muted">
                  {users.isFetching && !users.isPending && (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
                  )}
                  {users.data &&
                    [
                      `${list.length.toLocaleString()} ${list.length === 1 ? "login" : "logins"}`,
                      counts.invited > 0 && `${counts.invited} invited`,
                      counts.off > 0 && `${counts.off} turned off`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                </div>
              </header>
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
                    onRole={chooseRole}
                    onSalesPerson={chooseSalesPerson}
                    onAction={(user, action) => setActing({ user, action })}
                  />
                ) : (
                  <Empty>No logins yet. Invite your staff with the button above.</Empty>
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
                  Link each sales person's login to their name in the register: their open quotes become their home page, and as an editor or
                  viewer they see only their own enquiries. Pricing and managers stay unlinked and see everything.
                </p>
                <p>
                  Activity counts changes in the register (new enquiries, edits, status changes). Turning access off signs someone out at once; their
                  work stays.
                </p>
              </footer>
            </section>
          ) : null}
        </>
      )}

      {inviting && users.data && people.data && (
        <InviteDialog users={users.data} salesPersons={people.data} onClose={() => setInviting(false)} onDone={done} />
      )}

      {acting && <UserActionDialog action={acting.action} user={acting.user} onClose={() => setActing(null)} onDone={done} />}

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
