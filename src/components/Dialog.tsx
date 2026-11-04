import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { IconButton } from "./ui";

/**
 * Modal dialog on the native <dialog> element: focus is kept inside, Escape closes, the page behind is inert.
 * Mount it to open it and unmount it to close it; focus then returns to whatever had it before.
 * With `onSubmit` the body is a form, so Enter in a field submits.
 */
export function Dialog({
  title,
  onClose,
  onSubmit,
  busy = false,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  /** While true, Escape and the close button do nothing (a save is running). */
  busy?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      opener?.focus();
    };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit?.();
  };

  const body = (
    <>
      <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 py-4 text-body">{children}</div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>
    </>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-0 text-ink shadow-[0_16px_48px_rgba(25,36,59,0.25)] backdrop:bg-ink/40"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line py-2 pl-5 pr-3">
        <h2 id={titleId} className="text-title font-semibold">
          {title}
        </h2>
        <IconButton icon="close" label="Close" onClick={onClose} disabled={busy} />
      </header>
      {onSubmit ? <form onSubmit={submit}>{body}</form> : body}
    </dialog>
  );
}
