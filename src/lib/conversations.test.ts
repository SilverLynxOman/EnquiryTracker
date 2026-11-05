import { describe, expect, it } from "vitest";
import { groupByEnquiry, groupByReference, ignoreKind, modeGroup, monthGrid, referenceSlip, referenceVariants } from "./conversations";
import type { EmailListItem } from "./types";

function mail(id: string, ref: string | null, at: string, from: string, files = 0): EmailListItem {
  return {
    id,
    received_at: at,
    from_name: from,
    from_email: `${from.toLowerCase()}@example.com`,
    attachments: Array.from({ length: files }, (_, i) => ({ filename: `f${i}.pdf`, mime_type: "application/pdf", size: 1, storage_path: null, skipped: null })),
    enquiry: ref ? { id: `id-${ref}`, reference: ref } : null,
  } as EmailListItem;
}

describe("groupByEnquiry", () => {
  const groups = groupByEnquiry([
    mail("1", "SL1", "2026-11-05T10:00:00Z", "Robert", 2),
    mail("2", "SL2", "2026-11-05T11:00:00Z", "Anwar"),
    mail("3", "SL1", "2026-11-05T12:00:00Z", "Ashwin", 1),
    mail("4", "SL1", "2026-11-05T09:00:00Z", "Robert"),
    mail("5", null, "2026-11-05T13:00:00Z", "Nobody"),
  ]);

  it("puts the most recently active enquiry first and skips unfiled mail", () => {
    expect(groups.map((g) => g.reference)).toEqual(["SL1", "SL2"]);
  });

  it("keeps each enquiry's e-mails newest first, with distinct senders and attachment totals", () => {
    const sl1 = groups[0]!;
    expect(sl1.emails.map((e) => e.id)).toEqual(["3", "1", "4"]);
    expect(sl1.latest.id).toBe("3");
    expect(sl1.people).toEqual(["Ashwin", "Robert"]);
    expect(sl1.attachments).toBe(3);
  });
});

describe("monthGrid", () => {
  it("starts weeks on Saturday: 1 Nov 2026 is a Sunday, so one blank", () => {
    const cells = monthGrid("2026-11");
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("2026-11-01");
    expect(cells.at(-1)).toBe("2026-11-30");
    expect(cells.filter(Boolean)).toHaveLength(30);
  });

  it("needs no blank when the month starts on a Saturday, and knows leap years", () => {
    expect(monthGrid("2026-08")[0]).toBe("2026-08-01"); // a Saturday
    expect(monthGrid("2028-02").filter(Boolean)).toHaveLength(29);
    expect(monthGrid("2026-05").filter((c) => c === null)).toHaveLength(6); // 1 May 2026 is a Friday
  });
});

describe("modeGroup", () => {
  it("maps the quick filters and lumps the rest into other", () => {
    expect(modeGroup("AIR")).toBe("AIR");
    expect(modeGroup("COURIER")).toBe("OTHER");
    expect(modeGroup(null)).toBe("OTHER");
  });
});

describe("referenceVariants", () => {
  it("finds a swapped or changed digit", () => {
    const v = referenceVariants("SL262810");
    expect(v).toContain("SL262180");
    expect(v).toContain("SL262811");
    expect(v).not.toContain("SL262810");
  });
  it("adds the missing digit to a short reference", () => {
    const v = referenceVariants("SL26273");
    expect(v).toContain("SL262735");
    expect(v).toContain("SL126273");
    expect(v.every((r) => r.length === 8)).toBe(true);
  });
  it("drops a digit from a long one", () => {
    expect(referenceVariants("SL2627355")).toContain("SL262735");
  });
  it("ignores what is not a reference", () => {
    expect(referenceVariants("hello")).toEqual([]);
  });
});

describe("referenceSlip", () => {
  it("names the slip", () => {
    expect(referenceSlip("SL262810", "SL262180")).toBe("two digits swapped");
    expect(referenceSlip("SL26273", "SL262735")).toBe("one digit missing");
    expect(referenceSlip("SL262810", "SL262811")).toBe("one digit different");
  });
});

describe("groupByReference", () => {
  it("groups by the first reference, newest first", () => {
    const m = (id: string, refs: string[], at: string) => ({ ...mail(id, null, at, "A"), sl_refs: refs }) as EmailListItem;
    const g = groupByReference([m("1", ["SL262810"], "2026-11-03T08:00:00Z"), m("2", ["SL262842"], "2026-11-04T08:00:00Z"), m("3", ["sl262810"], "2026-11-05T08:00:00Z")]);
    expect(g.map((x) => x.reference)).toEqual(["SL262810", "SL262842"]);
    expect(g[0]!.emails.map((e) => e.id)).toEqual(["3", "1"]);
    expect(g[0]!.since).toBe("2026-11-03T08:00:00Z");
  });
});

describe("ignoreKind", () => {
  it("reads the filing note", () => {
    expect(ignoreKind({ match_method: "rule", note: "Newsletter, mailing list or automatic reply" })).toBe("bulk");
    expect(ignoreKind({ match_method: "ai", note: "Operations e-mail – not linked to an enquiry" })).toBe("ops");
    expect(ignoreKind({ match_method: "manual", note: "Newsletter, mailing list or automatic reply" })).toBe("hand");
    expect(ignoreKind({ match_method: "ai", note: null })).toBe("other");
  });
});
