import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../../components/icons";
import { countEmailsByDay } from "../../lib/api";
import type { EmailStatus } from "../../lib/types";
import { dayLabel, monthGrid, type ModeFilter } from "../../lib/conversations";
import { addDays } from "../../lib/format";

export type SenderFilter = "" | "external" | "staff";

export const MODE_CHIPS: { key: ModeFilter; label: string; on: string }[] = [
  { key: "FCL", label: "FCL", on: "bg-mode-fcl-bg text-mode-fcl ring-mode-fcl" },
  { key: "LCL", label: "LCL", on: "bg-mode-lcl-bg text-mode-lcl ring-mode-lcl" },
  { key: "AIR", label: "Air", on: "bg-mode-air-bg text-mode-air ring-mode-air" },
  { key: "OTHER", label: "Other", on: "bg-mode-other-bg text-mode-other ring-mode-other" },
];

const SENDERS: { key: SenderFilter; label: string }[] = [
  { key: "", label: "Everyone" },
  { key: "external", label: "Customers & agents" },
  { key: "staff", label: "Colleagues" },
];

export const chip = (on: boolean, onClass = "bg-selected text-primary ring-primary") =>
  `inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-meta font-medium ring-1 ring-inset transition-colors duration-150 ${
    on ? `${onClass} font-semibold` : "bg-surface text-ink-heading ring-line hover:bg-row-hover"
  }`;

export const toolButton = (active: boolean) =>
  `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-control font-medium whitespace-nowrap ring-1 ring-inset transition-colors duration-150 ${
    active ? "bg-lane-mail-bg text-lane-mail ring-lane-mail" : "bg-surface text-ink-heading ring-control hover:bg-row-hover"
  }`;

/** A button with a panel under it that closes on Escape or a click elsewhere. */
export function Popover({
  button,
  children,
  label,
  align = "right",
}: {
  button: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  label: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };
  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      {button({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          // On a phone the panel spans the screen (fixed) so it never runs off an edge.
          className={`absolute top-full z-40 mt-1.5 w-[21rem] rounded-panel border border-line bg-surface p-3 shadow-[0_12px_32px_rgba(25,36,59,0.18)] max-sm:fixed max-sm:inset-x-4 max-sm:top-28 max-sm:mt-0 max-sm:w-auto ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

function monthTitle(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** "Today · 333" button that opens a month calendar with each day's follow-up e-mail count. */
export function DayPicker({
  status = "linked",
  day,
  today,
  sender,
  searching,
  onPick,
}: {
  day: string;
  today: string;
  sender: SenderFilter;
  searching: boolean;
  onPick: (day: string) => void;
  status?: EmailStatus;
}) {
  const yesterday = addDays(today, -1);
  const quick = useQuery({
    queryKey: ["inbox", "day-counts", "quick", status, day, today, sender],
    queryFn: () => countEmailsByDay(status, [...new Set([day, today, yesterday])], sender),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: 60_000,
    enabled: !searching,
  });
  const label = day === today ? "Today" : day === yesterday ? "Yesterday" : dayLabel(day, today).replace(/ \d{4}$/, "");
  const n = quick.data?.[day];

  if (searching)
    return (
      <span className={`${toolButton(false)} cursor-default text-ink-muted`} title="Search looks through every day">
        <Icon name="calendar" className="size-4" />
        All dates
      </span>
    );

  return (
    <Popover
      label="Pick a day"
      button={({ open, toggle }) => (
        <button type="button" aria-expanded={open} aria-haspopup="dialog" className={toolButton(true)} onClick={toggle} title="Pick a day">
          <Icon name="calendar" className="size-4" />
          {label}
          {n != null && <span className="rounded-full bg-lane-mail px-1.5 text-[11px] font-bold text-white tabular-nums">{n}</span>}
          <Icon name="chevronDown" className="size-3.5" />
        </button>
      )}
    >
      {(close) => (
        <MonthCalendar
          status={status}
          day={day}
          today={today}
          sender={sender}
          quick={quick.data}
          onPick={(d) => {
            onPick(d);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function MonthCalendar({
  status,
  day,
  today,
  sender,
  quick,
  onPick,
}: {
  day: string;
  today: string;
  sender: SenderFilter;
  quick?: Record<string, number>;
  onPick: (day: string) => void;
  status: EmailStatus;
}) {
  const [month, setMonth] = useState(day.slice(0, 7));
  const cells = monthGrid(month);
  const days = cells.filter((d): d is string => !!d && d <= today);
  const counts = useQuery({
    queryKey: ["inbox", "day-counts", "month", status, month, sender],
    queryFn: () => countEmailsByDay(status, days, sender),
    placeholderData: keepPreviousData,
    staleTime: month === today.slice(0, 7) ? 60_000 : 300_000,
    enabled: days.length > 0,
  });
  const yesterday = addDays(today, -1);
  const atLatest = month >= today.slice(0, 7);

  const quickButton = (d: string, text: string) => (
    <button
      type="button"
      onClick={() => onPick(d)}
      className={`h-8 flex-1 rounded-control text-meta font-semibold transition-colors duration-150 ${
        d === day ? "bg-lane-mail text-white" : "bg-surface text-ink ring-1 ring-inset ring-control hover:bg-row-hover"
      }`}
    >
      {text}
      {quick?.[d] != null && ` · ${quick[d]}`}
    </button>
  );

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        {quickButton(today, "Today")}
        {quickButton(yesterday, "Yesterday")}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous month" className="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-row-hover" onClick={() => setMonth(shiftMonth(month, -1))}>
          <Icon name="chevronLeft" />
        </button>
        <span className="text-body font-bold text-ink">{monthTitle(month)}</span>
        <button
          type="button"
          aria-label="Next month"
          disabled={atLatest}
          className="inline-flex size-8 items-center justify-center rounded-control text-ink-heading hover:bg-row-hover disabled:text-ink-muted/40 disabled:hover:bg-transparent"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <Icon name="chevronRight" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="pb-1 text-[10px] font-semibold text-ink-muted">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`blank-${i}`} />;
          const future = d > today;
          const on = d === day;
          const n = counts.data?.[d];
          return (
            <button
              key={d}
              type="button"
              disabled={future}
              aria-pressed={on}
              aria-label={`${dayLabel(d, today)}${n != null ? `: ${n} e-mails` : ""}`}
              onClick={() => onPick(d)}
              className={`flex h-10 flex-col items-center justify-center rounded-control leading-tight transition-colors duration-150 ${
                on
                  ? "bg-lane-mail text-white"
                  : future
                    ? "text-ink-muted/40"
                    : n
                      ? "bg-lane-mail-bg text-lane-mail hover:ring-1 hover:ring-lane-mail hover:ring-inset"
                      : "text-ink-heading hover:bg-row-hover"
              } ${d === today && !on ? "ring-1 ring-lane-mail ring-inset" : ""}`}
            >
              <span className="text-meta font-semibold tabular-nums">{Number(d.slice(8))}</span>
              <span className="h-3 text-[9px] font-semibold tabular-nums">{n ? n : ""}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-ink-muted">Small number: e-mails that day.</p>
    </div>
  );
}

/** "Filters (n)" button with sender, attachments and mode choices. */
export function FiltersMenu({
  sender,
  filesOnly,
  mode,
  onChange,
}: {
  /** Leave a filter out to hide it. */
  sender?: SenderFilter;
  filesOnly?: boolean;
  mode?: "" | ModeFilter;
  onChange: (changes: Record<string, string>) => void;
}) {
  const active = (sender ? 1 : 0) + (filesOnly ? 1 : 0) + (mode ? 1 : 0);
  return (
    <Popover
      label="Filters"
      button={({ open, toggle }) => (
        <button type="button" aria-expanded={open} aria-haspopup="dialog" className={toolButton(active > 0)} onClick={toggle}>
          <Icon name="sliders" className="size-4" />
          Filters
          {active > 0 && <span className="rounded-full bg-lane-mail px-1.5 text-[11px] font-bold text-white tabular-nums">{active}</span>}
        </button>
      )}
    >
      {() => (
        <div className="space-y-3">
          {sender !== undefined && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">From</legend>
            <div className="flex flex-wrap gap-1.5">
              {SENDERS.map((s) => (
                <button key={s.label} type="button" aria-pressed={sender === s.key} className={chip(sender === s.key)} onClick={() => onChange({ sender: s.key })}>
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>
          )}
          {mode !== undefined && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Mode</legend>
            <div className="flex flex-wrap gap-1.5">
              {MODE_CHIPS.map((m) => (
                <button key={m.key} type="button" aria-pressed={mode === m.key} className={chip(mode === m.key, m.on)} onClick={() => onChange({ mode: mode === m.key ? "" : m.key })}>
                  {m.label}
                </button>
              ))}
            </div>
          </fieldset>
          )}
          {filesOnly !== undefined && (
          <fieldset>
            <legend className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Attachments</legend>
            <button type="button" aria-pressed={filesOnly} className={chip(filesOnly)} onClick={() => onChange({ files: filesOnly ? "" : "1" })}>
              <Icon name="paperclip" className="size-3.5" />
              Only with attachments
            </button>
          </fieldset>
          )}
          {active > 0 && (
            <div className="border-t border-line pt-2">
              <button type="button" className="text-meta font-medium text-primary hover:underline" onClick={() => onChange({ sender: "", mode: "", files: "" })}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

/** The filters in use as small tags, each with a remove button. */
export function FilterTags({
  sender,
  filesOnly,
  mode,
  onChange,
}: {
  /** Leave a filter out to hide it. */
  sender?: SenderFilter;
  filesOnly?: boolean;
  mode?: "" | ModeFilter;
  onChange: (changes: Record<string, string>) => void;
}) {
  const tags: { key: string; label: string; className: string }[] = [];
  if (mode) tags.push({ key: "mode", label: MODE_CHIPS.find((m) => m.key === mode)!.label, className: MODE_CHIPS.find((m) => m.key === mode)!.on.replace(/ring-\S+/g, "") });
  if (sender) tags.push({ key: "sender", label: SENDERS.find((s) => s.key === sender)!.label, className: "bg-selected text-primary" });
  if (filesOnly) tags.push({ key: "files", label: "With attachments", className: "bg-table-head text-ink-heading" });
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {tags.map((t) => (
        <span key={t.key} className={`inline-flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2 text-[11px] font-semibold ${t.className}`}>
          {t.label}
          <button type="button" aria-label={`Remove the ${t.label} filter`} className="inline-flex size-4 items-center justify-center rounded-full hover:bg-black/10" onClick={() => onChange({ [t.key]: "" })}>
            <Icon name="close" className="size-3" />
          </button>
        </span>
      ))}
    </span>
  );
}

/** Two icon buttons: one row per enquiry, or every e-mail. */
export function ViewToggle({
  view,
  onChange,
  labels = {},
}: {
  view: "threads" | "list";
  onChange: (view: "threads" | "list") => void;
  labels?: Partial<Record<"threads" | "list", string>>;
}) {
  const options = [
    { key: "threads", label: labels.threads ?? "By enquiry", icon: "columns" },
    { key: "list", label: labels.list ?? "Every e-mail", icon: "register" },
  ] as const;
  return (
    <div role="group" aria-label="View" className="inline-flex shrink-0 overflow-hidden rounded-control ring-1 ring-inset ring-control">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={view === o.key}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.key)}
          className={`inline-flex h-9 w-9 items-center justify-center transition-colors duration-150 ${i ? "border-l border-control" : ""} ${
            view === o.key ? "bg-selected text-primary" : "bg-surface text-ink-muted hover:bg-row-hover hover:text-ink"
          }`}
        >
          <Icon name={o.icon} className="size-4" />
        </button>
      ))}
    </div>
  );
}
