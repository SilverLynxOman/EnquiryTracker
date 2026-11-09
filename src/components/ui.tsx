import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Status } from "../lib/types";
import { Icon, type IconName } from "./icons";

// Shared building blocks. Tokens (colours, type, radii) live in src/index.css; usage rules in docs/DESIGN.md.

const BUTTON_VARIANTS = {
  /** One per view: the main action (New enquiry, Save changes, the selected row's next step). */
  primary: "bg-primary text-white hover:bg-primary-hover disabled:bg-primary/45",
  /** Routine actions: row next steps, Export, filters. */
  secondary: "bg-surface text-ink ring-1 ring-inset ring-control hover:bg-row-hover hover:ring-ink-muted disabled:text-ink-muted/60 disabled:ring-line",
  ghost: "text-ink-heading hover:bg-row-hover hover:text-ink disabled:text-ink-muted/50",
  danger: "bg-danger text-white hover:bg-danger-hover disabled:bg-danger/45",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export const buttonClass = (variant: ButtonVariant = "primary", size: "sm" | "md" = "md", extra = "") =>
  `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-control font-medium transition-colors duration-150 disabled:cursor-not-allowed ${
    size === "sm" ? "h-8 px-2.5" : "h-9 px-3"
  } ${BUTTON_VARIANTS[variant]} ${extra}`;

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Square button for an icon alone: at least 32 × 32. Always pass an aria-label. */
export function IconButton({
  icon,
  label,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-control text-ink-heading transition-colors duration-150 hover:bg-row-hover hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted/50 ${className}`}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

export const inputClass =
  "block h-9 w-full rounded-control border border-control bg-surface px-2.5 text-control text-ink placeholder:text-ink-muted hover:border-ink-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-table-head disabled:text-ink-muted";

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // A real <label> around the one control inside, so the control is named by it; the hint stays outside the name.
  return (
    <div className={className}>
      <label className="block">
        <span className="mb-1 block text-meta font-medium text-ink-heading">{label}</span>
        {children}
      </label>
      {hint && <span className="mt-1 block text-meta text-ink-muted">{hint}</span>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-panel border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="text-body font-semibold text-ink">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface px-4 py-3">
      <div className="text-meta font-medium text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-meta text-ink-muted">{sub}</div>}
    </div>
  );
}

export const STATUS_META: Record<Status, { label: string; icon: IconName; badge: string; dot: string }> = {
  new: { label: "Awaiting quote", icon: "clock", badge: "bg-await-bg text-await", dot: "bg-await-dot" },
  quoted: { label: "Quoted", icon: "send", badge: "bg-quoted-bg text-quoted", dot: "bg-quoted-dot" },
  confirmed: { label: "Confirmed", icon: "check", badge: "bg-confirmed-bg text-confirmed", dot: "bg-confirmed-dot" },
  lost: { label: "Lost", icon: "close", badge: "bg-lost-bg text-lost", dot: "bg-lost-dot" },
  cancelled: { label: "Cancelled", icon: "ban", badge: "bg-cancelled-bg text-cancelled", dot: "bg-cancelled-dot" },
  not_genuine: { label: "Not genuine", icon: "flag", badge: "bg-not-genuine-bg text-not-genuine", dot: "bg-not-genuine-dot" },
};

/** Status as text plus an icon, never colour alone. */
export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium whitespace-nowrap ${m.badge}`}>
      <Icon name={m.icon} className="size-3.5" />
      {m.label}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-body text-ink-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Alert({
  kind = "error",
  children,
  action,
}: {
  kind?: "error" | "warning" | "success" | "info";
  children: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    error: "border-lost/25 bg-lost-bg text-lost",
    warning: "border-await/25 bg-await-bg text-await",
    success: "border-confirmed/25 bg-confirmed-bg text-confirmed",
    info: "border-primary/20 bg-selected text-ink",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2 text-body ${styles}`}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-body text-ink-muted">
      <div>{children}</div>
      {action}
    </div>
  );
}
