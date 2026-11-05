import { describe, expect, it } from "vitest";
import { groupByEnquiry, modeGroup } from "./conversations";
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

describe("modeGroup", () => {
  it("maps the quick filters and lumps the rest into other", () => {
    expect(modeGroup("AIR")).toBe("AIR");
    expect(modeGroup("COURIER")).toBe("OTHER");
    expect(modeGroup(null)).toBe("OTHER");
  });
});
