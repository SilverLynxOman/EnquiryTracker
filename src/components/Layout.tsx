import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Alert } from "./ui";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`;

export function Layout() {
  const { profile, session, canEdit, signOut } = useAuth();

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
            <NavLink to="/reports" className={linkClass}>
              Reports
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
            <NavLink to="/account" className="text-slate-600 hover:text-slate-900">
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
