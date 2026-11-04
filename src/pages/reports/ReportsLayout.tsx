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
  `relative flex h-12 items-center px-3 text-body transition-colors duration-150 ${
    isActive
      ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
      : "font-medium text-ink-heading hover:text-ink"
  }`;

export default function ReportsLayout() {
  return (
    <div className="space-y-3">
      <nav aria-label="Reports" className="flex flex-wrap gap-1 border-b border-line">
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
