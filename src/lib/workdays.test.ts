import { describe, expect, it } from "vitest";
import {
  dayLabel,
  isQuickQuote,
  isWorkingDay,
  laneLabel,
  lastMonthAtThisPoint,
  monthLabel,
  monthPace,
  nextWorkingDay,
  nthWorkingDay,
  previousMonth,
  quoteDeadline,
  seasonStart,
} from "./workdays";

describe("working days", () => {
  it("runs Sunday to Thursday", () => {
    expect(isWorkingDay("2026-11-05")).toBe(true);
    expect(isWorkingDay("2026-11-06")).toBe(false);
    expect(isWorkingDay("2026-11-07")).toBe(false);
    expect(isWorkingDay("2026-11-08")).toBe(true);
  });

  it("skips the weekend to find the next working day", () => {
    expect(nextWorkingDay("2026-11-04")).toBe("2026-11-05");
    expect(nextWorkingDay("2026-11-05")).toBe("2026-11-08");
    expect(nextWorkingDay("2026-11-06")).toBe("2026-11-08");
  });

  it("paces the month by its working days", () => {
    expect(monthPace("2026-11-05")).toEqual({ total: 22, done: 4, day: 5, share: 4 / 22 });
    expect(monthPace("2026-11-07")).toMatchObject({ done: 5, day: 5 });
    expect(monthPace("2026-08-01")).toMatchObject({ done: 0, day: 0 }); // a Saturday before the first working day
  });

  it("finds a month's Nth working day", () => {
    expect(nthWorkingDay("2026-10-01", 5)).toBe("2026-10-07");
    expect(nthWorkingDay("2026-10-01", 99)).toBe("2026-10-29");
    expect(nthWorkingDay("2026-10-01", 0)).toBeNull();
  });

  it("compares with last month after the same number of working days", () => {
    const pace = monthPace("2026-11-05"); // 4 working days done
    const dates = ["2026-10-01", "2026-10-06", "2026-10-07", "2026-10-20", "2026-11-02", null];
    expect(lastMonthAtThisPoint(dates, "2026-11-05", pace)).toEqual({ byNow: 2, total: 4 });
  });
});

describe("quick quotes", () => {
  it("are due by the end of the next working day", () => {
    expect(quoteDeadline("2026-11-04")).toBe("2026-11-05");
    expect(quoteDeadline("2026-11-05")).toBe("2026-11-08");
    expect(isQuickQuote({ enquiry_date: "2026-10-29", quoted_date: "2026-11-01" })).toBe(true);
    expect(isQuickQuote({ enquiry_date: "2026-10-27", quoted_date: "2026-10-29" })).toBe(false);
    expect(isQuickQuote({ enquiry_date: "2026-11-05", quoted_date: null })).toBe(false);
  });
});

describe("labels", () => {
  it("names days, months and lanes for people", () => {
    expect(dayLabel("2026-11-05")).toBe("Thursday 5 November");
    expect(monthLabel("2026-10-01")).toBe("October");
    expect(previousMonth("2026-01-15")).toBe("2025-12-01");
    expect(seasonStart("2026-11-05")).toBe("2026-01-01");
    expect(laneLabel("SHANGHAI CHINA", "SOHAR OMAN")).toBe("Shanghai → Sohar");
    expect(laneLabel(null, null)).toBe("");
  });
});
