import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BriefStage, Proof } from "../../lib/enquiryBrief";
import type { Stage } from "../../lib/enquiryDetails";
import { StageLine } from "./StageLine";

const TODAY = "2026-11-12";

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

/** The register's own steps of an enquiry quoted on the next working day and still waiting. */
const register: Stage[] = [
  { key: "received", label: "Enquiry received", state: "done", date: "2026-11-04", note: "From an e-mail", tone: null },
  { key: "quoted", label: "Quoted", state: "done", date: "2026-11-05", note: "By the next working day", tone: "good" },
  { key: "chased", label: "Waiting 7 days", state: "current", date: null, note: "None logged", tone: null },
  { key: "outcome", label: "Won or lost", state: "todo", date: null, note: "Not yet", tone: null },
];

const offer = proof("m-offer", "Anwar K. S. (Silver Lynx)", "Thu 05 Nov, 09:37", "Please find our final offer OMR 339 port to port");
const yes = proof("m-yes", "Fahid K V (Oman Textiles)", "Thu 05 Nov, 15:11", "You are here by nominated for this shipment");

/** The same line as the e-mails show it while the register still says awaiting quote. */
const byMail: BriefStage[] = [
  { key: "received", label: "Enquiry received", state: "done", date: "2026-11-04", note: "From an e-mail · forwarded by Jittu", tone: null, byMail: false, proof: null, registerNote: null },
  { key: "quoted", label: "Quoted by e-mail", state: "current", date: "2026-11-05", note: "Not marked in the register", tone: "warn", byMail: true, proof: offer, registerNote: null },
  { key: "chased", label: "Follow-ups", state: "todo", date: null, note: "After the quote", tone: null, byMail: false, proof: null, registerNote: null },
  { key: "outcome", label: "Looks won", state: "todo", date: "2026-11-05", note: "Nominated by e-mail — not confirmed in the register", tone: "good", byMail: true, proof: yes, registerNote: null },
];

/** A quote the register dates a day later than the e-mail that carried it. */
const differs: BriefStage[] = [
  { ...byMail[0] },
  { key: "quoted", label: "Quoted", state: "done", date: "2026-11-05", note: "By the next working day", tone: "good", byMail: false, proof: offer, registerNote: "E-mail says Wed 04 Nov 13:45" },
  { key: "chased", label: "Waiting 7 days", state: "current", date: null, note: "None logged · customer asked 2×", tone: null, byMail: false, proof: null, registerNote: null },
  { key: "outcome", label: "Won or lost", state: "todo", date: null, note: "Not yet", tone: null, byMail: false, proof: null, registerNote: null },
];

const open = { onOpenMail: () => {} };

const count = (html: string, part: string) => html.split(part).length - 1;

/** The list item of one step. */
const stage = (html: string, label: string) => html.split("<li ").find((part) => part.includes(label)) ?? "";

describe("StageLine", () => {
  it("shows the register's steps as before: no dashed marker, no button, nothing under the steps", () => {
    const html = renderToStaticMarkup(<StageLine stages={register} today={TODAY} />);
    expect(html).toMatch(/^<section aria-label="Progress" class="rounded-panel border border-line bg-surface p-4"><ol class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">/);
    expect(html).toMatch(/<\/ol><\/section>$/);
    expect(html).toContain('Enquiry received<span class="sr-only">, done</span>');
    expect(html).toContain('Waiting 7 days<span class="sr-only">, the current step</span>');
    expect(html).toContain('Won or lost<span class="sr-only">, not yet</span>');
    expect(html).toContain("Wed 04 Nov");
    expect(html).toContain("font-medium text-confirmed");
    expect(count(html, "bg-primary text-white")).toBe(2);
    expect(html).not.toContain("border-dashed");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("title=");
  });

  it("draws a step read from an e-mail with a dashed marker and opens that e-mail from its note", () => {
    const html = renderToStaticMarkup(<StageLine stages={byMail} today={TODAY} actions={open} />);
    const quoted = stage(html, "Quoted by e-mail");
    expect(quoted).toContain("size-5 shrink-0 rounded-full border-2 border-dashed border-primary bg-surface");
    expect(quoted).toContain('Quoted by e-mail<span class="sr-only">, the current step, read from an e-mail, not in the register</span>');
    expect(quoted).toContain("Thu 05 Nov");
    expect(quoted).toContain('<button type="button" title="Anwar K. S. (Silver Lynx) · Thu 05 Nov, 09:37 · “Please find our final offer OMR 339 port to port”"');
    expect(quoted).toContain("Not marked in the register");
    expect(quoted).toContain("font-medium text-await");

    const won = stage(html, "Looks won");
    expect(won).toContain("border-dashed border-primary");
    expect(won).toContain('Looks won<span class="sr-only">, not yet, read from an e-mail, not in the register</span>');
    expect(won).toContain("text-body font-semibold text-ink");
    expect(won).toContain("Nominated by e-mail — not confirmed in the register");
    expect(won).toContain("You are here by nominated for this shipment");

    expect(count(html, "border-dashed")).toBe(2);
    expect(count(html, "<button")).toBe(2);
    expect(stage(html, "Enquiry received")).toContain("From an e-mail · forwarded by Jittu");
    expect(stage(html, "Enquiry received")).not.toContain("<button");
  });

  it("adds what the e-mail says under the register's note, in amber, opening the e-mail", () => {
    const html = renderToStaticMarkup(<StageLine stages={differs} today={TODAY} actions={open} />);
    const quoted = stage(html, "Quoted<span");
    expect(quoted).toContain("bg-primary text-white");
    expect(quoted).not.toContain("border-dashed");
    expect(quoted).toContain('<div class="break-words text-meta font-medium text-confirmed">By the next working day</div>');
    expect(quoted).toContain('<div class="break-words text-meta tabular-nums text-await"><button type="button"');
    expect(quoted).toContain("E-mail says Wed 04 Nov 13:45");
    expect(count(html, "<button")).toBe(1);
    expect(html).toContain("None logged · customer asked 2×");
  });

  it("says where a step was read on hover when the page cannot open the e-mail", () => {
    const html = renderToStaticMarkup(<StageLine stages={byMail} today={TODAY} />);
    expect(html).not.toContain("<button");
    expect(html).toContain('<span title="Fahid K V (Oman Textiles) · Thu 05 Nov, 15:11 · “You are here by nominated for this shipment”">Nominated by e-mail — not confirmed in the register</span>');
    expect(count(html, "border-dashed")).toBe(2);
  });

  it("puts what the page passes under the steps, below a rule, in the same panel", () => {
    const html = renderToStaticMarkup(
      <StageLine stages={byMail} today={TODAY} actions={open}>
        <p>Shipment steps</p>
      </StageLine>,
    );
    expect(html).toMatch(/<\/ol><div class="mt-4 border-t border-line pt-3"><p>Shipment steps<\/p><\/div><\/section>$/);
    expect(renderToStaticMarkup(<StageLine stages={byMail} today={TODAY} actions={open}>{null}</StageLine>)).toMatch(/<\/ol><\/section>$/);
  });
});
