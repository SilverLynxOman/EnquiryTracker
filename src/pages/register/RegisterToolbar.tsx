import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/icons";
import { Menu } from "../../components/Menu";
import { Button, buttonClass } from "../../components/ui";
import type { DateBasis } from "../../lib/api";
import { displayName } from "../../lib/display";
import { BASIS_LABELS, DEFAULT_VIEW, OPTIONAL_COLUMNS, PERIODS, type ColumnPrefs, type OptionalColumn, type PeriodKey, type RegisterView } from "../../lib/registerView";
import { MODE_LABELS, SHIPMENT_MODES, type NamedRef, type ShipmentMode } from "../../lib/types";

const controlBase =
  "h-9 rounded-control border border-control bg-surface text-control font-medium text-ink hover:border-ink-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

function SelectBox({
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

export function RegisterToolbar({
  view,
  update,
  salesPersons,
  columns,
  onToggleColumn,
}: {
  view: RegisterView;
  update: (patch: Partial<RegisterView>) => void;
  salesPersons: NamedRef[];
  columns: ColumnPrefs;
  onToggleColumn: (key: OptionalColumn) => void;
}) {
  // Search applies as you type (after a short pause) or at once on Enter.
  const [search, setSearch] = useState(view.q);
  useEffect(() => setSearch(view.q), [view.q]);
  useEffect(() => {
    const term = search.trim();
    if (term === view.q) return;
    const t = setTimeout(() => update({ q: term, page: 0 }), 350);
    return () => clearTimeout(t);
    // `update` is recreated every render; the timer only needs the latest search text, so it is left out.
  }, [search, view.q]);

  const filtered =
    view.q !== "" ||
    view.salesPersonId !== "" ||
    view.mode !== "" ||
    view.basis !== DEFAULT_VIEW.basis ||
    view.period !== DEFAULT_VIEW.period;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        role="search"
        className="relative min-w-56 flex-[1_1_18rem] lg:max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: search.trim(), page: 0 });
        }}
      >
        <label htmlFor="register-search" className="sr-only">
          Search enquiries
        </label>
        <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-muted" />
        <input
          id="register-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference, customer, port or agent"
          className={`${controlBase} w-full pl-9 pr-3 font-normal placeholder:text-ink-muted [&::-webkit-search-cancel-button]:cursor-pointer`}
        />
      </form>

      <SelectBox label="Dates by" icon="calendar" value={view.basis} onChange={(v) => update({ basis: v as DateBasis, page: 0 })} className="w-40">
        {Object.entries(BASIS_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </SelectBox>

      <SelectBox label="Period" value={view.period} onChange={(v) => update({ period: v as PeriodKey, page: 0 })} className="w-44">
        {PERIODS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </SelectBox>

      {view.period === "custom" && (
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="register-from">
            From
          </label>
          <input
            id="register-from"
            type="date"
            value={view.from}
            max={view.to || undefined}
            onChange={(e) => update({ from: e.target.value, page: 0 })}
            className={`${controlBase} px-2.5`}
          />
          <span className="text-meta text-ink-muted">to</span>
          <label className="sr-only" htmlFor="register-to">
            To
          </label>
          <input
            id="register-to"
            type="date"
            value={view.to}
            min={view.from || undefined}
            onChange={(e) => update({ to: e.target.value, page: 0 })}
            className={`${controlBase} px-2.5`}
          />
        </div>
      )}

      <SelectBox label="Sales person" icon="user" value={view.salesPersonId} onChange={(v) => update({ salesPersonId: v, page: 0 })} className="w-44">
        <option value="">Everyone</option>
        {salesPersons.map((s) => (
          <option key={s.id} value={s.id}>
            {displayName(s.name)}
          </option>
        ))}
      </SelectBox>

      <SelectBox label="Shipment" icon="package" value={view.mode} onChange={(v) => update({ mode: v as ShipmentMode | "", page: 0 })} className="w-44">
        <option value="">All shipments</option>
        {SHIPMENT_MODES.map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m]}
          </option>
        ))}
      </SelectBox>

      {filtered && (
        <Button
          variant="ghost"
          onClick={() => update({ q: "", salesPersonId: "", mode: "", basis: DEFAULT_VIEW.basis, period: DEFAULT_VIEW.period, from: "", to: "", page: 0 })}
        >
          Reset
        </Button>
      )}

      <div className="ml-auto">
        <Menu
          label="Choose columns"
          trigger={
            <>
              <Icon name="columns" />
              Columns
            </>
          }
          triggerClassName={buttonClass("secondary")}
          header={<span className="text-meta text-ink-muted">Hidden automatically when space is short</span>}
          items={OPTIONAL_COLUMNS.map((c) => ({ label: c.label, checked: columns[c.key], onSelect: () => onToggleColumn(c.key) }))}
        />
      </div>
    </div>
  );
}
