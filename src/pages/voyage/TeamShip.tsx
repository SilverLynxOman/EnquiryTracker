import { useEffect, useId, useState } from "react";
import { shipName, shipRows } from "../../lib/teamVoyage";

/** True on screens 1024 px and wider, where the ship gets a wider (panorama) frame. */
function useLargeScreen(): boolean {
  const query = "(min-width: 1024px)";
  const [large, setLarge] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setLarge(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return large;
}

// The team voyage illustration: a container ship at sunrise, one container per confirmed job, coloured by the
// sales person who won it. Drawn as one SVG, so it keeps its proportions from a phone to the office TV.
// Colours are tokens (--color-ship-*, --color-crew-*); see docs/DESIGN.md, "The Window and the team voyage".

/** Literal class names so Tailwind generates them: index = crew colour (0 = no sales person). */
export const CREW_BG = [
  "bg-crew-0", "bg-crew-1", "bg-crew-2", "bg-crew-3", "bg-crew-4", "bg-crew-5", "bg-crew-6",
  "bg-crew-7", "bg-crew-8", "bg-crew-9", "bg-crew-10", "bg-crew-11", "bg-crew-12",
];
const CREW_FILL = [
  "fill-crew-0", "fill-crew-1", "fill-crew-2", "fill-crew-3", "fill-crew-4", "fill-crew-5", "fill-crew-6",
  "fill-crew-7", "fill-crew-8", "fill-crew-9", "fill-crew-10", "fill-crew-11", "fill-crew-12",
];

export interface ShipSlot {
  key: string;
  /** Crew colour of a loaded container; null for an empty slot. */
  colour: number | null;
  /** The next slot to fill. */
  next?: boolean;
  /** Faded while someone else's containers are highlighted. */
  dimmed?: boolean;
  title: string;
}

// Layout in SVG units (the drawing is 1000 wide and scales to its box).
const W = 1000;
const SKY = 40;
const FUNNEL = 18;
const HULL = 60;
const SEA = 46;
const GAP = 2;
const STACK_X = 165;
const STACK_W = 740;

/** Width of the panorama frame: the ship stays 1000 wide in the middle, sea and sky reach further. */
const PANORAMA = 1400;

export function TeamShip({ slots, label, rock = false }: { slots: ShipSlot[]; label: string; rock?: boolean }) {
  const stripes = `ship-stripes-${useId().replace(/:/g, "")}`;
  const view = useLargeScreen() ? PANORAMA : W;
  const shift = (view - W) / 2;
  const rows = shipRows(slots.length);
  const cols = Math.max(1, Math.ceil(slots.length / rows));
  const slotW = (STACK_W - (cols - 1) * GAP) / cols;
  const slotH = Math.min(18, Math.max(6, slotW / 2.2));
  const stackH = rows * slotH + (rows - 1) * GAP;
  const hullTop = SKY + FUNNEL + stackH;
  const hullBottom = hullTop + HULL;
  const height = hullBottom + SEA;
  const horizon = hullTop + HULL * 0.6;
  const name = shipName(import.meta.env.VITE_COMPANY_NAME);

  return (
    <div className="overflow-hidden rounded-panel bg-ship-sky">
      <svg viewBox={`0 0 ${view} ${height}`} role="img" aria-label={label} className="block h-auto w-full">
        <defs>
          <pattern id={stripes} width="6" height="10" patternUnits="userSpaceOnUse">
            <rect width="2" height="10" fill="black" fillOpacity="0.16" />
          </pattern>
        </defs>
        <circle cx={shift + W * 0.72} cy={horizon} r={height * 0.3} className="fill-ship-sun" />
        <g fill="none" strokeLinecap="round" className="stroke-ship-hull" transform={`translate(${shift} 0)`}>
          <path d="M600 34 Q608 24 616 34 Q624 24 632 34" strokeWidth="2.5" />
          <path d="M650 22 Q656 15 662 22 Q668 15 674 22" strokeWidth="2" />
          <path d="M688 38 Q693 32 698 38 Q703 32 708 38" strokeWidth="2" />
        </g>
        <rect x="0" y={horizon} width={view} height={height - horizon} className="fill-ship-sea" />

        {/* The ship. The inner group rocks on the TV view; its CSS transform would override the offset. */}
        <g transform={`translate(${shift} 0)`}>
          <g className={rock ? "animate-bob" : undefined}>
            {/* Bridge and funnel at the stern */}
            <rect x="97" y={SKY} width="22" height={FUNNEL} rx="3" className="fill-ship-hull" />
            <rect x="97" y={SKY + 6} width="22" height="5" className="fill-ship-funnel" />
            <rect x="88" y={SKY + FUNNEL} width="62" height={stackH + 2} rx="6" className="fill-ship-cabin stroke-ship-hull" strokeWidth="3" />
            {Array.from({ length: 6 }, (_, i) => (
              <rect key={i} x={97 + (i % 3) * 16} y={SKY + FUNNEL + 10 + Math.floor(i / 3) * 14} width="11" height="8" rx="2" className="fill-ship-hull" />
            ))}

            {/* Containers, loaded from the bottom row up */}
            {slots.map((slot, i) => {
              const row = Math.floor(i / cols);
              const col = i % cols;
              const x = STACK_X + col * (slotW + GAP);
              const y = hullTop - (row + 1) * slotH - row * GAP;
              if (slot.colour !== null) {
                return (
                  <g key={slot.key} opacity={slot.dimmed ? 0.2 : 1}>
                    <title>{slot.title}</title>
                    <rect x={x} y={y} width={slotW} height={slotH} rx="1.5" className={CREW_FILL[slot.colour] ?? CREW_FILL[0]} />
                    <rect x={x} y={y} width={slotW} height={slotH} rx="1.5" fill={`url(#${stripes})`} />
                  </g>
                );
              }
              return (
                <rect
                  key={slot.key}
                  x={x + 0.75}
                  y={y + 0.75}
                  width={slotW - 1.5}
                  height={slotH - 1.5}
                  rx="1.5"
                  strokeWidth={slot.next ? 2.5 : 1}
                  strokeDasharray={slot.next ? undefined : "3 2"}
                  className={slot.next ? "animate-pulse fill-white/80 stroke-ship-hull" : "fill-white/30 stroke-ship-hull/40"}
                >
                  <title>{slot.title}</title>
                </rect>
              );
            })}

            {/* Hull: navy above the waterline, red boot-top below, bow to the right */}
            <polygon points={`60,${hullTop} 940,${hullTop} 896,${hullBottom} 84,${hullBottom}`} className="fill-ship-hull" />
            <polygon points={`77,${hullBottom - 18} 909,${hullBottom - 18} 896,${hullBottom} 84,${hullBottom}`} className="fill-ship-boot" />
            <text x="150" y={hullTop + 30} className="fill-white" fontSize="20" fontWeight="800" letterSpacing="6" fontFamily="inherit">
              {name}
            </text>
          </g>
        </g>

        {/* Front sea with a wavy edge, and the sun's reflection */}
        <path
          d={`M0 ${hullBottom - 12} ${Array.from({ length: Math.ceil(view / 50) }, (_, i) => `Q${i * 50 + 12.5} ${hullBottom - 20} ${i * 50 + 25} ${hullBottom - 12} T${i * 50 + 50} ${hullBottom - 12}`).join(" ")} V${height} H0 Z`}
          className="fill-ship-sea-deep"
        />
        <rect x={shift + W * 0.72 - 60} y={hullBottom + 8} width="120" height="4" rx="2" className="fill-ship-sun" opacity="0.5" />
      </svg>
    </div>
  );
}
