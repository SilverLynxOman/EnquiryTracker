import { describe, expect, it } from "vitest";
import { addDays } from "./format";
import { bandFilters, chasedLabel, FOLLOW_UP_BANDS, isFollowUpBand, latestFollowUps, STALE_DAYS, staleQuoteFilters, waitingDays } from "./followUps";

const today = "2026-11-04";
const other = { salesPersonId: "s1", q: "oman" };
const ago = (n: number) => addDays(today, -n);

/** Which band a quote sent `n` days ago falls into, judged by the filters' inclusive date ranges. */
function bandOf(n: number) {
  const date = ago(n);
  return FOLLOW_UP_BANDS.filter((b) => b.key !== "unquoted").find((b) => {
    const f = bandFilters(b.key, today, other);
    return (!f.from || date >= f.from) && (!f.to || date <= f.to);
  })?.key;
}

describe("follow-up bands", () => {
  it("splits stale quotes into contiguous, non-overlapping bands", () => {
    expect(bandOf(13)).toBeUndefined();
    expect(bandOf(14)).toBe("14-30");
    expect(bandOf(30)).toBe("14-30");
    expect(bandOf(31)).toBe("31-90");
    expect(bandOf(90)).toBe("31-90");
    expect(bandOf(91)).toBe("90+");
    expect(bandOf(400)).toBe("90+");
  });

  it("covers exactly the stale quotes that the dashboard counts", () => {
    const stale = staleQuoteFilters(today);
    expect(stale).toMatchObject({ basis: "quoted_date", status: "quoted", from: "", to: ago(STALE_DAYS) });
    for (const n of [14, 15, 30, 31, 90, 91, 365]) expect(bandOf(n)).toBeDefined();
  });

  it("lists enquiries never quoted by their enquiry date", () => {
    expect(bandFilters("unquoted", today, other)).toMatchObject({ basis: "enquiry_date", status: "new", from: "", to: ago(14) });
  });

  it("keeps the sales person and search, and never filters by shipment", () => {
    for (const b of FOLLOW_UP_BANDS) expect(bandFilters(b.key, today, other)).toMatchObject({ salesPersonId: "s1", q: "oman", mode: "" });
  });

  it("recognises band keys from the URL", () => {
    expect(isFollowUpBand("31-90")).toBe(true);
    expect(isFollowUpBand("old")).toBe(false);
    expect(isFollowUpBand(null)).toBe(false);
  });
});

describe("waitingDays", () => {
  it("counts from the quote, or from the enquiry when there is none", () => {
    expect(waitingDays({ quoted_date: ago(20), enquiry_date: ago(25) }, today)).toBe(20);
    expect(waitingDays({ quoted_date: null, enquiry_date: ago(16) }, today)).toBe(16);
  });
});

describe("follow-up log", () => {
  it("keeps the latest follow-up of each enquiry, whoever logged it", () => {
    const latest = latestFollowUps([
      { enquiry_id: "e1", followed_up_on: ago(9), sales_person_id: "s1" },
      { enquiry_id: "e1", followed_up_on: ago(2), sales_person_id: "s2" },
      { enquiry_id: "e2", followed_up_on: ago(5), sales_person_id: "s1" },
    ]);
    expect(latest.get("e1")).toEqual({ enquiry_id: "e1", followed_up_on: ago(2), sales_person_id: "s2" });
    expect(latest.get("e2")?.followed_up_on).toBe(ago(5));
    expect(latest.has("e3")).toBe(false);
  });

  it("says when it was chased", () => {
    expect(chasedLabel(today, today)).toBe("Chased today");
    expect(chasedLabel(ago(1), today)).toBe("Chased yesterday");
    expect(chasedLabel(ago(6), today)).toBe("Chased 6 days ago");
  });
});
