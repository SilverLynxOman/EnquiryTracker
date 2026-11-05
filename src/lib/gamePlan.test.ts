import { describe, expect, it } from "vitest";
import {
  bestNote,
  buildGamePlan,
  crewOf,
  dayLabel,
  defaultGoal,
  defaultTeamGoal,
  goalPace,
  goalSource,
  isWorkingDay,
  laneLabel,
  lastMonthAtThisPoint,
  levelFor,
  MAX_QUOTE_MISSIONS,
  monthPace,
  nextWorkingDay,
  nthWorkingDay,
  paceShare,
  personalBests,
  planHeadline,
  quickQuoteDays,
  quickQuoteStreak,
  shipName,
  shipRows,
  streakWeek,
  teamRecord,
  winStack,
  xpEarned,
} from "./gamePlan";
import { enquiry } from "./testFixtures";
import type { TeamWin } from "./types";

const TODAY = "2026-11-05"; // a Thursday

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
    expect(paceShare({ byNow: 2, total: 4 }, pace)).toBe(4 / 22); // too little last month: working days
    expect(paceShare({ byNow: 25, total: 161 }, pace)).toBe(25 / 161);
  });

  it("labels days and lanes for people", () => {
    expect(dayLabel("2026-11-05")).toBe("Thursday 5 November");
    expect(laneLabel("SHANGHAI CHINA", "SOHAR OMAN")).toBe("Shanghai → Sohar");
    expect(laneLabel(null, null)).toBe("");
  });
});

describe("quick-quote streak", () => {
  const rows = [
    enquiry({ reference: "SL1", enquiry_date: "2026-10-27", quoted_date: "2026-10-29" }), // deadline 28 Oct: late
    enquiry({ reference: "SL2", enquiry_date: "2026-10-28", quoted_date: "2026-10-28" }),
    enquiry({ reference: "SL3", enquiry_date: "2026-10-29", quoted_date: "2026-11-01" }), // Thursday: Sunday is in time
    enquiry({ reference: "SL4", enquiry_date: "2026-11-02", quoted_date: "2026-11-03" }),
    enquiry({ reference: "SL5", enquiry_date: "2026-11-04" }), // deadline today
    enquiry({ reference: "SL6", enquiry_date: "2026-11-05" }),
  ];

  it("judges every day on which enquiries arrived", () => {
    expect(Object.fromEntries(quickQuoteDays(rows, TODAY))).toEqual({
      "2026-10-27": "miss",
      "2026-10-28": "hit",
      "2026-10-29": "hit",
      "2026-11-02": "hit",
      "2026-11-04": "pending",
      "2026-11-05": "pending",
    });
  });

  it("counts hit days since the last miss; pending days neither add nor break", () => {
    expect(quickQuoteStreak(quickQuoteDays(rows, TODAY), "2026-01-01")).toEqual({ current: 3, best: 3, pending: 2 });
  });

  it("misses an unquoted enquiry once its deadline has passed", () => {
    expect(quickQuoteDays([enquiry({ reference: "SL7", enquiry_date: "2026-11-03" })], TODAY).get("2026-11-03")).toBe("miss");
  });

  it("ignores cancelled enquiries and lost ones that were never quoted", () => {
    const closed = [
      enquiry({ reference: "SL8", enquiry_date: "2026-10-01", closure: "cancelled", status: "cancelled" }),
      enquiry({ reference: "SL9", enquiry_date: "2026-10-01", closure: "lost", status: "lost" }),
    ];
    expect(quickQuoteDays(closed, TODAY).size).toBe(0);
  });

  it("shows Sunday to Thursday of this week", () => {
    expect(streakWeek(quickQuoteDays(rows, TODAY), TODAY).map((d) => [d.label, d.status, d.isToday])).toEqual([
      ["Sun", "quiet", false],
      ["Mon", "hit", false],
      ["Tue", "quiet", false],
      ["Wed", "pending", false],
      ["Thu", "pending", true],
    ]);
  });
});

describe("XP and levels", () => {
  it("starts levels at 500, 1,500, 3,000 XP and so on", () => {
    expect(levelFor(0)).toEqual({ level: 1, rank: "Cadet", into: 0, span: 500 });
    expect(levelFor(499).level).toBe(1);
    expect(levelFor(500)).toEqual({ level: 2, rank: "Deckhand", into: 0, span: 1000 });
    expect(levelFor(25_000)).toMatchObject({ level: 10, rank: "Admiral" });
    expect(levelFor(40_000).rank).toBe("Admiral");
  });

  it("earns XP for quotes, quick quotes, wins, follow-ups and high-fives", () => {
    const rows = [
      enquiry({ reference: "SL1", enquiry_date: "2026-11-02", quoted_date: "2026-11-02" }),
      enquiry({ reference: "SL2", enquiry_date: "2026-10-20", quoted_date: "2026-10-28" }),
      enquiry({ reference: "SL3", enquiry_date: "2026-10-01", quoted_date: "2026-10-01", confirmed_date: "2026-11-03" }),
      enquiry({ reference: "SL4", enquiry_date: "2025-12-01", quoted_date: "2025-12-01" }), // last season
    ];
    expect(xpEarned(rows, "2026-01-01", TODAY, { followUps: 2, highFives: 1 })).toBe(20 + 10 + 70 + 15);
    expect(xpEarned(rows, TODAY, TODAY, { followUps: 0, highFives: 0 })).toBe(0);
  });
});

describe("today's game plan", () => {
  const rows = [
    enquiry({ reference: "SL10", enquiry_date: "2026-10-29", customer_name: "AL ZAIN LLC" }),
    enquiry({ reference: "SL11", enquiry_date: "2026-11-05", customer_name: "OMAN GASKET" }),
    enquiry({ reference: "SL12", enquiry_date: "2026-09-01", customer_name: "OLD ONE" }),
    enquiry({ reference: "SL13", enquiry_date: "2026-11-04", quoted_date: "2026-11-05", customer_name: "QUOTED TODAY" }),
    enquiry({ reference: "SL14", enquiry_date: "2026-10-30", quoted_date: "2026-11-02", customer_name: "FRESH QUOTE" }),
    enquiry({ reference: "SL15", enquiry_date: "2026-10-10", quoted_date: "2026-10-12", customer_name: "OLDER QUOTE" }),
    enquiry({ reference: "SL16", enquiry_date: "2026-10-20", quoted_date: "2026-10-21", customer_name: "RESTING" }),
    enquiry({ reference: "SL17", enquiry_date: "2026-11-03", quoted_date: "2026-11-04", customer_name: "TOO FRESH" }),
    enquiry({ reference: "SL18", enquiry_date: "2026-10-26", quoted_date: "2026-10-27", customer_name: "WEEK OLD" }),
  ];
  const followUps = [{ enquiry_id: "SL16", followed_up_on: "2026-11-03" }];

  it("lists quotes to send (oldest first), quotes sent today, follow-ups (freshest first) and a high-five", () => {
    const plan = buildGamePlan({ rows, today: TODAY, followUps, highFiveGivenToday: false });
    expect(plan.missions.map((m) => [m.title, m.done])).toEqual([
      ["Quote Al Zain LLC", false],
      ["Quote Oman Gasket", false],
      ["Quote Quoted Today", true],
      ["Follow up Fresh Quote", false],
      ["Follow up Week Old", false],
      ["Follow up Older Quote", false],
      ["Give a teammate a high-five", false],
    ]);
    expect(plan.missions[0]).toMatchObject({ detail: "SL10 · waiting 7 days", xp: 10 }); // too late for the quick bonus
    expect(plan.missions[1]).toMatchObject({ detail: "SL11 · arrived today", xp: 20 });
    expect(plan.olderWaiting).toBe(1);
    expect(plan.moreToQuote).toBe(0);
  });

  it("counts follow-ups logged today as done and plans three a day", () => {
    const today = [...followUps, { enquiry_id: "SL15", followed_up_on: TODAY }, { enquiry_id: "SL18", followed_up_on: TODAY }];
    const plan = buildGamePlan({ rows, today: TODAY, followUps: today, highFiveGivenToday: true });
    expect(plan.missions.filter((m) => m.kind === "follow_up").map((m) => [m.title, m.done])).toEqual([
      ["Follow up Fresh Quote", false],
      ["Follow up Older Quote", true],
      ["Follow up Week Old", true],
    ]);
    expect(plan.missions.at(-1)).toMatchObject({ kind: "high_five", done: true });
  });

  it("caps quote missions and reports how many more are waiting", () => {
    const many = Array.from({ length: 8 }, (_, i) => enquiry({ reference: `SL2${i}`, enquiry_date: "2026-11-01" }));
    const plan = buildGamePlan({ rows: many, today: TODAY, followUps: [], highFiveGivenToday: false });
    expect(plan.missions.filter((m) => m.kind === "quote")).toHaveLength(MAX_QUOTE_MISSIONS);
    expect(plan.moreToQuote).toBe(2);
  });

  it("writes a headline that points at the streak", () => {
    const { missions } = buildGamePlan({ rows, today: TODAY, followUps, highFiveGivenToday: false });
    expect(planHeadline(missions, { current: 4, best: 6, pending: 1 })).toBe(
      "6 missions left on today's plan. Quote the new enquiries in time and your streak grows to 5.",
    );
    expect(planHeadline(missions.map((m) => ({ ...m, done: true })), { current: 4, best: 6, pending: 0 })).toBe(
      "Game plan complete, on a 4-day streak. That's momentum.",
    );
  });
});

describe("goals, records and the win stack", () => {
  it("defaults to beating last month", () => {
    const last = { enquiries: 40, quotes: 38, quick: 30, wins: 22 };
    expect(defaultGoal("wins", last)).toBe(23);
    expect(defaultGoal("quotes", last)).toBe(40);
    expect(defaultGoal("wins", { enquiries: 0, quotes: 0, quick: 0, wins: 0 })).toBe(3);
  });

  it("compares progress with the pace marker, calling anything within one of it on pace", () => {
    const share = 4 / 22; // 30 × share = 5.45 by today
    expect(goalPace(3, 30, share)).toEqual({ status: "behind", gap: 2 });
    expect(goalPace(5, 30, share)).toEqual({ status: "on_pace", gap: 0 });
    expect(goalPace(6, 30, share)).toEqual({ status: "on_pace", gap: 0 });
    expect(goalPace(7, 30, share)).toEqual({ status: "ahead", gap: 0 });
    expect(goalPace(30, 30, 0.5)).toEqual({ status: "smashed", gap: 0 });
  });

  it("says where the goal comes from", () => {
    const last = { enquiries: 40, quotes: 38, quick: 30, wins: 35 };
    expect(goalSource("wins", 36, last, "October")).toBe("Goal: beat October (35)");
    expect(goalSource("wins", 3, { ...last, wins: 0 }, "October")).toBe("Goal: a first target of 3");
    expect(goalSource("quotes", 40, last, "October")).toBe("Goal: beat October (38)");
  });

  it("finds this season's records", () => {
    const rows = [
      enquiry({ reference: "SL1", enquiry_date: "2026-10-05", quoted_date: "2026-10-05", confirmed_date: "2026-10-06" }),
      enquiry({ reference: "SL2", enquiry_date: "2026-10-05", quoted_date: "2026-10-06", confirmed_date: "2026-10-20" }),
      enquiry({ reference: "SL3", enquiry_date: "2026-11-02", quoted_date: "2026-11-02", confirmed_date: "2026-11-03" }),
      enquiry({ reference: "SL4", enquiry_date: "2026-11-04", quoted_date: "2026-11-04" }),
    ];
    const bests = personalBests(rows, TODAY, { current: 2, best: 5, pending: 0 });
    expect(bests.map((b) => [b.key, b.current, b.best])).toEqual([
      ["week_quotes", 2, 2],
      ["month_wins", 1, 2],
      ["streak", 2, 5],
    ]);
    expect(bestNote(bests[1])).toBe("1 win so far. 2 more wins for a new record.");
    expect(bestNote(bests[2])).toBe("2 days so far. 4 more days for a new record.");
    expect(winStack(rows, "2026-11-01", "2026-11-30")).toEqual([
      { id: "SL3", reference: "SL3", mode: "LCL", lane: "Shanghai → Sohar", date: "2026-11-03" },
    ]);
  });
});

describe("team voyage", () => {
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
