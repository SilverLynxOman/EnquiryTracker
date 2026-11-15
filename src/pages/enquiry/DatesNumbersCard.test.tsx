import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyTexts, DatedValue, DateFacts, Proof, RefChip } from "../../lib/enquiryBrief";
import { enquiry } from "../../lib/testFixtures";
import type { EnquiryRow } from "../../lib/types";
import { DatesNumbersCard, houseSubjectButton, refButton, shownRefs } from "./DatesNumbersCard";
import type { PageActions } from "./shared";

const TODAY = "2026-11-10";
const HOUSE = "SL262713 1X20 OT FOB QINGDAO CHINA TO SOHAR OMAN";

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

const row = enquiry({ reference: "SL262713", enquiry_date: "2026-10-26", quoted_date: "2026-10-27", confirmed_date: "2026-10-28", customer_name: "STERLING", pol: "QINGDAO CHINA", pod: "SOHAR OMAN" });

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const sunny = proof("m-etd", "Sunny Wang (Consolclub)", "Mon 09 Nov, 14:08", "Kindly note the new ETD 21 Nov, ETA Sohar 14 Dec");
const kelly = proof("m-etd0", "Kelly Zhou (WWL)", "Thu 05 Nov, 16:21", "ETD 6/11, ETA 2/12");
const ours = proof("m-offer", "Anwar K. S. (Silver Lynx)", "Tue 27 Oct, 09:37", "TT: 35 days, 14 days free at POD");

const etd: DatedValue = { date: "2026-11-21", text: "ETD 21 Nov", port: null, proof: sunny, earlier: [{ date: "2026-11-06", text: "ETD 6/11", proof: kelly }], slipDays: 15, plan: false };

const dates: DateFacts = {
  etd,
  eta: { date: "2026-12-14", text: "ETA Sohar 14 Dec", port: "SOHAR OMAN", proof: sunny, earlier: [], slipDays: null, plan: false },
  atd: null,
  cutoff: { value: "Thu 19 Nov, 12:00", proof: sunny },
  transit: { ours: { value: "35 days", proof: ours }, agent: { value: "25–35 days", proof: sunny } },
  freeDays: { asked: 14, given: { value: 11, proof: sunny } },
  validity: [
    { who: "Frontline", until: null, daysLeft: null, ended: false, none: true, boilerplate: false, text: "none given", proof: kelly },
    { who: "MLE", until: "2026-11-30", daysLeft: 20, ended: false, none: false, boilerplate: true, text: "valid until Mon 30 Nov", proof: kelly },
    { who: "Our offer", until: null, daysLeft: null, ended: false, none: true, boilerplate: false, text: "none stated", proof: null },
  ],
  promises: [
    { by: "us", sentence: "will update by tomorrow", due: "2026-11-09", kept: false, proof: proof("m-promise", "Ashwin Luiz (Silver Lynx)", "Sun 08 Nov, 11:28", "We will update by tomorrow") },
    { by: "them", sentence: "will revert shortly", due: "2026-11-05", kept: true, proof: proof("m-kept", "Kelly Zhou (WWL)", "Wed 04 Nov, 08:59", "Well noted, will revert shortly") },
  ],
  headline: { text: "ETD in 11 days", tone: "neutral" },
};

const none: DateFacts = { etd: null, eta: null, atd: null, cutoff: null, transit: { ours: null, agent: null }, freeDays: { asked: null, given: null }, validity: [], promises: [], headline: null };

const chip = (kind: RefChip["kind"], label: string, value: string, copyLabel: string, from: Proof | null): RefChip => ({ kind, label, value, copyLabel, proof: from });

const refs: RefChip[] = [
  chip("reference", "Reference", "SL262713", "Copy reference SL262713", null),
  chip("po", "PO", "26SOM0398", "Copy PO number 26SOM0398", ours),
  chip("agent_job", "Agent job", "HPQDOM2611163", "Copy agent job number HPQDOM2611163", sunny),
  chip("so", "SO", "KMTCTAO8748592", "Copy SO number KMTCTAO8748592", sunny),
  chip("container", "Container", "MRKU4046894", "Copy container number MRKU4046894", sunny),
  chip("vessel", "Vessel / voyage", "KMTC TIANJIN 2511S", "Copy vessel and voyage KMTC TIANJIN 2511S", sunny),
];

const copy: CopyTexts = { status: null, offer: null, chase: {}, requestBlock: "", houseSubject: HOUSE };

const render = (over: { dates?: DateFacts; refs?: RefChip[]; row?: EnquiryRow; copy?: CopyTexts; busy?: PageActions["busy"] } = {}) =>
  renderToStaticMarkup(
    <DatesNumbersCard dates={over.dates ?? dates} refs={over.refs ?? refs} row={over.row ?? row} today={TODAY} copy={over.copy ?? copy} actions={{ ...actions, busy: over.busy ?? {} }} />,
  );

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees: no markup, nothing that is only for screen readers. */
const seen = (html: string) =>
  html
    .replace(/<span class="sr-only">.*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("DatesNumbersCard", () => {
  it("shows the dates the e-mails give, each with what it was before", () => {
    const html = render();
    const text = seen(html);
    expect(text.startsWith("Dates and numbersDates")).toBe(true);
    expect(text).toContain("ETD in 11 days");
    expect(text).toContain("ETDSat 21 Nov");
    expect(text).toContain("15 days later than before");
    expect(text).toContain("was 06 Nov (WWL, Thu 05 Nov, 16:21)");
    expect(text).toContain("ETAMon 14 Dec · Sohar");
    expect(text).toContain("Cut-offThu 19 Nov, 12:00");
    expect(text).toContain("Transit35 days (we said) · 25–35 days (agent)");
    expect(text).toContain("Free days14 asked · 11 given");
    expect(text).toContain("3 fewer than asked");
    expect(text).toContain("Frontline: none given");
    expect(text).toContain("MLE: valid until Mon 30 Nov · from their standard wording");
    expect(text).toContain("Our offer: none stated");
    expect(text).toContain("We said “will update by tomorrow” Sun 08 Nov, 11:28");
    expect(text).toContain("was due Mon 09 Nov");
    expect(text).toContain("Kept: theirs, Wed 04 Nov, 08:59");
    expect(text).not.toContain("ATD");
    expect(text).not.toContain("No dates in the e-mails yet.");
  });

  it("opens the e-mail a date was read from, and names who wrote it and when", () => {
    const html = render().split("Numbers</h3>")[0];
    const title = (p: Proof) => `title="${p.who} · ${p.when} · “${p.sentence}”"`;
    // ETD, ETA, the cut-off, the agent's transit time and the free days given are Sunny's.
    expect(count(html, title(sunny))).toBe(5);
    // The earlier ETD and two validities are Kelly's.
    expect(count(html, title(kelly))).toBe(3);
    expect(html).toContain("(from Kelly Zhou (WWL), Thu 05 Nov, 16:21; opens the e-mail)");
    // Our offer's validity has no e-mail to open: it is plain text.
    expect(html).toContain('<span class="tabular-nums">Our offer: none stated</span>');
  });

  it("says a slip of more than three days, fewer free days and a broken promise in amber, each with an icon", () => {
    const html = render();
    expect(html).toContain("font-medium tabular-nums text-await");
    // The slip, the free days and the promise that fell due.
    expect(count(html, 'text-meta font-medium text-await"><svg')).toBe(3);
    expect(html).not.toContain("text-lost");

    const small = render({ dates: { ...none, etd: { ...etd, slipDays: 3 } } });
    expect(seen(small)).toContain("3 days later than before");
    expect(small).not.toContain("text-await");
    const sooner = render({ dates: { ...none, etd: { ...etd, slipDays: -5 } } });
    expect(seen(sooner)).toContain("5 days earlier than before");
    expect(sooner).not.toContain("text-await");
  });

  it("does not call a date in our own offer a slip, and shows the words found when no day could be read", () => {
    const planned = render({ dates: { ...none, etd: { ...etd, plan: true } } });
    expect(seen(planned)).toContain("Sat 21 Nov · from our offer");
    expect(seen(planned)).not.toContain("later than before");
    expect(planned).not.toContain("text-await");

    const loose = seen(render({ dates: { ...none, eta: { date: null, text: "end of November", port: null, proof: sunny, earlier: [{ date: null, text: "mid November", proof: kelly }], slipDays: null, plan: false } } }));
    expect(loose).toContain("ETAend of November");
    expect(loose).toContain("was mid November (WWL, Thu 05 Nov, 16:21)");
  });

  it("shows the day the shipment left between the ETD and the ETA", () => {
    const text = seen(render({ dates: { ...dates, atd: { date: "2026-11-22", text: "sailed on 22 Nov", port: null, proof: sunny, earlier: [], slipDays: null, plan: false } } }));
    expect(text).toContain("DepartedSun 22 Nov");
    expect(text.indexOf("ETDSat 21 Nov")).toBeLessThan(text.indexOf("DepartedSun 22 Nov"));
    expect(text.indexOf("DepartedSun 22 Nov")).toBeLessThan(text.indexOf("ETAMon 14 Dec"));
  });

  it("puts a date that passed without proof first, in red with an icon", () => {
    const html = render({ dates: { ...dates, headline: { text: "ETD 06 Nov passed — no sailing confirmed", tone: "bad" } } });
    expect(html).toMatch(/text-lost"><svg[^>]*>.*?<\/svg><span[^>]*>ETD 06 Nov passed — no sailing confirmed<\/span>/);
  });

  it("marks a validity that ended, and a promise due later stays quiet", () => {
    const html = render({
      dates: {
        ...none,
        validity: [{ who: "Frontline", until: "2026-11-07", daysLeft: -3, ended: true, none: false, boilerplate: false, text: "", proof: kelly }],
        promises: [{ ...dates.promises[0], due: "2026-11-12" }],
      },
    });
    expect(seen(html)).toContain("Frontline: ended 07 Nov");
    expect(count(html, "text-await")).toBe(1);
    expect(seen(html)).toContain("We said “will update by tomorrow” Sun 08 Nov, 11:28 — due Thu 12 Nov");
  });

  it("makes every number a button that copies it, with where it was read in the tooltip", () => {
    const html = render();
    for (const one of refs) expect(html).toContain(`aria-label="${one.copyLabel}"`);
    expect(count(html, 'aria-label="Copy ')).toBe(refs.length);
    expect(html).toContain(`aria-label="Copy SO number KMTCTAO8748592" title="${sunny.who} · ${sunny.when} · “${sunny.sentence}”"`);
    expect(html).toContain('aria-label="Copy reference SL262713" title="Copy reference SL262713"');
    expect(seen(html)).toContain("Agent jobHPQDOM2611163");
    expect(seen(html)).toContain("Vessel / voyageKMTC TIANJIN 2511S");
    expect(html).not.toContain("bg-primary");
  });

  it("hands the page the value to copy and what to say afterwards", () => {
    expect(refButton(refs[3])).toEqual({ id: "copy", label: "Copy SO number KMTCTAO8748592", variant: "ghost", copyText: "KMTCTAO8748592", copiedToast: "SO copied." });
    expect(refButton({ ...refs[2], copyLabel: "" })).toEqual({ id: "copy", label: "Copy Agent job HPQDOM2611163", variant: "ghost", copyText: "HPQDOM2611163", copiedToast: "Agent job copied." });
    expect(houseSubjectButton(copy)).toEqual({ id: "copy", label: "Copy house subject", variant: "secondary", copyText: HOUSE, copiedToast: "House subject copied." });
    expect(houseSubjectButton({ ...copy, houseSubject: "  " })).toBeNull();
  });

  it("copies the house subject, and shows what will be copied", () => {
    const html = render();
    expect(seen(html)).toContain(`Copy house subject${HOUSE}`);
    expect(render({ copy: { ...copy, houseSubject: "" } })).not.toContain("Copy house subject");
    const busy = render({ busy: { copy: true } });
    expect(count(busy, 'aria-busy="true"')).toBe(1);
  });

  it("always shows the enquiry's own reference, once", () => {
    expect(shownRefs([], row)).toEqual([{ kind: "reference", label: "Reference", value: "SL262713", copyLabel: "Copy reference SL262713", proof: null }]);
    expect(shownRefs(refs, row)).toEqual(refs);
    expect(shownRefs([refs[3], { ...refs[1], value: " " }], row).map((one) => one.kind)).toEqual(["reference", "so"]);
  });

  it("says so when the e-mails give no dates, and still offers the reference and the house subject", () => {
    const html = render({ dates: none, refs: [] });
    const text = seen(html);
    expect(text).toBe(`Dates and numbersDatesNo dates in the e-mails yet.NumbersReferenceSL262713Copy house subject${HOUSE}`);
    // The reference and the house subject.
    expect(count(html, "<button")).toBe(2);
    expect(html).not.toContain("<dl");
  });

  it("uses none of the words kept off the screen", () => {
    expect(seen(render())).not.toMatch(/\b(lane|ball|relay|silent|healthy|thin|counterparts)\b/i);
  });
});
