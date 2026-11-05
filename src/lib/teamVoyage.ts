import { displayName } from "./display";
import type { TeamWin } from "./types";

// The team voyage: one container on the ship per job confirmed this month (managers' dashboard and the TV view).
// Activity only, never money. Pure functions, tested in teamVoyage.test.ts.

export const CREW_COLOURS = 12;

export interface CrewMember {
  /** Sales person id; "" for jobs without one. */
  id: string;
  name: string;
  wins: number;
  /** 1–12 (`--color-crew-N`) in order of each person's first win this month, so colours never move; 0 when unassigned. */
  colour: number;
}

export function crewOf(wins: TeamWin[]): CrewMember[] {
  const byId = new Map<string, CrewMember>();
  let next = 0;
  for (const w of wins) {
    const id = w.sales_person_id ?? "";
    let member = byId.get(id);
    if (!member) {
      member = { id, name: id ? displayName(w.sales_person_name) || "Unknown" : "Unassigned", wins: 0, colour: id ? (next++ % CREW_COLOURS) + 1 : 0 };
      byId.set(id, member);
    }
    member.wins++;
  }
  return [...byId.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}

/** Without a goal set by an admin: beat last month. */
export function defaultTeamGoal(lastMonthConfirmed: number): number {
  return Math.max(10, lastMonthConfirmed + 1);
}

/** Rows of containers on the ship, so a bigger goal makes a longer ship rather than a taller one. */
export function shipRows(capacity: number): number {
  if (capacity <= 40) return 4;
  if (capacity <= 90) return 5;
  if (capacity <= 160) return 6;
  if (capacity <= 250) return 7;
  return 8;
}

/** "SILVER LYNX COMPANY LLC" → "SILVER LYNX": the name painted on the hull. */
export function shipName(company: string | undefined): string {
  const name = (company ?? "")
    .toUpperCase()
    .replace(/\b(COMPANY|CO|LLC|L\.L\.C|SAOC|SAOG|SPC|LTD|LIMITED|WLL)\b\.?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || "ENQUIRY TRACKER";
}

export interface MonthTotal {
  month: string;
  confirmed: number;
}

/** The best month before the current one (null without history). */
export function teamRecord(months: MonthTotal[], currentMonth: string): MonthTotal | null {
  let best: MonthTotal | null = null;
  for (const m of months) {
    if (m.month < currentMonth && (!best || m.confirmed > best.confirmed)) best = m;
  }
  return best && best.confirmed > 0 ? best : null;
}
