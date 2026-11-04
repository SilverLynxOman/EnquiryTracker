import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect?: () => void;
  /** Present for a checkbox item (menuitemcheckbox); the menu stays open when it is toggled. */
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

/**
 * A button that opens a list of actions. Rendered in a portal with fixed positioning so a scrolling table cannot
 * clip it. Keyboard: Enter/Space opens, arrows and Home/End move, Escape closes and returns focus, Tab leaves.
 */
export function Menu({
  label,
  trigger,
  triggerClassName,
  items,
  header,
}: {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  items: MenuItem[];
  /** Optional non-interactive content at the top (e.g. who is signed in). */
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Place the menu under the trigger, right-aligned, flipping up when there is no room below.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const width = menuRef.current?.offsetWidth ?? 208;
      const height = menuRef.current?.offsetHeight ?? 200;
      const up = r.bottom + height + 8 > window.innerHeight && r.top > height + 8;
      setPos({ top: up ? r.top - height - 4 : r.bottom + 4, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(els.length - 1);
    else if (e.key === "Tab") close(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={triggerClassName}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-50 min-w-52 rounded-control border border-line bg-surface py-1 text-control shadow-[0_8px_24px_rgba(25,36,59,0.14)]"
          >
            {header && <div className="border-b border-line px-3 py-2">{header}</div>}
            {items.map((it) => (
              <div key={it.label}>
                {it.separatorBefore && <div role="separator" className="my-1 border-t border-line" />}
                <button
                  type="button"
                  role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={it.checked}
                  aria-disabled={it.disabled || undefined}
                  tabIndex={-1}
                  onClick={() => {
                    if (it.disabled) return;
                    it.onSelect?.();
                    if (it.checked === undefined) close(true);
                  }}
                  className={`flex min-h-9 w-full items-center gap-2 px-3 text-left font-medium hover:bg-row-hover focus:bg-row-hover focus:outline-none aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted/60 ${
                    it.danger ? "text-danger" : "text-ink"
                  }`}
                >
                  {it.checked !== undefined ? (
                    <span className={`flex size-4 items-center justify-center rounded border ${it.checked ? "border-primary bg-primary text-white" : "border-control"}`}>
                      {it.checked && <Icon name="check" className="size-3" />}
                    </span>
                  ) : (
                    it.icon && <Icon name={it.icon} className="size-4 text-ink-muted" />
                  )}
                  {it.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
