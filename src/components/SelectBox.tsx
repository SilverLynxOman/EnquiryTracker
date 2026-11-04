import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Shared look of toolbar controls: 36 px, outlined. */
export const controlBase =
  "h-9 rounded-control border border-control bg-surface text-control font-medium text-ink hover:border-ink-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/** A labelled native select for toolbars (the label is for screen readers). */
export function SelectBox({
  label,
  icon,
  value,
  onChange,
  children,
  className = "",
}: {
  label: string;
  icon?: IconName;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`relative flex items-center ${className}`}>
      <span className="sr-only">{label}</span>
      {icon && <Icon name={icon} className="pointer-events-none absolute left-2.5 size-4 text-ink-muted" />}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlBase} w-full appearance-none pr-8 ${icon ? "pl-8" : "pl-2.5"}`}
      >
        {children}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute right-2.5 size-4 text-ink-muted" />
    </label>
  );
}
