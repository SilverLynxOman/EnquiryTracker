import { describe, expect, it } from "vitest";
import { activityKeys, agoLabel, groupActivity, last12Months, lifecycle, monthlyCounts, ranked, type ActivityRow } from "./masterActivity";

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: "e1",
  reference: "SL000001",
  enquiry_date: "2026-11-01",
  status: "new",
  customer_id: "c1",
  agent_id: null,
  pol: null,
  pod: null,
  sales_person: null,
  ...over,
});

describe("master activity", () => {
  it("counts a port once per enquiry, by its name key", () => {
    expect(activityKeys("ports", row({ pol: "Sohar, Oman", pod: "SOHAR OMAN" }))).toEqual(["SOHAR OMAN"]);
    expect(activityKeys("agents", row({}))).toEqual([]);
    expect(activityKeys("customers", row({}))).toEqual(["c1"]);
  });

  it("groups enquiries newest first", () => {
    const g = groupActivity("customers", [row({ id: "a", enquiry_date: "2026-01-02" }), row({ id: "b", enquiry_date: "2026-03-02" })]);
    expect(g.get("c1")?.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("lists the last 12 months across a year end", () => {
    const m = last12Months("2026-11-06");
    expect(m[0]).toBe("2025-12-01");
    expect(m[11]).toBe("2026-11-01");
  });

  it("counts enquiries and confirmations per month, ignoring older ones", () => {
    const c = monthlyCounts(
      [row({ enquiry_date: "2026-11-02", status: "confirmed" }), row({ enquiry_date: "2026-11-05" }), row({ enquiry_date: "2025-10-30" })],
      "2026-11-06",
    );
    expect(c[11]).toEqual({ month: "2026-11-01", enquiries: 2, confirmed: 1 });
    expect(c.reduce((n, x) => n + x.enquiries, 0)).toBe(2);
  });

  it("ranks values with their share", () => {
    expect(ranked(["B", "A", "B", null])).toEqual([
      { value: "B", count: 2, share: 2 / 3 },
      { value: "A", count: 1, share: 1 / 3 },
    ]);
  });

  it("places rows in their lifecycle", () => {
    expect(lifecycle("2026-11-02", "2026-11-03", "2026-11-06")).toBe("new");
    expect(lifecycle("2026-01-02", "2026-10-03", "2026-11-06")).toBe("active");
    expect(lifecycle("2026-01-02", "2026-06-03", "2026-11-06")).toBe("quiet");
    expect(lifecycle("2026-01-02", "2026-04-03", "2026-11-06")).toBe("dormant");
    expect(lifecycle(null, null, "2026-11-06")).toBe("none");
  });

  it("says how long ago", () => {
    expect(agoLabel("2026-11-06", "2026-11-06")).toBe("Today");
    expect(agoLabel("2026-11-05", "2026-11-06")).toBe("Yesterday");
    expect(agoLabel("2026-10-27", "2026-11-06")).toBe("10 days ago");
    expect(agoLabel("2026-08-06", "2026-11-06")).toBe("3 months ago");
  });
});
