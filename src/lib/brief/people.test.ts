import { describe, expect, it } from "vitest";
import type { EnquiryRow } from "../types";
import {
  approvesAfterConfirmation,
  cargoOf,
  driftOf,
  handlerOf,
  parseSignature,
  peopleOf,
  shipperBlockOf,
  wonCues,
  wonDay,
} from "./people";
import { readMails } from "./read";
import { input, mail, oman, row, sl262784 } from "./testkit";
import type { Buy, MailInput, Offer, Proof, ReadMail, Side } from "./types";

const OURS = { sender_type: "staff" as const, from_email: "operation@silverlynxoman.com", from_name: "Ashwin luiz" };
const CUSTOMER = "hanin@acme-oman.com";
const AGENT = "susie@consolclub.com";

const proof = (emailId: string, who = "Anwar K. S.", when = "Thu 05 Nov, 09:37"): Proof => ({ emailId, who, when, sentence: "" });

/** Our final offer on SL262784 (09:37): OMR 339 port to port plus OMR 132 LCL and DO, after OMR 359 at 08:20. */
function offer84(over: Partial<Offer> = {}): Offer {
  return {
    lines: [
      { label: "PORT TO PORT", amount: 339, currency: "OMR", unit: null, soft: false, softText: null, main: true, proof: proof("sl84-07") },
      { label: "LCL + DO", amount: 132, currency: "OMR", unit: null, soft: false, softText: null, main: false, proof: proof("sl84-06") },
    ],
    total: 471,
    currency: "OMR",
    sentAt: oman("2026-11-05 09:37"),
    sentTo: ["purchase_otm@omzest.com", "raghavan_otm@omzest.com"],
    earlier: [{ amount: 359, proof: proof("sl84-04", "Anwar K. S.", "Thu 05 Nov, 08:20") }],
    options: [],
    proof: proof("sl84-07"),
    ...over,
  } as unknown as Offer;
}

/** An offer of OMR 471 sent on Thu 05 Nov at 09:00 to the default customer. */
function offer(over: Partial<Offer> = {}): Offer {
  return offer84({ sentAt: oman("2026-11-05 09:00"), earlier: [], sentTo: [CUSTOMER], proof: proof("o1"), ...over });
}

const read = (enquiryRow: EnquiryRow, emails: MailInput[]) => readMails(input(enquiryRow, emails));
const kinds = (cues: { kind: string }[]) => cues.map((c) => c.kind);

describe("wonCues", () => {
  it("reads the nomination on SL262784 as the customer's yes, with our own confirmations after it", () => {
    const { row: r, emails } = sl262784();
    const cues = wonCues(read(r, emails).mails, r, offer84());
    expect(cues[0]).toMatchObject({ kind: "customer_yes", day: "2026-11-05", betterRate: false, amountMismatch: false });
    expect(cues[0].proof.emailId).toBe("sl84-08");
    expect(cues[0].proof.sentence).toContain("here by nominated");
    expect(kinds(cues)).toContain("thanks_for_confirmation");
    expect(kinds(cues)).toContain("agent_details_sent");
    const toAgent = cues.find((c) => c.kind === "confirmed_to_agent");
    expect(toAgent?.proof.emailId).toBe("sl84-14");
    expect(toAgent?.proof.sentence).toBe("Please proceed this shipment.");
    expect(wonDay(cues)).toBe("2026-11-05");
  });

  it("counts a go-ahead with a better-rate ask, and not a question", () => {
    const r = row({ contact_email: CUSTOMER });
    const yes = mail({ from_email: CUSTOMER, received_at: oman("2026-11-05 11:00"), body_text: "Dear Sir,\n\nGohead – and share the forwarder details.\nWe expect a more competitive rate for the next shipments.\n\nRegards" });
    const ask = mail({ from_email: CUSTOMER, received_at: oman("2026-11-05 12:00"), body_text: "Dear Sir,\n\nCan we go ahead?\n\nRegards" });
    expect(wonCues(read(r, [yes]).mails, r, offer())).toEqual([expect.objectContaining({ kind: "customer_yes", betterRate: true })]);
    expect(wonCues(read(r, [ask]).mails, r, offer())).toEqual([]);
  });

  it("takes the approver's short 'Approve' after a colleague asked for approval, and not without the ask", () => {
    const r = row({ contact_email: CUSTOMER });
    const asked = mail({ from_email: CUSTOMER, received_at: oman("2026-11-05 09:46"), body_text: "Dear Beknazar,\n\nPlease approve the below offer from Silver Lynx.\n\nRegards" });
    const approve = mail({ from_email: "beknazar@acme-oman.com", received_at: oman("2026-11-05 10:51"), body_text: "Approve" });
    expect(kinds(wonCues(read(r, [asked, approve]).mails, r, offer()))).toEqual(["customer_yes"]);
    expect(wonCues(read(r, [approve]).mails, r, offer())).toEqual([]);
    // "Approved" is a yes on its own.
    const approved = mail({ from_email: "beknazar@acme-oman.com", received_at: oman("2026-11-05 10:51"), body_text: "Approved" });
    expect(kinds(wonCues(read(r, [asked, approved]).mails, r, offer()))).toEqual(["customer_yes"]);
  });

  it("counts our confirmation to an agent only after its rate and never from accounts; agents' and carriers' 'kindly proceed' are no yes", () => {
    const r = row({ quoted_date: "2026-11-03" });
    const rate = mail({ from_email: AGENT, received_at: oman("2026-11-04 07:00"), body_text: "Dear Ashwin,\n\nOCEAN FREIGHT : USD 1,250 per 40HC\n\nBest regards,\nSusie" });
    const confirm = (from = OURS.from_email, at = "2026-11-05 10:00") =>
      mail({ ...OURS, from_email: from, to_emails: [AGENT], received_at: oman(at), body_text: "Dear Susie,\n\nWe hereby confirm this shipment with below agreed rate.\n\nOCEAN FREIGHT : USD 1,250 per 40HC\n\nRegards" });
    expect(kinds(wonCues(read(r, [rate, confirm()]).mails, r, null))).toEqual(["confirmed_to_agent"]);
    expect(wonCues(read(r, [rate, confirm("accounts@silverlynxoman.com")]).mails, r, null)).toEqual([]);
    expect(wonCues(read(r, [confirm(OURS.from_email, "2026-11-03 10:00"), mail({ ...rate, id: "late", received_at: oman("2026-11-04 07:00") })]).mails, r, null)).toEqual([]);
    const agentProceed = mail({ from_email: AGENT, received_at: oman("2026-11-05 11:00"), body_text: "Dear Ashwin,\n\nKindly proceed with the booking.\n\nRegards" });
    const carrierProceed = mail({ from_email: "ops@maersk.com", received_at: oman("2026-11-05 11:00"), body_text: "Dear Ashwin,\n\nKindly proceed with the booking.\n\nRegards" });
    expect(wonCues(read(r, [agentProceed, carrierProceed]).mails, r, null)).toEqual([]);
  });

  it("marks a yes that repeats a figure that is not this offer's", () => {
    const r = row({ contact_email: CUSTOMER });
    const yes = mail({ from_email: CUSTOMER, received_at: oman("2026-11-05 11:00"), body_text: "Dear Sir,\n\nPlease proceed with the booking at OMR 75 as discussed.\n\nRegards" });
    const echo = mail({ from_email: CUSTOMER, received_at: oman("2026-11-05 11:00"), body_text: "Dear Sir,\n\nPlease proceed with the booking.\n\nPORT TO PORT : OMR 339.000\nLCL + DO : OMR 132.000\n\nRegards" });
    expect(wonCues(read(r, [yes]).mails, r, offer())).toEqual([expect.objectContaining({ kind: "customer_yes", amountMismatch: true })]);
    expect(wonCues(read(r, [echo]).mails, r, offer())).toEqual([expect.objectContaining({ amountMismatch: false })]);
    // SL262731: the yes repeats our estimate for a charge at actuals; that is no figure of their own.
    const estimate = mail({
      from_email: CUSTOMER, received_at: oman("2026-11-05 11:00"),
      body_text: "Dear Sir,\n\nPlease proceed with the booking as per your quotation (OMR 339.000 port to port + Oman aviation charges at actuals, approx. OMR 44).\n\nRegards",
    });
    expect(wonCues(read(r, [estimate]).mails, r, offer())).toEqual([expect.objectContaining({ kind: "customer_yes", amountMismatch: false })]);
  });

  it("gives nothing once the register is closed or confirmed, before the offer, or on odd input", () => {
    const yes = mail({ from_email: CUSTOMER, received_at: oman("2026-11-05 11:00"), body_text: "Go ahead." });
    for (const status of ["confirmed", "lost", "cancelled", "not_genuine"] as const) {
      const r = row({ contact_email: CUSTOMER, status });
      expect(wonCues(read(r, [yes]).mails, r, offer())).toEqual([]);
    }
    const r = row({ contact_email: CUSTOMER });
    expect(wonCues(read(r, [yes]).mails, r, offer({ sentAt: oman("2026-11-05 12:00") }))).toEqual([]);
    expect(wonCues(null as unknown as ReadMail[], r, null)).toEqual([]);
    expect(wonCues([], null as unknown as EnquiryRow, null)).toEqual([]);
    expect(wonDay(null as unknown as [])).toBeNull();
  });

  it("finds no yes in a cross-filed courier subject on SL262731", () => {
    const r = row({ reference: "SL262731", contact_email: CUSTOMER, subject: "SL262731 LCL SHANGHAI CHINA TO SOHAR OMAN" });
    const other = mail({
      from_email: CUSTOMER,
      subject: "COURIER EX-WORKS UTTENDORF AUSTRIA TO SOHAR OMAN",
      sl_refs: [],
      gmail_thread_id: "t9",
      received_at: oman("2026-11-05 11:00"),
      body_text: "Dear Sir,\n\nPlease proceed with the courier booking.\n\nRegards",
    });
    const mails = read(r, [other]).mails;
    expect(mails[0].scope).toBe("cross_filed");
    expect(wonCues(mails, r, null)).toEqual([]);
  });
});

describe("approvesAfterConfirmation", () => {
  it("reads a customer's 'please proceed' on a confirmed job as approving a step, never as a new yes", () => {
    const r = row({ contact_email: CUSTOMER, quoted_date: "2026-11-02", confirmed_date: "2026-11-03" });
    const theirs = mail({ from_email: CUSTOMER, received_at: oman("2026-11-08 08:54"), body_text: "Dear Ashwin,\n\nPlease proceed without palletization\n\nRegards" });
    const agents = mail({ from_email: AGENT, received_at: oman("2026-11-08 09:00"), body_text: "Dear Ashwin,\n\nKindly proceed with the booking.\n\nRegards" });
    const mails = read(r, [theirs, agents]).mails;
    expect(wonCues(mails, r, offer())).toEqual([]);
    expect(approvesAfterConfirmation(mails.find((m) => m.party === "customer")!)).toBe(true);
    expect(approvesAfterConfirmation(mails.find((m) => m.party === "agent")!)).toBe(false);
    expect(approvesAfterConfirmation(null as unknown as ReadMail)).toBe(false);
  });
});

describe("parseSignature", () => {
  it("reads the name in capitals and an Omani mobile (WhatsApp guessed)", () => {
    const c = parseSignature("THANKS & REGARDS\nBASIL IQBAL\nM: +968 90000201\nSTERLING SITES");
    expect(c.name).toBe("Basil Iqbal");
    expect(c.company).toBe("STERLING SITES");
    expect(c.phones).toEqual([{ label: "mobile", display: "+968 90000201", digits: "96890000201", whatsapp: true, whatsappGuessed: true }]);
    // Stated by the writer, it is no guess.
    expect(parseSignature("Basil Iqbal\nM: +968 90000201\nWhatsApp: +968 90000201").phones).toEqual([{ label: "mobile", display: "+968 90000201", digits: "96890000201", whatsapp: true }]);
  });

  it("reads a name with its role and one number for mobile and WeChat; a QQ id is no phone and 'line' no messenger", () => {
    const c = parseSignature("Samule/ OVERSEAS SALES\nMOB /Wechat ID : +8613000000202");
    expect(c.name).toBe("Samule");
    expect(c.designation).toBe("OVERSEAS SALES");
    expect(c.phones).toEqual([expect.objectContaining({ label: "mobile", digits: "8613000000202", whatsapp: false })]);
    expect(c.wechat).toBe("+8613000000202");
    expect(parseSignature("QQ ID：3004600000").phones).toEqual([]);
    const line = parseSignature("shipping line operations");
    expect(line.phones).toEqual([]);
    expect(line.wechat).toBeNull();
    expect(line.name).toBeNull();
  });

  it("reads a Chinese agent's block: labels in capitals, the trunk 0 dropped, the QQ id left out", () => {
    const block = [
      "Milk.Lv",
      "Operation Specialist",
      "",
      "宁波豪会拼国际物流有限公司",
      "CONSOLCLUB (NINGBO) INTERNATIONAL LOGISTICS CO., LTD",
      "ADD：5F，4# NORTH-BANK FORTUNE CENTRE，NO.288 XINMA ROAD, NINGBO,CHINA",
      "TEL：+86-0574-20000203",
      "MOB：+86-13000000204",
      "QQ  ID：3004600000",
      "EMAIL：lvtianxin@consolclub.com",
    ].join("\n");
    const c = parseSignature(block);
    expect(c).toMatchObject({ name: "Milk.Lv", designation: "Operation Specialist", company: "CONSOLCLUB (NINGBO) INTERNATIONAL LOGISTICS CO., LTD" });
    expect(c.phones.map((p) => [p.label, p.digits])).toEqual([
      ["office", "8657420000203"],
      ["mobile", "8613000000204"],
    ]);
  });

  it("takes a wa.me link as WhatsApp, a label on the line above its number, and never a landline as WhatsApp", () => {
    const c = parseSignature("Best regards\n\nAmar Singh\n*T*  +968 26000205 , *Extn*. 793\n*M* *+968 93000206, CUG *559\n*WhatsApp* : wa.me/96893000206");
    expect(c.name).toBe("Amar Singh");
    expect(c.phones.find((p) => p.digits === "96826000205")).toMatchObject({ whatsapp: false });
    expect(c.phones.find((p) => p.digits === "96893000206")).toMatchObject({ label: "mobile", whatsapp: true });
    const below = parseSignature("Beshoy Maged\nMobile\n\n+201000000207");
    expect(below.phones).toEqual([expect.objectContaining({ label: "mobile", digits: "201000000207" })]);
  });

  it("reads no name from a line with a run of dots, and does so at once", () => {
    expect(parseSignature("Best regards\nTom......").name).toBeNull();
    const started = Date.now();
    expect(parseSignature(`Best regards\nTom${".".repeat(40)}!`).name).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    // Initials keep their single dots.
    expect(parseSignature("Best regards\nAnwar K. S.").name).toBe("Anwar K. S.");
  });

  it("gives an empty contact for odd input", () => {
    expect(parseSignature("")).toEqual({ name: null, designation: null, company: null, phones: [], wechat: null });
    expect(parseSignature(null as unknown as string).phones).toEqual([]);
  });
});

describe("shipperBlockOf", () => {
  it("reads a flattened label table, each value on the line under its label", () => {
    const text = [
      "Dear Anwar,",
      "",
      "Please find the vendor details below.",
      "",
      "VENDOR NAME",
      "Union Top",
      "VENDOR ADDRESS",
      "No. 8 Haier Road, Qingdao",
      "CONTACT PERSON",
      "Mr. David",
      "MOBILE",
      "+86 13000000321",
      "EMAIL",
      "uniontop@example.cn",
      "",
      "Best regards,",
      "Fahid",
    ].join("\n");
    const c = shipperBlockOf(text);
    expect(c).toMatchObject({ name: "Mr. David", company: "Union Top", email: "uniontop@example.cn" });
    expect(c?.phones).toEqual([expect.objectContaining({ label: "mobile", digits: "8613000000321" })]);
  });

  it("reads SL262784's shipper block as the customer sent it, and as our forward passed it on from 'Contact Person' up", () => {
    const { emails } = sl262784();
    const fromCustomer = shipperBlockOf(emails.find((e) => e.id === "sl84-13")!.body_text!.replace(/<mailto:\s*([^>\s]+)\s*>/g, " $1 "));
    expect(fromCustomer).toMatchObject({ name: "Tina", company: "Aedan Sourcing Co. Ltd - China", email: "ravi@aslchina.net" });
    expect(fromCustomer?.phones.map((p) => [p.label, p.digits])).toEqual([
      ["office", "8657580000106"],
      ["mobile", "8613000000107"],
    ]);
    const forwarded = shipperBlockOf(emails.find((e) => e.id === "sl84-14")!.body_text!);
    expect(forwarded).toMatchObject({ name: "Tina", company: "Aedan Sourcing Co. Ltd - China", email: "ravi@aslchina.net" });
    expect(forwarded?.phones.some((p) => p.digits === "8613000000107")).toBe(true);
  });

  it("gives null without a block, for a request for the details, and for odd input", () => {
    expect(shipperBlockOf("Dear Sir,\n\nPlease share the shipper contact details.\n\nRegards")).toBeNull();
    expect(shipperBlockOf("Noted with thanks")).toBeNull();
    expect(shipperBlockOf(null as unknown as string)).toBeNull();
  });
});

describe("handlerOf", () => {
  it("hands SL262784 from Anwar to Ashwin on Sat 07 Nov; a later mail from customs clearance or a one-off writer changes nothing", () => {
    const { row: r, emails } = sl262784();
    const later = [
      mail({ sender_type: "staff", from_email: "akp@silverlynxoman.com", to_emails: ["purchase_otm@omzest.com"], subject: emails[7].subject, sl_refs: ["SL262784"], received_at: oman("2026-11-09 12:00"), body_text: "Dear Sir,\n\nPlease share the documents for clearance.\n\nRegards" }),
      mail({ sender_type: "staff", from_email: "operation3@silverlynxoman.com", to_emails: ["purchase_otm@omzest.com"], subject: emails[7].subject, sl_refs: ["SL262784"], received_at: oman("2026-11-09 13:00"), body_text: "Dear Sir,\n\nPlease find the BL draft.\n\nRegards" }),
    ];
    for (const set of [emails, [...emails, ...later]]) {
      const h = handlerOf(read(r, set).mails, r);
      expect(h).toMatchObject({ name: "Ashwin Luiz", role: "Operations", mailbox: "operation@silverlynxoman.com", since: oman("2026-11-07 10:01") });
      expect(h?.previous).toEqual([{ name: "Anwar K. S.", role: "Operations", from: oman("2026-11-04 18:05"), to: oman("2026-11-05 16:04") }]);
      expect(h?.customerGreets).toBeNull();
    }
  });

  it("says whether the sales person is on the e-mails: not on the internal forward alone, yes once copied to the customer", () => {
    const { row: r, emails } = sl262784();
    const SALES7 = "sales7@silverlynxoman.com";
    const without = emails.map((e) => (e.id === "sl84-01" ? e : { ...e, to_emails: e.to_emails.filter((a) => a !== SALES7), cc_emails: e.cc_emails.filter((a) => a !== SALES7) }));
    expect(handlerOf(read(r, without).mails, r)?.salesPerson).toEqual({ name: "Jittu Jacob", mailbox: SALES7, onThread: false });
    const copied = without.map((e) => (e.id === "sl84-25" ? { ...e, cc_emails: [...e.cc_emails, SALES7] } : e));
    expect(handlerOf(read(r, copied).mails, r)?.salesPerson?.onThread).toBe(true);
  });

  it("names whom the customer's greetings address when two agree and it is not the handler", () => {
    const { row: r, emails } = sl262784();
    const greeted = emails.map((e) => (e.id === "sl84-19" || e.id === "sl84-22" ? { ...e, body_text: (e.body_text ?? "").replace("Dear Ashwin,", "Dear Waheed,") } : e));
    expect(handlerOf(read(r, greeted).mails, r)?.customerGreets).toBe("Abdul Waheed");
  });

  it("gives null when nobody of ours wrote outside twice, and on odd input", () => {
    const r = row();
    const once = mail({ ...OURS, to_emails: [CUSTOMER], body_text: "Please find our offer." });
    expect(handlerOf(read(r, [once]).mails, r)).toBeNull();
    expect(handlerOf(null as unknown as ReadMail[], r)).toBeNull();
  });
});

describe("peopleOf", () => {
  const people84 = () => {
    const { row: r, emails } = sl262784();
    const result = read(r, emails);
    const handler = handlerOf(result.mails, r);
    return { r, blocks: peopleOf(result.sides, result.mails, handler, r, oman("2026-11-09 18:00")) };
  };

  it("lists the customer's writers with their signatures, and who we wrote to", () => {
    const { blocks } = people84();
    expect(blocks[0]).toMatchObject({ kind: "customer", sideKey: "customer" });
    const fahid = blocks[0].persons.find((p) => p.email === "purchase_otm@omzest.com");
    // "Oman Textile Mills" has no legal form and is not in capitals: the lean reading leaves the company out.
    expect(fahid).toMatchObject({ name: "Fahid K V", company: null, party: "customer", wrote: 5, canSave: true, sharedDesk: false });
    expect(fahid?.phones).toEqual([{ label: "mobile", display: "+968 9000 0104", digits: "96890000104", whatsapp: true, whatsappGuessed: true }]);
    expect(fahid?.lastWrote).toBe(oman("2026-11-09 09:25"));
    expect(fahid?.lastWeReplied).toBe(oman("2026-11-09 11:15"));
    expect(fahid?.prefill).toMatchObject({ contact_email: "purchase_otm@omzest.com", contact_name: "Fahid K V", contact_phone: "+968 9000 0104" });
    expect(fahid?.localTime).toBeNull();
    expect(blocks[0].persons.find((p) => p.email === "raghavan_otm@omzest.com")).toMatchObject({ wrote: 0, canSave: true });
  });

  it("lists the agent's people with the colleague Manu added, and the desk only copied", () => {
    const { blocks } = people84();
    const frontline = blocks.find((b) => b.sideKey === "flgshipping.net");
    expect(frontline).toMatchObject({ kind: "agent", title: "Frontline" });
    expect(frontline?.persons.map((p) => p.email).sort()).toEqual(["abinand@flgshipping.net", "manukrishna@flgshipping.net", "reena@flgshipping.net"]);
    expect(frontline?.persons.find((p) => p.email === "reena@flgshipping.net")).toMatchObject({ name: "Reena Aneesh", chips: ["added by Manukrishna Thu 16:06"] });
    expect(frontline?.copied).toEqual([{ name: "", email: "cs2lclom@flgshipping.net" }]);
    expect(frontline?.agentPrefill).toMatchObject({ agent_name: "FRONTLINE" });
  });

  it("adds the shipper from the contact block, and our side with the handler first", () => {
    const { blocks } = people84();
    const shipper = blocks.find((b) => b.kind === "shipper");
    expect(shipper?.title).toBe("Aedan Sourcing Co. Ltd - China");
    expect(shipper?.persons).toEqual([expect.objectContaining({ name: "Tina", email: "ravi@aslchina.net", party: "shipper", wrote: 0 })]);
    const us = blocks[blocks.length - 1];
    expect(us.kind).toBe("us");
    expect(us.persons[0]).toMatchObject({ email: "operation@silverlynxoman.com", name: "Ashwin Luiz", designation: "Operations" });
    expect(us.persons.find((p) => p.email === "operation2@silverlynxoman.com")?.phones[0]?.digits).toBe("96890000102");
    expect(us.copied.map((c) => c.email)).toContain("pricing@silverlynxoman.com");
  });

  it("says the time where an agent is, marks shared desks, and names an address from our greetings", () => {
    const r = row();
    const theirs = mail({ from_email: "lvtianxin@consolclub.com", received_at: oman("2026-11-05 07:00"), body_text: "Dear Ashwin,\n\nNoted, will check.\n\nThanks & Best Regards !\n\nMilk.Lv\nMOB：+86-13000000204" });
    const ours = mail({ ...OURS, to_emails: ["sales3@hydro.example"], received_at: oman("2026-11-05 08:00"), body_text: "Dear Milk,\n\nPlease advise the rate for below shipment.\n\nRegards" });
    const greeted = mail({ ...OURS, to_emails: ["sales3@hydro.example"], received_at: oman("2026-11-05 09:00"), body_text: "Dear Kent,\n\nAny update please?\n\nRegards" });
    const result = read(r, [theirs, ours, greeted]);
    const blocks = peopleOf(result.sides, result.mails, null, r, oman("2026-11-05 10:00"));
    const milk = blocks.flatMap((b) => b.persons).find((p) => p.email === "lvtianxin@consolclub.com");
    expect(milk?.localTime).toBe("Shanghai 14:00");
    const desk = blocks.flatMap((b) => b.persons).find((p) => p.email === "sales3@hydro.example");
    expect(desk).toMatchObject({ sharedDesk: true, wrote: 0 });
    expect(["Milk", "Kent"]).toContain(desk?.name);
  });

  it("gives an empty list on odd input", () => {
    expect(peopleOf(null as unknown as Side[], null as unknown as ReadMail[], null, null as unknown as EnquiryRow, "")).toEqual([]);
    expect(peopleOf([], [], null, row(), oman("2026-11-09 18:00"))).toEqual([]);
  });
});

describe("cargoOf", () => {
  it("reads SL262784's cargo from our request to Frontline, with the stacking from our offer", () => {
    const { row: r, emails } = sl262784();
    const cargo = cargoOf(r, read(r, emails).mails);
    const field = (key: string) => cargo.fields.find((f) => f.key === key);
    expect(field("commodity")).toMatchObject({ value: "Fabric rolls", source: "our request, Wed 18:05", required: true });
    expect(field("gross_weight")).toMatchObject({ value: "2,892 kg", source: "our request, Wed 18:05" });
    expect(field("volume")).toMatchObject({ value: "6 cbm", required: true });
    expect(field("packages")?.value).toBe("41 rolls");
    expect(field("incoterm")?.value).toBe("FOB");
    expect(field("stackable_dg")).toMatchObject({ value: "Stackable · Non DG", source: "our offer, Thu 09:37" });
    expect(field("gross_weight")?.proof?.emailId).toBe("sl84-02");
    expect(cargo.gaps).toEqual([]);
    expect(cargo.askText).toBe("");
    expect(cargo.warning).toBeNull();
    expect(cargo.requestBlock).toBe(
      ["POL : NINGBO CHINA", "POD : SOHAR OMAN", "UNIT : LCL", "INCOTERM : FOB", "COMMODITY : Fabric rolls", "GR. WT. : 2,892 kg", "VOLUME : 6 cbm", "PACKAGES : 41 rolls"].join("\n"),
    );
  });

  it("asks for what each mode needs", () => {
    const gaps = (over: Partial<EnquiryRow>) => cargoOf(row(over), []).gaps;
    expect(gaps({ shipment_mode: "AIR", qty_text: "AIR" })).toEqual(["gross_weight", "dimensions", "commodity"]);
    expect(gaps({ shipment_mode: "FCL", qty_text: "FCL" })).toEqual(["equipment", "commodity"]);
    expect(gaps({ shipment_mode: "FCL", qty_text: "1X40'" })).toEqual(["commodity"]);
    expect(gaps({ shipment_mode: "LCL", qty_text: "LCL" })).toEqual(["volume", "gross_weight", "commodity"]);
    expect(gaps({ shipment_mode: "COURIER", qty_text: "COURIER" })).toEqual(["gross_weight", "dimensions"]);
    expect(gaps({ shipment_mode: "AIR", qty_text: "AIR", subject: "SL262700 AIR EX-WORKS DANYANG CHINA TO MUSCAT OMAN" })).toEqual([
      "gross_weight",
      "dimensions",
      "commodity",
      "pickup_address",
    ]);
  });

  it("lists the gaps as a short numbered request, and the request block from the register", () => {
    const cargo = cargoOf(row({ shipment_mode: "AIR", qty_text: "AIR", pol: "DANYANG CHINA", pod: "MUSCAT OMAN" }), []);
    expect(cargo.askText).toBe(
      "Please share these details of the shipment:\n1. The gross weight\n2. The dimensions of each package (length × width × height in cm)\n3. What the cargo is (commodity)",
    );
    expect(cargo.requestBlock).toBe("POL : DANYANG CHINA\nPOD : MUSCAT OMAN\nUNIT : AIR");
    expect(cargo.fields.map((f) => [f.key, f.value, f.required])).toEqual([
      ["commodity", null, true],
      ["gross_weight", null, true],
      ["dimensions", null, true],
    ]);
    const fcl = cargoOf(row({ shipment_mode: "FCL", qty_text: "1X40'" }), []);
    expect(fcl.requestBlock.split("\n").pop()).toBe("14 days free detention at destination; MBL seaway or telex");
    expect(fcl.fields.find((f) => f.key === "equipment")).toMatchObject({ value: "1X40'", source: "register" });
  });

  it("warns when the dimensions weigh far more than the cargo", () => {
    const r = row({ contact_email: CUSTOMER });
    const typo = mail({ from_email: CUSTOMER, body_text: "Dear Sir,\n\nDimensions: 260 x 350 x 50 cm\nGross weight: 150 kg\nCommodity: Spare parts\n\nRegards" });
    const cargo = cargoOf(r, read(r, [typo]).mails);
    expect(cargo.warning).toBe("Check the dimensions: 260 × 350 × 50 cm for 150 kg looks like a typo.");
    expect(cargo.fields.find((f) => f.key === "dimensions")?.source).toBe("the customer, Thu 10:00");
    const fixed = mail({ from_email: CUSTOMER, body_text: "Dear Sir,\n\nDimensions: 260 x 35 x 50 cm\nGross weight: 150 kg\n\nRegards" });
    expect(cargoOf(r, read(r, [fixed]).mails).warning).toBeNull();
    const air = row({ contact_email: CUSTOMER, shipment_mode: "AIR", qty_text: "AIR" });
    const light = mail({ from_email: CUSTOMER, body_text: "Dear Sir,\n\n120 x 100 x 80 cm, gross weight 10 kg\n\nRegards" });
    expect(cargoOf(air, read(air, [light]).mails).warning).toBe("Check the dimensions: 120 × 100 × 80 cm for 10 kg looks like a typo.");
  });

  it("falls back to the requirements and to the AI's reading, said as such", () => {
    const r = row({ requirements: "Commodity: Glass bottles" });
    const ai = mail({ from_email: CUSTOMER, body_text: "Dear Sir, see attached.", ai_result: { summary: null, shipment: { commodity: "Steel pipes", weight: "1,200 kg" } } });
    const cargo = cargoOf(r, read(r, [ai]).mails);
    expect(cargo.fields.find((f) => f.key === "commodity")).toMatchObject({ value: "Glass bottles", source: "requirements", proof: null });
    expect(cargo.fields.find((f) => f.key === "gross_weight")).toMatchObject({ value: "1,200 kg", source: "read by AI" });
  });

  it("keeps the request block on odd input", () => {
    const cargo = cargoOf(row(), null as unknown as ReadMail[]);
    expect(cargo.requestBlock).toContain("POL : SHANGHAI CHINA");
    expect(cargoOf(null as unknown as EnquiryRow, []).fields).toEqual([]);
  });
});

describe("driftOf", () => {
  const today = "2026-11-09";
  const subjectMail = (subject: string, reference = "SL262700") =>
    mail({ from_email: AGENT, subject, sl_refs: [reference], received_at: oman("2026-11-05 10:00"), body_text: "Dear Ashwin,\n\nPlease find our rates.\n\nRegards" });
  const driftFor = (r: EnquiryRow, emails: MailInput[], over: { offer?: Offer | null; buy?: Buy | null; dismissed?: string[] } = {}) => {
    const result = read(r, emails);
    const won = wonCues(result.mails, r, over.offer ?? null);
    return driftOf(r, result.mails, result.sides, over.offer ?? null, over.buy ?? null, won, over.dismissed ?? [], today);
  };

  it("reads the mode and the route from SL262731's agent subject that carries our reference", () => {
    const r = row({ reference: "SL262731", subject: "SL262731 LCL SHANGHAI CHINA TO SOHAR OMAN" });
    const drift = driftFor(r, [subjectMail("RE: SL262731 AIR EX-WORKS DANYANG CHINA TO MUSCAT OMAN", "SL262731")]);
    const mode = drift.find((d) => d.kind === "mode");
    expect(mode).toMatchObject({ text: "E-mails say air; the register says LCL", mail: "air", register: "LCL", buttonLabel: "Update…" });
    expect(mode?.prefill).toMatchObject({ shipment_mode: "AIR", qty_text: "AIR", replace: ["shipment_mode", "qty_text"] });
    expect(mode?.proof?.sentence).toBe("RE: SL262731 AIR EX-WORKS DANYANG CHINA TO MUSCAT OMAN");
    const route = drift.find((d) => d.kind === "route");
    expect(route).toMatchObject({ text: "E-mails say Danyang → Muscat; the register says Shanghai → Sohar" });
    expect(route?.prefill).toMatchObject({ pol: "DANYANG CHINA", pod: "MUSCAT OMAN", replace: ["pol", "pod"] });
    expect(drift.map((d) => d.kind)).toEqual(["mode", "route"]);
    expect(driftFor(r, [subjectMail("RE: SL262731 AIR EX-WORKS DANYANG CHINA TO MUSCAT OMAN", "SL262731")], { dismissed: [mode!.id] }).map((d) => d.kind)).toEqual(["route"]);
  });

  it("reads a changed container and incoterm, and a changed direction", () => {
    const r = row({ shipment_mode: "FCL", qty_text: "1X20", pol: "NINGBO CHINA", subject: "SL262700 1X20 FOB NINGBO CHINA TO SOHAR OMAN" });
    const drift = driftFor(r, [subjectMail("RE: SL262700 1X40 HC EX-WORKS NINGBO CHINA TO SOHAR OMAN")]);
    expect(drift.find((d) => d.kind === "quantity")).toMatchObject({ text: "E-mails say 1X40 HC; the register says 1X20", prefill: expect.objectContaining({ qty_text: "1X40 HC" }) });
    expect(drift.find((d) => d.kind === "incoterm")).toMatchObject({ text: "E-mails say EXW; the register says FOB", prefill: null });
    const exp = row({ trade_type: "EXP" });
    expect(driftFor(exp, [subjectMail("RE: SL262700 LCL SHANGHAI CHINA TO SOHAR OMAN")]).find((d) => d.kind === "direction")).toMatchObject({
      text: "E-mails say Import; the register says Export",
      prefill: expect.objectContaining({ trade_type: "IMP" }),
    });
  });

  it("says SL262784 was won while the register waits for a quote, and which agent and contact the e-mails are with", () => {
    const { row: r, emails } = sl262784();
    const result = read(r, emails);
    const buy = { agreed: true, agentName: "Frontline", sideKey: "flgshipping.net", proof: proof("sl84-14", "Anwar K. S.", "Thu 05 Nov, 16:04") } as unknown as Buy;
    const won = wonCues(result.mails, r, offer84());
    const drift = driftOf(r, result.mails, result.sides, offer84(), buy, won, [], today);
    expect(drift.find((d) => d.kind === "status")).toMatchObject({
      text: "E-mails say won on Thu 05 Nov; the register says awaiting quote",
      prefill: expect.objectContaining({ confirmed_date: "2026-11-05", quoted_date: "2026-11-05" }),
      buttonLabel: "Confirm job…",
    });
    expect(drift.find((d) => d.kind === "agent")).toMatchObject({
      text: "E-mails say the agent is Frontline; the register has none",
      prefill: expect.objectContaining({ agent_name: "FRONTLINE" }),
    });
    expect(drift.find((d) => d.kind === "contact")).toMatchObject({
      text: "Our offer went to purchase_otm@omzest.com; the register has no contact",
      prefill: expect.objectContaining({ contact_email: "purchase_otm@omzest.com", contact_name: "Fahid" }),
    });
    expect(drift.some((d) => ["mode", "route", "quantity", "direction"].includes(d.kind))).toBe(false);
    expect(driftOf({ ...r, agent_name: "FRONTLINE", contact_email: "purchase_otm@omzest.com" }, result.mails, result.sides, offer84(), buy, won, [], today).map((d) => d.kind)).toEqual(["status"]);
  });

  it("leaves out the won status once our own won cues are put away with Not won yet; a customer's yes still counts", () => {
    const { row: base, emails } = sl262784();
    const r = { ...base, status: "quoted" as const, quoted_date: "2026-11-05" };
    const ours = emails.filter((e) => e.id !== "sl84-08" && e.id !== "sl84-19");
    const result = read(r, ours);
    const won = wonCues(result.mails, r, offer84());
    expect(won.some((c) => c.kind === "customer_yes")).toBe(false);
    const status = (dismissed: string[], cues = won, mails = result) => driftOf(r, mails.mails, mails.sides, offer84(), null, cues, dismissed, today).filter((d) => d.kind === "status");
    expect(status([]).map((d) => d.id)).toEqual(["drift:status:won:2026-11-05"]);
    // "Not won yet" stores won:{day}, not the drift's own id.
    expect(status(["won:2026-11-05"])).toEqual([]);

    const all = read(r, emails);
    const withYes = wonCues(all.mails, r, offer84());
    expect(status(["won:2026-11-05"], withYes, all).map((d) => d.id)).toEqual(["drift:status:won:2026-11-05"]);
  });

  it("offers no form when the yes quotes a figure that is not this offer's", () => {
    const r = row({ contact_email: CUSTOMER });
    const yes = mail({ from_email: CUSTOMER, received_at: oman("2026-11-05 11:00"), body_text: "Dear Sir,\n\nPlease proceed with the booking at OMR 75.\n\nRegards" });
    const status = driftFor(r, [yes], { offer: offer() }).find((d) => d.kind === "status");
    expect(status?.prefill).toBeNull();
    expect(status?.text).toContain("not this offer's");
  });

  it("says a new row was quoted by e-mail, and a quoted date that differs from the offer's", () => {
    const r = row({ contact_email: CUSTOMER });
    expect(driftFor(r, [], { offer: offer() }).find((d) => d.kind === "status")).toMatchObject({
      text: "E-mails say quoted on Thu 05 Nov; the register says awaiting quote",
      prefill: expect.objectContaining({ quoted_date: "2026-11-05" }),
    });
    const quoted = row({ contact_email: CUSTOMER, quoted_date: "2026-11-08" });
    expect(driftFor(quoted, [], { offer: offer() }).find((d) => d.kind === "quoted_date")).toMatchObject({
      text: "E-mails say quoted on Thu 05 Nov; the register says Sun 08 Nov",
      prefill: { quoted_date: "2026-11-05", replace: ["quoted_date"], notes: expect.any(Array) },
    });
    expect(driftFor(row({ contact_email: CUSTOMER, quoted_date: "2026-11-05" }), [], { offer: offer() }).filter((d) => d.kind === "quoted_date")).toEqual([]);
  });

  it("flags a confirmed date before the enquiry date", () => {
    const r = row({ enquiry_date: "2026-04-15", quoted_date: "2026-04-15", confirmed_date: "2026-04-11" });
    expect(driftFor(r, []).find((d) => d.kind === "date_order")).toMatchObject({
      text: "Confirmed 11 Apr is before the enquiry date — a typo?",
      prefill: expect.objectContaining({ replace: ["confirmed_date"] }),
      buttonLabel: "Fix the date…",
    });
  });

  it("gives nothing on odd input", () => {
    expect(driftOf(null as unknown as EnquiryRow, [], [], null, null, [], [], today)).toEqual([]);
    expect(driftOf(row(), null as unknown as ReadMail[], null as unknown as Side[], null, null, null as unknown as [], null as unknown as [], "")).toEqual([]);
  });
});

describe("real mail checks", () => {
  const people = (r: EnquiryRow, emails: MailInput[]) => {
    const result = read(r, emails);
    return peopleOf(result.sides, result.mails, handlerOf(result.mails, r), r, oman("2026-11-09 18:00"));
  };

  it("never gives a customer or an agent our own number read from our signature quoted back", () => {
    const r = row({ contact_email: CUSTOMER });
    const ours = mail({ ...OURS, from_email: "operation2@silverlynxoman.com", from_name: "Anwar", to_emails: [CUSTOMER], received_at: oman("2026-11-04 17:47"), body_text: "Dear Sir,\n\nPlease share the CI and PI.\n\nThanks & Regards\n\nAnwar K. S.\n\nM: +968 9000 0102" });
    const theirs = mail({
      from_email: CUSTOMER, from_name: "Anish R. Nair", received_at: oman("2026-11-04 17:52"),
      body_text: "Dear Anwar,\n\nPlease find this CI and PI attached.\n\nRegards,\n\nAnish R. Nair\nPurchase Manager\n\nThanks & Regards\n\nAnwar K. S.\n\nM: +968 9000 0102",
    });
    const blocks = people(r, [ours, theirs]);
    const anish = blocks.flatMap((b) => b.persons).find((p) => p.email === CUSTOMER);
    expect(anish?.phones.map((p) => p.digits)).not.toContain("96890000102");
    expect(blocks[blocks.length - 1].persons.find((p) => p.email === "operation2@silverlynxoman.com")?.phones[0]?.digits).toBe("96890000102");
  });

  it("reads no shipper from a block that names us as consignee or runs into our own address", () => {
    const r = row({ contact_email: CUSTOMER });
    const consignee = mail({ ...OURS, to_emails: [AGENT], received_at: oman("2026-11-08 10:00"), body_text: "Dear Samule,\n\nCONSIGNEE DETAILS :\nSILVER LYNX CO. LLC\nOffice : +968 9000 0918\n\nThanks Regards" });
    const ownSignature = mail({ ...OURS, from_email: "pricing@silverlynxoman.com", to_emails: [AGENT], received_at: oman("2026-11-08 11:00"), body_text: "Dear Robert,\n\nCOLLECTION ADDRESS :\n\nWhatsApp : +968 9000 2160\n\nOffice : +968 2400 0000\n\nEmail : pricing@silverlynxoman.com" });
    expect(people(r, [consignee, ownSignature]).some((b) => b.kind === "shipper")).toBe(false);
  });

  it("keeps one handler when two colleagues answer the same morning in turn", () => {
    const r = row({ contact_email: CUSTOMER });
    const maria = { sender_type: "self" as const, from_email: "pricing@silverlynxoman.com", from_name: "Maria" };
    const fahad = { sender_type: "staff" as const, from_email: "pricing1@silverlynxoman.com", from_name: "Fahad" };
    const say = (who: typeof maria | typeof fahad, wall: string) => mail({ ...who, to_emails: [AGENT], received_at: oman(wall), body_text: "Dear Team,\n\nPlease advise the rate for the below shipment.\n\nRegards" });
    const h = handlerOf(read(r, [say(maria, "2026-11-05 12:01"), say(maria, "2026-11-05 14:18"), say(fahad, "2026-11-05 14:28"), say(fahad, "2026-11-05 14:40"), say(maria, "2026-11-05 15:02")]).mails, r);
    expect(h).toMatchObject({ name: "Maria Britto", since: oman("2026-11-05 12:01"), previous: [] });
  });

  it("puts the customer's supplier, written to by the customer, with the shipper and not the customer", () => {
    const r = row({ contact_email: "weldmax@gmail.com" });
    const loop = mail({
      from_email: "weldmax@gmail.com", from_name: "Weld Max Business", to_emails: ["jw.oh@welding-maker.example"], cc_emails: ["pricing1@silverlynxoman.com"],
      received_at: oman("2026-11-08 11:03"), body_text: "Dear Austin Oh\n\nI have added our shipping partner in this loop, please proceed further.\n\nRegards\nAbdul\nMob +968 9000 2980",
    });
    const ours = mail({
      ...OURS, to_emails: ["jw.oh@welding-maker.example"], cc_emails: ["weldmax@gmail.com"], subject: "RE: Stock Order Inq // SL262700 1X20' EX-WORKS JIANGSU CHINA TO SOHAR OMAN",
      received_at: oman("2026-11-09 16:05"), body_text: "Dear Austin,\n\nPlease share the pick-up address and the cargo ready date.\n\nRegards",
    });
    const blocks = people(r, [loop, ours]);
    expect(blocks.find((b) => b.kind === "customer")?.persons.map((p) => p.email)).toEqual(["weldmax@gmail.com"]);
    expect(blocks.flatMap((b) => b.persons).find((p) => p.email === "jw.oh@welding-maker.example")).toMatchObject({ party: "shipper", canSave: false });
  });

  it("reads no container from a package size, and no commodity from the next label's value", () => {
    const r = row({ shipment_mode: "AIR", qty_text: "AIR" });
    const request = mail({
      ...OURS, to_emails: [AGENT], received_at: oman("2026-11-05 10:00"),
      body_text: "Dear Robert,\n\nApologize there is typing error, please find correct dimensions of the\ncargo :\n\nAOL : NEAREST AIRPORT\n\nAOD : MUSCAT\n\nQTY. : 5 BOXES\n\nDIMENSIONS : 73 X 45 X 47 CM X 4\n\nRegards",
    });
    const cargo = cargoOf(r, read(r, [request]).mails);
    expect(cargo.fields.find((f) => f.key === "equipment")?.value ?? null).toBeNull();
    expect(cargo.fields.find((f) => f.key === "commodity")?.value ?? null).toBeNull();
    expect(cargo.fields.find((f) => f.key === "dimensions")?.value).toBe("73 × 45 × 47 cm");
  });

  it("gives no quoted-date drift when the first offer on file came after the register's day", () => {
    const today = "2026-11-09";
    const r = row({ contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-04" });
    const result = read(r, []);
    const later = offer({ sentAt: oman("2026-11-08 10:45") });
    expect(driftOf(r, result.mails, result.sides, later, null, [], [], today).filter((d) => d.kind === "quoted_date")).toEqual([]);
  });
});
