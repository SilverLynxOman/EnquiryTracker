import { describe, expect, it } from "vitest";
import {
  buildWindow,
  clampWindow,
  customerRecords,
  customerScore,
  monthWins,
  quickShare,
  shareWithin,
  suggestedWindow,
  TIMELINE_DAYS,
  waitStatus,
  winLags,
  WINDOW_DEFAULT,
  WINDOW_MAX,
  WINDOW_MIN,
} from "./quoteWindow";
import { enquiry } from "./testFixtures";
import type { FollowUpRecord } from "./types";

const TODAY = "2026-11-05"; // a Thursday
const SEASON = "2026-01-01";

describe("the win window", () => {
  it("measures how long each win took after its quote", () => {
    const rows = [
      enquiry({ reference: "SL1", enquiry_date: "2026-10-01", quoted_date: "2026-10-01", confirmed_date: "2026-10-01" }),
      enquiry({ reference: "SL2", enquiry_date: "2026-10-01", quoted_date: "2026-10-02", confirmed_date: "2026-10-09" }),
      enquiry({ reference: "SL3", enquiry_date: "2026-10-01", quoted_date: "2026-10-05", confirmed_date: "2026-10-03" }), // confirmed "before" the quote
      enquiry({ reference: "SL4", enquiry_date: "2025-12-01", quoted_date: "2025-12-01", confirmed_date: "2025-12-20" }), // last year
      enquiry({ reference: "SL5", enquiry_date: "2026-10-01", confirmed_date: "2026-10-04" }), // never quoted
      enquiry({ reference: "SL6", enquiry_date: "2026-10-01", quoted_date: "2026-10-01" }), // not won
    ];
    const lags = winLags(rows, SEASON);
    expect(lags).toEqual([0, 7, 0]);
    expect(shareWithin(lags, 0)).toBeCloseTo(2 / 3);
    expect(shareWithin(lags, 7)).toBe(1);
    expect(shareWithin([], 7)).toBe(0);
  });

  it("suggests the shortest window that covers 95% of a person's wins", () => {
    const lags = [...Array<number>(10).fill(0), ...Array<number>(5).fill(1), ...Array<number>(3).fill(2), 6, 9]; // 20 wins
    expect(suggestedWindow(lags)).toBe(6); // 19 of the 20 within 6 days
    expect(suggestedWindow(Array<number>(20).fill(0))).toBe(WINDOW_MIN);
    expect(suggestedWindow(Array<number>(20).fill(12))).toBe(WINDOW_MAX);
    expect(suggestedWindow([0, 1, 2])).toBe(WINDOW_DEFAULT); // too few wins to judge
  });

  it("keeps a chosen window within bounds", () => {
    expect(clampWindow(1)).toBe(WINDOW_MIN);
    expect(clampWindow(7.4)).toBe(7);
    expect(clampWindow(30)).toBe(WINDOW_MAX);
  });
});

describe("waiting for a quote", () => {
  it("is overdue after the end of the next working day", () => {
    expect(waitStatus("2026-10-29", TODAY)).toBe("overdue");
    expect(waitStatus("2026-11-04", TODAY)).toBe("due_today");
    expect(waitStatus("2026-11-05", TODAY)).toBe("new");
    expect(waitStatus("2026-11-05", "2026-11-08")).toBe("due_today"); // Thursday's enquiry is due on Sunday
  });
});

describe("the timeline", () => {
  const rows = [
    enquiry({ reference: "SL10", enquiry_date: "2026-10-29", customer_id: "zain" }),
    enquiry({ reference: "SL11", enquiry_date: "2026-11-04", shipment_mode: "AIR" }),
    enquiry({ reference: "SL12", enquiry_date: "2026-10-01" }), // waiting 35 days: the Follow-ups page's
    enquiry({ reference: "SL13", enquiry_date: "2026-11-03", quoted_date: "2026-11-04", customer_id: "quartz" }),
    enquiry({ reference: "SL14", enquiry_date: "2026-10-30", quoted_date: "2026-10-31", customer_id: "sterling" }),
    enquiry({ reference: "SL15", enquiry_date: "2026-10-26", quoted_date: "2026-10-27", customer_id: "sabbagh", shipment_mode: "AIR" }),
    enquiry({ reference: "SL16", enquiry_date: "2026-10-19", quoted_date: "2026-10-20" }), // 16 days: stale
    enquiry({ reference: "SL17", enquiry_date: "2026-11-01", quoted_date: "2026-11-01", confirmed_date: "2026-11-02" }),
  ];
  const chases: FollowUpRecord[] = [
    { enquiry_id: "SL14", followed_up_on: TODAY, sales_person_id: "me" },
    { enquiry_id: "SL15", followed_up_on: "2026-11-03", sales_person_id: "other" },
    { enquiry_id: "SL15", followed_up_on: "2026-11-01", sales_person_id: "me" },
  ];
  const base = { rows, today: TODAY, windowDays: 7, mode: "" as const, sort: "newest" as const, records: new Map(), chases, me: "me" };

  it("lists enquiries to quote, longest waiting first, then quotes up to 13 days old, newest first", () => {
    const view = buildWindow(base);
    expect(view.waiting.map((w) => [w.row.reference, w.days, w.status])).toEqual([
      ["SL10", 7, "overdue"],
      ["SL11", 1, "due_today"],
    ]);
    expect(view.quotes.map((q) => [q.row.reference, q.days, q.inWindow])).toEqual([
      ["SL13", 1, true],
      ["SL14", 5, true],
      ["SL15", 9, false],
    ]);
    expect(view).toMatchObject({ overdue: 1, inWindow: 2, lastChance: 1 });
    expect(TIMELINE_DAYS).toBe(13);
  });

  it("shows who chased a quote last, and what the viewer chased today", () => {
    const [, sterling, sabbagh] = buildWindow(base).quotes;
    expect(sterling).toMatchObject({ chasedToday: true, lastChase: { followed_up_on: TODAY, sales_person_id: "me" } });
    expect(sabbagh).toMatchObject({ chasedToday: false, lastChase: { followed_up_on: "2026-11-03", sales_person_id: "other" } });
    expect(buildWindow({ ...base, me: null }).quotes[1].chasedToday).toBe(false);
  });

  it("filters by mode and follows the window's length", () => {
    const air = buildWindow({ ...base, mode: "AIR" });
    expect(air.waiting.map((w) => w.row.reference)).toEqual(["SL11"]);
    expect(air.quotes.map((q) => q.row.reference)).toEqual(["SL15"]);
    expect(buildWindow({ ...base, windowDays: 10 })).toMatchObject({ inWindow: 3, lastChance: 0 });
  });

  it("can put the best customers first, those inside the window before the rest", () => {
    const records = new Map([
      ["quartz", { enquiries: 3, wins: 1 }],
      ["sterling", { enquiries: 31, wins: 28 }],
      ["sabbagh", { enquiries: 27, wins: 26 }],
    ]);
    const view = buildWindow({ ...base, sort: "customers", records });
    expect(view.quotes.map((q) => q.row.reference)).toEqual(["SL14", "SL13", "SL15"]);
    expect(view.quotes[0].customer).toEqual({ enquiries: 31, wins: 28 });
  });
});

describe("customers", () => {
  it("counts this year's enquiries and wins per customer", () => {
    const rows = [
      enquiry({ reference: "SL1", enquiry_date: "2026-03-01", confirmed_date: "2026-03-02", customer_id: "a" }),
      enquiry({ reference: "SL2", enquiry_date: "2026-04-01", customer_id: "a" }),
      enquiry({ reference: "SL3", enquiry_date: "2026-04-01", customer_id: "a", closure: "cancelled", status: "cancelled" }),
      enquiry({ reference: "SL4", enquiry_date: "2025-12-01", customer_id: "a" }),
      enquiry({ reference: "SL5", enquiry_date: "2026-04-01", customer_id: "b" }),
    ];
    const records = customerRecords(rows, SEASON);
    expect(records.get("a")).toEqual({ enquiries: 2, wins: 1 });
    expect(records.get("b")).toEqual({ enquiries: 1, wins: 0 });
    expect(customerScore({ enquiries: 31, wins: 28 })).toBeGreaterThan(customerScore({ enquiries: 1, wins: 1 }));
  });
});

describe("the month so far", () => {
  const won = (reference: string, quoted: string, confirmed: string, mode: "FCL" | "AIR" = "FCL") =>
    enquiry({ reference, enquiry_date: quoted, quoted_date: quoted, confirmed_date: confirmed, shipment_mode: mode });
  const rows = [
    ...["2026-06-03", "2026-06-10", "2026-06-11", "2026-06-20", "2026-06-25"].map((d, i) => won(`J${i}`, d, d)),
    won("O1", "2026-10-01", "2026-10-01"),
    won("O2", "2026-10-02", "2026-10-04"),
    won("O3", "2026-10-27", "2026-10-28"),
    won("O4", "2026-10-28", "2026-10-28", "AIR"),
    won("N1", "2026-11-01", "2026-11-02"),
    won("N2", "2026-11-03", "2026-11-03"),
  ];

  it("adds up wins day by day against the same day last month", () => {
    const m = monthWins(rows, TODAY, "", SEASON);
    expect(m.thisMonth).toEqual([0, 1, 2, 2, 2]);
    expect(m).toMatchObject({ monthDays: 30, total: 2, lastTotal: 4, lastByNow: 2, sameDay: 1 });
    expect(m.lastMonth).toHaveLength(31);
    expect(m.best).toEqual({ month: "2026-06-01", wins: 5 });
    expect(m.wins.map((e) => e.reference)).toEqual(["N2", "N1"]);
  });

  it("follows the mode filter and copes with a shorter last month", () => {
    expect(monthWins(rows, TODAY, "AIR", SEASON)).toMatchObject({ total: 0, lastTotal: 1, best: { month: "2026-10-01", wins: 1 } });
    expect(monthWins([won("F1", "2026-02-27", "2026-02-27")], "2026-03-31", "", SEASON)).toMatchObject({ lastTotal: 1, lastByNow: 1, total: 0 });
    expect(monthWins([], TODAY, "", SEASON)).toMatchObject({ total: 0, lastTotal: 0, best: null });
  });
});

describe("quote speed", () => {
  it("is the share of quoted enquiries quoted by the end of the next working day", () => {
    const times = [
      { enquiry_date: "2026-11-04", quoted_date: "2026-11-04" },
      { enquiry_date: "2026-10-29", quoted_date: "2026-11-01" }, // Thursday to Sunday: in time
      { enquiry_date: "2026-10-26", quoted_date: "2026-10-28" }, // late
      { enquiry_date: "2026-11-05", quoted_date: null },
    ];
    expect(quickShare(times)).toEqual({ share: 2 / 3, count: 3 });
    expect(quickShare([])).toEqual({ share: 0, count: 0 });
  });
});
