import { describe, expect, it } from "vitest";
import { compareLabel, compareRange, kpiBar, kpiDelta, kpiValues, periodRange, shiftYear, weekStart } from "./kpiPeriods";

const THU = "2026-11-05";

describe("periodRange", () => {
  it("runs each period up to today", () => {
    expect(periodRange("today", THU)).toEqual({ from: THU, to: THU });
    expect(periodRange("week", THU)).toEqual({ from: "2026-11-01", to: THU });
    expect(periodRange("month", THU)).toEqual({ from: "2026-11-01", to: THU });
    expect(periodRange("quarter", THU)).toEqual({
      from: "2026-10-01",
      to: THU,
    });
    expect(periodRange("year", THU)).toEqual({ from: "2026-01-01", to: THU });
  });

  it("starts the week on Sunday", () => {
    expect(weekStart("2026-11-01")).toBe("2026-11-01");
    expect(weekStart("2026-11-07")).toBe("2026-11-01");
    expect(weekStart("2026-11-08")).toBe("2026-11-08");
  });
});

describe("compareRange", () => {
  it("compares with the same days of the previous period", () => {
    expect(compareRange("today", "previous", THU)).toEqual({
      from: "2026-11-04",
      to: "2026-11-04",
    });
    expect(compareRange("week", "previous", THU)).toEqual({
      from: "2026-10-25",
      to: "2026-10-29",
    });
    expect(compareRange("month", "previous", THU)).toEqual({
      from: "2026-10-01",
      to: "2026-10-05",
    });
    expect(compareRange("quarter", "previous", THU)).toEqual({
      from: "2026-07-01",
      to: "2026-08-05",
    });
    expect(compareRange("year", "previous", THU)).toEqual({
      from: "2025-01-01",
      to: "2025-11-05",
    });
  });

  it("stops at the end of a shorter previous month or quarter", () => {
    expect(compareRange("month", "previous", "2026-03-31")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(compareRange("month", "previous", "2026-01-15")).toEqual({
      from: "2025-12-01",
      to: "2025-12-15",
    });
    expect(compareRange("quarter", "previous", "2026-06-30")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("can compare with the same dates last year", () => {
    expect(compareRange("month", "lastYear", THU)).toEqual({
      from: "2025-11-01",
      to: "2025-11-05",
    });
    expect(shiftYear("2028-02-29")).toBe("2027-02-28");
  });
});

describe("compareLabel", () => {
  it("names the comparison", () => {
    expect(compareLabel("today", "previous", THU)).toBe("yesterday");
    expect(compareLabel("month", "previous", THU)).toBe("Oct");
    expect(compareLabel("month", "previous", "2026-01-10")).toBe("Dec");
    expect(compareLabel("year", "previous", THU)).toBe("2025");
    expect(compareLabel("week", "lastYear", THU)).toBe("last year");
  });
});

describe("kpis", () => {
  const stats = {
    enquiries: 54,
    quoted: 46,
    confirmed: 12,
    converted: 12,
    profit: 5756,
    sell_total: 88253,
  };

  it("works out rates and averages", () => {
    const v = kpiValues(stats);
    expect(v.conversion).toBeCloseTo(22.22, 2);
    expect(v.margin).toBeCloseTo(6.52, 2);
    expect(v.avgProfit).toBeCloseTo(479.67, 2);
  });

  it("leaves rates empty when there's nothing to divide by", () => {
    const v = kpiValues({
      enquiries: 0,
      quoted: 0,
      confirmed: 0,
      converted: 0,
      profit: 0,
      sell_total: 0,
    });
    expect(v.conversion).toBeNull();
    expect(v.margin).toBeNull();
    expect(v.avgProfit).toBeNull();
  });

  it("shows change in percent, or points for rates", () => {
    expect(kpiDelta("count", 54, 49)).toEqual({ direction: "up", text: "10%" });
    expect(kpiDelta("money", 80, 100)).toEqual({
      direction: "down",
      text: "20%",
    });
    expect(kpiDelta("rate", 22.2, 20.4)).toEqual({
      direction: "up",
      text: "1.8 pts",
    });
    expect(kpiDelta("count", 5, 0)).toBeNull();
    expect(kpiDelta("count", 2749, 1)).toEqual({ direction: "up", text: "999%+" });
    expect(kpiDelta("rate", null, 10)).toBeNull();
  });

  it("fills the bar towards the comparison", () => {
    expect(kpiBar("count", 25, 50)).toBe(50);
    expect(kpiBar("count", 80, 50)).toBe(100);
    expect(kpiBar("rate", 22.2, 0)).toBe(22.2);
    expect(kpiBar("count", 0, 0)).toBe(0);
  });
});
