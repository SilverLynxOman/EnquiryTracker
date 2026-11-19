import { describe, expect, it } from "vitest";
import {
  buildStages,
  closedBy,
  customerMarks,
  customerStats,
  dayWithWeekday,
  isCustomerSender,
  laneStats,
  quoteSpeed,
  whenSent,
} from "./enquiryDetails";
import { enquiry } from "./testFixtures";
import type { FollowUpRecord, HistoryRow } from "./types";

const TODAY = "2026-11-05"; // a Thursday
const SEASON = "2026-01-01";
const HYDROTEC = { name: "HYDROTEC INTERNATIONAL" };

function hist(over: Partial<HistoryRow> & Pick<HistoryRow, "id" | "enquiry_date">): HistoryRow {
  return {
    reference: over.id,
    quoted_date: null,
    confirmed_date: null,
    status: over.confirmed_date ? "confirmed" : over.quoted_date ? "quoted" : "new",
    shipment_mode: "FCL",
    qty_text: "1X40'",
    pol: "ITALY",
    pod: "SOHAR OMAN",
    customer_name: "HYDROTEC INTERNATIONAL",
    agent_name: null,
    buy_total: null,
    sell_total: null,
    profit: null,
    ...over,
  };
}

describe("who wrote an e-mail", () => {
  it("knows a customer by the distinctive words or the initials of its name", () => {
    expect(customerMarks("HYDROTEC INTERNATIONAL")).toEqual({ words: ["hydrotec"], initials: [] });
    expect(customerMarks("CONSOLIDATED MARINE SERVICES").initials).toEqual(["cms"]);
    // Legal forms drop out; "CO" counts in one spelling of the initials and not in the other.
    expect(customerMarks("OMAN NATIONAL ENG & INVESTMENT CO (SAOG)")).toEqual({ words: [], initials: ["oneic", "onei"] });
  });

  it("matches the sender's domain, the contact's address or the sender's name", () => {
    expect(isCustomerSender("purchase@hydrotecinternational.com", "Akshay", HYDROTEC)).toBe(true);
    expect(isCustomerSender("logistics@cms-egypt.com", "Heba", { name: "CONSOLIDATED MARINE SERVICES" })).toBe(true);
    expect(isCustomerSender("yousuf@oneic.com.om", null, { name: "OMAN NATIONAL ENG & INVESTMENT CO (SAOG)" })).toBe(true);
    expect(isCustomerSender("someone@gmail.com", "WHITEROCKUNITED OMAN", { name: "WHITE ROCK UNITED LLC" })).toBe(true);
    expect(isCustomerSender("ops@gmail.com", "Ops", { name: "ANY CO", contactEmail: "ops@gmail.com" })).toBe(true);
    expect(isCustomerSender("b@acme.com", null, { name: "SOMETHING ELSE", contactEmail: "a@acme.com" })).toBe(true);
  });

  it("does not take an agent, a free-mail domain or a common word for the customer", () => {
    expect(isCustomerSender("alessia.dotelli@cdcitalia.it", "Alessia Dotelli - CDC Italia", HYDROTEC)).toBe(false);
    expect(isCustomerSender("someone@gmail.com", "Someone", HYDROTEC)).toBe(false);
    // OMAN and NATIONAL are too common to recognise a customer by.
    expect(isCustomerSender("rates@omanshipping.com", null, { name: "OMAN NATIONAL TRADING" })).toBe(false);
    expect(isCustomerSender(null, null, HYDROTEC)).toBe(false);
  });
});
describe("the progress line", () => {
  it("names the weekday, and the year only when it isn't this one", () => {
    expect(dayWithWeekday("2026-11-01", TODAY)).toBe("Sun 01 Nov");
    expect(dayWithWeekday("2025-12-20", TODAY)).toBe("Sat 20 Dec 2025");
    // 21:30 UTC is past midnight in Muscat.
    expect(whenSent("2026-11-04T21:30:00Z", TODAY)).toBe("Thu 05 Nov, 01:30");
  });

  it("measures the quote against the end of the next working day", () => {
    expect(quoteSpeed({ enquiry_date: "2026-11-01", quoted_date: "2026-11-01" })).toEqual({ text: "The same day", quick: true });
    // Thursday to Sunday: Friday and Saturday are the weekend.
    expect(quoteSpeed({ enquiry_date: "2026-10-29", quoted_date: "2026-11-01" })).toEqual({ text: "By the next working day", quick: true });
    expect(quoteSpeed({ enquiry_date: "2026-11-01", quoted_date: "2026-11-04" })).toEqual({ text: "3 days after the enquiry", quick: false });
    expect(quoteSpeed({ enquiry_date: "2026-11-01", quoted_date: null })).toBeNull();
  });

  it("shows when a waiting enquiry's quote is due", () => {
    const stages = (enquiry_date: string) => buildStages(enquiry({ reference: "SL1", enquiry_date }), [], TODAY);
    expect(stages("2026-11-05")[1]).toMatchObject({ state: "current", note: "Due by the end of 08 Nov", tone: null });
    expect(stages("2026-11-04")[1]).toMatchObject({ note: "Due by the end of today", tone: "warn" });
    expect(stages("2026-11-02")[1]).toMatchObject({ note: "Overdue since 04 Nov", tone: "bad" });
    expect(stages("2026-11-02").map((s) => s.state)).toEqual(["done", "current", "todo", "todo"]);
  });

  it("counts the wait and the follow-ups of an open quote", () => {
    const chases: FollowUpRecord[] = [
      { enquiry_id: "SL1", sales_person_id: "s1", followed_up_on: "2026-10-20" },
      { enquiry_id: "SL1", sales_person_id: "s2", followed_up_on: "2026-10-27" },
    ];
    const row = enquiry({ reference: "SL1", enquiry_date: "2026-10-15", quoted_date: "2026-10-16", source: "import" });
    const [received, quoted, chased, outcome] = buildStages(row, chases, TODAY);
    expect(received).toMatchObject({ date: "2026-10-15", note: "From the Excel register" });
    expect(quoted).toMatchObject({ state: "done", note: "By the next working day", tone: "good" });
    expect(chased).toMatchObject({ label: "Waiting 20 days", state: "current", note: "2 follow-ups, last 27 Oct", tone: "warn" });
    expect(outcome).toMatchObject({ state: "todo", label: "Won or lost" });
  });

  it("closes the line with the confirmation or the reason it was lost", () => {
    const won = enquiry({ reference: "SL1", enquiry_date: "2026-11-01", quoted_date: "2026-11-02", confirmed_date: "2026-11-05" });
    expect(buildStages(won, [], TODAY)[3]).toMatchObject({ state: "done", label: "Job confirmed", note: "3 days after the quote", tone: "good" });
    expect(buildStages(won, [], TODAY)[2]).toMatchObject({ state: "todo", note: "None logged" });
    const lost = enquiry({ reference: "SL2", enquiry_date: "2026-05-03", quoted_date: "2026-05-05", status: "lost", closure: "lost", closure_reason: "Rate not competitive" });
    expect(buildStages(lost, [], TODAY)[3]).toMatchObject({ state: "closed", label: "Lost", note: "Rate not competitive" });
    const cancelled = enquiry({ reference: "SL3", enquiry_date: "2026-05-03", status: "cancelled", closure: "cancelled" });
    expect(buildStages(cancelled, [], TODAY).map((s) => [s.state, s.note])).toEqual([
      ["done", "Entered in the app"],
      ["todo", "Never quoted"],
      ["todo", "None logged"],
      ["closed", "No reason recorded"],
    ]);
  });

  it("closes the line with a flag when the enquiry is not genuine", () => {
    const fake = enquiry({ reference: "SL4", enquiry_date: "2026-11-03", quoted_date: "2026-11-04", status: "not_genuine", closure: "not_genuine", closure_reason: "Competitor checking our rates" });
    expect(buildStages(fake, [], TODAY)[3]).toMatchObject({ state: "closed", label: "Not genuine", note: "Competitor checking our rates", tone: "flag" });
  });
});

describe("who closed an enquiry", () => {
  const entry = (id: number, changed_at: string, changes: Record<string, unknown> | null, changed_by = "u1") => ({
    id, enquiry_id: "e", reference: "SL1", action: "update" as const, changes, import_batch_id: null, changed_by, changed_at,
  });

  it("finds the latest change that set the closure", () => {
    const audit = [
      entry(1, "2026-11-01T08:00:00Z", { closure: { old: null, new: "not_genuine" } }, "u1"),
      entry(2, "2026-11-02T08:00:00Z", { closure: { old: "not_genuine", new: null } }, "u2"),
      entry(3, "2026-11-03T08:00:00Z", { closure: { old: null, new: "not_genuine" } }, "u3"),
      entry(4, "2026-11-04T08:00:00Z", { remarks: { old: null, new: "x" } }, "u4"),
    ];
    expect(closedBy(audit, "not_genuine")).toEqual({ by: "u3", at: "2026-11-03T08:00:00Z" });
    expect(closedBy(audit, "lost")).toBeNull();
  });
});

describe("the customer's record", () => {
  const rows = [
    hist({ id: "now", enquiry_date: "2026-11-01", quoted_date: "2026-11-02" }),
    hist({ id: "w1", enquiry_date: "2026-10-24", quoted_date: "2026-10-24", confirmed_date: "2026-10-26", sell_total: 1813, profit: 358 }),
    hist({ id: "w2", enquiry_date: "2026-07-05", quoted_date: "2026-07-06", confirmed_date: "2026-07-08", sell_total: 5894, profit: 793 }),
    hist({ id: "w3", enquiry_date: "2026-02-04", quoted_date: "2026-02-04", confirmed_date: "2026-02-05", sell_total: 6140, profit: 690 }),
    hist({ id: "q1", enquiry_date: "2026-10-24", quoted_date: "2026-10-24" }), // 12 days ago
    hist({ id: "q2", enquiry_date: "2026-05-03", quoted_date: "2026-05-05" }), // long ago
    hist({ id: "n1", enquiry_date: "2026-11-04" }),
    hist({ id: "c1", enquiry_date: "2026-09-01", status: "cancelled" }),
    hist({ id: "f1", enquiry_date: "2026-08-01", quoted_date: "2026-08-01", status: "not_genuine" }),
    hist({ id: "f2", enquiry_date: "2025-08-01", status: "not_genuine" }), // last season
    hist({ id: "old", enquiry_date: "2025-12-20", quoted_date: "2025-12-20", confirmed_date: "2026-01-10", sell_total: 999, profit: 99 }),
  ];

  it("adds up this year's enquiries and wins, and finds the usual time to confirm", () => {
    const s = customerStats(rows, "now", SEASON, TODAY);
    // Days from quote to confirmation: 2, 2 and 1.
    expect(s).toMatchObject({ enquiries: 7, notGenuine: 1, won: 3, sold: 1813 + 5894 + 6140, profit: 358 + 793 + 690, usualDays: 2 });
    // The latest win of any year, other than this enquiry.
    expect(s.lastWin?.id).toBe("w1");
    expect(s).toMatchObject({ awaiting: 1, quoted: 2, stale: 1 });
  });

  it("gives no usual time from fewer than 3 wins", () => {
    expect(customerStats(rows.slice(0, 3), "now", SEASON, TODAY).usualDays).toBeNull();
  });
});

describe("the lane's history", () => {
  it("counts the other enquiries on the lane in the same mode, and lists the latest wins with prices", () => {
    const rows = [
      hist({ id: "now", enquiry_date: "2026-11-01", quoted_date: "2026-11-02" }),
      hist({ id: "a", enquiry_date: "2026-10-13", confirmed_date: "2026-10-27", buy_total: 6436, sell_total: 7332, profit: 896 }),
      hist({ id: "b", enquiry_date: "2026-06-11", confirmed_date: "2026-07-01", buy_total: 10621, sell_total: 10881, profit: 260 }),
      hist({ id: "c", enquiry_date: "2026-02-04", confirmed_date: "2026-02-05", buy_total: 5450, sell_total: 6140, profit: 690 }),
      hist({ id: "d", enquiry_date: "2026-09-20", quoted_date: "2026-09-21" }),
      hist({ id: "lcl", enquiry_date: "2026-07-01", confirmed_date: "2026-07-05", shipment_mode: "LCL" }),
      hist({ id: "x", enquiry_date: "2026-08-01", status: "cancelled" }),
      hist({ id: "y", enquiry_date: "2025-11-01", confirmed_date: "2025-11-03" }),
    ];
    const s = laneStats(rows, { id: "now", shipment_mode: "FCL" }, SEASON, 2);
    expect(s).toMatchObject({ enquiries: 4, won: 3, open: 1 });
    expect(s.wins.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
