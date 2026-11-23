import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DocFile, DocGroup } from "../../lib/enquiryBrief";
import { DocumentsCard, orderedGroups, type DocumentsCardProps } from "./DocumentsCard";
import type { PageActions } from "./shared";

// A stored file is opened through the database module; nothing is opened here.
vi.mock("../../lib/api", () => ({ attachmentUrl: vi.fn() }));

const TODAY = "2026-11-10";

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

/** The ISO timestamp of an Oman wall-clock time ("2026-11-09 11:18"). */
const oman = (wall: string) => new Date(`${wall.replace(" ", "T")}:00+04:00`).toISOString();

const file = (filename: string, wall: string, over: Partial<DocFile> = {}): DocFile => ({
  filename,
  mime: "application/pdf",
  size: 34_956,
  storagePath: `2026/11/${filename}`,
  emailId: `m-${filename}`,
  at: oman(wall),
  from: "Alpagu",
  sideKey: "alpagu.example",
  crossFiled: false,
  ...over,
});

const group = (kind: DocGroup["kind"], subKind: DocGroup["subKind"], label: string, latest: DocFile, over: Partial<DocGroup> = {}): DocGroup => ({
  kind,
  subKind,
  label,
  latest,
  version: 1,
  sentTimes: 1,
  files: [latest],
  ...over,
});

const LONG = "HPQDOM2611149_BL_DRAFT_REVISED_AFTER_SHIPPER_COMMENTS_FINAL_CHECK.pdf";

const blDraft = group("bl_awb", "draft", "BL draft", file(LONG, "2026-11-09 11:18"), { version: 3, sentTimes: 6 });
const telex = group("bl_awb", "telex_seaway", "Telex release", file("TLX_HPQDOM2611149.pdf", "2026-11-10 08:02"));
const booking = group("booking_so", "booking", "Booking note", file("BOOKING FORM -320348- (1).xls", "2026-11-05 16:40", { from: "FRONTLINE", mime: "application/vnd.ms-excel", size: 30_720 }), { sentTimes: 4 });
const invoice = group("invoice_payment", "debit_note", "Debit note", file("DN-1182.pdf", "2026-10-28 09:05", { from: "Ashwin Luiz", storagePath: null, emailId: "m-dn" }));
const photo = group("photo", null, "Photo", file("WhatsApp Image 2026-11-04.jpeg", "2026-11-04 14:12", { from: "OMAN TEXTILES", mime: "image/jpeg", size: 178_000 }));
const stray = group("booking_so", "so", "SO", file("KMTCTAO8748592.pdf", "2026-11-09 10:58", { from: "Consolclub", emailId: "m-stray", crossFiled: true }));

// Given out of order: the card sorts by kind.
const groups = [photo, stray, invoice, telex, blDraft, booking];

const render = (over: Partial<DocumentsCardProps> = {}) => renderToStaticMarkup(<DocumentsCard groups={groups} actions={actions} today={TODAY} {...over} />);

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees: no markup, nothing that is only for screen readers. */
const seen = (html: string) =>
  html
    .replace(/<span class="sr-only">.*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("DocumentsCard", () => {
  it("lists the documents by kind, each with its version, when it came, from whom and how often it was sent", () => {
    const html = render();
    const text = seen(html);
    expect(text.startsWith("Documents (6)")).toBe(true);
    expect(text).toContain("Booking note· Thu 16:40 · Frontline");
    expect(text).toContain("BOOKING FORM -320348- (1).xls· sent 4×");
    expect(text).toContain(`BL draftv3· Mon 11:18 · Alpagu${LONG}· sent 6×`);
    expect(text).toContain("Telex release· Tue 08:02 · Alpagu");
    expect(text).toContain("Debit note· Wed 28 Oct, 09:05 · Ashwin Luiz");
    expect(text).toContain("Photo· Wed 14:12 · Oman Textiles");
    // A document sent once in one size says neither.
    expect(count(text, "sent ")).toBe(2);
    expect(count(html, ">v3<")).toBe(1);
    expect(text).not.toContain("v1");

    const order = ["Booking note", "BL draft", "Telex release", "Debit note", "Photo", "from an e-mail that looks like"].map((part) => text.indexOf(part));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(0);
  });

  it("cuts a long file name and keeps the whole of it, with the size, in the tooltip", () => {
    const html = render();
    expect(html).toContain(`title="${LONG} (35 KB)"`);
    expect(html).toMatch(/<span class="min-w-0 truncate [^"]*">HPQDOM2611149_BL_DRAFT_REVISED/);
    expect(html).toContain('title="WhatsApp Image 2026-11-04.jpeg (178 KB)"');
  });

  it("opens a stored file from its row, and the e-mail it came with from the row's menu", () => {
    const html = render();
    // One button per document, and one menu beside it.
    expect(count(html, "Open the file: ")).toBe(5);
    expect(count(html, 'aria-haspopup="menu"')).toBe(6);
    expect(html).toContain('aria-label="More about BL draft: ' + LONG + '"');
    expect(html).toContain("text-primary");
    expect(html).not.toContain("bg-primary");
  });

  it("says so when a file was not stored: its row opens the e-mail", () => {
    const html = render();
    expect(count(html, "Open the e-mail with the file: ")).toBe(1);
    expect(count(seen(html), "Not stored here: it opens the e-mail it came with.")).toBe(1);
    expect(html).toMatch(/<span class="min-w-0 truncate group-hover:underline text-ink-heading">DN-1182\.pdf<\/span>/);
  });

  it("greys a file from an e-mail that looks like another enquiry's, puts it last and names that enquiry", () => {
    const named = render({ crossFiled: [{ looksLike: "SL262790", mails: [{ id: "m-stray" }] }] });
    expect(seen(named)).toContain("from an e-mail that looks like SL262790");
    expect(named).toMatch(/<span class="text-body font-medium text-ink-muted">SO<\/span>/);
    expect(named).toMatch(/<span class="min-w-0 truncate group-hover:underline text-ink-muted">KMTCTAO8748592\.pdf<\/span>/);
    // Said with an icon, not by the grey alone.
    expect(named).toMatch(/<svg[^>]*>.*?<\/svg><span class="min-w-0 break-words">from an e-mail that looks like SL262790<\/span>/);

    expect(seen(render())).toContain("from an e-mail that looks like another enquiry's");
    expect(seen(render({ groups: [blDraft, booking] }))).not.toContain("looks like");
  });

  it("orders BL files as draft, final, telex or seaway, originals, and the newest first within a kind", () => {
    const final = group("bl_awb", "final", "BL", file("HBL.pdf", "2026-11-09 15:00"));
    const original = group("bl_awb", "original", "Original BL", file("OBL.pdf", "2026-11-08 15:00"));
    const older = group("other", null, "Other", file("notes.docx", "2026-11-02 10:00"));
    const newer = group("other", null, "Other", file("map.pdf", "2026-11-06 10:00"));
    const names = orderedGroups([older, original, stray, telex, newer, final, blDraft]).map((one) => one.latest.filename);
    expect(names).toEqual([LONG, "HBL.pdf", "TLX_HPQDOM2611149.pdf", "OBL.pdf", "map.pdf", "notes.docx", "KMTCTAO8748592.pdf"]);
  });

  it("folds a long list behind a button that says how many more there are", () => {
    const many = Array.from({ length: 11 }, (_, i) => group("other", null, "Other", file(`file-${String(i).padStart(2, "0")}.pdf`, `2026-11-0${(i % 9) + 1} 10:00`)));
    const html = render({ groups: many });
    expect(seen(html).startsWith("Documents (11)")).toBe(true);
    expect(count(html, "Open the file: ")).toBe(8);
    expect(seen(html)).toContain("Show 3 more documents");
    expect(seen(render({ groups: many.slice(0, 9) }))).toMatch(/Show 1 more document$/);
    expect(seen(render({ groups: many.slice(0, 8) }))).not.toContain("Show ");
  });

  it("says so when there are no documents, without a count or a button", () => {
    const html = render({ groups: [] });
    expect(seen(html)).toBe("DocumentsNo documents yet. Files on the e-mails appear here; signature logos are left out.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<ul");
  });

  it("uses none of the words kept off the screen", () => {
    expect(seen(render())).not.toMatch(/\b(lane|ball|relay|silent|healthy|thin|counterparts)\b/i);
  });
});
