import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { fetchInboxCounts } from "../lib/api";
import { initials } from "../lib/display";
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
  const { profile, session, canEdit, mustSetPassword, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const exporter = useRegisterExport();
  const onRegister = pathname === "/enquiries";
  const name = profile?.full_name ?? session?.user.email ?? "Account";
  const inbox = useQuery({ queryKey: ["inbox", "counts"], queryFn: fetchInboxCounts, refetchInterval: 60_000, enabled: !!profile });
  const waiting = inbox.data ? inbox.data.drafts + inbox.data.review : 0;

  // Arrived from an invite or reset e-mail: choose a password before anything else. (After the hooks above.)
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
            <NavLink to="/reports" className={navClass}>
              <Icon name="chart" />
              <span className="sr-only lg:not-sr-only">Reports</span>
            </NavLink>
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
            <NavLink to="/customers" className={navClass} title="Customer list, renaming and merging duplicates">
              <Icon name="users" />
              <span className="sr-only lg:not-sr-only">Customers</span>
            </NavLink>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {canEdit && (
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
                    {profile && ` · ${profile.role}`}
                  </div>
                </div>
              }
              items={[
                { label: "Account and password", icon: "user", onSelect: () => navigate("/account") },
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
          <Alert kind="info">You have read-only access. Ask an administrator for the editor role to add or change enquiries.</Alert>
        )}
        <Outlet />
      </main>
    </div>
  );
}
