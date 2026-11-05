import { MODE_LABELS, type ShipmentMode } from "../../lib/types";

const MODES: (ShipmentMode | "")[] = ["", "FCL", "LCL", "AIR", "COURIER"];

/** All modes, or one of the four that most enquiries use (the rest show under All modes). */
export function ModeFilter({ value, onChange }: { value: ShipmentMode | ""; onChange: (mode: ShipmentMode | "") => void }) {
  return (
    <div role="group" aria-label="Shipment mode" className="inline-flex flex-wrap gap-1 rounded-panel border border-line bg-surface p-1">
      {MODES.map((m) => {
        const on = m === value;
        return (
          <button
            key={m || "all"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(m)}
            className={`h-8 rounded-control px-3 text-control font-medium transition-colors duration-150 ${
              on ? "bg-primary text-white" : "text-ink-heading hover:bg-row-hover hover:text-ink"
            }`}
          >
            {m ? MODE_LABELS[m] : "All modes"}
          </button>
        );
      })}
    </div>
  );
}
