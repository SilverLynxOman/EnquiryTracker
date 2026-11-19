import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActionButton, Flag, Proof } from "../../lib/enquiryBrief";
import { flagButtons, FlagsStrip } from "./FlagsStrip";
import type { PageActions } from "./shared";

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const show = (emailId: string): ActionButton => ({ id: "open_mail", label: "Show e-mail", variant: "ghost", emailIds: [emailId] });
const dismiss = (id: string): ActionButton => ({ id: "dismiss", label: "Dismiss", variant: "ghost", dismissId: id });

const hold: Flag = {
  id: "hold-m1",
  kind: "hold",
  tone: "neutral",
  icon: "pause",
  label: "On hold",
  sentence: "Pls hold… planning via Jeddah",
  who: "Basil Iqbal",
  when: "Fri 06 Nov 14:02",
  proof: proof("m1", "Basil Iqbal (Sterling)", "Fri 06 Nov, 14:02", "Pls hold this shipment, we are planning via Jeddah"),
  cleared: false,
  clearedText: null,
  buttons: [show("m1"), dismiss("hold-m1")],
};

const complaint: Flag = {
  id: "complaint-m2",
  kind: "complaint",
  tone: "bad",
  icon: "alert",
  label: "Complaint",
  sentence: "your team is not responding",
  who: "Fahid K V",
  when: "Mon 09 Nov 09:25",
  proof: proof("m2", "Fahid K V (Oman Textiles)", "Mon 09 Nov, 09:25", "It seems your team is not responding"),
  cleared: true,
  clearedText: "answered Mon 11:15",
  buttons: [show("m2"), dismiss("complaint-m2")],
};

const bounced: Flag = {
  id: "bounced-m3",
  kind: "bounced",
  tone: "bad",
  icon: "alert",
  label: "Bounced",
  sentence: "purchase@fahmyfurniture.com was blocked",
  who: "",
  when: "Sat 08:24",
  proof: proof("m3", "Mail delivery subsystem", "Sat 08 Nov, 08:24", "Final-Recipient: rfc822; purchase@fahmyfurniture.com"),
  cleared: false,
  clearedText: null,
  buttons: [show("m3"), { id: "reply", label: "Reply", variant: "secondary", sideKey: "customer" }],
};

const wrongEnquiry: Flag = {
  id: "wrong-SL262790",
  kind: "wrong_enquiry",
  tone: "warn",
  icon: "flag",
  label: "8 e-mails look like SL262790",
  sentence: "40 HQ Qingdao → Sohar",
  who: "",
  when: "",
  proof: null,
  cleared: false,
  clearedText: null,
  buttons: [
    show("m4"),
    { id: "move_mails", label: "Move to SL262790", variant: "primary", reference: "SL262790", emailIds: ["m4", "m5"] },
    { id: "keep_thread", label: "Keep here", variant: "secondary", threadIds: ["t9"] },
  ],
};

const outOfOffice: Flag = {
  id: "ooo-m6",
  kind: "out_of_office",
  tone: "neutral",
  icon: "clock",
  label: "Out of office",
  sentence: "write to Reena Aneesh reena@flgshipping.net",
  who: "Milk",
  when: "Sun 08 Nov 07:10",
  proof: proof("m6", "Milk (Frontline)", "Sun 08 Nov, 07:10", "I am out of office, please write to Reena Aneesh reena@flgshipping.net"),
  cleared: false,
  clearedText: null,
  buttons: [show("m6"), { id: "reply", label: "Reply", variant: "secondary", sideKey: "flgshipping.net" }, dismiss("ooo-m6")],
};

const deadline: Flag = {
  id: "deadline-m7",
  kind: "deadline",
  tone: "warn",
  icon: "clock",
  label: "Deadline",
  sentence: "Wants our offer by 12:00 today",
  who: "Sneha",
  when: "Mon 09 Nov 09:40",
  proof: proof("m7", "Sneha (Synergies Casting)", "Mon 09 Nov, 09:40", "Please share your best offer by 12:00 today"),
  cleared: false,
  clearedText: null,
  buttons: [],
};

const all = [complaint, hold, bounced, wrongEnquiry, outOfOffice];

const render = (flags: Flag[], rights: { canEdit?: boolean; canReply?: boolean; actions?: PageActions } = {}) =>
  renderToStaticMarkup(<FlagsStrip flags={flags} actions={rights.actions ?? actions} canEdit={rights.canEdit ?? true} canReply={rights.canReply ?? true} />);

const count = (html: string, part: string) => html.split(part).length - 1;

/** The rows, each as its own markup. */
const rows = (html: string) => html.split("<li ").slice(1);

/** The text a reader sees, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

const labels = (buttons: ActionButton[]) => buttons.map((b) => b.label);

describe("FlagsStrip", () => {
  it("shows three flags, open ones first, and says how many more there are", () => {
    const html = render(all);
    expect(html).toMatch(/^<section aria-label="Flags">/);
    const shown = rows(html);
    expect(shown).toHaveLength(3);
    expect(text(shown[0])).toContain("On hold · “Pls hold… planning via Jeddah” · Basil Iqbal, Fri 06 Nov 14:02");
    expect(text(shown[1])).toContain("Bounced · purchase@fahmyfurniture.com was blocked · Sat 08:24");
    expect(text(shown[2])).toContain("8 e-mails look like SL262790 · 40 HQ Qingdao → Sohar");
    expect(html).toContain("and 2 more");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Complaint");
    expect(html).not.toContain("Out of office");
  });

  it("tints each flag by what it is: a hold grey, a bounce red, another enquiry's e-mails amber, an absence plain", () => {
    const [onHold, bounce, wrong] = rows(render(all));
    expect(onHold).toContain("border-cancelled/25 bg-cancelled-bg");
    expect(onHold).toContain("text-cancelled");
    expect(bounce).toContain("border-lost/25 bg-lost-bg");
    expect(bounce).toContain("text-lost");
    expect(wrong).toContain("border-await/25 bg-await-bg");
    expect(wrong).toContain("text-await");
    const [absent, due] = rows(render([outOfOffice, deadline]));
    expect(absent).toContain("border-line bg-table-head");
    expect(text(absent)).toContain("Out of office · write to Reena Aneesh reena@flgshipping.net · Milk, Sun 08 Nov 07:10");
    expect(due).toContain("bg-await-bg");
    for (const row of [onHold, bounce, wrong, absent, due]) expect(row).toContain("<svg");
  });

  it("keeps an answered flag, muted, with when it was answered", () => {
    const [row] = rows(render([complaint]));
    expect(text(row)).toContain("Complaint · “your team is not responding” · Fahid K V, Mon 09 Nov 09:25 · answered Mon 11:15");
    expect(row).toContain("border-line bg-surface");
    expect(row).not.toContain("bg-lost-bg");
    expect(row).not.toContain("text-lost");
    expect(text(rows(render([{ ...complaint, clearedText: null }]))[0])).toContain("· answered");
  });

  it("names where each flag was read: on the row when it has a Show e-mail button, as a link when it has none", () => {
    const [withButton] = rows(render([hold]));
    expect(withButton).toContain('title="Basil Iqbal (Sterling) · Fri 06 Nov, 14:02 · “Pls hold this shipment, we are planning via Jeddah”"');
    expect(withButton).not.toContain("opens the e-mail");
    const [linked] = rows(render([deadline]));
    expect(linked).toMatch(/<button type="button" title="Sneha \(Synergies Casting\) · Mon 09 Nov, 09:40 · “Please share your best offer by 12:00 today”"/);
    expect(linked).toContain("opens the e-mail");
    expect(text(linked)).toContain("Deadline · Wants our offer by 12:00 today · Sneha, Mon 09 Nov 09:40");
  });

  it("cuts a long sentence to 140 characters", () => {
    const long = "We are still waiting for the shipping order and this is not acceptable any more, ".repeat(3).trim();
    const [row] = rows(render([{ ...complaint, cleared: false, sentence: long }]));
    const quoted = /“([^”]*)”/.exec(text(row))?.[1] ?? "";
    expect(quoted.length).toBeGreaterThan(120);
    expect(quoted.length).toBeLessThanOrEqual(140);
    expect(quoted.endsWith("…")).toBe(true);
    expect(long.startsWith(quoted.slice(0, -1))).toBe(true);
    expect(text(rows(render([{ ...hold, sentence: "“Pls hold”" }]))[0])).toContain("On hold · “Pls hold” · Basil Iqbal");
  });

  it("renders nothing without flags", () => {
    expect(render([])).toBe("");
  });

  it("gives someone with the mailbox every button, none of them filled", () => {
    const html = render([wrongEnquiry, bounced, outOfOffice]);
    expect(html).toContain("Move to SL262790");
    expect(html).toContain("Keep here");
    expect(count(html, ">Reply<")).toBe(2);
    expect(count(html, ">Dismiss<")).toBe(1);
    expect(count(html, ">Show e-mail<")).toBe(3);
    expect(html).not.toContain("bg-primary");
    expect(html).toMatch(/ring-control[^>]*>Move to SL262790</);
  });

  it("gives a viewer the flags and only the button that shows the e-mail", () => {
    const html = render(all, { canEdit: false, canReply: false });
    expect(text(html)).toContain("On hold");
    for (const flag of all) expect(labels(flagButtons(flag, false, false))).toEqual(["Show e-mail"]);
    expect(html).not.toContain("Move to");
    expect(html).not.toContain("Keep here");
    expect(html).not.toContain(">Reply<");
    expect(html).not.toContain(">Dismiss<");
    // Three rows with Show e-mail, and the button that shows the other two.
    expect(count(html, "<button")).toBe(4);
    expect(flagButtons(deadline, false, false)).toEqual([]);
  });

  it("gives a sales login what needs no mailbox: keep here and dismiss, not move or reply", () => {
    expect(labels(flagButtons(wrongEnquiry, true, false))).toEqual(["Show e-mail", "Keep here"]);
    expect(labels(flagButtons(bounced, true, false))).toEqual(["Show e-mail"]);
    expect(labels(flagButtons(outOfOffice, true, false))).toEqual(["Show e-mail", "Dismiss"]);
    expect(labels(flagButtons(hold, true, false))).toEqual(["Show e-mail", "Dismiss"]);
  });

  it("never lets a bounce or another enquiry's e-mails be dismissed", () => {
    expect(labels(flagButtons({ ...bounced, buttons: [...bounced.buttons, dismiss("bounced-m3")] }, true, true))).toEqual(["Show e-mail", "Reply"]);
    expect(labels(flagButtons({ ...wrongEnquiry, buttons: [...wrongEnquiry.buttons, dismiss("wrong-SL262790")] }, true, true))).toEqual([
      "Show e-mail",
      "Move to SL262790",
      "Keep here",
    ]);
  });

  it("hands the page the flag's own buttons, a filled one drawn as an outline", () => {
    const [open, away] = flagButtons(hold, true, true);
    expect(open).toBe(hold.buttons[0]);
    expect(away).toBe(hold.buttons[1]);
    expect(away).toMatchObject({ id: "dismiss", dismissId: "hold-m1" });
    const move = flagButtons(wrongEnquiry, true, true)[1];
    expect(move).toEqual({ ...wrongEnquiry.buttons[1], variant: "secondary" });
  });

  it("shows a spinner on the button whose action is running", () => {
    const html = render([wrongEnquiry], { actions: { ...actions, busy: { move_mails: true } } });
    expect(count(html, 'aria-busy="true"')).toBe(1);
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*>.*?Move to SL262790</);
  });
});
