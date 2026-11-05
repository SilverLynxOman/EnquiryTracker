import { NavLink, Outlet } from "react-router";
import { MASTER_KINDS } from "./kinds";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `relative flex h-12 items-center px-3 text-body transition-colors duration-150 ${
    isActive
      ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
      : "font-medium text-ink-heading hover:text-ink"
  }`;

/** Customers, agents and ports: one tab each, like the Reports tabs. */
export default function MastersLayout() {
  return (
    <div className="space-y-3">
      <nav aria-label="Masters" className="flex flex-wrap gap-1 border-b border-line">
        {MASTER_KINDS.map((k) => (
          <NavLink key={k.key} to={`/${k.key}`} className={tabClass}>
            {k.title}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
