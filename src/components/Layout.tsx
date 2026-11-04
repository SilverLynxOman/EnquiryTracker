import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { fetchInboxCounts } from "../lib/api";
import { Alert } from "./ui";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`;

export function Layout() {
  const { profile, session, canEdit, mustSetPassword, signOut } = useAuth();
  const location = useLocation();
  const inbox = useQuery({ queryKey: ["inbox", "counts"], queryFn: fetchInboxCounts, refetchInterval: 60_000, enabled: !!profile });
  const waiting = inbox.data ? inbox.data.drafts + inbox.data.review : 0;

  // Arrived from an invite or reset e-mail: choose a password before anything else.
  if (mustSetPassword && location.pathname !== "/account") return <Navigate to="/account" replace />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            Enquiry Tracker
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/enquiries" end className={linkClass}>
              Register
            </NavLink>
            <NavLink to="/inbox" className={linkClass} title="New enquiries and e-mails to review from the pricing mailbox">
              Inbox
              {waiting > 0 && <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs text-white">{waiting}</span>}
            </NavLink>
            {canEdit && (
              <>
                <NavLink to="/enquiries/new" className={linkClass}>
                  New enquiry
                </NavLink>
                <NavLink to="/import" className={linkClass}>
                  Import Excel
                </NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <NavLink to="/account" className="text-slate-600 hover:text-slate-900" title="Account and password">
              <span className="mr-1.5 font-medium text-indigo-700">Account</span>
              {profile?.full_name ?? session?.user.email}
              {profile && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{profile.role}</span>}
            </NavLink>
            <button type="button" onClick={signOut} className="text-slate-500 hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4">
        {profile?.role === "viewer" && (
          <Alert kind="info">You have read-only access. Ask an administrator for the editor role to add or change enquiries.</Alert>
        )}
        <Outlet />
      </main>
    </div>
  );
}
