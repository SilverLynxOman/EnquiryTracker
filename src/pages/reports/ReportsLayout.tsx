import { Suspense } from "react";
import { NavLink, Outlet } from "react-router";
import { Spinner } from "../../components/ui";

const TABS = [
  { to: "daily", label: "Daily" },
  { to: "weekly", label: "Weekly" },
  { to: "monthly", label: "Monthly" },
  { to: "analytics", label: "Analytics" },
];

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
    isActive ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"
  }`;

export default function ReportsLayout() {
  return (
    <div className="space-y-4">
      <nav aria-label="Reports" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={tabClass}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
