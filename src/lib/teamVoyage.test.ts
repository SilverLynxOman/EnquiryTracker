import { describe, expect, it } from "vitest";
import { crewOf, defaultTeamGoal, shipName, shipRows, teamRecord } from "./teamVoyage";
import type { TeamWin } from "./types";

const win = (reference: string, sp: string | null, name: string | null, date: string): TeamWin => ({
  id: reference,
  reference,
  confirmed_date: date,
  sales_person_id: sp,
  sales_person_name: name,
  shipment_mode: "FCL",
  pol: null,
  pod: null,
});

describe("team voyage", () => {
  it("colours each person in order of their first win and ranks by wins", () => {
    const crew = crewOf([
      win("SL1", "m", "MAHMUD", "2026-11-01"),
      win("SL2", "s", "SAHAN", "2026-11-01"),
      win("SL3", "m", "MAHMUD", "2026-11-03"),
      win("SL4", null, null, "2026-11-04"),
    ]);
    expect(crew).toEqual([
      { id: "m", name: "Mahmud", wins: 2, colour: 1 },
      { id: "s", name: "Sahan", wins: 1, colour: 2 },
      { id: "", name: "Unassigned", wins: 1, colour: 0 },
    ]);
  });

  it("sizes and names the ship", () => {
    expect(shipRows(60)).toBe(5);
    expect(shipRows(170)).toBe(7);
    expect(defaultTeamGoal(161)).toBe(162);
    expect(shipName("SILVER LYNX COMPANY LLC")).toBe("SILVER LYNX");
    expect(shipName(undefined)).toBe("ENQUIRY TRACKER");
  });

  it("finds the record month before this one", () => {
    const months = [
      { month: "2026-01-01", confirmed: 175 },
      { month: "2026-10-01", confirmed: 161 },
      { month: "2026-11-01", confirmed: 200 },
    ];
    expect(teamRecord(months, "2026-11-01")).toEqual({ month: "2026-01-01", confirmed: 175 });
    expect(teamRecord([], "2026-11-01")).toBeNull();
  });
});
