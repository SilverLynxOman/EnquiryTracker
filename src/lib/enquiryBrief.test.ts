import { describe, expect, it } from "vitest";
import { input, mail, oman, row, sl262784 } from "./brief/testkit";
import {
  buildBrief,
  cleanText,
  readMails,
  replyDefaults,
  stagesOf,
  statusSentence,
  type ActionButton,
  type EnquiryBrief,
  type MailInput,
  type Viewer,
} from "./enquiryBrief";
import type { EnquiryRow } from "./types";

const PRICING = "pricing@silverlynxoman.com";
const OPS3 = "operation3@silverlynxoman.com";
const ANWAR = { sender_type: "staff" as const, from_email: "operation2@silverlynxoman.com", from_name: "Anwar" };
const WAHEED = { sender_type: "staff" as const, from_email: OPS3, from_name: "Abdul Waheed" };
const MANAGER: Viewer = { canEdit: true, canReply: true, me: null };
const SALES: Viewer = { canEdit: true, canReply: false, me: "s7" };
const VIEWER: Viewer = { canEdit: false, canReply: false, me: null };

/** Every button the brief offers, wherever it sits. */
const buttonsOf = (b: EnquiryBrief): ActionButton[] => [...b.now.buttons, ...b.needsYou.flatMap((n) => (n.button ? [n.button] : [])), ...b.flags.flatMap((f) => f.buttons)];
const side = (b: EnquiryBrief, key: string) => b.sides.find((s) => s.key === key)!;
const without = (emails: MailInput[], ...ids: string[]) => emails.filter((e) => !ids.includes(e.id));

// --- SL262713: Sterling Sites, a confirmed 20' open top from Qingdao; the customer keeps asking for the SO -------

const BASIL = "basil@sterlingsites.example";
const MILK = "milk@consolclub.com";

function sl262713(): { row: EnquiryRow; emails: MailInput[] } {
  const enquiryRow = row({
    reference: "SL262713",
    enquiry_date: "2026-10-26",
    quoted_date: "2026-10-27",
    confirmed_date: "2026-10-28",
    customer_name: "STERLING SITES LLC",
    contact_name: "Basil Iqbal",
    contact_email: BASIL,
    subject: "SL262713 1X20 OT CFR QINGDAO CHINA TO SOHAR OMAN",
    qty_text: "1X20 OT",
    shipment_mode: "FCL",
    units: 1,
    pol: "QINGDAO CHINA",
    pod: "SOHAR OMAN",
    agent_name: "CONSOLE CLUB",
    sales_person_name: "SAHAN",
    sell_total: 7000,
    buy_total: 610,
    profit: 6390,
  });
  let n = 0;
  const filed = (wall: string, over: Partial<MailInput>) => {
    n++;
    return mail({ id: `sl13-${String(n).padStart(2, "0")}`, gmail_message_id: `g-sl13-${n}`, received_at: oman(wall), sl_refs: ["SL262713"], ...over });
  };
  const customer = { gmail_thread_id: "t13-customer", subject: "RE: SL262713 // 1X20 OT QINGDAO CHINA TO SOHAR OMAN" };
  const agent = { gmail_thread_id: "t13-consolclub", subject: "RE: SL262713 // 1X20 OT CFR QINGDAO CHINA TO SOHAR OMAN" };
  const fromBasil = (wall: string, text: string) =>
    filed(wall, { ...customer, from_email: BASIL, from_name: "Basil Iqbal", to_emails: [OPS3], cc_emails: [PRICING], body_text: `Dear Waheed\n\n${text}\n\nThanks & Best Regards\nBasil Iqbal\nM: +968 9000 0201` });
  const toBasil = (wall: string, text: string) =>
    filed(wall, { ...customer, ...WAHEED, to_emails: [BASIL], cc_emails: [PRICING], body_text: `Dear Basil,\n\n${text}\n\nBest Regards,\n\nAbdul Waheed\nCell : 90000202` });
  const emails = [
    filed("2026-11-03 07:30", {
      ...agent, from_email: MILK, from_name: "Milk.Lv", to_emails: [OPS3], cc_emails: [PRICING],
      body_text: "Dear Abdul,\n\nPlease find the booking note attached.\n\nThanks & Best Regards !\n\nMilk.Lv",
      attachments: [{ filename: "BOOKING NOTE KMTC.pdf", mime_type: "application/pdf", size: 52_000, storage_path: null, skipped: null }],
    }),
    fromBasil("2026-11-04 16:33", "What's the SO status?"),
    toBasil("2026-11-04 17:10", "We are checking with the agent and will update you."),
    fromBasil("2026-11-05 09:15", "Any update on the SO?"),
    toBasil("2026-11-05 10:00", "The agent is following up with the line for the SO."),
    fromBasil("2026-11-06 11:20", "What's the SO status? Kindly update."),
    fromBasil("2026-11-07 09:05", "Kind reminder on the SO."),
    toBasil("2026-11-07 12:00", "We have chased the agent again for the SO."),
    fromBasil("2026-11-08 13:40", "Still awaiting the SO."),
    toBasil("2026-11-09 08:30", "We expect the SO from the agent today."),
    filed("2026-11-09 09:00", { ...agent, from_email: MILK, from_name: "Milk.Lv", to_emails: [OPS3], cc_emails: [PRICING], body_text: "Dear Abdul,\n\nSO will release tomorrow.\n\nThanks & Best Regards !\n\nMilk.Lv" }),
    fromBasil("2026-11-09 10:05", "What's the SO status? Please update."),
    filed("2026-11-09 14:08", { ...agent, ...WAHEED, to_emails: [MILK], cc_emails: [PRICING], body_text: "Dear Milk,\n\nPlease share SO details urgently.\n\nBest Regards,\n\nAbdul Waheed" }),
    fromBasil("2026-11-09 14:12", "So shouldn't be delayed and to sail asap without rollover"),
    filed("2026-11-09 18:29", { gmail_thread_id: "t13-wwl", subject: agent.subject, ...WAHEED, to_emails: ["ops@wwl.cn"], cc_emails: [PRICING], body_text: "Dear Team,\nPlease hold this shipment until further notice.\n\nBest Regards,\n\nAbdul Waheed" }),
  ];
  return { row: enquiryRow, emails };
}

// --- SL262731: Synergies Castings, quoted by sea; a courier enquiry of theirs is filed here too -------------------

const SYNERGIES = "purchase@synergiescastings.example";

function sl262731(): { row: EnquiryRow; emails: MailInput[] } {
  const enquiryRow = row({
    reference: "SL262731",
    enquiry_date: "2026-11-03",
    quoted_date: "2026-11-04",
    customer_name: "SYNERGIES CASTINGS LLC",
    contact_email: SYNERGIES,
    subject: "SL262731 LCL EX-WORKS DANYANG CHINA TO SOHAR OMAN",
    pol: "DANYANG CHINA",
    pod: "SOHAR OMAN",
    sales_person_name: "JITTU",
  });
  const thread = { gmail_thread_id: "t31", subject: "RE: SL262731 // RFQ LCL Danyang to Sohar", sl_refs: ["SL262731"] };
  const emails = [
    mail({ id: "sl31-01", ...thread, ...ANWAR, to_emails: [SYNERGIES], cc_emails: [PRICING], received_at: oman("2026-11-04 11:00"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nLCL PORT TO PORT : OMR 315.000\n\nTRANSIT TIME : 40 DAYS\n\nBest Regards" }),
    mail({ id: "sl31-02", ...thread, from_email: SYNERGIES, from_name: "Purchase", to_emails: [ANWAR.from_email], cc_emails: [PRICING], received_at: oman("2026-11-09 09:59"), body_text: "Dear Anwar,\n\nKind reminder on the below. We are finalizing this shipment today, so appreciate your reply by 12:00 PM\n\nRegards" }),
    mail({ id: "sl31-03", ...thread, ...ANWAR, to_emails: [SYNERGIES], cc_emails: [PRICING], received_at: oman("2026-11-09 10:24"), body_text: "Dear Sir,\n\nKindly reconfirm whether we may proceed with the sea shipment as per our offer?\n\nBest Regards" }),
    mail({
      id: "sl31-04", gmail_thread_id: "t31-courier", subject: "COURIER EX-WORKS UTTENDORF AUSTRIA TO SOHAR OMAN", sl_refs: [], from_email: SYNERGIES, from_name: "Purchase",
      to_emails: [ANWAR.from_email], received_at: oman("2026-11-09 11:30"), body_text: "Dear Anwar,\n\nPlease proceed with the courier booking.\n\nRegards",
    }),
  ];
  return { row: enquiryRow, emails };
}

// --- Whose move -----------------------------------------------------------------------------------------------

describe("whose move", () => {
  it("SL262713: the customer is waiting for us after seven requests; Consolclub owes the SO; WWL is paused", () => {
    const { row: r, emails } = sl262713();
    const b = buildBrief(input(r, emails, { now: oman("2026-11-09 18:45") }));
    const customer = side(b, "customer");
    expect(customer.state).toMatchObject({ kind: "waiting_on_us", tone: "warn", since: oman("2026-11-09 10:05") });
    expect(customer.state.text).toBe("Waiting for us since Mon 10:05 · 7 working h (9 h)");
    expect(customer.chase).toMatchObject({ count: 7, urgent: true, text: "Asked 7 times since Wed 16:33 · last Mon 14:12 · urgent" });
    expect(side(b, "consolclub.com").state).toMatchObject({ kind: "waiting_on_them", since: oman("2026-11-09 14:08"), text: "Waiting for Console Club · we asked Mon 14:08" });
    expect(side(b, "wwl.cn").pausedByUs?.emailId).toBe("sl13-15");
    expect(b.move).toMatchObject({ kind: "us_customer", word: "Customer is waiting for us", sideKey: "customer", clock: "since Mon 10:05 · 7 working h (9 h)" });
    expect(b.now).toMatchObject({ kind: "customer_waiting", tone: "warn", title: "Basil Iqbal is waiting for the SO — asked 7 times" });
  });

  it("SL262713: the next working morning the wait turns red", () => {
    const { row: r, emails } = sl262713();
    const b = buildBrief(input(r, emails, { now: oman("2026-11-10 08:30") }));
    expect(side(b, "customer").state).toMatchObject({ kind: "waiting_on_us", tone: "bad" });
    expect(b.now.tone).toBe("bad");
  });

  it("SL262784: both conversations have nothing pending and the register is behind the nomination", () => {
    const { row: r, emails } = sl262784();
    const b = buildBrief(input(r, emails));
    expect(side(b, "customer").state).toMatchObject({ kind: "nothing_pending", text: "Nothing pending · our last e-mail Mon 11:15" });
    expect(side(b, "flgshipping.net").state).toMatchObject({ kind: "nothing_pending", text: "Nothing pending · “Noted with thanks Ashwin” Mon 11:29" });
    expect(b.move).toMatchObject({ kind: "said_yes", word: "Said yes — not confirmed", icon: "check", tone: "good" });
    expect(b.now.kind).toBe("won_unmarked");
    // Without the customer's words only our own go-ahead to Frontline and our thanks remain.
    const ours = buildBrief(input(r, without(emails, "sl84-08", "sl84-19")));
    expect(ours.move).toMatchObject({ kind: "looks_won", word: "Looks won" });
  });

  it("SL262731: the customer side waits for them after our reconfirmation; their deadline was met", () => {
    const { row: r, emails } = sl262731();
    const b = buildBrief(input(r, emails));
    const customer = side(b, "customer");
    expect(customer.state).toMatchObject({ kind: "waiting_on_them", since: oman("2026-11-09 10:24") });
    expect(customer.deadline).toMatchObject({ at: "2026-11-09T12:00+04:00", cleared: true });
    expect(b.move).toMatchObject({ kind: "waiting_on_them", word: "Waiting for Synergies Castings LLC" });
    // The courier e-mail belongs to another enquiry: its "please proceed" is no yes.
    expect(b.truth).toBeNull();
    expect(b.crossFiled).toHaveLength(1);
    expect(b.flags.find((f) => f.kind === "deadline")).toMatchObject({ cleared: true, clearedText: "answered Mon 10:24" });
  });

  it("a rate in hand with no offer turns amber after 10 working hours and red after 20", () => {
    const r = row({ enquiry_date: "2026-11-03" });
    const rate = mail({ id: "y1", from_email: "marketing11@yxcargo.com", from_name: "Robert", received_at: oman("2026-11-04 05:39"), body_text: "Dear Anwar,\n\nAir freight: 5.4 usd per KG\nAirline: Y9\n\nBest regards\nRobert" });
    const at = (wall: string) => buildBrief(input(r, [rate], { now: oman(wall) }));
    expect(side(at("2026-11-04 12:00"), "yxcargo.com").state).toMatchObject({ kind: "rate_in_hand", tone: "neutral" });
    expect(side(at("2026-11-05 12:00"), "yxcargo.com").state).toMatchObject({ kind: "rate_in_hand", tone: "warn" });
    const late = at("2026-11-09 18:00");
    expect(side(late, "yxcargo.com").state).toMatchObject({ kind: "rate_in_hand", tone: "bad", since: oman("2026-11-04 05:39") });
    expect(late.move.kind).toBe("rate_in_hand");
    expect(late.now).toMatchObject({ kind: "rate_in_hand", title: "Yuxing's rate is in since Wed 05:39 — no quote on file" });
  });

  it("the SO an agent issued is news for the customer until we write to them", () => {
    const { row: r, emails } = sl262784();
    const told = buildBrief(input(r, emails));
    expect(told.sides.some((s) => s.state.kind === "pass_on")).toBe(false);
    expect(told.needsYou.some((n) => n.verb === "pass_on" && !n.done)).toBe(false);
    expect(told.needsYou.find((n) => n.id === "done:pass_on:sl84-23")).toMatchObject({ done: true, text: "Passed on to Oman Textiles: SO released · Mon 11:15" });

    const untold = buildBrief(input(r, without(emails, "sl84-25")));
    expect(side(untold, "flgshipping.net").state).toMatchObject({ kind: "pass_on", since: oman("2026-11-09 10:58"), tone: "info" });
    expect(untold.needsYou.find((n) => n.id === "pass_on:sl84-23")).toMatchObject({ verb: "pass_on", done: false, text: "Pass on to Oman Textiles: SO released (Frontline, Mon 10:58)" });
  });

  it("our acknowledgement after the customer's request leaves the move with us", () => {
    const r = row({ contact_email: "buyer@acme.example" });
    const ask = mail({ id: "q1", from_email: "buyer@acme.example", from_name: "Buyer", received_at: oman("2026-11-09 09:00"), body_text: "Dear Sir,\n\nPlease share the destination charges.\n\nRegards" });
    const noted = mail({ id: "q2", ...ANWAR, to_emails: ["buyer@acme.example"], received_at: oman("2026-11-09 09:30"), body_text: "Noted." });
    const b = buildBrief(input(r, [ask, noted]));
    expect(side(b, "customer").state).toMatchObject({ kind: "waiting_on_us", since: oman("2026-11-09 09:00") });
    expect(b.move.kind).toBe("us_customer");
  });
});

// --- Progress, truth, needs-you, now ---------------------------------------------------------------------------

describe("stages, truth, needs-you, now", () => {
  it("stagesOf: a quote and a win the register does not show, and a quoted date the e-mail puts elsewhere", () => {
    const { row: r, emails } = sl262784();
    const b = buildBrief(input(r, emails));
    const stage = (key: string) => b.stages.find((s) => s.key === key)!;
    expect(stage("received").note).toContain("forwarded by Jittu Jacob");
    expect(stage("quoted")).toMatchObject({ label: "Quoted by e-mail", date: "2026-11-05", note: "Not marked in the register", byMail: true, tone: "warn", state: "current" });
    expect(stage("outcome")).toMatchObject({ label: "Looks won", date: "2026-11-05", byMail: true, tone: "good", note: "Nominated by e-mail — not confirmed in the register" });

    const quoted = row({ quoted_date: "2026-11-08", contact_email: "buyer@acme.example" });
    const offer = mail({ id: "o1", ...ANWAR, to_emails: ["buyer@acme.example"], received_at: oman("2026-11-05 09:37"), body_text: "Dear Sir,\n\nPlease find below our final offer.\n\nPORT TO PORT : OMR 339.000\n\nBest Regards" });
    const q = buildBrief(input(quoted, [offer]));
    expect(q.stages.find((s) => s.key === "quoted")).toMatchObject({ label: "Quoted", date: "2026-11-08", registerNote: "E-mail says Thu 05 Nov 09:37", byMail: false });
    expect(stagesOf(null as never, null as never, null as never, null, null as never, null as never, "")).toEqual([]);
  });

  it("mailFollowUps: two of our e-mails to the customer on one day after the quote are one follow-up", () => {
    const r = row({ quoted_date: "2026-11-04", contact_email: "buyer@acme.example" });
    const to = { ...ANWAR, to_emails: ["buyer@acme.example"] };
    const emails = [
      mail({ id: "f1", ...to, received_at: oman("2026-11-04 10:00"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nPORT TO PORT : OMR 339.000\n\nBest Regards" }),
      mail({ id: "f2", ...to, received_at: oman("2026-11-08 10:00"), body_text: "Dear Sir,\n\nKind reminder on our offer of Wed 04 Nov.\n\nBest Regards" }),
      mail({ id: "f3", ...to, received_at: oman("2026-11-08 15:00"), body_text: "Dear Sir,\n\nPlease let us know your feedback on our offer.\n\nBest Regards" }),
    ];
    const b = buildBrief(input(r, emails));
    expect(b.mailFollowUps).toHaveLength(1);
    expect(b.mailFollowUps[0]).toMatchObject({ day: "2026-11-08", by: "Anwar K. S.", withChaseWords: true });
    expect(b.mailFollowUps[0].proof.emailId).toBe("f2");
    expect(b.stages.find((s) => s.key === "chased")?.note).toContain("chased by e-mail Sun 10:00");
    expect(b.history.find((h) => h.kind === "chased_by_email")).toMatchObject({ text: "Chased by e-mail · Anwar K. S." });
  });

  it("truth: won over quoted over on hold", () => {
    const { row: r, emails } = sl262784();
    expect(buildBrief(input(r, emails)).truth).toMatchObject({ kind: "won", text: "E-mails say: won Thu 05 Nov" });

    const fresh = row({ contact_email: "buyer@acme.example" });
    const offer = mail({ id: "t1", ...ANWAR, to_emails: ["buyer@acme.example"], received_at: oman("2026-11-05 09:37"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nPORT TO PORT : OMR 339.000\n\nBest Regards" });
    expect(buildBrief(input(fresh, [offer])).truth).toMatchObject({ kind: "quoted", text: "E-mails say: quoted Thu 05 Nov" });

    const waiting = row({ quoted_date: "2026-11-02", contact_email: "buyer@acme.example" });
    const hold = mail({ id: "t2", from_email: "buyer@acme.example", from_name: "Buyer", received_at: oman("2026-11-08 14:02"), body_text: "Dear Sir,\n\nPls hold, we are planning via Jeddah.\n\nRegards" });
    const held = buildBrief(input(waiting, [hold]));
    expect(held.truth).toMatchObject({ kind: "hold", text: "E-mails say: on hold since Sun 08 Nov" });
    expect(held.flags.find((f) => f.kind === "hold")).toMatchObject({ label: "On hold", sentence: "Pls hold, we are planning via Jeddah." });
    expect(held.now).toMatchObject({ kind: "on_hold", lines: [{ text: "Sounds lost.", tone: "warn" }] });
  });

  it("needsYou: leaves out what the Now card covers and what was put away, and strikes what was answered", () => {
    const { row: r, emails } = sl262784();
    const b = buildBrief(input(r, emails));
    expect(b.needsYou.some((n) => n.id.startsWith("drift:status"))).toBe(false);
    expect(b.needsYou.filter((n) => !n.done).map((n) => [n.verb, n.text, n.button?.label])).toEqual([
      ["save_contact", "purchase_otm@omzest.com is not a saved contact of Oman Textiles", "Save contact"],
      ["set_agent", "Agent not in the register: the e-mails are with Frontline", "Update agent"],
    ]);
    expect(b.needsYou.find((n) => n.id === "done:answer:customer:sl84-25")).toMatchObject({ done: true, button: null, text: "Complaint Mon 09:25 answered by Ashwin at 11:15" });

    const away = buildBrief(input(r, emails, { overrides: { party: {}, keptThreads: [], dismissed: ["drift:agent:FRONTLINE"] } }));
    expect(away.needsYou.some((n) => n.verb === "set_agent")).toBe(false);
  });

  it("now: no buttons for a viewer, no reply for a sales login, and Confirm job filled from the e-mails", () => {
    const { row: r, emails } = sl262784();
    expect(buildBrief(input(r, emails, { viewer: VIEWER })).now).toMatchObject({ kind: "won_unmarked", buttons: [], checkLine: null });

    const manager = buildBrief(input(r, emails, { viewer: MANAGER })).now;
    expect(manager.buttons.filter((x) => x.variant === "primary")).toHaveLength(1);
    expect(manager.buttons[0]).toMatchObject({
      id: "confirm_job",
      label: "Confirm job on Thu 05 Nov",
      variant: "primary",
      date: "2026-11-05",
      formPrefill: { confirmed_date: "2026-11-05", quoted_date: "2026-11-05", sell_total: 1225, buy_total: 1079, agent_name: "FRONTLINE" },
    });
    expect(manager.buttons.map((x) => x.label)).toEqual(["Confirm job on Thu 05 Nov", "Mark quoted only", "Mark lost…"]);
    expect(manager.checkLine).toBe("Read from the e-mails — check before you click.");

    const { row: r13, emails: e13 } = sl262713();
    const sales = buildBrief(input(r13, e13, { viewer: SALES, now: oman("2026-11-09 18:45") })).now;
    expect(sales.kind).toBe("customer_waiting");
    expect(sales.buttons.some((x) => x.id === "reply")).toBe(false);
    expect(sales.buttons.map((x) => x.label)).toEqual(["Copy status"]);
    expect(sales.checkLine).toBe("Pricing replies from the mailbox.");
  });

  it("now: a yes that names an amount which is not this offer's carries no form", () => {
    const r = row({ contact_email: "buyer@acme.example" });
    const offer = mail({ id: "a1", ...ANWAR, to_emails: ["buyer@acme.example"], received_at: oman("2026-11-05 09:37"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nPORT TO PORT : OMR 471.000\n\nBest Regards" });
    const yes = mail({ id: "a2", from_email: "buyer@acme.example", from_name: "Buyer", received_at: oman("2026-11-05 15:11"), body_text: "Dear Anwar,\n\nPlease proceed with the shipment at OMR 75.\n\nRegards" });
    const now = buildBrief(input(r, [offer, yes])).now;
    expect(now.kind).toBe("won_unmarked");
    expect(now.buttons[0]).toMatchObject({ id: "confirm_job", date: "2026-11-05" });
    expect(now.buttons[0].formPrefill).toBeUndefined();
    expect(now.lines).toContainEqual({ text: "They quote OMR 75, which is not this offer — check it is this enquiry", tone: "warn" });
  });

  it("now: Reply to a waiting customer goes to the writer, copies the handler and the sales person, and carries the status", () => {
    const { row: r, emails } = sl262713();
    const b = buildBrief(input(r, emails, { now: oman("2026-11-09 18:45") }));
    const reply = b.now.buttons.find((x) => x.id === "reply");
    expect(reply).toMatchObject({ variant: "primary", sideKey: "customer" });
    expect(reply?.replyPrefill).toMatchObject({
      sideKey: "customer",
      targetEmailId: "sl13-14",
      to: [BASIL],
      cc: [OPS3, "sales3@silverlynxoman.com"],
      subject: "RE: SL262713 // 1X20 OT QINGDAO CHINA TO SOHAR OMAN",
      message: "Dear Basil,\n\nYour shipment is confirmed with our agent at origin.\n",
    });
    expect(b.statusText?.text).toBe("Your shipment is confirmed with our agent at origin.");
    expect(b.needsYou.find((n) => n.id === "slip:SL262713:7000:610")).toMatchObject({ verb: "update", text: "Buy 610 on a sell of 7,000 looks like a slip: the profit is 91% of the sell" });
    // Put away with "Keep the register's", the slip leaves the list.
    const kept = buildBrief(input(r, emails, { now: oman("2026-11-09 18:45"), overrides: { party: {}, keptThreads: [], dismissed: ["slip:SL262713:7000:610"] } }));
    expect(kept.needsYou.some((n) => n.id.startsWith("slip:"))).toBe(false);
  });

  it("handler: Ashwin since Sat 07 Nov after Anwar, unchanged by a customs mail or a single mail of another mailbox", () => {
    const { row: r, emails } = sl262784();
    const subject = emails[7].subject;
    const later = [
      mail({ sender_type: "staff", from_email: "akp@silverlynxoman.com", to_emails: ["purchase_otm@omzest.com"], subject, sl_refs: ["SL262784"], received_at: oman("2026-11-09 12:00"), body_text: "Dear Sir,\n\nPlease share the documents for clearance.\n\nRegards" }),
      mail({ sender_type: "staff", from_email: OPS3, to_emails: ["purchase_otm@omzest.com"], subject, sl_refs: ["SL262784"], received_at: oman("2026-11-09 13:00"), body_text: "Dear Sir,\n\nPlease find the BL draft.\n\nRegards" }),
    ];
    for (const set of [emails, [...emails, ...later]]) {
      const b = buildBrief(input(r, set));
      expect(b.handler).toMatchObject({ name: "Ashwin Luiz", role: "Operations", since: oman("2026-11-07 10:01") });
      expect(b.handler?.previous.map((p) => p.name)).toEqual(["Anwar K. S."]);
      expect(b.handler?.salesPerson).toMatchObject({ name: "Jittu Jacob", onThread: true });
    }
    const alone = emails.map((e) => (e.id === "sl84-01" ? e : { ...e, to_emails: e.to_emails.filter((a) => !a.startsWith("sales7@")), cc_emails: e.cc_emails.filter((a) => !a.startsWith("sales7@")) }));
    expect(buildBrief(input(r, alone)).handler?.salesPerson?.onThread).toBe(false);
  });

  it("statusSentence: the SO template without the SO number, with a warning when another enquiry's e-mail shares the thread", () => {
    const { row: r, emails } = sl262784();
    const numbered = emails.map((e) => (e.id === "sl84-23" ? { ...e, body_text: (e.body_text ?? "").replace("accordingly.", "accordingly. SO NO: KMTCTAO8748592") } : e));
    const b = buildBrief(input(r, numbered));
    expect(b.statusText).toMatchObject({ text: "The SO was issued to the shipper on Mon 09 Nov. Next: sailing; ETD not advised yet.", warning: null, builtFrom: 1 });
    expect(b.statusText?.text).not.toContain("KMTC");
    expect(b.statusText?.facts.map((f) => [f.value, f.proof.emailId])).toEqual([["SO released Mon 09 Nov", "sl84-23"]]);

    const other = mail({
      id: "x90", gmail_thread_id: "1a1ab9b1ea7a5d8b", subject: "RE: SL262790 QINGDAO - SOHAR 40 HQ", sl_refs: ["SL262790"], from_email: "reena@flgshipping.net", from_name: "Reena Aneesh",
      to_emails: ["operation@silverlynxoman.com"], received_at: oman("2026-11-09 12:00"), body_text: "Dear Ashwin,\n\nSO attached.\n\nRegards",
    });
    const shared = buildBrief(input(r, [...numbered, other]));
    expect(shared.statusText?.warning).toBe("Some e-mails here look like SL262790 — check the dates.");
    expect(statusSentence(r, null, shared.dates, null, [], [])).toBeNull();
  });
});

// --- The page for SL262784, end to end -----------------------------------------------------------------------

describe("SL262784 end to end", () => {
  const { row: r, emails } = sl262784();
  const b = buildBrief(input(r, emails));

  it("tags the register as behind and says whose move it is with the nomination", () => {
    expect(b.truth?.text).toBe("E-mails say: won Thu 05 Nov");
    expect(b.truth?.proof.emailId).toBe("sl84-08");
    expect(b.move.word).toBe("Said yes — not confirmed");
    expect(b.move.why[0]).toContain("You are here by nominated to arrange for collection of cargo immediately.");
    expect(b.move.why[1]).toBe("Nominated Thu 05 Nov 15:11; we told Frontline to proceed 16:04. Nothing waits on us: our last e-mail Mon 11:15.");
  });

  it("shows the offer, the margin with its inputs, and the Now action with its form", () => {
    expect(b.offer).toMatchObject({ total: 471, currency: "OMR", linesText: "339 port to port + 132 LCL & DO", final: true });
    expect(b.margin.figure).toMatchObject({ text: "about OMR 56", pct: 12, negative: false });
    expect(b.margin.inputs).toContain("buy OMR 415, Frontline, agreed");
    expect(b.now).toMatchObject({ kind: "won_unmarked", tone: "good", title: "Won by e-mail on Thu 05 Nov — the register says awaiting quote" });
    expect(b.now.said?.emailId).toBe("sl84-08");
    expect(b.now.buttons[0].formPrefill?.notes[0]).toBe("Won by e-mail: Fahid (Oman Textiles), Thu 05 Nov, 15:11");
  });

  it("puts a dashed quote and a win on the progress line and proves Booked and SO released", () => {
    expect(b.stages.filter((s) => s.byMail).map((s) => s.label)).toEqual(["Quoted by e-mail", "Looks won"]);
    const node = (key: string) => b.journey?.nodes.find((n) => n.key === key);
    expect(node("booked")).toMatchObject({ state: "proven", date: "2026-11-09" });
    expect(node("so")).toMatchObject({ state: "proven", date: "2026-11-09" });
    expect(node("so")?.proof?.sentence).toContain("issued S/O to the shipper");
    expect(node("delivered")).toMatchObject({ state: "todo", note: "Not written in any e-mail — confirm by phone" });
    expect(b.journey?.chip).toMatch(/^SO released Mon 09 Nov/);
  });

  it("splits the conversation into the customer, Frontline and our side, with the loop-in hidden", () => {
    expect(b.sides.map((s) => [s.key, s.name, s.mails.length])).toEqual([
      ["customer", "Oman Textiles", 11],
      ["flgshipping.net", "Frontline", 13],
      ["internal", "Our side", 1],
    ]);
    expect(side(b, "flgshipping.net").agent?.summary).toMatch(/^OMR 309 → 303 → 298 \+ 117 · agreed/);
    expect(b.hidden).toMatchObject({ loopIns: 1, text: "1 'adding a colleague' note hidden" });
    expect(b.mails.flatMap((m) => m.excerpt).some((x) => /Disclaimer|geopolitical/i.test(x))).toBe(false);
  });

  it("shows the complaint as answered and names the handler", () => {
    const complaint = b.flags.find((f) => f.kind === "complaint");
    expect(complaint).toMatchObject({ label: "Complaint", cleared: true, clearedText: "answered Mon 11:15", when: "Mon 09:25" });
    expect(complaint?.sentence).toContain("your team is not responding");
    expect(b.flags.filter((f) => !f.cleared)).toEqual([]);
    expect(b.handler).toMatchObject({ name: "Ashwin Luiz", role: "Operations" });
  });

  it("puts cues on each e-mail by priority, the first with its amount", () => {
    const cues = (id: string) => b.mails.find((m) => m.id === id)!.cues.map((c) => c.label);
    expect(cues("sl84-07")[0]).toBe("Offer OMR 339 · final");
    expect(cues("sl84-04")[0]).toBe("Offer OMR 359");
    expect(cues("sl84-03")[0]).toBe("Rate OMR 309");
    expect(cues("sl84-11")[0]).toBe("Rate OMR 298");
    expect(cues("sl84-09")[0]).toBe("Target OMR 285");
    expect(cues("sl84-08")[0]).toBe("Says yes");
    expect(cues("sl84-19")).not.toContain("Says yes");
    expect(cues("sl84-14")[0]).toBe("Go-ahead");
    expect(cues("sl84-23")[0]).toBe("SO");
    expect(cues("sl84-25")[0]).toBe("SO");
    expect(cues("sl84-22")[0]).toBe("Complaint");
    expect(cues("sl84-26")).toEqual(["Noted"]);
    expect(cues("sl84-02")).toContain("Rate request");
  });

  it("gives copy texts, history events and reply defaults", () => {
    expect(b.copy).toMatchObject({ status: b.statusText?.text, houseSubject: "SL262784 LCL FOB NINGBO CHINA TO SOHAR OMAN" });
    expect(b.copy.offer).toContain("OMR 339");
    expect(b.copy.chase.customer).toBe("Kind reminder on our offer of Thu 05 Nov for LCL Ningbo to Sohar. Please let us know if we may proceed.");
    expect(b.history.map((h) => [h.kind, h.text])).toEqual([
      ["customer_chased", "The customer asked again (2 times)"],
      ["hand_over", "Ashwin Luiz took over from Anwar K. S."],
    ]);
    const all = replyDefaults(side(b, "customer"), b.handler, r, PRICING, { all: true });
    expect(all).toMatchObject({
      targetEmailId: "sl84-22",
      all: true,
      to: ["purchase_otm@omzest.com"],
      cc: ["raghavan_otm@omzest.com", "operation@silverlynxoman.com", "sales7@silverlynxoman.com"],
      message: "Dear Fahid,\n\n",
    });
    const fromApp = buildBrief(input(r, emails, { replies: [{ gmail_message_id: "g-sl84-25", sent_by: "u1" } as never], profileNames: new Map([["u1", "Sahan"]]) }));
    expect(fromApp.history.find((h) => h.kind === "sent_from_app")).toMatchObject({ text: "Reply sent from the app by Sahan", at: oman("2026-11-09 11:15") });
  });
});

// --- Cues on real wording -----------------------------------------------------------------------------------------

describe("cues on real wording", () => {
  const confirmed = row({ quoted_date: "2026-10-27", confirmed_date: "2026-10-28", contact_email: "basil@sterlingsites.example" });
  const fromCustomer = (id: string, wall: string, text: string) =>
    mail({ id, from_email: "basil@sterlingsites.example", from_name: "Basil Iqbal", received_at: oman(wall), body_text: `Dear Waheed\n\n${text}\n\nThanks & Best Regards\nBasil Iqbal` });

  it("a decision word used as an adjective is no approval; on its own it is", () => {
    const b = buildBrief(input(confirmed, [
      fromCustomer("c1", "2026-11-05 11:58", "Agreed sailing date already over and it shouldn’t be delayed for next vessel."),
      fromCustomer("c2", "2026-11-06 09:00", "Approved, please proceed."),
      fromCustomer("c3", "2026-11-07 09:00", "Agreed."),
    ]));
    const cues = (id: string) => b.mails.find((m) => m.id === id)!.cues.map((c) => c.label);
    expect(cues("c1")).not.toContain("Approves");
    expect(cues("c2")).toContain("Approves");
    expect(cues("c3")).toContain("Approves");
  });

  it("a step the mail only speaks of is named by its topic, not as done", () => {
    const b = buildBrief(input(confirmed, [fromCustomer("s1", "2026-11-05 11:58", "It should be sailed on the coming vessel, please share the ETD.")]));
    const labels = b.mails[0].cues.map((c) => c.label);
    expect(labels).toContain("Sailing");
    expect(labels).not.toContain("Sailed");
  });
});

// --- Cleaning ----------------------------------------------------------------------------------------------------

describe("cleaning", () => {
  it("cuts an agent's standing notice in their own language, above or below the sign-off", () => {
    const sanco = [
      "Dear Waheed,",
      "",
      "Rate is USD 450/cbm, valid till 15 Nov.",
      "",
      "***Warm prompt***",
      "1.目的国规定:去往中东、红海地区，请在提供补料时注明8位数HS CODE,如有多个品名的，请对应地提供商编，否则会有改单费RMB500/BILL!",
      "2.根据2026年阿拉伯联合酋长国国家规定，所有运往或途经阿联酋的货物必须强制申报MPCI,船司将对货物收取MPCI申报费USD35/BL.请知悉。",
      "",
      "Thank you so much and best regards~",
      "Donna Li (Ms.)",
    ].join("\n");
    expect(cleanText({ body_text: sanco, snippet: null })).toBe("Rate is USD 450/cbm, valid till 15 Nov.");
    expect(cleanText({ body_text: "Dear Waheed,\n\nSO attached.\n\n特别提醒：请提供8位数HS CODE\n\nRegards", snippet: null })).toBe("SO attached.");
    expect(cleanText({ body_text: "Dear Waheed,\n\nSO attached.\n1.目的国规定:去往中东", snippet: null })).toBe("SO attached.");
    // A numbered list of our own stays.
    expect(cleanText({ body_text: "Dear Sir,\n\n1. Commercial invoice\n2. Packing list\n\nRegards", snippet: null })).toBe("1. Commercial invoice\n2. Packing list");
  });
});

// --- Other enquiries and viewers ------------------------------------------------------------------------------

describe("other enquiries and viewers", () => {
  it("an enquiry without e-mail: the register's wait and today's quote", () => {
    const b = buildBrief(input(row(), []));
    expect(b.move).toMatchObject({ kind: "no_mail", word: "No e-mails on file", clock: "Received 01 Nov · waiting 8 days by the register" });
    expect(b.offer).toBeNull();
    expect(b.margin.figure).toBeNull();
    expect(b.now).toMatchObject({ kind: "to_quote", tone: "bad", title: "The quote is overdue" });
    expect(b.now.buttons[0]).toMatchObject({ id: "mark_quoted", label: "Mark quoted today", date: "2026-11-09", variant: "primary" });
    expect(b.flags).toEqual([]);
    expect(b.journey).toBeNull();
    expect(b.statusText).toBeNull();
    expect(b.truth).toBeNull();
    expect(b.sides.map((s) => s.key)).toEqual(["customer"]);

    const dead = buildBrief(input(row({ enquiry_date: "2026-10-15" }), []));
    expect(dead.now).toMatchObject({ kind: "to_quote", tone: "neutral", title: "Nothing on file for 25 days" });
    expect(dead.now.buttons.map((x) => x.label)).toEqual(["Mark quoted today", "Mark lost…", "Not genuine…"]);
  });

  it("a lost enquiry: closed, with Reopen and nothing that asks for a reply", () => {
    const { row: r, emails } = sl262784();
    const lost = { ...r, status: "lost" as const, closure: "lost" as const, closure_reason: "Rate not competitive" };
    const b = buildBrief(input(lost, emails));
    expect(b.now).toMatchObject({ kind: "closed", tone: "bad", title: "Closed as lost", lines: [{ text: "Rate not competitive", tone: null }] });
    expect(b.now.buttons.map((x) => x.id)).toEqual(["reopen"]);
    expect(b.move).toMatchObject({ kind: "closed", word: "Closed as lost" });
    expect(b.needsYou).toEqual([]);
    expect(b.truth).toBeNull();
    expect(b.journey).toBeNull();
    expect(b.statusText).toBeNull();
    expect(b.sides[0].mails).toHaveLength(11);
  });

  it("a viewer without rights gets every reading and no button anywhere", () => {
    for (const make of [sl262784, sl262713, sl262731]) {
      const { row: r, emails } = make();
      const b = buildBrief(input(r, emails, { viewer: VIEWER }));
      expect(buttonsOf(b)).toEqual([]);
      expect(b.needsYou.every((n) => n.button === null)).toBe(true);
    }
  });

  it("a sales login never gets a Reply button", () => {
    for (const make of [sl262784, sl262713, sl262731]) {
      const { row: r, emails } = make();
      const b = buildBrief(input(r, emails, { viewer: SALES }));
      expect(buttonsOf(b).some((x) => x.id === "reply")).toBe(false);
      expect(buttonsOf(b).some((x) => x.id === "move_mails")).toBe(false);
    }
    const { row: r, emails } = sl262731();
    const manager = buildBrief(input(r, emails));
    expect(manager.flags.find((f) => f.kind === "wrong_enquiry")?.buttons.map((x) => x.label)).toEqual(["Keep here", "Wrong enquiry"]);
  });

  it("a bounced address raises a flag and warns above the reply", () => {
    const address = "purchase@fahmyfurniture.com";
    const r = row({ contact_email: address });
    const offer = mail({ id: "b1", ...ANWAR, to_emails: [address], received_at: oman("2026-11-07 08:20"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nPORT TO PORT : OMR 359.000\n\nBest Regards" });
    const bounce = mail({
      id: "b2", from_email: "mailer-daemon@googlemail.com", from_name: "Mail Delivery Subsystem", subject: "Delivery Status Notification (Failure)", received_at: oman("2026-11-07 08:24"),
      body_text: `Final-Recipient: rfc822; ${address}\nAction: failed\nStatus: 5.7.1 Message blocked`,
    });
    const b = buildBrief(input(r, [offer, bounce]));
    expect(b.flags.find((f) => f.kind === "bounced")).toMatchObject({ label: "Bounced", sentence: `${address} was blocked`, when: "Sat 08:24" });
    expect(b.mails.find((m) => m.id === "b2")?.cues[0]).toMatchObject({ key: "bounce", label: "Bounced" });
    const reply = replyDefaults(side(b, "customer"), b.handler, r, PRICING);
    expect(reply.to).toEqual([address]);
    expect(reply.warnings).toEqual([`${address} bounced on Sat 07 Nov — check the address`]);
  });

  it("never throws: odd input gives the empty brief", () => {
    expect(() => buildBrief(input(row(), [null as never, { id: "x" } as never]))).not.toThrow();
    const odd = buildBrief({ row: undefined, emails: null, followUps: null, now: "never", viewer: null } as never);
    expect(odd.mails).toEqual([]);
    expect(odd.now.buttons).toEqual([]);
    expect(readMails(null as never).mails).toEqual([]);
  });
});

// --- Checked against real enquiries ------------------------------------------------------------------------------

describe("checked against real enquiries", () => {
  const CUSTOMER = "buyer@castings.example";
  const AGENT = "robert@aircargo.example";

  it("puts the waiting customer before an agent who has waited longer, and lists the agent under needs-you", () => {
    const { row: r, emails } = sl262713();
    const wwl = mail({
      id: "sl13-wwl", gmail_thread_id: "t13-wwl", subject: "RE: SL262713 // 1X20 OT CFR QINGDAO CHINA TO SOHAR OMAN", sl_refs: ["SL262713"], from_email: "ops@wwl.cn", from_name: "Cynthia",
      to_emails: [OPS3], cc_emails: [PRICING], received_at: oman("2026-11-06 03:21"), body_text: "Dear Abdul,\n\nNow , space of KAWA still is pending , do we change to MSC?\n\nThanks",
    });
    const b = buildBrief(input(r, [...without(emails, "sl13-15"), wwl], { now: oman("2026-11-09 18:00") }));
    expect(side(b, "wwl.cn").state.kind).toBe("waiting_on_us");
    expect(b.move).toMatchObject({ kind: "us_customer", sideKey: "customer" });
    expect(b.needsYou.some((n) => n.id === "answer:wwl.cn")).toBe(true);
  });

  it("a yes on a new enquiry with no offer of ours on file is a win to confirm, not a quote overdue", () => {
    const r = row({ enquiry_date: "2026-10-31", contact_email: "goldenarena@gmail.com", shipment_mode: "FCL", qty_text: "1X40'" });
    const yes = mail({ from_email: "goldenarena@gmail.com", from_name: "GOLDEN ARENA", received_at: oman("2026-11-07 11:52"), body_text: "Dear Sir,\n\nWe have confirmed hereby." });
    const b = buildBrief(input(r, [yes]));
    expect(b.now).toMatchObject({ kind: "won_unmarked", tone: "good", title: "Won by e-mail on Sat 07 Nov — the register says awaiting quote" });
    expect(b.now.lines.map((l) => l.text)).toContain("No offer of ours is on file: enter the rates when you confirm.");
    expect(b.now.buttons[0]).toMatchObject({ id: "confirm_job", variant: "primary", formPrefill: expect.objectContaining({ confirmed_date: "2026-11-07" }) });
  });

  it("quotes the urgent sentence in the urgent flag, not an apology for “delayed” feedback", () => {
    const r = row({ contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-02" });
    const urgent = mail({
      from_email: CUSTOMER, from_name: "Yazan", received_at: oman("2026-11-08 09:38"),
      body_text: "Dear Ashwin,\n\nThank you for your reply, and apologies for the delayed feedback.\n\nFor the Austria shipment, we don’t have a target rate. Please share your best offer, if possible today by 1:00 PM, as it’s urgent.\n\nKind regards,\n\nYazan",
    });
    const b = buildBrief(input(r, [urgent]));
    expect(b.flags.find((f) => f.kind === "urgent")?.sentence).toBe("Please share your best offer, if possible today by 1:00 PM, as it’s urgent.");
  });

  it("chases no agent for a rate once we have quoted the customer after asking", () => {
    const r = row({ contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-05", shipment_mode: "AIR", qty_text: "AIR" });
    const request = mail({ ...ANWAR, to_emails: ["ujjwal@avfreight.example"], received_at: oman("2026-11-04 16:21"), body_text: "Dear Team,\n\nPlease advise air freight quote for the below shipment.\n\nAOL : MUMBAI\n\nRegards" });
    // A second request, younger: the headline waits on that one, so the first would be a chase item.
    const second = mail({ ...ANWAR, to_emails: ["amol@avaglobal.example"], received_at: oman("2026-11-04 16:25"), body_text: "Dear Team,\n\nPlease advise air freight quote for the below shipment.\n\nAOL : MUMBAI\n\nRegards" });
    const offer = mail({ ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-05 13:45"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nDOOR TO DOOR : OMR 552.000\n\nBest Regards" });
    const quoted = buildBrief(input(r, [request, second, offer]));
    expect(quoted.needsYou.some((n) => n.verb === "chase" && n.id.includes("avfreight"))).toBe(false);
    expect(buildBrief(input(r, [request, second])).needsYou.some((n) => n.verb === "chase" && n.id.includes("avfreight"))).toBe(true);
  });

  it("counts our answer to the customer's question as a reply, not a follow-up by e-mail", () => {
    const r = row({ contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-04" });
    const offer = mail({ ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-04 12:04"), body_text: "Dear Sir,\n\nPlease find below our offer for Air.\n\nDOOR TO DOOR: OMR 768.000\n\nThanks & Regards" });
    const asks = mail({ from_email: CUSTOMER, from_name: "Yazan", received_at: oman("2026-11-08 15:28"), body_text: "Dear Anwar,\n\nCould you kindly reconfirm the rate of OMR 768 and let us know the validity?\n\nKind regards" });
    const answer = mail({ ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-09 10:24"), body_text: "Dear Sir,\n\nBelow quoted is our best rate to secure first shipment from your good company, kindly support with your nomination.\n\nThanks & Regards" });
    expect(buildBrief(input(r, [offer, asks, answer])).mailFollowUps).toEqual([]);
    expect(buildBrief(input(r, [offer, answer])).mailFollowUps.map((f) => f.day)).toEqual(["2026-11-09"]);
  });

  it("writes no status text without an e-mail, and no “booking awaited” once a BL draft is spoken of", () => {
    const confirmed = row({ status: "confirmed", quoted_date: "2026-10-31", confirmed_date: "2026-10-31", shipment_mode: "FCL", qty_text: "1X40'", sell_total: 7570, buy_total: 7270, profit: 300 });
    expect(buildBrief(input(confirmed, [])).statusText).toBeNull();
    const draft = mail({
      from_email: MILK, from_name: "Milk.Lv", to_emails: [OPS3], received_at: oman("2026-11-09 10:00"), body_text: "Dear Abdul,\n\nPlease find the BL draft attached, kindly check.\n\nThanks & Best Regards !",
      attachments: [{ filename: "HPSHOM2611100_BL_DRAFT.pdf", mime_type: "application/pdf", size: 60_000, storage_path: null, skipped: null }],
    });
    expect(buildBrief(input(confirmed, [draft])).statusText?.text).toBe("Your shipment is confirmed with our agent at origin.");
  });

  it("dates a copied offer for the reader outside and names no shipment the e-mails say has changed", () => {
    const r = row({ contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-04" });
    const offer = mail({ ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-04 12:04"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nDOOR TO DOOR: OMR 768.000\n\nVALIDITY : 2 WEEKS\n\nThanks & Regards" });
    const air = mail({ from_email: AGENT, from_name: "Robert", subject: "RE: SL262700 AIR EX-WORKS DANYANG CHINA TO MUSCAT OMAN", received_at: oman("2026-11-04 12:00"), body_text: "Dear Anwar,\n\nAir freight: 5.4 usd per KG\n\nBest regards" });
    const b = buildBrief(input(r, [air, offer]));
    expect(b.copy.offer).toContain("Valid until : 18 Nov 2026");
    expect(b.drift.some((d) => d.kind === "mode")).toBe(true);
    expect(b.copy.chase.customer).toBe("Kind reminder on our offer of Wed 04 Nov. Please let us know if we may proceed.");
  });

  it("names what our request asks for in the wait and the chase: the HS code, not the BL draft", () => {
    const r = row({ status: "confirmed", quoted_date: "2026-11-02", confirmed_date: "2026-11-02", shipment_mode: "FCL", qty_text: "1X40'", sell_total: 7600, buy_total: 7120, profit: 480 });
    const ask = mail({ ...WAHEED, to_emails: ["sp@broker.example"], received_at: oman("2026-11-07 09:24"), body_text: "Dear Prasad,\n\nPlease share HS code12 digit number\n\nBest Regards,\n\nAbdul Waheed" });
    const b = buildBrief(input(r, [ask]));
    expect(b.now).toMatchObject({ kind: "confirmed_waiting_agent", title: expect.stringContaining("for the HS code") });
    expect(b.copy.chase["broker.example"]).toBe("Kind reminder on the below. Please share the HS code at the earliest.");
  });

  it("puts no e-mail date on the register's quote when the offer on file is a revision after the job was confirmed", () => {
    const r = row({ contact_email: CUSTOMER, status: "confirmed", enquiry_date: "2026-10-15", quoted_date: "2026-10-17", confirmed_date: "2026-10-26", shipment_mode: "AIR", qty_text: "AIR", sell_total: 3732, buy_total: 3473, profit: 259 });
    const revised = mail({ ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-09 11:48"), body_text: "Dear Sir,\n\nPlease find below our revised offer.\n\nDOOR TO DOOR: OMR 1448.000\n\nThanks & Regards" });
    const b = buildBrief(input(r, [revised]));
    expect(b.stages.find((s) => s.key === "quoted")?.registerNote).toBeNull();
    expect(b.drift.some((d) => d.kind === "quoted_date")).toBe(false);
  });

  it("lists one rates item when the register's buy is a slip and the agreed buy says the same", () => {
    const { row: r, emails } = sl262713();
    const agent = { gmail_thread_id: "t13-consolclub", subject: "RE: SL262713 // 1X20 OT CFR QINGDAO CHINA TO SOHAR OMAN", sl_refs: ["SL262713"] };
    const rate = mail({ id: "sl13-rate", ...agent, from_email: MILK, from_name: "Milk.Lv", to_emails: [PRICING], received_at: oman("2026-11-07 10:00"), body_text: "Dear Maria,\n\nO/F : USD 6300/20GP\n\nThanks & Best Regards !" });
    const agreed = mail({
      id: "sl13-agreed", ...agent, sender_type: "self", from_email: PRICING, from_name: "Maria", to_emails: [MILK], received_at: oman("2026-11-07 12:50"),
      body_text: "Dear Samuel,\n\nMany thanks for your support, we hereby confirm this shipment with below agreed rate.\n\nO/F : USD 6300/20GP\n\nBest Regards",
    });
    const b = buildBrief(input(r, [...emails, rate, agreed], { now: oman("2026-11-09 18:45") }));
    expect(b.registerMoney.slip).not.toBeNull();
    expect(b.registerMoney.differs).not.toBeNull();
    expect(b.needsYou.filter((n) => n.verb === "update" && /buy|slip/i.test(n.text))).toHaveLength(1);
  });

  it("suggests no buy for the form while the agent's rate is written in two currencies", () => {
    const r = row({ contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-02", shipment_mode: "FCL", qty_text: "1X40 OT", units: 1 });
    const offer = mail({ ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-02 14:50"), body_text: "Dear Sir,\n\nPlease find our quote.\n\nDOOR TO DOOR : OMR 5012/40 OT HC\n\nBest Regards" });
    const yes = mail({ from_email: CUSTOMER, from_name: "Akshay", received_at: oman("2026-11-05 11:43"), body_text: "Dear Maria,\n\nGohead – and share the forwarder details.\n\nRegards" });
    const rate = mail({ from_email: "luca@agent-italy.example", from_name: "Luca", received_at: oman("2026-11-05 15:00"), body_text: "Dear Maria,\n\nWith MSK door to Sohar:€8995/40 OTHC IG.\n\nBest regards" });
    const ours = mail({ ...ANWAR, to_emails: ["luca@agent-italy.example"], received_at: oman("2026-11-05 18:02"), body_text: "Dear Luca,\n\nNoted, USD 8995/40 OT HC, please proceed.\n\nBest Regards" });
    const b = buildBrief(input(r, [offer, yes, rate, ours]));
    expect(b.margin.clash).not.toBeNull();
    expect(b.registerMoney.prefill?.buy_total).toBeUndefined();
    expect(b.now.buttons.find((x) => x.id === "confirm_job")?.formPrefill?.buy_total).toBeUndefined();
  });

  it("quotes what a reminder asks about, not “Kind reminder on the below”", () => {
    const r = row({ contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-04" });
    const chase = mail({ from_email: CUSTOMER, from_name: "Yazan", received_at: oman("2026-11-09 09:59"), body_text: "Dear Anwar,\n\nKind reminder on the below.\n\nWe are finalizing this shipment today, so appreciate your reply by 12:00 PM if possible.\n\nKind regards" });
    const answer = mail({ ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-09 10:24"), body_text: "Dear Sir,\n\nBelow quoted is our best rate, kindly support with your nomination.\n\nThanks & Regards" });
    const done = buildBrief(input(r, [chase, answer])).needsYou.find((n) => n.done && n.verb === "answer");
    expect(done?.text).toContain("We are finalizing this shipment today");
  });

  it("asks nobody to tell the customer a date our own e-mail to them gave", () => {
    const r = row({ status: "confirmed", quoted_date: "2026-11-01", confirmed_date: "2026-11-02", contact_email: CUSTOMER, shipment_mode: "FCL", qty_text: "1X20'", sell_total: 7000, buy_total: 6300, profit: 700 });
    const planned = mail({ from_email: MILK, from_name: "Milk.Lv", to_emails: [OPS3], received_at: oman("2026-11-03 09:00"), body_text: "Dear Abdul,\n\nETD 06/11 confirmed with the line.\n\nThanks & Best Regards !" });
    const ours = mail({ ...WAHEED, to_emails: [CUSTOMER], received_at: oman("2026-11-10 12:44"), body_text: "Dear Sir,\n\nAwaiting SO from the line, ETD 18/11\n\nBest Regards,\n\nAbdul Waheed" });
    const b = buildBrief(input(r, [planned, ours], { now: oman("2026-11-10 15:00") }));
    expect(b.dates.etd).toMatchObject({ date: "2026-11-18", slipDays: 12 });
    expect(b.needsYou.some((n) => n.verb === "tell_customer")).toBe(false);
  });

  it("puts right the garbled dash in the out-of-office flag", () => {
    const away = mail({
      from_email: "simone@agent-italy.example", from_name: "Simone Noli", subject: "Automatic reply: SL262700", received_at: oman("2026-11-09 12:34"),
      body_text: "I am out of the office. For urgent matters please contact Luca Ancona â€“ ancona@agent-italy.example",
    });
    const flag = buildBrief(input(row(), [away])).flags.find((f) => f.kind === "out_of_office");
    expect(flag?.sentence).toContain("ancona@agent-italy.example");
    expect(flag?.sentence).not.toContain("â€");
  });
});

// --- Review fixes -------------------------------------------------------------------------------------------------

describe("review fixes", () => {
  const CUSTOMER = "buyer@acme.example";
  const put = (...dismissed: string[]) => ({ overrides: { party: {}, keptThreads: [], dismissed } });
  const today = (sales: string) => [{ enquiry_id: "SL262700", sales_person_id: sales, followed_up_on: "2026-11-09" }];

  it("Confirm job fills only what the register leaves empty, and its notes speak only of that", () => {
    const { row: r, emails } = sl262784();
    const quoted = { ...r, status: "quoted" as const, quoted_date: "2026-11-05" };
    const confirmOf = (b: EnquiryBrief) => b.now.buttons.find((x) => x.id === "confirm_job");

    // The register has its own sell, buy and agent: nothing read from the e-mails replaces them.
    const filled = confirmOf(buildBrief(input({ ...quoted, sell_total: 1250, buy_total: 999, agent_name: "OTHER LINE" }, emails)));
    expect(filled?.formPrefill).toEqual({ confirmed_date: "2026-11-05", notes: ["Won by e-mail: Fahid (Oman Textiles), Thu 05 Nov, 15:11"] });

    // Only the sell is missing: only the sell is filled, with its own note.
    const sellOnly = confirmOf(buildBrief(input({ ...quoted, sell_total: null, buy_total: 999, agent_name: "OTHER LINE" }, emails)))?.formPrefill;
    expect(sellOnly).toMatchObject({ sell_total: 1225, confirmed_date: "2026-11-05" });
    expect(sellOnly?.replace).toBeUndefined();
    expect(sellOnly?.buy_total).toBeUndefined();
    expect(sellOnly?.agent_name).toBeUndefined();
    expect(sellOnly?.notes.map((n) => n.split(" ")[0])).toEqual(["Won", "Sell"]);
  });

  it("Not won yet puts away the won reading everywhere: the status drift, Looks won and the progress line", () => {
    const { row: r, emails } = sl262784();
    const quoted = { ...r, status: "quoted" as const, quoted_date: "2026-11-05" };
    const ours = without(emails, "sl84-08", "sl84-19");
    const before = buildBrief(input(quoted, ours));
    expect(before.move.kind).toBe("looks_won");
    expect(before.now.buttons.find((x) => x.id === "dismiss")).toMatchObject({ label: "Not won yet", dismissId: "won:2026-11-05" });

    const after = buildBrief(input(quoted, ours, put("won:2026-11-05")));
    expect(after.now.kind).toBe("waiting_customer");
    expect(after.needsYou.some((n) => n.id.startsWith("drift:status"))).toBe(false);
    expect(after.move.kind).not.toBe("looks_won");
    expect(after.stages.find((s) => s.key === "outcome")?.label).not.toBe("Looks won");
    expect(after.truth).toBeNull();

    // The customer's own yes is not put away by it.
    const yes = buildBrief(input(quoted, emails, put("won:2026-11-05")));
    expect(yes.move.kind).toBe("said_yes");
  });

  it("Done by phone ends the pass-on in whose move, not only on the Now card", () => {
    const r = row({ status: "confirmed", quoted_date: "2026-11-01", confirmed_date: "2026-11-02", contact_email: CUSTOMER, sell_total: 1000, buy_total: 800, profit: 200 });
    const so = mail({ id: "p1", from_email: MILK, from_name: "Milk", to_emails: [OPS3], received_at: oman("2026-11-08 10:00"), body_text: "Dear Abdul,\n\nThe SO is released to the shipper.\n\nRegards" });
    const news = buildBrief(input(r, [so]));
    expect(news.move).toMatchObject({ kind: "pass_on", word: "Pass on to the customer" });
    expect(news.now.buttons.find((x) => x.id === "dismiss")).toMatchObject({ label: "Done by phone", dismissId: "pass_on:p1" });

    const told = buildBrief(input(r, [so], put("pass_on:p1")));
    expect(told.move.kind).not.toBe("pass_on");
    expect(side(told, "consolclub.com").state.kind).not.toBe("pass_on");
    expect(told.now.kind).not.toBe("pass_on");
    expect(told.needsYou.some((n) => n.verb === "pass_on" && !n.done)).toBe(false);
  });

  it("offers Followed up today instead of a second Log a follow-up in every state that offers one", () => {
    const quoted = row({ status: "quoted", quoted_date: "2026-11-02", contact_email: CUSTOMER });
    const hold = mail({ id: "h1", from_email: CUSTOMER, from_name: "Buyer", received_at: oman("2026-11-08 14:02"), body_text: "Dear Sir,\n\nPls hold, we are planning via Jeddah.\n\nRegards" });
    const ask = mail({ id: "h2", from_email: CUSTOMER, from_name: "Buyer", received_at: oman("2026-11-09 09:00"), body_text: "Dear Sir,\n\nPlease share the destination charges.\n\nRegards" });
    const ids = (b: EnquiryBrief) => b.now.buttons.map((x) => [x.id, x.label]);
    for (const [emails, kind] of [[[hold], "on_hold"], [[ask], "customer_waiting"]] as const) {
      const fresh = buildBrief(input(quoted, [...emails], { viewer: SALES }));
      expect(fresh.now.kind).toBe(kind);
      expect(ids(fresh)).toContainEqual(["log_follow_up", "Log a follow-up"]);
      const logged = buildBrief(input(quoted, [...emails], { viewer: SALES, followUps: today("s7") }));
      expect(ids(logged)).toContainEqual(["undo_follow_up", "Followed up today"]);
      expect(ids(logged).some(([id]) => id === "log_follow_up")).toBe(false);
      // A colleague's follow-up today is theirs: this login may still log its own.
      expect(ids(buildBrief(input(quoted, [...emails], { viewer: SALES, followUps: today("s9") })))).toContainEqual(["log_follow_up", "Log a follow-up"]);
    }
  });

  it("our promise to an agent opens the reply without the customer's status text, which carries our sell price", () => {
    const r = row({ status: "quoted", quoted_date: "2026-11-05", contact_email: CUSTOMER });
    const rate = mail({ id: "r1", from_email: "reena@flgshipping.net", from_name: "Reena", to_emails: [ANWAR.from_email], received_at: oman("2026-11-04 09:00"), body_text: "Dear Anwar,\n\nOcean freight : USD 900\n\nRegards" });
    const offer = mail({ id: "o1", ...ANWAR, to_emails: [CUSTOMER], received_at: oman("2026-11-05 09:37"), body_text: "Dear Sir,\n\nPlease find below our offer.\n\nPORT TO PORT : OMR 1250.000\n\nBest Regards" });
    const promise = mail({ id: "pr1", ...ANWAR, to_emails: ["reena@flgshipping.net"], received_at: oman("2026-11-08 10:00"), body_text: "Dear Reena,\n\nWe will confirm the booking by tomorrow.\n\nBest Regards" });
    const b = buildBrief(input(r, [rate, offer, promise]));
    expect(b.statusText?.text).toContain("OMR 1,250");
    const due = b.needsYou.find((n) => n.id === "promise:pr1");
    expect(due?.button).toMatchObject({ id: "reply", sideKey: "flgshipping.net" });
    expect(due?.button?.replyPrefill?.to).toEqual(["reena@flgshipping.net"]);
    expect(due?.button?.replyPrefill?.message).not.toContain("OMR");
    expect(due?.button?.copyText).toBeUndefined();
    // Without the mailbox the copy holds our own promise, not the customer's status.
    const copy = buildBrief(input(r, [rate, offer, promise], { viewer: SALES })).needsYou.find((n) => n.id === "promise:pr1")?.button;
    expect(copy).toMatchObject({ id: "copy", label: "Copy what we said", copyText: "We will confirm the booking by tomorrow." });
  });

  it("a read-only login linked to a sales person gets no button that puts a reading away", () => {
    const { row: r, emails } = sl262784();
    const quoted = { ...r, status: "quoted" as const, quoted_date: "2026-11-05" };
    const readOnly: Viewer = { canEdit: false, canReply: false, me: "s7" };
    const b = buildBrief(input(quoted, without(emails, "sl84-08", "sl84-19"), { viewer: readOnly }));
    expect(b.now.kind).toBe("looks_won");
    expect(buttonsOf(b).some((x) => x.id === "dismiss")).toBe(false);
    expect(b.now.buttons).toEqual([]);
    expect(b.now.checkLine).toBeNull();
    // An editor keeps them.
    expect(buildBrief(input(quoted, without(emails, "sl84-08", "sl84-19"), { viewer: SALES })).now.buttons.map((x) => x.label)).toContain("Not won yet");
  });

  it("takes no competing agent's sailing date for a slip, and counts no date down before the job is booked", () => {
    const fresh = row({ contact_email: CUSTOMER });
    const thread = (id: string, address: string) => ({ gmail_thread_id: `t-${id}`, sl_refs: ["SL262700"], subject: "RE: SL262700 LCL SHANGHAI CHINA TO SOHAR OMAN", to_emails: [ANWAR.from_email], from_email: address });
    const ask = (id: string, address: string) => mail({ id: `${id}0`, ...thread(id, address), ...ANWAR, to_emails: [address], received_at: oman("2026-11-03 09:00"), body_text: "Dear Team,\n\nPlease advise ocean freight quote.\n\nRegards" });
    const winco = mail({ id: "w1", ...thread("w", "ops@winco.example"), from_name: "Winco", received_at: oman("2026-11-04 09:00"), body_text: "Dear Anwar,\n\nOcean freight : USD 1000\nETD 06 Nov\n\nRegards" });
    const sanco = mail({ id: "s1", ...thread("s", "ops@sanco.example"), from_name: "Sanco", received_at: oman("2026-11-05 09:00"), body_text: "Dear Anwar,\n\nOcean freight : USD 950\nETD 15 Nov\n\nRegards" });
    const b = buildBrief(input(fresh, [ask("w", "ops@winco.example"), ask("s", "ops@sanco.example"), winco, sanco], { now: oman("2026-11-14 10:00") }));
    expect(b.dates.etd?.slipDays ?? null).toBeNull();
    expect(b.dates.etd?.earlier ?? []).toEqual([]);
    expect(b.dates.headline).toBeNull();
    expect(b.needsYou.some((n) => n.verb === "tell_customer")).toBe(false);

    // One agent's date on an enquiry not yet booked: shown, but no countdown.
    const one = buildBrief(input(fresh, [ask("w", "ops@winco.example"), mail({ id: "w2", ...thread("w", "ops@winco.example"), received_at: oman("2026-11-04 09:00"), body_text: "Dear Anwar,\n\nPlease find our rates attached.\nETD 06 Nov\n\nRegards" })], { now: oman("2026-11-05 10:00") }));
    expect(one.dates.etd).toMatchObject({ date: "2026-11-06" });
    expect(one.dates.headline).toBeNull();
  });

  it("a closed enquiry keeps no deadline flag and no waiting clock", () => {
    const closed = row({ status: "not_genuine", enquiry_date: "2026-10-01", contact_email: CUSTOMER });
    const urgent = mail({ id: "u1", from_email: CUSTOMER, from_name: "Buyer", received_at: oman("2026-10-01 10:00"), body_text: "Dear Sir,\n\nKindly quote urgently by tomorrow.\n\nRegards" });
    const b = buildBrief(input(closed, [urgent], { now: oman("2026-11-14 10:00") }));
    expect(b.flags.some((f) => f.kind === "deadline")).toBe(false);
    expect(side(b, "customer").state).toMatchObject({ kind: "nothing_pending", age: null, since: null });
    expect(side(b, "customer").state.text).not.toContain("Waiting");
    // The conversation header builds its "Reply by … passed" chip from the side's deadline: none is left.
    expect(side(b, "customer").deadline).toBeNull();
    for (const status of ["lost", "cancelled"] as const) expect(side(buildBrief(input({ ...closed, status }, [urgent], { now: oman("2026-11-14 10:00") })), "customer").deadline).toBeNull();
    // Open, the same e-mail still raises both.
    const open = buildBrief(input({ ...closed, status: "new" }, [urgent], { now: oman("2026-11-14 10:00") }));
    expect(open.flags.some((f) => f.kind === "deadline")).toBe(true);
    expect(side(open, "customer").state.kind).toBe("waiting_on_us");
    expect(side(open, "customer").deadline).toMatchObject({ passed: true, cleared: false });
  });

  it("keeps a line's dates and the booking agent's on a confirmed job, with or without our go-ahead", () => {
    const r = row({ status: "confirmed", quoted_date: "2026-11-01", confirmed_date: "2026-11-02", contact_email: CUSTOMER, sell_total: 1000, buy_total: 800, profit: 200 });
    const go = mail({ id: "go", ...WAHEED, to_emails: [MILK], gmail_thread_id: "t-agent", received_at: oman("2026-11-02 09:00"), body_text: "Dear Milk,\n\nPlease proceed with the booking at USD 800.\n\nRegards" });
    const so = mail({ id: "a1", from_email: MILK, from_name: "Milk", to_emails: [OPS3], gmail_thread_id: "t-agent", received_at: oman("2026-11-03 09:00"), body_text: "Dear Abdul,\n\nThe SO is released. ETD 06 Nov.\n\nRegards" });
    const line = mail({ id: "c1", from_email: "sohar.cs@maersk.com", from_name: "Maersk Line", to_emails: [OPS3], gmail_thread_id: "t-line", received_at: oman("2026-11-05 09:00"), body_text: "Dear Sir,\n\nPlease note the vessel ETA Sohar is 11.11.2026.\n\nRegards" });
    for (const emails of [[so, line], [go, so, line]]) {
      const b = buildBrief(input(r, emails, { now: oman("2026-11-09 10:00") }));
      expect(b.dates.etd?.date).toBe("2026-11-06");
      expect(b.dates.eta).toMatchObject({ date: "2026-11-11", port: "Sohar" });
      expect(b.journey?.nodes.find((n) => n.key === "arrived")?.note).toBe("ETA Sohar 11 Nov");
    }
  });

  it("never states a figure that is not the shipment's total as what we sent or what the e-mails say", () => {
    const offerMail = (lines: string) =>
      mail({ id: "o1", ...ANWAR, to_emails: [CUSTOMER], gmail_thread_id: "t-customer", received_at: oman("2026-11-03 10:00"), body_text: `Dear Sir\n\nPlease find below our offer.\n\n${lines}\n\nThanks & Regards\n\nAnwar K. S.` });
    // By the kilo with no weight known: the rate per kilo, never the OMR 2.1 stand-in as a total.
    const air = row({ shipment_mode: "AIR", contact_email: CUSTOMER });
    const byKilo = offerMail("AIRPORT TO AIRPORT : OMR 2.100 / KG\n\nDO CHARGES : OMR 150.000");
    const quoted = buildBrief(input(air, [byKilo]));
    expect(quoted.move.why.join(" ")).toContain("sent OMR 2.1/kg on");
    expect(quoted.now.lines[0]?.text).toMatch(/^OMR 2\.1\/kg · /);
    const confirmed = buildBrief(input({ ...air, status: "confirmed", quoted_date: "2026-11-03", confirmed_date: "2026-11-04", sell_total: null }, [byKilo]));
    expect(confirmed.now.lines[0]?.text).toContain("The e-mails say sell OMR 2.1/kg (total depends on the weight)");
    // Per box with the number of boxes unknown: the rate per box, not one box plus the trucking.
    const perBox = buildBrief(input(row({ shipment_mode: "FCL", contact_email: CUSTOMER }), [offerMail("PORT TO PORT : OMR 3282.000 / 40\n\nTRANSPORTATION : OMR 135.000")]));
    expect(perBox.move.why.join(" ")).toContain("sent OMR 3,282/40 on");
    // A whole offer still reads as its total.
    const whole = buildBrief(input(row({ shipment_mode: "FCL", qty_text: "1X40", units: 1, contact_email: CUSTOMER }), [offerMail("PORT TO PORT : OMR 3282.000 / 40\n\nTRANSPORTATION : OMR 135.000")]));
    expect(whole.move.why.join(" ")).toContain("sent OMR 3,417 on");
  });
});
