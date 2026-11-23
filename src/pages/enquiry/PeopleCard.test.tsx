import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Handler, PeopleBlock, Person, Viewer } from "../../lib/enquiryBrief";
import { enquiry } from "../../lib/testFixtures";
import type { EnquiryRow } from "../../lib/types";
import { agentButton, PeopleCard, saveContactButton, treatAsButtons } from "./PeopleCard";
import type { PageActions } from "./shared";

const TODAY = "2026-11-10";
const FAHID = "purchase_otm@omzest.example";
const REENA = "reena@frontline.example";

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

const pricing: Viewer = { canEdit: true, canReply: true, me: null };
const sales: Viewer = { canEdit: true, canReply: false, me: "s7" };
const reader: Viewer = { canEdit: false, canReply: false, me: null };

const row = enquiry({ reference: "SL262784", enquiry_date: "2026-11-04", customer_name: "OMAN TEXTILES", pol: "NINGBO CHINA", pod: "SOHAR OMAN", sales_person_name: "JITTU" });

/** The ISO timestamp of an Oman wall-clock time ("2026-11-09 09:25"). */
const oman = (wall: string) => new Date(`${wall.replace(" ", "T")}:00+04:00`).toISOString();

const person = (email: string, over: Partial<Person> = {}): Person => ({
  email,
  party: "customer",
  name: null,
  designation: null,
  company: null,
  phones: [],
  wechat: null,
  wrote: 1,
  lastWrote: null,
  lastWeReplied: null,
  sharedDesk: false,
  chips: [],
  localTime: null,
  canSave: false,
  prefill: null,
  ...over,
});

const fahid = person(FAHID, {
  name: "Fahid K V",
  designation: "Purchase officer",
  company: "Oman Textile Mills",
  phones: [
    { label: "mobile", display: "+968 9000 1830", digits: "96890001830", whatsapp: true },
    { label: "office", display: "+968 2400 0100", digits: "96824000100", whatsapp: false },
    { label: "fax", display: "+968 2400 0101", digits: "96824000101", whatsapp: false },
  ],
  wrote: 5,
  lastWrote: oman("2026-11-09 09:25"),
  lastWeReplied: oman("2026-11-09 11:15"),
  sharedDesk: true,
  localTime: "Muscat 15:32",
  canSave: true,
  prefill: { contact_name: "Fahid K V", contact_email: FAHID, contact_phone: "+968 9000 1830", notes: ["Contact from Fahid K V's e-mail of Mon 09 Nov"] },
});

const reena = person(REENA, { party: "agent", name: "Reena Aneesh", designation: "Customer service", company: "Frontline Logistics", wrote: 8, lastWrote: oman("2026-11-09 10:58"), lastWeReplied: oman("2026-11-09 11:13") });

const liu = person("liu@frontline.example", {
  party: "agent",
  name: "Liu Samule",
  phones: [{ label: "mobile", display: "+86 150 0000 6655", digits: "8615000006655", whatsapp: true }],
  wechat: "liu_fl2026",
  wrote: 2,
  lastWrote: oman("2026-10-29 08:05"),
  localTime: "Ningbo 19:32",
});

const paul = person("paul@ningbo-mills.example", { party: "shipper", name: "Paul Jiang", wrote: 0, chips: ["added by Manu Thu 16:06"] });

const stranger = person("Accounts@Unknown-Trading.example", { party: "other", chips: ["bounced"] });

const ashwinStaff = person("operation@forwarder.example", { party: "us", name: "Ashwin Luiz", wrote: 6, lastWrote: oman("2026-11-09 11:15") });
const maria = person("pricing@forwarder.example", { party: "us", name: "Maria Britto", designation: "Pricing", wrote: 1, lastWrote: oman("2026-11-04 18:05") });

const customer: PeopleBlock = { kind: "customer", title: "OMAN TEXTILES", sideKey: "customer", note: null, persons: [fahid], copied: [], agentPrefill: null };
const frontline: PeopleBlock = {
  kind: "agent",
  title: "FRONTLINE",
  sideKey: "frontline.example",
  note: "agreed",
  // The one who wrote least recently is given first: the card keeps the brief's order among writers.
  persons: [reena, liu],
  copied: [
    { name: "Docs desk", email: "docs@frontline.example" },
    { name: "", email: "ops2@frontline.example" },
    { name: "Manu", email: "manu@frontline.example" },
  ],
  agentPrefill: { agent_name: "FRONTLINE", notes: ["The e-mails are with Frontline (frontline.example)"] },
};
const shipper: PeopleBlock = { kind: "shipper", title: "Ningbo Mills", sideKey: "ningbo-mills.example", note: null, persons: [paul], copied: [], agentPrefill: null };
const external: PeopleBlock = { kind: "other", title: "unknown-trading.example", sideKey: "unknown-trading.example", note: null, persons: [stranger], copied: [], agentPrefill: null };
const us: PeopleBlock = { kind: "us", title: "Our side", sideKey: null, note: null, persons: [ashwinStaff, maria], copied: [{ name: "M K Ali", email: "ali@forwarder.example" }], agentPrefill: null };

/** Given out of order: the card lists Customer, Agents, Shipper, Carrier, External, Our side. */
const people: PeopleBlock[] = [us, external, shipper, frontline, customer];

const handler: Handler = {
  mailbox: "operation",
  name: "Ashwin Luiz",
  role: "Operations",
  since: "2026-11-07",
  previous: [{ name: "Anwar K. S.", role: "Operations", from: "2026-11-04", to: "2026-11-05" }],
  salesPerson: { name: "JITTU", mailbox: "sales7", onThread: false },
  customerGreets: null,
};

const render = (over: { people?: PeopleBlock[]; handler?: Handler | null; row?: EnquiryRow; viewer?: Viewer } = {}) =>
  renderToStaticMarkup(
    <PeopleCard people={over.people ?? people} handler={over.handler === undefined ? handler : over.handler} row={over.row ?? row} viewer={over.viewer ?? pricing} actions={actions} today={TODAY} />,
  );

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees: no markup, nothing that is only for screen readers. */
const seen = (html: string) =>
  html
    .replace(/<span class="sr-only">.*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("PeopleCard", () => {
  it("lists the parties in the card's order, whatever order the brief gives them", () => {
    const text = seen(render());
    const at = ["Customer· Oman Textiles", "Agent· Frontlineagreed", "Shipper· Ningbo Mills", "External· unknown-trading.example", "Our side"].map((part) => text.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text.startsWith("People")).toBe(true);
  });

  it("shows a person with their role, address, numbers, when they last wrote and what is worth knowing", () => {
    const html = render();
    const text = seen(html);
    expect(text).toContain("Fahid K V");
    expect(text).toContain("Purchase officer · Oman Textile Mills");
    expect(text).toContain("Muscat 15:32");
    expect(text).toContain("last wrote Mon 09:25 · we replied Mon 11:15");
    expect(text).toContain("shared desk");
    expect(html).toContain(`<a href="mailto:${FAHID}" title="${FAHID}"`);
    // The mobile is called and takes WhatsApp; the office number is called; the fax is only shown.
    expect(text).toContain("M +968 9000 1830·WhatsApp");
    expect(html).toContain('href="tel:+96890001830"');
    expect(html).toContain('<a href="https://wa.me/96890001830" target="_blank" rel="noreferrer"');
    expect(html).toContain('href="tel:+96824000100"');
    expect(html).not.toContain("wa.me/96824000100");
    expect(text).toContain("F +968 2400 0101");
    expect(html).not.toContain("96824000101");
    // A number is copied as it is written; a fax is not.
    expect(html).toContain('aria-label="Copy +968 9000 1830"');
    expect(html).toContain('aria-label="Copy +968 2400 0100"');
    expect(html).not.toContain('aria-label="Copy +968 2400 0101"');
    // An older e-mail carries its date.
    expect(text).toContain("last wrote Thu 29 Oct, 08:05");
    expect(text).toContain("Ningbo 19:32");
    expect(text).toContain("WeChat liu_fl2026");
    expect(html).toContain('aria-label="Copy WeChat ID liu_fl2026"');
    expect(html).toContain(`aria-label="Copy ${FAHID}"`);
  });

  it("keeps copied people folded behind their number, and says what an agent is to the enquiry", () => {
    const html = render();
    expect(seen(html)).toContain("+3 copied");
    expect(html).toMatch(/aria-expanded="false" aria-controls="[^"]+-copied"/);
    expect(html).toMatch(/<ul id="[^"]+-copied" role="list" hidden=""/);
    expect(html).toContain('href="mailto:docs@frontline.example"');
    // "agreed" is said with a tick, not by colour alone.
    expect(html).toMatch(/text-confirmed"><svg[^>]*>.*?<\/svg><span[^>]*>agreed<\/span>/);
  });

  it("says when someone has not written, who added them, and marks a bounced address with an icon", () => {
    const html = render();
    const text = seen(html);
    expect(text).toContain("Paul Jiang");
    expect(text).toContain("no e-mail from them on file");
    expect(text).toContain("added by Manu Thu 16:06");
    expect(html).toMatch(/bg-lost-bg text-lost"><svg[^>]*>.*?<\/svg><span[^>]*>bounced<\/span>/);
    // Without a name the address is the person's heading, once.
    expect(count(text, "Accounts@Unknown-Trading.example")).toBe(1);
  });

  it("shows our side: who handles the enquiry and since when, who did before, and whether the sales person is on the e-mails", () => {
    const text = seen(render());
    const ours = text.slice(text.indexOf("Our side"));
    expect(ours).toContain("Ashwin Luiz");
    expect(ours).toContain("Operations · handling since Sat 07 Nov");
    expect(ours).toContain("operation@forwarder.example");
    expect(ours).toContain("Anwar K. S.");
    expect(ours).toContain("Operations · handled Wed 04 – Thu 05 Nov");
    expect(ours).toContain("Jittu");
    expect(ours).toContain("Sales person · not on the e-mails");
    // A colleague who wrote and is none of those is listed after them; the handler is not listed twice.
    expect(ours).toContain("Maria Britto");
    expect(count(ours, "Ashwin Luiz")).toBe(1);
    expect(ours).toContain("+1 copied");
    expect(ours).not.toContain("The customer writes to");
    expect(seen(render({ handler: { ...handler, customerGreets: "Waheed" } }))).toContain("The customer writes to Waheed.");

    const onThread = seen(render({ handler: { ...handler, salesPerson: { name: "JITTU", mailbox: "sales7", onThread: true } } }));
    expect(onThread).toContain("Sales person · on the e-mails");
    expect(onThread).not.toContain("not on the e-mails");

    const same = seen(render({ handler: { ...handler, previous: [], salesPerson: { name: "ASHWIN LUIZ", mailbox: "operation", onThread: true } } }));
    expect(same).toContain("Operations · handling since Sat 07 Nov · the sales person");
    expect(same).not.toContain("Sales person ·");
  });

  it("gives those who may edit Save as contact, Set as this enquiry's agent and Treat as…, none of them filled", () => {
    for (const viewer of [pricing, sales]) {
      const html = render({ viewer });
      const text = seen(html);
      expect(count(text, "Save as contact")).toBe(1);
      expect(count(text, "Set as this enquiry's agent")).toBe(1);
      expect(count(text, "Treat as…")).toBe(1);
      expect(html).toContain('aria-haspopup="menu"');
      expect(html).toContain('aria-label="Treat as… (Accounts@Unknown-Trading.example)"');
      expect(html).not.toContain("bg-primary");
    }
  });

  it("gives a reader the links and the copy buttons, and no button that changes anything", () => {
    const html = render({ viewer: reader });
    const text = seen(html);
    expect(text).not.toContain("Save as contact");
    expect(text).not.toContain("Set as this enquiry's agent");
    expect(text).not.toContain("Treat as");
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).toContain(`href="mailto:${FAHID}"`);
    expect(html).toContain('href="tel:+96890001830"');
    expect(html).toContain("https://wa.me/96890001830");
    // Copy for the six addresses of the people listed, the handler's own, three numbers and the WeChat id.
    expect(count(html, 'aria-label="Copy ')).toBe(count(render(), 'aria-label="Copy '));
    expect(count(html, 'aria-label="Copy ')).toBe(11);
    expect(text).toContain("Fahid K V");
    // Nothing to save, so nothing to check before saving.
    expect(text).toContain("Read from the e-mails' signatures.");
    expect(text).not.toContain("check before you save");
    expect(seen(render())).toContain("Read from the e-mails' signatures, so check before you save.");
  });

  it("hands the page the Edit form's suggestion for a contact, and keeps it from the enquiry's own contact", () => {
    expect(saveContactButton(fahid, row, pricing)).toEqual({ id: "edit_prefilled", label: "Save as contact", variant: "secondary", formPrefill: fahid.prefill });
    expect(saveContactButton(fahid, row, reader)).toBeNull();
    expect(saveContactButton(reena, row, pricing)).toBeNull();

    const saved = { ...row, contact_name: "Fahid", contact_email: FAHID.toUpperCase() };
    expect(saveContactButton(fahid, saved, pricing)).toBeNull();
    const html = render({ row: saved });
    expect(seen(html)).toContain("enquiry's contact");
    expect(seen(html)).not.toContain("Save as contact");

    // Without a suggestion from the brief the card builds one; it may replace the contact the enquiry has.
    const other = { ...row, contact_name: "Someone else", contact_email: "old@omzest.example" };
    expect(saveContactButton({ ...fahid, prefill: null }, other, pricing)?.formPrefill).toEqual({
      contact_name: "Fahid K V",
      contact_email: FAHID,
      contact_phone: "+968 9000 1830",
      replace: ["contact_name", "contact_email", "contact_phone"],
      notes: ["Contact Fahid K V, from the signature on their e-mails"],
    });
    expect(saveContactButton({ ...fahid, prefill: null, name: null, phones: [] }, row, pricing)?.formPrefill).toEqual({
      contact_email: FAHID,
      notes: [`Contact ${FAHID}, from the signature on their e-mails`],
    });
  });

  it("hands the page who an External person is to be treated as, by the address in lower case", () => {
    expect(treatAsButtons(stranger, pricing)).toEqual([
      { id: "treat_as", label: "Treat as customer", variant: "ghost", address: "accounts@unknown-trading.example", party: "customer" },
      { id: "treat_as", label: "Treat as agent", variant: "ghost", address: "accounts@unknown-trading.example", party: "agent" },
      { id: "treat_as", label: "Treat as shipper", variant: "ghost", address: "accounts@unknown-trading.example", party: "shipper" },
    ]);
    expect(treatAsButtons(stranger, reader)).toEqual([]);
    expect(treatAsButtons(fahid, pricing)).toEqual([]);
  });

  it("offers the agent for the enquiry only when the register knows the name and the enquiry has another", () => {
    expect(agentButton(frontline, row, pricing)).toEqual({ id: "edit_prefilled", label: "Set as this enquiry's agent", variant: "secondary", formPrefill: frontline.agentPrefill });
    expect(agentButton(frontline, row, reader)).toBeNull();
    expect(agentButton(frontline, { ...row, agent_name: "Frontline" }, pricing)).toBeNull();
    expect(agentButton({ ...frontline, agentPrefill: null }, row, pricing)).toBeNull();
    expect(seen(render({ row: { ...row, agent_name: "FRONTLINE" } }))).not.toContain("Set as this enquiry's agent");
    // An agent known only by its button still gets its heading.
    const bare = seen(render({ people: [{ ...frontline, persons: [], copied: [] }], handler: null }));
    expect(bare).toContain("Agent· Frontlineagreed");
    expect(bare).toContain("Set as this enquiry's agent");
  });

  it("folds agents after the third", () => {
    const agent = (n: number): PeopleBlock => ({
      kind: "agent",
      title: `agent${n}.example`,
      sideKey: `agent${n}.example`,
      note: n === 5 ? "declined" : null,
      persons: [person(`rates@agent${n}.example`, { party: "agent", name: `Agent person ${n}` })],
      copied: [],
      agentPrefill: null,
    });
    const html = render({ people: [customer, ...[1, 2, 3, 4, 5].map(agent)], handler: null });
    const text = seen(html);
    expect(text).toContain("Agent person 3");
    expect(text).not.toContain("Agent person 4");
    expect(text).toContain("Show 2 more agents");
    expect(html).toContain('aria-expanded="false"');
    // An agent that declined, or one we paused, is said with an icon; any other note follows a dot.
    const noted = (note: string) => render({ people: [{ ...agent(1), note }], handler: null });
    expect(noted("declined")).toMatch(/text-ink-muted"><svg[^>]*>.*?<\/svg><span[^>]*>declined<\/span>/);
    expect(noted("paused by us Mon 18:29")).toMatch(/text-ink-muted"><svg[^>]*>.*?<\/svg><span[^>]*>paused by us Mon 18:29<\/span>/);
    expect(seen(noted("asked a question"))).toContain("Agent· agent1.example·asked a question");
    expect(seen(render({ people: [customer, ...[1, 2, 3].map(agent)], handler: null }))).not.toContain("more agent");
  });

  it("never makes a link out of an address or a number that carries more than itself", () => {
    const odd = person("x@omzest.example?cc=other@elsewhere.example", { name: "Odd Address", phones: [{ label: "mobile", display: "+968 9000 0000", digits: "968-9000 0000;ext=1", whatsapp: true }] });
    const html = render({ people: [{ ...customer, persons: [odd] }], handler: null });
    expect(html).not.toContain("mailto:");
    expect(seen(html)).toContain("x@omzest.example?cc=other@elsewhere.example");
    expect(html).toContain('href="tel:+968900000001"');
    expect(html).toContain('href="https://wa.me/968900000001"');
  });

  it("marks a guessed WhatsApp with a question mark, and leaves out an address nobody gave", () => {
    const guessed = person("", {
      party: "shipper",
      name: "Paul Jiang",
      wrote: 0,
      phones: [{ label: "mobile", display: "+968 9111 2233", digits: "96891112233", whatsapp: false, whatsappGuessed: true }],
    });
    const html = render({ people: [{ ...shipper, persons: [guessed] }], handler: null });
    expect(seen(html)).toContain("WhatsApp?");
    expect(html).toContain('href="https://wa.me/96891112233"');
    expect(html).not.toContain('href="mailto:"');
    expect(html).not.toContain('aria-label="Copy "');
    const nameless = render({ people: [{ ...shipper, persons: [person("", { party: "shipper", wrote: 0 })] }], handler: null });
    expect(seen(nameless)).toContain("Name not given");
  });

  it("says so when nobody has written", () => {
    const html = render({ people: [], handler: null });
    expect(seen(html)).toBe("PeopleNobody has written yet. Contacts appear from the e-mails' signatures.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    // Parties without anyone in them are left out.
    expect(seen(render({ people: [{ ...customer, persons: [] }], handler: null }))).toContain("Nobody has written yet.");
  });

  it("uses none of the words kept off the screen", () => {
    expect(seen(render())).not.toMatch(/\b(lane|ball|relay|silent|healthy|thin|counterparts)\b/i);
  });
});
