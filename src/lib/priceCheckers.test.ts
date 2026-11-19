import { describe, expect, it } from "vitest";
import { lastJobText, priceCheckerSince, priceCheckerSummary } from "./priceCheckers";

describe("price checkers", () => {
  it("looks back a year from today", () => {
    expect(priceCheckerSince("2026-11-09")).toBe("2025-11-09");
    expect(priceCheckerSince("2028-02-29")).toBe("2027-02-28");
  });

  it("says how many quotes and when they last booked", () => {
    expect(priceCheckerSummary({ quotes: 14 })).toBe("14 quotes in the last 12 months, no job booked");
    expect(lastJobText({ last_win: "2025-03-18" })).toBe("Last job: March 2025.");
    expect(lastJobText({ last_win: null })).toBe("No job booked in the register.");
  });
});
