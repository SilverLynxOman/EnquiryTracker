import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { fetchInboxCounts } from "../lib/api";
import { initials } from "../lib/display";
import { ROLE_META } from "../lib/users";
import { useRegisterExport } from "../pages/register/useRegisterExport";
import { Icon, Logo } from "./icons";
import { Menu } from "./Menu";
import { Alert, Button, buttonClass } from "./ui";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `relative inline-flex h-14 shrink-0 items-center gap-2 px-2 text-body transition-colors duration-150 sm:px-3 ${
    isActive
      ? "font-semibold text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary sm:after:inset-x-3"
      : "font-medium text-ink-heading hover:text-ink"
  }`;

export function Layout() {
  const { profile, session, canEdit, isOwner, seesAll, disabled, mustSetPassword, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const exporter = useRegisterExport();
  const onRegister = pathname === "/enquiries";
  const onMasters = /^\/(customers|agents|ports)(\/|$)/.test(pathname);
  const name = profile?.full_name ?? session?.user.email ?? "Account";
  // The pricing inbox and imports are for those who see every enquiry, not sales staff.
  const inbox = useQuery({ queryKey: ["inbox", "counts"], queryFn: fetchInboxCounts, refetchInterval: 60_000, enabled: !!profile && seesAll });
  const waiting = inbox.data ? inbox.data.drafts + inbox.data.review : 0;

  // Access turned off by the owner: nothing to show (the database returns nothing either). (After the hooks above.)
  if (disabled) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md space-y-4 rounded-panel border border-line bg-surface p-6 text-center">
          <Logo />
          <h1 className="text-title font-semibold text-ink">Your access is turned off</h1>
          <p className="text-body text-ink-muted">
            {session?.user.email} can no longer use the Enquiry Tracker. If this is a mistake, ask the owner to turn your access back on.
          </p>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  // Arrived from an invite or reset e-mail, or with a temporary password: choose a password before anything else.
  if (mustSetPassword && pathname !== "/account") return <Navigate to="/account" replace />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 h-14 border-b border-line bg-surface">
        <div className="flex h-full items-center gap-1 px-4 sm:px-5">
          <Link to="/" className="mr-1 flex items-center gap-2.5 rounded-control text-app font-semibold text-ink">
            <Logo />
            <span className="hidden sm:inline">Enquiry Tracker</span>
          </Link>
          <span className="mx-2 hidden h-6 w-px bg-line lg:block" aria-hidden="true" />
          {/* On the narrowest phones the icons scroll inside the bar rather than widening the page. */}
          <nav aria-label="Main" className="flex h-full min-w-0 items-center overflow-x-auto [scrollbar-width:none]">
            <NavLink to="/" end className={navClass}>
              <Icon name="home" />
              <span className="sr-only lg:not-sr-only">Dashboard</span>
            </NavLink>
            <NavLink to="/enquiries" className={navClass}>
              <Icon name="register" />
              <span className="sr-only lg:not-sr-only">Register</span>
            </NavLink>
            <NavLink to="/follow-ups" className={navClass} title="Quotes waiting 14 days or more: chase them or mark them lost">
              <Icon name="bell" />
              <span className="sr-only lg:not-sr-only">Follow-ups</span>
            </NavLink>
            <NavLink to="/reports" className={navClass}>
              <Icon name="chart" />
              <span className="sr-only lg:not-sr-only">Reports</span>
            </NavLink>
            {seesAll && (
              <NavLink to="/inbox" className={navClass} title="New enquiries and e-mails to review from the pricing mailbox">
                <Icon name="inbox" />
                <span className="sr-only lg:not-sr-only">Inbox</span>
                {waiting > 0 && (
                  <span className="rounded-full bg-selected px-1.5 text-meta font-medium tabular-nums text-primary">
                    {waiting}
                    <span className="sr-only"> waiting</span>
                  </span>
                )}
              </NavLink>
            )}
            {/* One item for the Customers, Agents and Ports tabs (MastersLayout). */}
            <Link
              to="/customers"
              className={navClass({ isActive: onMasters })}
              aria-current={onMasters ? "page" : undefined}
              title="Customers, agents and ports: lists, renaming and merging duplicates"
            >
              <Icon name="users" />
              <span className="sr-only lg:not-sr-only">Masters</span>
            </Link>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {canEdit && seesAll && (
              <Link to="/import" className={buttonClass("ghost")} title="Import Excel">
                <Icon name="upload" />
                <span className="sr-only xl:not-sr-only">Import</span>
              </Link>
            )}
            {onRegister && (
              <Button variant="ghost" onClick={exporter.run} loading={exporter.running} title="Export the filtered register to Excel">
                {!exporter.running && <Icon name="download" />}
                <span className="sr-only xl:not-sr-only">{exporter.running ? "Exporting…" : "Export"}</span>
              </Button>
            )}
            {canEdit && (
              <Link to="/enquiries/new" className={buttonClass("primary", "md", "ml-1")}>
                <Icon name="plus" />
                <span className="sr-only sm:not-sr-only">New enquiry</span>
              </Link>
            )}
            <Menu
              label={`Account and password: ${name}`}
              trigger={initials(name)}
              triggerClassName="ml-1 flex size-9 sm:ml-2 items-center justify-center rounded-full bg-selected text-control font-semibold text-primary hover:bg-primary/15"
              header={
                <div>
                  <div className="text-body font-semibold text-ink">{name}</div>
                  <div className="text-meta text-ink-muted">
                    {session?.user.email}
                    {profile && ` · ${ROLE_META[profile.role].label}`}
                  </div>
                </div>
              }
              items={[
                { label: "Account and password", icon: "user", onSelect: () => navigate("/account") },
                // Settings (logins, invitations, access) is the owner's alone.
                ...(isOwner ? [{ label: "Settings", icon: "userCog" as const, onSelect: () => navigate("/settings") }] : []),
                { label: "Sign out", icon: "logout", onSelect: () => void signOut(), separatorBefore: true },
              ]}
            />
          </div>
        </div>
      </header>

      <main className="space-y-3 px-5 py-4">
        {exporter.error && (
          <Alert action={<Button variant="ghost" size="sm" onClick={exporter.clearError}>Dismiss</Button>}>
            Export failed. {exporter.error}
          </Alert>
        )}
        {profile?.role === "viewer" && (
          <Alert kind="info">You have read-only access. Ask the owner for the editor role to add or change enquiries.</Alert>
        )}
        <Outlet />
      </main>
    </div>
  );
}
