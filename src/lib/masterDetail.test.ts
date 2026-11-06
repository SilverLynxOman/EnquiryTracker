import { describe, expect, it } from "vitest";
import {
  breakdown,
  monthSeries,
  rankOf,
  tally,
  usualGap,
  windowCompare,
} from "./masterDetail";
import type { Status } from "./types";

const row = (
  enquiry_date: string,
  status: Status = "quoted",
  profit: number | null = null,
  mode: string | null = "FCL",
) => ({
  enquiry_date,
  status,
  profit,
  shipment_mode: mode,
});

describe("tally", () => {
  it("counts profit on confirmed enquiries only", () => {
    expect(
      tally([
        row("2026-01-02", "confirmed", 100),
        row("2026-01-03", "quoted", 50),
        row("2026-01-04", "confirmed", null),
      ]),
    ).toEqual({
      enquiries: 3,
      confirmed: 2,
      profit: 100,
    });
  });
});

describe("monthSeries", () => {
  it("runs from the first enquiry's month to today's, keeping empty months", () => {
    const s = monthSeries(
      [
        row("2026-01-15", "confirmed", 10),
        row("2026-03-02"),
        row("2026-03-20", "confirmed", 5),
      ],
      "2026-04-06",
    );
    expect(s.map((m) => m.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(s.map((m) => m.enquiries)).toEqual([1, 0, 2, 0]);
    expect(s[2]).toMatchObject({ confirmed: 1, profit: 5 });
  });

  it("crosses the year and keeps only the latest months", () => {
    const s = monthSeries([row("2025-11-01")], "2026-02-01", 3);
    expect(s.map((m) => m.month)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("is empty without enquiries", () => {
    expect(monthSeries([], "2026-02-01")).toEqual([]);
  });
});

describe("windowCompare", () => {
  it("splits the last days from the same number of days before", () => {
    const { current, previous } = windowCompare(
      [
        row("2026-11-06"),
        row("2026-10-31", "confirmed", 7),
        row("2026-10-30"),
        row("2026-10-23"),
        row("2026-10-22"),
      ],
      "2026-11-06",
      7,
    );
    expect(current).toEqual({ enquiries: 2, confirmed: 1, profit: 7 });
    expect(previous.enquiries).toBe(1); // 24–30 Oct: the 23rd falls before it
  });
});

describe("usualGap", () => {
  it("is the median gap between enquiry days", () => {
    expect(
      usualGap([
        row("2026-01-01"),
        row("2026-01-03"),
        row("2026-01-03"),
        row("2026-01-10"),
        row("2026-01-13"),
      ]),
    ).toBe(3);
    expect(usualGap([row("2026-01-01"), row("2026-01-02")])).toBeNull();
  });
});

describe("breakdown", () => {
  it("groups, skips empty values and sorts by enquiries", () => {
    const b = breakdown(
      [
        row("2026-01-01", "confirmed", 1, "AIR"),
        row("2026-01-02", "quoted", null, "FCL"),
        row("2026-01-03", "confirmed", 2, "FCL"),
        row("2026-01-04", "quoted", null, null),
      ],
      (r) => r.shipment_mode,
    );
    expect(b).toEqual([
      { value: "FCL", enquiries: 2, confirmed: 1, profit: 2 },
      { value: "AIR", enquiries: 1, confirmed: 1, profit: 1 },
    ]);
  });
});

describe("rankOf", () => {
  it("is the place by enquiries, ties sharing it", () => {
    const all = [
      { id: "a", enquiries: 9 },
      { id: "b", enquiries: 5 },
      { id: "c", enquiries: 5 },
      { id: "d", enquiries: 0 },
    ];
    expect(rankOf("a", all)).toBe(1);
    expect(rankOf("c", all)).toBe(2);
    expect(rankOf("d", all)).toBeNull();
  });
});
