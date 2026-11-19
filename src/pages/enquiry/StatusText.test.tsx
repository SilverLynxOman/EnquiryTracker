import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Proof, StatusText as StatusTextData } from "../../lib/enquiryBrief";
import type { PageActions } from "./shared";
import { statusButtons, StatusText } from "./StatusText";

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const SENTENCE = "The SO was issued to the shipper on Mon 09 Nov. Next: sailing; ETD not advised yet.";

const status: StatusTextData = {
  text: SENTENCE,
  facts: [
    { value: "SO issued Mon 09 Nov", proof: proof("m-so", "Reena Aneesh (Frontline)", "Mon 09 Nov, 10:58", "Agent have received the shipper's booking and issued S/O to the shipper") },
    { value: "Confirmed with our agent", proof: proof("m-go", "Anwar K. S. (Silver Lynx)", "Thu 05 Nov, 16:04", "Please proceed with the booking") },
  ],
  builtFrom: 3,
  warning: "Some e-mails here look like SL262790 — check the dates.",
};

const render = (value: StatusTextData | null, canReply: boolean, busy: PageActions["busy"] = {}) =>
  renderToStaticMarkup(<StatusText status={value} canReply={canReply} actions={{ ...actions, busy }} />);

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("StatusText", () => {
  it("shows the sentence, what it was built from, the warning and both buttons to someone who replies from the mailbox", () => {
    const html = render(status, true);
    expect(html).toMatch(/^<section aria-labelledby="status-text-title" class="rounded-panel border border-line bg-table-head px-4 py-3"/);
    expect(html).toContain('<h2 id="status-text-title" class="text-meta font-medium text-ink-muted">Status for the customer</h2>');
    expect(html).toContain(`<p class="mt-1 whitespace-pre-line break-words text-body text-ink">${SENTENCE}</p>`);
    expect(html).toContain("Built from 3 e-mails and the register · check it before you send.");
    expect(html).toContain("Some e-mails here look like SL262790 — check the dates.");
    expect(html).toContain("text-await");
    expect(text(html)).toContain("CopyUse in a reply");
    expect(html).not.toContain("bg-primary");
  });

  it("lists where each part comes from, closed until asked for, each opening its e-mail", () => {
    const html = render(status, true);
    expect(html).toContain('aria-expanded="false" aria-controls="status-text-facts"');
    expect(html).toContain("Where this comes from");
    expect(html).toContain('<ul id="status-text-facts" role="list" hidden=""');
    expect(text(html)).toContain("SO issued Mon 09 Nov — Reena Aneesh (Frontline), Mon 09 Nov, 10:58");
    expect(text(html)).toContain("Confirmed with our agent — Anwar K. S. (Silver Lynx), Thu 05 Nov, 16:04");
    expect(html).toContain('title="Anwar K. S. (Silver Lynx) · Thu 05 Nov, 16:04 · “Please proceed with the booking”"');
    // Copy, Use in a reply, the disclosure, and one per fact.
    expect(count(html, "<button")).toBe(5);
  });

  it("gives everyone Copy, and Use in a reply only with the mailbox", () => {
    const html = render(status, false);
    expect(html).toContain("Copy");
    expect(html).not.toContain("Use in a reply");
    expect(count(html, "<button")).toBe(4);
    expect(html).toContain(SENTENCE);
  });

  it("hands the page the text to copy, and the text for a reply to the customer", () => {
    expect(statusButtons(SENTENCE, true)).toEqual([
      { id: "copy", label: "Copy", variant: "secondary", copyText: SENTENCE, copiedToast: "Status text copied." },
      { id: "reply", label: "Use in a reply", variant: "secondary", sideKey: "customer", copyText: SENTENCE },
    ]);
    expect(statusButtons(SENTENCE, false)).toEqual([{ id: "copy", label: "Copy", variant: "secondary", copyText: SENTENCE, copiedToast: "Status text copied." }]);
  });

  it("shows the button of an action in flight as busy", () => {
    const html = render(status, true, { copy: true });
    expect(count(html, 'aria-busy="true"')).toBe(1);
    expect(count(html, ' disabled=""')).toBe(1);
  });

  it("counts one e-mail in the singular and says so when only the register was used", () => {
    expect(render({ ...status, builtFrom: 1 }, false)).toContain("Built from 1 e-mail and the register · check it before you send.");
    const plain = render({ text: "Your shipment is confirmed with our agent at origin.", facts: [], builtFrom: 0, warning: null }, false);
    expect(plain).toContain("Built from the register · check it before you send.");
    expect(plain).not.toContain("Where this comes from");
    expect(plain).not.toContain("text-await");
    expect(count(plain, "<button")).toBe(1);
  });

  it("is not there before there is anything to say", () => {
    expect(render(null, true)).toBe("");
    expect(render({ ...status, text: "  " }, true)).toBe("");
  });
});
