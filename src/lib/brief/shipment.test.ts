import { describe, expect, it } from "vitest";
import type { EnquiryRow } from "../types";
import { proofOf, readMails } from "./read";
import {
  assignMilestones,
  datesOf,
  documentKind,
  documentsOf,
  journeyOf,
  milestoneHits,
  modeSetOf,
  parseShipDate,
  refsOf,
} from "./shipment";
import { input, mail, oman, row, sl262784 } from "./testkit";
import type { AgentQuote, Journey, MailInput, MilestoneKey, Offer, ReadMail, WonCue } from "./types";

const TODAY = "2026-11-09"; // a Monday
const PRICING = "pricing@silverlynxoman.com";
const OPS = "operation3@silverlynxoman.com";
const AGENT = "milk@consolclub.com";
const CUSTOMER = "basil@acme-trading.com";

const fromAgent = (at: string, body_text: string, over: Partial<MailInput> = {}) =>
  mail({ from_email: AGENT, from_name: "Milk Lv", to_emails: [OPS], cc_emails: [PRICING], received_at: oman(at), body_text, ...over });
const fromCustomer = (at: string, body_text: string, over: Partial<MailInput> = {}) =>
  mail({ from_email: CUSTOMER, from_name: "Basil Iqbal", to_emails: [OPS], cc_emails: [PRICING], received_at: oman(at), body_text, ...over });
const ours = { sender_type: "staff" as const, from_email: OPS, from_name: "Abdul Waheed", cc_emails: [PRICING] };
const toAgent = (at: string, body_text: string, over: Partial<MailInput> = {}) => mail({ ...ours, to_emails: [AGENT], received_at: oman(at), body_text, ...over });
const toCustomer = (at: string, body_text: string, over: Partial<MailInput> = {}) => mail({ ...ours, to_emails: [CUSTOMER], received_at: oman(at), body_text, ...over });
const file = (filename: string, size = 120_000, mime_type = "application/pdf") => ({ filename, mime_type, size, storage_path: null, skipped: null });

/** A confirmed sea import: SL262700, LCL Shanghai to Sohar, confirmed Mon 02 Nov 2026. */
const confirmed = (over: Partial<EnquiryRow> = {}) => row({ quoted_date: "2026-11-01", confirmed_date: "2026-11-02", contact_email: CUSTOMER, ...over });

/** The e-mails read and their milestones assigned, as buildBrief does it. */
function read(enquiryRow: EnquiryRow, emails: MailInput[]) {
  const mails = readMails(input(enquiryRow, emails)).mails;
  const set = modeSetOf(enquiryRow, mails);
  assignMilestones(mails, set, enquiryRow.status === "confirmed");
  const of = (email: MailInput) => mails.find((m) => m.id === email.id) as ReadMail;
  return { mails, set, of, journey: (won: WonCue[] = []) => journeyOf(enquiryRow, mails, won, TODAY) as Journey };
}

const node = (journey: Journey, key: MilestoneKey) => journey.nodes.find((n) => n.key === key)!;
const states = (journey: Journey) => journey.nodes.map((n) => n.state);
const subs = (m: ReadMail) => m.milestones.map((h) => h.sub).filter(Boolean);

describe("modeSetOf", () => {
  it("follows the mode, then the direction, then the port of discharge", () => {
    expect(modeSetOf(row({ shipment_mode: "COURIER" }), [])).toBe("courier");
    expect(modeSetOf(row({ shipment_mode: "AIR" }), [])).toBe("air");
    expect(modeSetOf(row({ trade_type: "EXP" }), [])).toBe("sea_export");
    expect(modeSetOf(row(), [])).toBe("sea_import");
    expect(modeSetOf(row({ trade_type: null, pod: "JEBEL ALI UAE" }), [])).toBe("sea_export");
    expect(modeSetOf(row({ trade_type: null, pod: null }), [])).toBe("sea_import");
  });

  it("reads the direction off the newest agent-side house subject when the register has none", () => {
    const exportRow = row({ trade_type: null, pod: null });
    const emails = [toAgent("2026-11-03 09:00", "Please advise the quote.", { subject: "SL262700 1X40' SOHAR OMAN TO HAMBURG GERMANY" })];
    expect(modeSetOf(exportRow, readMails(input(exportRow, emails)).mails)).toBe("sea_export");
  });
});

describe("journeyOf: booking and SO", () => {
  it("proves Booked and SO released from the agent's mail and its booking form, and nothing from our own request", () => {
    const { row: enquiryRow, emails } = sl262784();
    const ask = mail({
      sender_type: "staff", from_email: "operation@silverlynxoman.com", from_name: "Ashwin luiz",
      to_emails: ["reena@flgshipping.net"], cc_emails: [PRICING], gmail_thread_id: "1a1ab9b1ea7a5d8b",
      subject: "RE: ENQ1020126007139//ABSOH26110504//SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN",
      sl_refs: ["SL262784"], enquiry_id: enquiryRow.id, received_at: oman("2026-11-08 10:10"),
      body_text: "Dear Reena,\n\nPlease share SO details\n\nThanks & Regards,\n\nAshwin Luiz",
    });
    const { mails, set, of } = read(enquiryRow, [...emails, ask]);
    expect(set).toBe("sea_import");
    expect(of(ask).milestones).toEqual([{ key: "so", sub: "so_requested", proves: false, sentence: "Please share SO details", file: null }]);

    const yes = mails.find((m) => m.id === "sl84-08") as ReadMail;
    const won: WonCue[] = [{ kind: "customer_yes", day: "2026-11-05", betterRate: false, amountMismatch: false, proof: proofOf(yes, TODAY) }];
    const journey = journeyOf(enquiryRow, mails, won, TODAY) as Journey;

    const booked = node(journey, "booked");
    expect(booked).toMatchObject({ state: "proven", date: "2026-11-09", label: "Booked" });
    expect(booked.proof).toMatchObject({ emailId: "sl84-23", when: "Mon 09 Nov, 10:58", who: "Reena Aneesh (Frontline)", file: "BOOKING FORM -320348- (1).xls" });
    expect(booked.subSteps.map((s) => s.label)).toEqual(["Booking note Mon 10:58", "Shipper details sent Thu 16:04", "Agent details sent Thu 15:37"]);

    const so = node(journey, "so");
    expect(so).toMatchObject({ state: "proven", date: "2026-11-09", label: "SO released" });
    expect(so.proof).toMatchObject({ emailId: "sl84-23", when: "Mon 09 Nov, 10:58" });
    expect(so.proof?.sentence).toContain("issued S/O to the shipper");
    expect(so.subSteps.map((s) => [s.key, s.label, s.tone])).toEqual([["so_requested", "SO requested Sun 10:10", "neutral"]]);

    expect(journey.reached).toBe("so");
    expect(journey.chip).toBe("SO released Mon 09 Nov");
    expect(node(journey, "sailed")).toMatchObject({ state: "todo", note: "ETD not advised" });
    expect(node(journey, "arrived")).toMatchObject({ state: "todo", note: "ETA not advised" });
    expect(node(journey, "delivered")).toMatchObject({ state: "todo", note: "Not written in any e-mail — confirm by phone" });
  });

  it("is null until the job is confirmed or the e-mails show a yes", () => {
    const { row: enquiryRow, emails } = sl262784();
    const { journey } = read(enquiryRow, emails);
    expect(journey()).toBeNull();
    expect(journeyOf(row(), [], [], TODAY)).toBeNull();
  });

  it("counts our chases of the SO and keeps the wait amber until it is released", () => {
    const { journey } = read(confirmed(), [
      toAgent("2026-11-03 10:10", "Dear Milk,\n\nPlease share SO details."),
      toAgent("2026-11-04 09:00", "Dear Milk,\n\nKindly update SO status urgently."),
      toAgent("2026-11-05 09:00", "REMINDER\n\nDear Milk,\n\nPlease release the SO today itself."),
      fromCustomer("2026-11-05 16:33", "Dear Waheed\n\nWhat's the SO status?"),
    ]);
    const so = node(journey(), "so");
    expect(so.state).toBe("current");
    expect(so.subSteps.map((s) => [s.label, s.tone])).toEqual([["SO requested Tue 10:10 · chased 2×", "warn"]]);
    expect(so.emailIds).toHaveLength(4);
    expect(journey().chip).toBe("Now: SO requested");
  });
});

describe("journeyOf: guards", () => {
  it("marks the steps before the furthest proven one that no e-mail marks", () => {
    const { journey } = read(confirmed(), [fromAgent("2026-11-08 09:00", "Dear Abdul,\n\nVessel sailed on 07/11/2026.")]);
    expect(states(journey())).toEqual(["unmarked", "unmarked", "proven", "todo", "todo", "todo", "todo", "todo"]);
    expect(node(journey(), "so").note).toBe("No e-mail marks this step");
    expect(journey().reached).toBe("sailed");
  });

  it("counts a pre-alert once, however many replies carry its subject", () => {
    const subject = "Pre-Alert: KWSTAO26100326 GDWV26104329 SL262700 2X20' DALIAN CHINA TO SOHAR OMAN//GDWV26104329";
    const first = fromAgent("2026-11-05 09:00", "Dear Abdul\n\nPlease kindly find attached Pre-Alert Documents for the subject shipment ,", { subject });
    const { mails, of, journey } = read(confirmed(), [
      first,
      toAgent("2026-11-05 10:00", "Dear Milk,\n\nWell received.", { subject: `RE: ${subject}` }),
      fromAgent("2026-11-06 09:00", "Dear Abdul,\n\nD/N will send it to you immediately once received.", { subject: `RE: ${subject}` }),
      toAgent("2026-11-07 10:00", "Dear Milk,\n\nPlease share MBL telex release", { subject: `RE: ${subject}` }),
      fromAgent("2026-11-08 09:00", "Dear Abdul,\n\nNoted.", { subject: `RE: ${subject}` }),
    ]);
    expect(mails.filter((m) => m.milestones.some((h) => h.sub === "pre_alert"))).toEqual([of(first)]);
    expect(node(journey(), "bl").subSteps.map((s) => s.label)).toEqual(["Pre-alert Thu 09:00"]);
    // Read on its own, a reply still shows the tag of its subject.
    expect(milestoneHits(mails[0], "sea_import", true).map((h) => h.sub)).toContain("pre_alert");
  });

  it("takes a Cargo Arrival Notice for the CAN, not for the arrival", () => {
    const { journey } = read(confirmed(), [fromAgent("2026-11-08 09:00", "Dear Sir,\n\nCargo Arrival Notice attached.")]);
    expect(node(journey(), "can_do")).toMatchObject({ state: "proven", date: "2026-11-08" });
    expect(node(journey(), "can_do").subSteps.map((s) => s.label)).toEqual(["CAN Sun 09:00"]);
    expect(node(journey(), "arrived")).toMatchObject({ state: "unmarked", proof: null });
  });

  it("never reads a carrier's _POD.PDF as a delivery", () => {
    const pod = fromAgent("2026-11-08 09:00", "Dear Sir,\n\nPlease find attached.", { attachments: [file("006033_POD.PDF", 71_800)] });
    const { of, journey } = read(confirmed(), [pod]);
    expect(documentKind("006033_POD.PDF", "application/pdf", 71_800, "Please find attached proof of delivery")).toEqual({ kind: "other", subKind: null, label: "Other" });
    expect(of(pod).milestones).toEqual([]);
    expect(states(journey()).every((s) => s === "todo")).toBe(true);
  });

  it("takes a file named only by a number for the SO when the mail says so", () => {
    const bare = fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nPlease check.", { attachments: [file("KMTCTAO8748592.pdf", 99_737)] });
    expect(read(confirmed(), [bare]).of(bare).milestones).toEqual([]);

    const cued = fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nPls find attach SO details.", { attachments: [file("KMTCTAO8748592.pdf", 99_737)] });
    const { of, journey, mails } = read(confirmed(), [cued]);
    expect(of(cued).milestones).toMatchObject([{ key: "so", proves: true, file: "KMTCTAO8748592.pdf" }]);
    expect(node(journey(), "so")).toMatchObject({ state: "proven", date: "2026-11-04" });
    expect(refsOf(mails, confirmed()).find((c) => c.kind === "so")).toMatchObject({ value: "KMTCTAO8748592", copyLabel: "Copy SO number KMTCTAO8748592" });
    expect(refsOf(mails, confirmed()).find((c) => c.kind === "carrier")?.value).toBe("KMTC");
  });

  it("tells a BL approval given from one asked for", () => {
    const okOurs = toAgent(
      "2026-11-05 09:00",
      "Dear Rosanne,\n\nMBL & HBL drafts consignee and notify details is OK from our side, cargo & packages details please take final approval from shipper and proceed.\n\nThanks.",
    );
    const asked = toCustomer("2026-11-05 10:00", "Dear Sir,\n\nGood day!!!\n\nPlease find attached HBL draft kindly check and confirm us your approval.\n\nThanks.", {
      attachments: [file("HPSHOM2611115_BL_DRAFT.pdf", 36_220)],
    });
    const fromOrigin = fromAgent("2026-11-05 08:00", "Dear Abdul,\n\nPlease check and confirm the attached BL draft.", { attachments: [file("HPSHOM2611115_BL_DRAFT.pdf", 36_007)] });
    const before = read(confirmed(), [fromOrigin, okOurs, asked]);
    expect(subs(before.of(okOurs))).toEqual(["bl_ok_ours"]);
    expect(subs(before.of(asked))).toEqual(["bl_draft"]);
    expect(subs(before.of(fromOrigin))).toEqual(["bl_draft"]);
    const waiting = node(before.journey(), "bl");
    expect(waiting.state).toBe("current");
    expect(waiting.proof).toBeNull();
    expect(waiting.subSteps.map((s) => [s.label, s.tone])).toEqual([["BL draft v2 · not approved yet", "warn"], ["OK from our side Thu 09:00", "neutral"]]);
    expect(before.journey().chip).toBe("Now: BL draft");

    const approved = fromCustomer("2026-11-06 09:00", "Dear Waheed,\n\nBL drafts checked and found ok to proceed.");
    const short = fromCustomer("2026-11-06 09:00", "BL confirm, kindly proceed and share vessel schedule / ETA Sohar");
    const bare = fromCustomer("2026-11-06 09:00", "Approved.");
    for (const yes of [approved, short, bare]) {
      const after = read(confirmed(), [fromOrigin, okOurs, asked, yes]);
      expect(subs(after.of(yes))).toContain("bl_approved");
      expect(node(after.journey(), "bl").subSteps.map((s) => s.label)).toEqual(["BL approved Fri 09:00", "BL draft v2 Thu 10:00", "OK from our side Thu 09:00"]);
      expect(node(after.journey(), "bl").state).toBe("current");
    }
    // The same word with no draft waiting approves something else.
    const alone = fromCustomer("2026-11-06 09:00", "Approved.");
    expect(read(confirmed(), [alone]).of(alone).milestones).toEqual([]);
  });

  it("proves the BL by the release or the final copy, whoever forwards the file", () => {
    const telex = fromAgent("2026-11-07 09:00", "Dear Abdul,\n\nHbl is telex , we shared to shipper.");
    const forwarded = toCustomer("2026-11-08 09:00", "Dear Sir,\n\nPlease find attached HBL Original copy.\n\nShipment sailed 07.11.2026", {
      attachments: [file("HPSHOM2611115_BL_ORIGINAL.pdf", 39_480)],
    });
    const request = toAgent("2026-11-06 09:00", "Dear Gao,\n\nPlease share MBL telex release");
    const a = read(confirmed(), [request, telex]);
    expect(a.of(request).milestones).toEqual([{ key: "bl", sub: null, proves: false, sentence: "Please share MBL telex release", file: null }]);
    expect(node(a.journey(), "bl")).toMatchObject({ state: "proven", date: "2026-11-07" });
    expect(node(a.journey(), "bl").subSteps.map((s) => s.label)).toEqual(["Telex release Sat 09:00"]);

    const b = read(confirmed(), [forwarded]);
    expect(node(b.journey(), "bl")).toMatchObject({ state: "proven", date: "2026-11-08" });
    expect(node(b.journey(), "bl").proof?.file).toBe("HPSHOM2611115_BL_ORIGINAL.pdf");
    // Our own "Shipment sailed" passes the news on: it marks the step, it does not prove it.
    expect(node(b.journey(), "sailed")).toMatchObject({ state: "unmarked", proof: null });
    expect(node(b.journey(), "sailed").emailIds).toEqual([forwarded.id]);
  });

  it("reads the Oman side: authorization asked is not done, the Bayan is proven by its file, Delivered never is", () => {
    const arrival = fromCustomer("2026-11-05 09:00", "Dear Abdul Waheed,\n\nVessle has arrived at Salalah port, and the container is there now.");
    const askedFor = toCustomer("2026-11-06 09:00", "Dear Sir,\n\nPlease arrange authorization for clearance GULF FALCON - C00002864");
    const done = fromCustomer("2026-11-06 12:00", "Dear Ashwin,\n\nAuthorization has been successfully completed.");
    const bayan = toCustomer("2026-11-08 09:00", "Dear Sir,\n\nPlease find attached bayan and arrange payment", { attachments: [file("DeclarationPrint.pdf", 204_920)] });
    const delivered = fromCustomer("2026-11-09 09:00", "Dear Ashwin,\n\nThe cargo has been delivered to our store, thanks.");
    const { of, journey, mails } = read(confirmed(), [arrival, askedFor, done, bayan]);
    expect(of(askedFor).milestones).toEqual([{ key: "bayan", sub: null, proves: false, sentence: "Please arrange authorization for clearance GULF FALCON - C00002864", file: null }]);
    expect(subs(of(done))).toEqual(["authorization"]);
    expect(node(journey(), "arrived")).toMatchObject({ state: "proven", date: "2026-11-05" });
    expect(node(journey(), "can_do")).toMatchObject({ state: "unmarked" });
    const customs = node(journey(), "bayan");
    expect(customs).toMatchObject({ state: "proven", date: "2026-11-08" });
    expect(customs.proof?.file).toBe("DeclarationPrint.pdf");
    expect(customs.subSteps.map((s) => s.label)).toEqual(["Authorization done Fri 12:00"]);
    expect(node(journey(), "delivered")).toMatchObject({ state: "todo", proof: null, note: "Not written in any e-mail — confirm by phone" });
    expect(refsOf(mails, confirmed()).find((c) => c.kind === "customs_code")).toMatchObject({ value: "C00002864", copyLabel: "Copy customs code C00002864" });

    const after = read(confirmed(), [arrival, askedFor, done, bayan, delivered]).journey();
    expect(node(after, "delivered")).toMatchObject({ state: "current", proof: null, date: null, note: "An e-mail mentions delivery — confirm by phone" });
    expect(after.reached).toBe("bayan");
  });

  it("keeps quote riders, standing notices and origin paperwork out of the customs steps", () => {
    const riders = fromAgent("2026-11-03 09:00", "Dear Abdul,\n\nDESTINATION CHARGES\nCUSTOM DUTY : AT ACTUALS\nDO CHARGES : OMR 35/-\nBL FEE : USD 50\nDELIVERY ORDER : USD 60");
    const notice = fromAgent(
      "2026-11-04 09:00",
      "Dear Sir,\n\nNoted.\n\n//\n\nKindly note an important Oman Customs Notice: Effective 15 September 2026, All applicable cargo arriving in Oman by air , sea and road must be palletised. Customs declaration and duty paid by consignee.",
    );
    const origin = fromAgent("2026-11-05 09:00", "Dear Ashwin\n\nWe are waiting for shipper to provide some documents for customs declaration. HS code and brand to be confirmed.");
    const { of, journey } = read(confirmed(), [riders, notice, origin]);
    expect(of(riders).milestones).toEqual([]);
    expect(of(notice).milestones).toEqual([]);
    expect(of(origin).milestones).toEqual([]);
    expect(states(journey()).every((s) => s === "todo")).toBe(true);

    // After the arrival the same words are the Oman side's.
    const arrival = fromAgent("2026-11-06 09:00", "Dear Ashwin,\n\nShipment arrived Sohar today.");
    const snag = fromAgent("2026-11-07 09:00", "Dear Ashwin,\n\nPlease share the HS code and brand of the goods.");
    const later = read(confirmed(), [arrival, snag]);
    expect(subs(later.of(snag))).toEqual(["hs_brand"]);
    // Arrival at a warehouse on the way is not the arrival.
    const onTheWay = fromAgent("2026-11-06 09:00", "Dear Ashwin,\n\nCargo arrived at our warehouse yesterday.");
    expect(read(confirmed(), [onTheWay]).of(onTheWay).milestones).toEqual([]);
  });

  it("greys the steps from the reached one after a cancel sentence, until a later proof", () => {
    const booking = fromAgent("2026-11-03 09:00", "Dear Abdul,\n\nPlease find the booking confirmation attached.", { attachments: [file("BPENC26000367 - BC.pdf", 45_082)] });
    const so = fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nSO released, please check the attachment.");
    const cancel = fromCustomer("2026-11-05 09:00", "Dear Waheed,\n\nKindly cancel current booking. We will plan this cargo next month.");
    const stopped = read(confirmed(), [booking, so, cancel]).journey();
    expect(states(stopped)).toEqual(["proven", "void", "void", "void", "void", "void", "void", "void"]);
    expect(node(stopped, "so").note).toBe("Cancelled or changed");
    expect(stopped.cancelled).toMatchObject({ emailId: cancel.id, sentence: "Kindly cancel current booking." });
    expect(stopped.reached).toBe("booked");

    const again = fromAgent("2026-11-08 09:00", "Dear Abdul,\n\nNew S/O issued for the next sailing, please find attached.");
    const resumed = read(confirmed(), [booking, so, cancel, again]).journey();
    expect(resumed.cancelled).toBeNull();
    expect(node(resumed, "so")).toMatchObject({ state: "proven", date: "2026-11-08" });
    expect(states(resumed).slice(2)).toEqual(["todo", "todo", "todo", "todo", "todo", "todo"]);

    // A warning about fees, a condition or a refusal to wait cancels nothing; nor does something else of the customer's.
    for (const text of [
      "Cancellation charges will apply after gate-in.",
      "It shouldn't be delayed for next vessel.",
      "If cancelled, please inform us.",
      "Due to these delays, several orders have been cancelled, and we have incurred significant financial losses and customer penalties.",
      "Kindly advise next vessel to check for future booking",
    ]) {
      expect(read(confirmed(), [booking, so, fromCustomer("2026-11-05 09:00", text)]).journey().cancelled).toBeNull();
    }

    // Our own word to the agent cancels or re-books just as well.
    const ours = toAgent("2026-11-05 09:00", "Dear Milk,\n\nPlease note customer could not pick up containers as cross stuffing issue still not solved. Kindly cancel current booking");
    expect(read(confirmed(), [booking, so, ours]).journey().cancelled).toMatchObject({ emailId: ours.id, sentence: "Kindly cancel current booking" });
    const moved = toAgent("2026-11-05 09:00", "Dear Milk,\n\nPlease amend this booking to next vessel and share release order along with vessel details");
    expect(read(confirmed(), [booking, so, moved]).journey().cancelled?.emailId).toBe(moved.id);

    // With nothing proven yet, the steps from the one the e-mails were about are greyed, not the booking.
    const asked = toAgent("2026-11-03 09:00", "Dear Milk,\n\nPlease share SO details.");
    const early = read(confirmed(), [asked, moved]).journey();
    expect(states(early)).toEqual(["todo", "void", "void", "void", "void", "void", "void", "void"]);
    expect(early.cancelled?.emailId).toBe(moved.id);
  });

  it("takes the agent's word that the vessel is booked for the booking", () => {
    const booked = fromAgent("2026-11-04 13:25", "Dear Abdul,\n\nWe have booked the vessel on 23/11 as per shipper request.");
    expect(node(read(confirmed(), [booked]).journey(), "booked")).toMatchObject({ state: "proven", date: "2026-11-04" });
  });

  it("keeps a hold of the SO, a BL still being chased and a final BL draft out of the proofs", () => {
    const hold = toAgent("2026-11-07 09:01", "Dear Milk,\n\nPlease hold and do not release the SO to shipper as we have heavy payment outstanding from consignee.");
    const chased = fromAgent("2026-11-09 06:06", "Dear Abdul,\n\nwe are pushing Carrier release final BL to us ,will send it to you once available ,tks");
    const finalDraft = fromAgent("2026-11-09 12:45", "Dear Abdul,\n\npls find attachment final mbl draft");
    const { of, journey } = read(confirmed(), [hold, chased, finalDraft]);
    expect(of(hold).milestones.map((h) => [h.key, h.sub])).toEqual([["so", null]]);
    expect(of(chased).milestones.some((h) => h.proves)).toBe(false);
    expect(subs(of(finalDraft))).toEqual(["bl_draft"]);
    expect(states(journey()).includes("proven")).toBe(false);
  });

  it("leaves out the ship's arrival at the port of loading, signature tag lines and the riders of a rate", () => {
    const pol = toAgent("2026-11-10 10:17", "Dear Milk,\n\nAs per SO ETD 13/11/ please explain delay of the vessel arrival shanghai 18/11/ ??");
    const rider = fromAgent("2026-11-06 10:59", "Dear Abdul,\n\n- Rates are subject to the ruling surcharges at time of shipping, space, equipment availability, acceptance and T’s & C’s by the carrier.");
    const tag = toAgent("2026-11-07 12:50", "Dear Milk,\n\nNoted.\n\nFreight Forwarder | NVOCC | Customs Broker | Projects Handling & Heavy Equipment | GCC transporters");
    const { of } = read(confirmed(), [pol, rider, tag]);
    expect(of(pol).milestones.map((h) => h.key)).not.toContain("arrived");
    expect(of(rider).milestones).toEqual([]);
    expect(of(tag).milestones).toEqual([]);
  });
});

describe("journeyOf: what a sentence states", () => {
  const proven = (journey: Journey) => journey.nodes.filter((n) => n.state === "proven").map((n) => n.key);
  const provenBy = (email: MailInput, enquiryRow = confirmed()) => proven(read(enquiryRow, [email]).journey());

  it("takes what happened as said, whatever the rest of the sentence promises", () => {
    expect(provenBy(fromAgent("2026-11-08 09:00", "Dear Sir,\n\nShipment has arrived, our team will share you the CAN by tomorrow."))).toEqual(["arrived"]);
    expect(provenBy(fromAgent("2026-11-08 09:00", "Dear Sir,\n\nThe shipment has arrived at sohar port and we will share the CAN for this shipment by today"))).toEqual(["arrived"]);
    expect(
      provenBy(fromAgent("2026-11-07 09:00", "Dear Abdul,\n\nThe vessel has departed and is expected to arrive at Qingdao by 09.11.2026, will share you the final BL once received.")),
    ).toEqual(["sailed"]);
    expect(provenBy(fromAgent("2026-11-07 09:00", "Dear Abdul,\n\nVessel has departed from origin as planned, will share you the final BL once received."))).toEqual(["sailed"]);
    expect(provenBy(fromAgent("2026-11-07 09:00", "hi dear good day the vessel had sailed on 6th afternoon,and the pre alert expect to get it after 2-3 days"))).toEqual(["sailed"]);
    expect(provenBy(fromCustomer("2026-11-08 09:00", "Dear Waheed,\n\nThanks for sharing the CAN. Endorsed BL is attached."))).toEqual(["can_do"]);
  });

  it("proves nothing by a plan, a hope, a condition or a request", () => {
    for (const text of [
      "The vessel is expected to arrive by 15.11.2026, our team will share the CAN once arrived.",
      "We hope the shipment has arrived at MCT. Kindly confirm.",
      "Please confirm shipment arrived and share CAN without delay",
      "Shipment reached to Sohar??",
      "We will send pre alert within 3 working days after the ship sailed ,thanks",
      "Agreed sailing date already over and it shouldn’t be delayed for next vessel it should be sailed please share the planning vessel etd details",
      "Kindly assist to share the CAN.",
      "Please note we will share CAN once its available",
    ]) {
      expect(provenBy(fromCustomer("2026-11-08 09:00", `Dear Waheed,\n\n${text}`))).toEqual([]);
    }
    // A request broken over two lines by the sender's mail program is still a request.
    const wrapped = fromCustomer("2026-11-08 09:00", "Dear Waheed,\n\nCould you please confirm at your earliest convenience whether the shipment has\narrived at Sohar port.");
    expect(provenBy(wrapped)).toEqual([]);
  });

  it("takes a place on the way for no arrival", () => {
    for (const text of [
      "Shipment reached Ningbo today 13/10.",
      "The cargo arrived at the NHV yesterday.",
      "Vessel arrived at Jebel Ali, connecting vessel ETD 12 Nov.",
      "Further, please note that the vessel arrived at POL and is scheduled to sail by tomorrow.",
      "Pls note the cargo arrived at the CFS",
    ]) {
      expect(provenBy(fromAgent("2026-11-08 09:00", `Dear Abdul,\n\n${text}`))).toEqual([]);
    }
    const reachedOut = fromAgent("2026-11-08 09:00", "Dear Abdul,\n\nWe have reached out to the carrier for an update.");
    expect(read(confirmed(), [reachedOut]).of(reachedOut).milestones).toEqual([]);
    expect(provenBy(fromAgent("2026-11-08 09:00", "Dear Abdul,\n\n* Arrived and discharged at Salalah on 5 November 2026"))).toEqual(["arrived"]);

    // On the way out the Oman port is the start; the port of discharge in the subject is the end.
    const exportRow = confirmed({ trade_type: "EXP", pol: "SOHAR OMAN", pod: "HAMBURG GERMANY" });
    const subject = "RE: SL262700 1X40' SOHAR OMAN TO HAMBURG GERMANY";
    expect(provenBy(fromAgent("2026-11-08 09:00", "Dear Ashwin,\n\nContainer arrived at Sohar port this morning.", { subject }), exportRow)).toEqual([]);
    expect(provenBy(fromAgent("2026-11-08 09:00", "Dear Ashwin,\n\nVessel arrived Hamburg on 2 Dec.", { subject }), exportRow)).toEqual(["arrived"]);
  });

  it("proves the BL by its release, not by the kind of BL or a release still to come", () => {
    const released: string[] = [
      "TLX has been finished，pls find below.",
      "HB/L surrendered to shipper already, Please only release the cargo to consignee once received HB/L surrendered from the consignee.",
      "Tlx-mbl is applying，HBL is ORG,we have sent to shipper.",
      "pls find attachment obl",
      "As instructed attached OHBL have been sent to shipper .",
    ];
    for (const text of released) expect(provenBy(fromAgent("2026-11-07 09:00", `Dear Abdul,\n\n${text}`))).toEqual(["bl"]);
    const applying = fromAgent("2026-11-07 09:00", "Dear Abdul,\n\nTlx-mbl is applying，HBL is ORG,we have sent to shipper.");
    expect(subs(read(confirmed(), [applying]).of(applying))).toEqual(["originals"]);

    for (const text of [
      "telex under process, will share u once available soon",
      "HBL type telex release ,",
      "HBL : original",
      "HB/L will TELEX RELEASE",
      "MBL : surrender (we are waiting for surrender from carrier)",
      "shipper not payment yet，so obl not sign，pls wait",
      "I have just hang up with shipper reminding him to send me his courier details in order to send him the OBL .",
      "The original BL is urgently required, and we request your full support in obtaining it as soon as possible.",
      "This shipment is under L/C. The shipper’s B/L requirements can only be met by the original Master B/L.",
      "DON'T RELEASE CARGO TO CONSIGNEE WITHOUT OUR OHBL OR TELEX HBL.",
      "Please Kindly share MBL surrendered / telex release BL immediately.",
    ]) {
      expect(provenBy(fromAgent("2026-11-07 09:00", `Dear Abdul,\n\n${text}`))).toEqual([]);
    }
    // "Original" beside no BL is some other original.
    const gone = fromAgent("2026-11-07 09:00", "Dear Abdul,\n\nUnfortunately original are already gone .");
    expect(read(confirmed(), [gone]).of(gone).milestones).toEqual([]);
  });

  it("proves the SO by its number or by the agent holding it; a question about it is a mention", () => {
    expect(provenBy(fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nSO:EGLV146601421201"))).toEqual(["so"]);
    expect(
      provenBy(fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nTo avoid the risk of no space available at the last minute, we obtained the SO for this shipment as early as Monday and have been checking daily.")),
    ).toEqual(["so"]);
    const chase = fromCustomer("2026-11-04 09:00", "Dear Waheed,\n\nWhat’s the Status OF SO? Why its delaying agreed sailing date NOV 1 already over");
    const { of, journey } = read(confirmed(), [chase]);
    expect(of(chase).milestones.map((h) => [h.key, h.proves])).toContainEqual(["so", false]);
    expect(proven(journey())).toEqual([]);
  });

  it("proves the Bayan when a sentence says it is there, not when it is asked for or only authorized", () => {
    const arrival = fromAgent("2026-11-05 09:00", "Dear Ashwin,\n\nShipment arrived Sohar today.");
    const wished = fromCustomer("2026-11-06 09:00", "Dear Ashwin,\n\nYour immediate support and action in processing the Bayan and arranging\nthe delivery is highly appreciated.");
    const authorised = fromCustomer("2026-11-06 10:00", "Dear Ashwin,\n\nPlease note that the Bayan authorization has already been completed, and there are no duty or VAT exemptions.");
    const pressed = fromCustomer("2026-11-06 11:00", "Dear Ashwin,\n\nKindly proceed with the Bayan customs declaration from your side *without\nfurther delay*.");
    const before = read(confirmed(), [arrival, wished, authorised, pressed]);
    expect(proven(before.journey())).toEqual(["arrived"]);
    expect(subs(before.of(authorised))).toContain("authorization");
    expect(node(before.journey(), "bayan")).toMatchObject({ state: "current", proof: null });
    expect(before.of(wished).milestones[0].sentence).toBe("Your immediate support and action in processing the Bayan and arranging the delivery is highly appreciated.");

    const thanked = fromCustomer("2026-11-08 09:00", "Dear Ashwin,\n\n*Thank you for processing the Bayan.*");
    const paid = fromCustomer("2026-11-08 09:00", "Dear Ashwin,\n\n*As per the customs Bayan, the payment has been completed successfully.*");
    for (const said of [thanked, paid]) {
      expect(node(read(confirmed(), [arrival, wished, authorised, pressed, said]).journey(), "bayan")).toMatchObject({ state: "proven", date: "2026-11-08" });
    }
  });
});

describe("journeyOf: air and courier", () => {
  it("proves the AWB by its file and the arrival at MCT by the agent's word", () => {
    const air = confirmed({ shipment_mode: "AIR", qty_text: "AIR", pol: "GUANGZHOU CHINA", pod: "MUSCAT OMAN" });
    const awb = fromAgent("2026-11-05 09:00", "Dear Ashwin,\n\nPlease find the final AWB attached.", { attachments: [file("MCT HAWB.pdf", 881_848)] });
    const number = fromAgent("2026-11-06 09:00", "Dear Ashwin,\n\nSorry this shipment can not catch up today flight,so the update flight details will be:\n\nAWB#910-19070553/13NOV");
    const arrival = fromAgent("2026-11-08 09:00", "Dear Ashwin,\n\nShipment arrived MCT today.");
    const { set, journey, of, mails } = read(air, [awb, number, arrival]);
    expect(set).toBe("air");
    expect(journey().nodes.map((n) => n.label)).toEqual(["Booked", "Collected", "AWB", "Departed", "Arrived MCT", "Bayan", "Delivered"]);
    expect(node(journey(), "awb")).toMatchObject({ state: "proven", date: "2026-11-05" });
    expect(node(journey(), "awb").proof?.file).toBe("MCT HAWB.pdf");
    expect(of(number).milestones.find((h) => h.key === "awb")).toMatchObject({ proves: true });
    expect(node(journey(), "arrived")).toMatchObject({ state: "proven", date: "2026-11-08" });
    expect(node(journey(), "departed").state).toBe("unmarked");
    expect(refsOf(mails, air).find((c) => c.kind === "awb")).toMatchObject({ value: "910-19070553", copyLabel: "Copy AWB number 910-19070553" });

    // A promise of the AWB proves nothing.
    const promised = fromAgent("2026-11-05 09:00", "Dear Mr Anwar,\n\nWe sincerely apologise for the delay.\n\nSharing the AWB shortly with you.");
    expect(node(read(air, [promised]).journey(), "awb")).toMatchObject({ state: "current", proof: null });
  });

  it("proves a courier's waybill by its number; a pick-up window is a plan", () => {
    const courier = confirmed({ shipment_mode: "COURIER", qty_text: "COURIER", pol: "MUMBAI INDIA", pod: "MUSCAT OMAN" });
    const waybill = fromAgent("2026-11-05 09:00", "Dear Mr Anwar,\n\nPFA label\n\nWaybill Number 6782082974\nShipment Date 11/6/2026\nPickup Confirmation PRG261106001234\nPickup window 14:00 - 17:00");
    const { set, journey, mails } = read(courier, [waybill]);
    expect(set).toBe("courier");
    expect(journey().nodes.map((n) => n.label)).toEqual(["Booked", "Waybill", "Picked up", "In transit", "Delivered"]);
    expect(node(journey(), "waybill")).toMatchObject({ state: "proven", date: "2026-11-05" });
    expect(node(journey(), "picked_up")).toMatchObject({ state: "todo", proof: null, emailIds: [waybill.id] });
    expect(refsOf(mails, courier).find((c) => c.kind === "waybill")).toMatchObject({ value: "6782082974", copyLabel: "Copy waybill number 6782082974" });

    // The courier's own word that it collected the parcel proves the pick-up; its waybill file has no BL sub-steps.
    const collected = fromAgent("2026-11-06 16:26", "Dear Mr Anwar,\n\nShipment collected and expected to reach our SEL warehouse tomorrow.");
    const label = toAgent("2026-11-06 17:00", "Dear Milk,\n\nPlease see the attached.", { attachments: [file("SILVER LYNX CO, LLC AWB 8584943813 23.10.26.pdf", 64_000)] });
    const later = read(courier, [waybill, collected, label]);
    expect(node(later.journey(), "picked_up")).toMatchObject({ state: "proven", date: "2026-11-06" });
    expect(later.of(label).milestones).toEqual([expect.objectContaining({ key: "waybill", sub: null, proves: true })]);
  });
});

describe("parseShipDate", () => {
  const at = oman("2026-11-05 10:00");
  const dates = (text: string) => parseShipDate(text, at).map((d) => `${d.kind} ${d.date}`);

  it("reads the forms the e-mails use, day first", () => {
    expect(dates("ETA 22.11.2026")).toEqual(["ETA 2026-11-22"]);
    expect(dates("ETA 19th nov")).toEqual(["ETA 2026-11-19"]);
    expect(dates("ETA 11/11/2026")).toEqual(["ETA 2026-11-11"]);
    expect(dates("ETA 13-NOV")).toEqual(["ETA 2026-11-13"]);
    expect(dates("ETD 08-NOV-26")).toEqual(["ETD 2026-11-08"]);
    expect(dates("ETD 05/11")).toEqual(["ETD 2026-11-05"]);
    expect(dates("ETD 19/Nov")).toEqual(["ETD 2026-11-19"]);
    expect(dates("ETD 12th Nov")).toEqual(["ETD 2026-11-12"]);
    expect(dates("ETD 12 NOV")).toEqual(["ETD 2026-11-12"]);
    expect(dates("ETD                     : 10.11.2026")).toEqual(["ETD 2026-11-10"]);
    expect(dates("ETA 2027-1-09")).toEqual(["ETA 2027-01-09"]);
    expect(dates("ETA is updated as 5th dec")).toEqual(["ETA 2026-12-05"]);
    expect(dates("ETD is 21-NOV, no 06-NOV vessel any more")).toEqual(["ETD 2026-11-21"]);
  });

  it("reads month first only when day first cannot be meant", () => {
    expect(dates("ETA 11.21 Please find MBL+HBL first")).toEqual(["ETA 2026-11-21"]);
    expect(dates("Confirm the vessel  ATD OCT-22. ETA NOV-23")).toEqual(["ATD 2026-10-22", "ETA 2026-11-23"]);
    expect(dates("ETD:Oct.30.")).toEqual(["ETD 2026-10-30"]);
    expect(dates("ETA  11.08. pls help to settle payment")).toEqual(["ETA 2026-11-08"]);
    expect(dates("ETA 11.12 ,kindly help")).toEqual(["ETA 2026-12-11"]);
    expect(parseShipDate("ATD 28 DEC", oman("2027-01-03 10:00"))[0].date).toBe("2026-12-28");
  });

  it("keeps a value it cannot date as text, and drops what is no date", () => {
    expect(parseShipDate("ATD 2026.09", at)).toEqual([{ kind: "ATD", date: null, text: "2026.09", port: null }]);
    expect(dates("ETA 14 days after sailing")).toEqual([]);
    expect(dates("Delay beyond the ETD date we will put the penalty of USD 250 per container")).toEqual([]);
    expect(dates("ETA will be updated after ship sail. Check Current ETA please")).toEqual([]);
    expect(parseShipDate("", at)).toEqual([]);
    expect(parseShipDate("ETD 2026/11/15", "not a date")).toEqual([{ kind: "ETD", date: "2026-11-15", text: "2026/11/15", port: null }]);
  });

  it("names the port that stands between the word and the date", () => {
    expect(parseShipDate("ETA Sohar: 12.10.2026", at)[0]).toMatchObject({ date: "2026-10-12", port: "Sohar" });
    expect(parseShipDate("Final Revised ETA at Sohar, Oman is 30/11", at)[0]).toMatchObject({ date: "2026-11-30", port: "Sohar", text: "30/11" });
    expect(parseShipDate("ETA NHAVA SHEVA 12/11/26 APPROX", at)[0]).toMatchObject({ date: "2026-11-12", port: "Nhava Sheva" });
    expect(parseShipDate("confirm the earliest available flight (ETD/ETA Muscat 12 Nov)", at)).toEqual([{ kind: "ETA", date: "2026-11-12", text: "12 Nov", port: "Muscat" }]);
    expect(parseShipDate("AGREED RATE ONLY ON KMTC ETD 14.11.2026", at)[0]).toMatchObject({ date: "2026-11-14", port: null });
  });
});

describe("datesOf", () => {
  it("shows the latest ETD with the earlier one and the days it moved", () => {
    const { mails } = read(confirmed(), [
      fromAgent("2026-11-03 09:00", "Dear Abdul,\n\nVessel planned ETD 06 Nov."),
      fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nETD is 21-NOV, no 06-NOV vessel any more"),
    ]);
    const dates = datesOf(mails, null, [], TODAY);
    expect(dates.etd).toMatchObject({ date: "2026-11-21", text: "21-NOV", slipDays: 15, plan: false });
    expect(dates.etd?.earlier.map((e) => e.date)).toEqual(["2026-11-06"]);
    expect(dates.etd?.proof.when).toBe("Thu 05 Nov, 09:00");
    expect(dates.headline).toBeNull();
    expect(datesOf(mails, null, [], "2026-11-19").headline).toEqual({ text: "ETD in 2 days", tone: "warn" });
    expect(datesOf(mails, null, [], "2026-11-25").headline).toEqual({ text: "ETD 21 Nov passed — no sailing confirmed", tone: "bad" });

    const journey = journeyOf(confirmed(), mails, [], TODAY) as Journey;
    expect(node(journey, "sailed")).toMatchObject({ note: "ETD 21 Nov (was 06 Nov)", noteTone: "warn" });
    expect(node(journeyOf(confirmed(), mails, [], "2026-11-25") as Journey, "sailed")).toMatchObject({ note: "ETD 21 Nov passed — no sailing confirmed", noteTone: "bad" });
  });

  it("keeps every distinct ETA, newest first", () => {
    const { mails, journey } = read(confirmed(), [
      fromAgent("2026-11-03 09:00", "Dear Abdul,\n\ntentative ETA: 28.11.2026"),
      fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nAs per tracking ETA Sohar will be of 23.11.2026"),
      fromAgent("2026-11-06 09:00", "Dear Abdul,\n\nETA Sohar is 04.12.2026 due to congestion at the hub."),
    ]);
    const eta = datesOf(mails, null, [], TODAY).eta;
    expect(eta).toMatchObject({ date: "2026-12-04", port: "Sohar", slipDays: 11 });
    expect(eta?.earlier.map((e) => e.date)).toEqual(["2026-11-23", "2026-11-28"]);
    expect(node(journey(), "arrived")).toMatchObject({ note: "ETA Sohar 04 Dec (was 23 Nov)", noteTone: "warn" });
  });

  it("takes the dates of our own quote for a plan, and reads its cut-off", () => {
    const quote = toCustomer("2026-11-03 09:00", "Dear Sir,\n\nPlease find below our offer.\n\nPORT TO PORT : OMR 450.000\n\nCY CLOSE : 09.11.2026 ETD : 11.11.2026\n\nTRANSIT TIME : 18 DAYS");
    const earlier = fromAgent("2026-11-02 09:00", "Dear Abdul,\n\nVSL : CHS ALPHA. ETD : 08TH NOV.");
    const { mails, of } = read(confirmed(), [earlier, quote]);
    const dates = datesOf(mails, null, [], TODAY);
    expect(dates.etd).toMatchObject({ date: "2026-11-11", plan: true, slipDays: null });
    expect(dates.etd?.earlier.map((e) => e.date)).toEqual(["2026-11-08"]);
    expect(dates.cutoff).toMatchObject({ value: "09.11.2026" });
    expect(dates.headline).toBeNull();
    expect(of(quote).milestones).toEqual([]);
  });

  it("reads the ETA at the port of discharge only, and never takes a date that was for the latest", () => {
    const hub = fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nETA NHAVA SHEVA 12/11/26 APPROX");
    expect(datesOf(read(confirmed(), [hub]).mails, null, [], TODAY).eta).toBeNull();

    const { mails } = read(confirmed(), [
      toCustomer("2026-11-03 09:00", "Dear Sir,\n\nTentative ETA 28.11.2026 ( subject to change)"),
      fromCustomer("2026-11-06 09:00", "Dear Waheed,\n\nThe latest ETA was already September 28th, and now there is another delay."),
    ]);
    const eta = datesOf(mails, null, [], TODAY).eta;
    expect(eta).toMatchObject({ date: "2026-11-28", slipDays: null });
    expect(eta?.earlier.map((e) => e.date)).toEqual(["2026-09-28"]);
  });

  it("drops the passed-date warning once papers that come only after the step are on file", () => {
    const air = confirmed({ shipment_mode: "AIR", qty_text: "AIR", pol: "GUANGZHOU CHINA", pod: "MUSCAT OMAN" });
    const flight = fromAgent("2026-11-05 09:00", "Dear Ashwin,\n\nFlight details: ETA MCT 07.11.2026");
    const before = read(air, [flight]);
    expect(datesOf(before.mails, null, [], TODAY).headline).toEqual({ text: "ETA 07 Nov passed — no arrival confirmed", tone: "bad" });
    expect(node(before.journey(), "arrived")).toMatchObject({ note: "ETA MCT 07 Nov passed — no arrival confirmed", noteTone: "bad" });

    const can = toCustomer("2026-11-07 11:34", "Dear Sir,\n\nPlease find attached CAN and FC, Manifest updated", { attachments: [file("CAN (1).PDF", 90_000), file("FC.PDF", 80_000)] });
    const after = read(air, [flight, can]);
    expect(datesOf(after.mails, null, [], TODAY).headline).toBeNull();
    expect(node(after.journey(), "arrived")).toMatchObject({ proof: null, note: "ETA MCT 07 Nov", noteTone: null });
  });

  it("reads cut-offs as written and leaves out a port of call", () => {
    const cut = (text: string) => datesOf(read(confirmed(), [fromAgent("2026-11-04 09:00", `Dear Abdul,\n\n${text}`)]).mails, null, [], TODAY).cutoff?.value ?? null;
    expect(cut("Gate Closing: 10th Nov ( 05:00 Hrs )")).toBe("10th Nov ( 05:00 Hrs )");
    expect(cut("SI&VGM CUT OFF:11.10 12:00(BEIJIN)")).toBe("11.10 12:00(BEIJIN)");
    expect(cut("Gate Closing: 29th, 0200 hrs")).toBe("29th");
    expect(cut("Kindly share the gate in plan before the cut off time to avoid last minute issues.")).toBeNull();

    const call = read(confirmed(), [fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nETA at Salalah Terminal is 5/11 and ETD from Salalah Terminal  is 25/11.")]);
    expect(datesOf(call.mails, null, [], TODAY)).toMatchObject({ etd: null, eta: null });
  });

  it("takes only this booking's dates: never a competing agent's sailing for a slip", () => {
    const SANCO = "ops@sanco.example";
    const sanco = (at: string, body_text: string) => fromAgent(at, body_text, { from_email: SANCO, from_name: "Sanco", gmail_thread_id: "t-sanco" });
    const winco = fromAgent("2026-11-03 09:00", "Dear Abdul,\n\nVessel planned ETD 06 Nov.");
    const offered = sanco("2026-11-04 09:00", "Dear Abdul,\n\nNext vessel ETD 15 Nov.");
    const { mails } = read(confirmed(), [winco, offered]);
    expect(new Set(mails.map((m) => m.sideKey))).toEqual(new Set(["consolclub.com", "sanco.example"]));

    // Two agents writing dates and no rate agreed: which one carries the booking is not known.
    expect(datesOf(mails, null, [], TODAY).etd).toBeNull();

    // The agreed one's dates count, the other's do not.
    const agreed = { sideKey: "sanco.example", name: "Sanco", domain: "sanco.example", state: "agreed" } as unknown as AgentQuote;
    const etd = datesOf(mails, null, [agreed], TODAY).etd;
    expect(etd).toMatchObject({ date: "2026-11-15", slipDays: null, earlier: [] });

    // With no rate agreed, an agent's quote is one option among others.
    const quote = read(confirmed(), [winco, fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nVessel ETD 21 Nov.")]);
    expect(datesOf(quote.mails, null, [], TODAY).etd).toMatchObject({ date: "2026-11-21", slipDays: 15 });
    quote.of(winco).moneyRole = "agent_rate";
    expect(datesOf(quote.mails, null, [], TODAY).etd).toMatchObject({ date: "2026-11-21", slipDays: null, earlier: [] });

    // The journey reads the same way.
    expect(node(journeyOf(confirmed(), mails, [], TODAY, [agreed]) as Journey, "sailed")).toMatchObject({ note: "ETD 15 Nov", noteTone: null });
  });

  it("keeps a line's dates beside the booking agent's, with or without an agreed rate", () => {
    const fromLine = (at: string, body_text: string) => fromAgent(at, body_text, { from_email: "sohar.cs@maersk.com", from_name: "Maersk Line", gmail_thread_id: "t-line" });
    const so = fromAgent("2026-11-03 09:00", "Dear Abdul,\n\nThe SO is released. ETD 06 Nov.");
    const line = fromLine("2026-11-05 09:00", "Dear Sir,\n\nPlease note the vessel ETA Sohar is 11.11.2026.");
    const { mails, of } = read(confirmed(), [so, line]);
    expect(of(line).party).toBe("carrier");
    const agreed = { sideKey: "consolclub.com", name: "Console Club", domain: "consolclub.com", state: "agreed" } as unknown as AgentQuote;
    for (const rates of [[], [agreed]]) {
      const dates = datesOf(mails, null, rates, TODAY);
      expect(dates.etd).toMatchObject({ date: "2026-11-06", earlier: [] });
      expect(dates.eta).toMatchObject({ date: "2026-11-11", port: "Sohar" });
      expect(node(journeyOf(confirmed(), mails, [], TODAY, rates) as Journey, "arrived")).toMatchObject({ note: "ETA Sohar 11 Nov" });
    }
    // A line alone counts down.
    expect(datesOf(read(confirmed(), [line]).mails, null, [], TODAY)).toMatchObject({ etd: null, eta: { date: "2026-11-11" }, headline: { text: "ETA in 2 days", tone: "warn" } });

    // The agent that proves the SO carries the booking: another agent's sailing is an option, not a slip.
    const sanco = fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nNext vessel ETD 15 Nov.", { from_email: "ops@sanco.example", from_name: "Sanco", gmail_thread_id: "t-sanco" });
    const two = read(confirmed(), [so, sanco, line]);
    expect(datesOf(two.mails, null, [], TODAY).etd).toMatchObject({ date: "2026-11-06", slipDays: null, earlier: [] });

    // Only a line's own rate offer is left out.
    of(line).moneyRole = "agent_rate";
    expect(datesOf(mails, null, [], TODAY).eta).toBeNull();
  });

  it("keeps the dates of another agent whose own e-mails prove a step of the booking, but never its rate offer", () => {
    const fromWwl = (at: string, body_text: string, over: Partial<MailInput> = {}) =>
      fromAgent(at, body_text, { from_email: "cherry@wwl.cn", from_name: "Cherry (WWL)", gmail_thread_id: "t-wwl", ...over });
    const note = fromWwl("2026-11-02 09:00", "Dear Abdul,\n\nPlease find the booking note attached.", { attachments: [file("BOOKING NOTE KMTC.pdf", 52_000)] });
    const moved = fromWwl("2026-11-05 09:00", "Dear Abdul,\n\nKAWA ETD is 21-NOV, no 06-NOV vessel any more.");
    const option = fromWwl("2026-11-06 09:00", "Dear Abdul,\n\nOnly MSC has space on ETD 16-Nov, rate is USD 6700/20GP.");
    const latest = fromAgent("2026-11-08 09:00", "Dear Abdul,\n\nVessel ETD 18 Nov.");
    const agreed = { sideKey: "consolclub.com", name: "Console Club", domain: "consolclub.com", state: "agreed" } as unknown as AgentQuote;

    const { mails, of } = read(confirmed(), [note, moved, option, latest]);
    expect(of(note).milestones.some((h) => h.proves)).toBe(true);
    of(option).moneyRole = "agent_rate";
    const etd = datesOf(mails, null, [agreed], TODAY).etd;
    expect(etd).toMatchObject({ date: "2026-11-18", slipDays: -3 });
    expect(etd?.earlier.map((e) => e.date)).toEqual(["2026-11-21"]);

    // Without the booking note WWL proves nothing of this booking: its date is an option.
    const bare = read(confirmed(), [moved, latest]);
    expect(datesOf(bare.mails, null, [agreed], TODAY).etd).toMatchObject({ date: "2026-11-18", slipDays: null, earlier: [] });
  });

  it("puts no passed-date warning on the track of a job won by e-mail but not confirmed in the register", () => {
    const won = row({ quoted_date: "2026-11-01", contact_email: CUSTOMER });
    const yes = fromCustomer("2026-11-02 09:00", "Dear Waheed,\n\nPlease go ahead.");
    const etd = fromAgent("2026-11-03 09:00", "Dear Abdul,\n\nVessel ETD 06 Nov.");
    const open = read(won, [yes, etd]);
    const cues: WonCue[] = [{ kind: "customer_yes", day: "2026-11-02", betterRate: false, amountMismatch: false, proof: proofOf(open.of(yes), TODAY) }];
    expect(node(journeyOf(won, open.mails, cues, TODAY) as Journey, "sailed")).toMatchObject({ note: "ETD 06 Nov", noteTone: null });
    // Confirmed in the register, the same date is a sailing that passed with nothing to show for it.
    const booked = read(confirmed(), [yes, etd]);
    expect(node(journeyOf(confirmed(), booked.mails, cues, TODAY) as Journey, "sailed")).toMatchObject({ note: "ETD 06 Nov passed — no sailing confirmed", noteTone: "bad" });
  });

  it("counts no date down and calls none a slip before the job is booked", () => {
    const { mails } = read(confirmed(), [
      fromAgent("2026-11-03 09:00", "Dear Abdul,\n\nVessel planned ETD 06 Nov."),
      fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nETD is 21-NOV, no 06-NOV vessel any more"),
    ]);
    const open = datesOf(mails, null, [], "2026-11-19", false);
    expect(open.etd).toMatchObject({ date: "2026-11-21", slipDays: null });
    expect(open.etd?.earlier.map((e) => e.date)).toEqual(["2026-11-06"]);
    expect(open.headline).toBeNull();
    expect(datesOf(mails, null, [], "2026-11-25", false).headline).toBeNull();
    expect(datesOf(mails, null, [], "2026-11-19", true).headline).toEqual({ text: "ETD in 2 days", tone: "warn" });
  });

  it("lists free days asked and given, each rate's validity and the open promises; odd input gives the empty facts", () => {
    const ask = toAgent("2026-11-03 09:00", "Dear Milk,\n\nPlease advise the quote.\n\n14 days free detention at destination; MBL seaway or telex");
    const answer = fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nFree time: 11 days at POD. We will update the vessel by tomorrow.");
    const { mails } = read(confirmed(), [ask, answer]);
    const dates = datesOf(mails, null, [], TODAY);
    expect(dates.freeDays.asked).toBe(14);
    expect(dates.freeDays.given).toMatchObject({ value: 11 });
    expect(dates.promises.map((p) => p.by)).toEqual(["them"]);
    expect(dates.validity).toEqual([]);

    // Our pass-on of a line's free days asks for nothing; kept promises follow the open ones.
    const passOn = toAgent("2026-11-05 09:00", "Dear Milk,\n\nPlease find attached HBL Original BL copy. Tentative ETA: 03.12.2026, ESL Line free days @ POD 10 days.");
    const kept = fromAgent("2026-11-05 10:00", "Dear Abdul,\n\nVessel: ESL NINGBO 02645W, ETD 12 Nov.");
    const ours = toAgent("2026-11-06 09:00", "Dear Milk,\n\nNoted, we will share the shipper details by tomorrow.");
    const later = datesOf(read(confirmed(), [answer, passOn, kept, ours]).mails, null, [], TODAY);
    expect(later.freeDays.asked).toBeNull();
    expect(later.promises.map((p) => [p.by, p.kept])).toEqual([["us", false], ["them", true]]);

    // "No validity can be provided" reads "none given"; an offer without a date reads "none stated".
    const frontline: AgentQuote = {
      sideKey: "flgshipping.net", name: "Frontline", domain: "flgshipping.net", state: "rated", askedAt: null, requestOnFile: false, options: [], latest: null,
      lowestOnFile: false, earlier: [], repliedInHours: null, question: null, summary: "", lastAt: oman("2026-11-05 07:11"),
      validity: { who: "Frontline", until: null, daysLeft: null, ended: false, none: true, boilerplate: false, text: "no validity given", proof: null },
    };
    const offer = { validUntil: null, transit: "35 DAYS", proof: proofOf(read(confirmed(), [passOn]).mails[0], TODAY) } as unknown as Offer;
    expect(datesOf([], offer, [frontline], TODAY).validity.map((v) => v.text)).toEqual(["Frontline: none given", "Our offer: none stated"]);

    const empty = datesOf(null as unknown as ReadMail[], null, null as unknown as [], "");
    expect(empty).toEqual({ etd: null, eta: null, atd: null, cutoff: null, transit: { ours: null, agent: null }, freeDays: { asked: null, given: null }, validity: [], promises: [], headline: null });
  });
});

describe("refsOf", () => {
  it("always starts with the SL reference", () => {
    expect(refsOf([], row())).toEqual([{ kind: "reference", label: "Reference", value: "SL262700", copyLabel: "Copy reference SL262700", proof: null }]);
    expect(refsOf(null as unknown as ReadMail[], row())[0].value).toBe("SL262700");
  });

  it("reads the PO, the agent's job numbers, containers and the vessel, each with its e-mail", () => {
    const po = fromCustomer("2026-11-03 09:00", "Dear Waheed\n\nWhat's the SO status?", {
      subject: "SL262700 QINGDAO - SOHAR 20 FEET - SHANDONG ZETAO - PO -26SOM0398// SL262700 1X20' QINGDAO CHINA TO SOHAR OMAN",
    });
    const job = fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nSO released, please check.\n\nV/V.：KAWA KOPER 2603W\nContainer No: MRKU4046894\nHBL: JASC2603037", {
      subject: "so release Re: （HPQDOM2611163）Re: RE: SL262700 1X40' QINGDAO CHINA TO SOHAR OMAN",
    });
    const frontline = mail({
      from_email: "reena@flgshipping.net", from_name: "Reena Aneesh", to_emails: [OPS], cc_emails: [PRICING], received_at: oman("2026-11-05 09:00"),
      subject: "RE: ENQ1020126007139//ABSOH26110504//SL262700 // LCL FOB NINGBO CHINA TO SOHAR OMAN", body_text: "Dear Ashwin\n\nNoted your message will keep you posted .",
    });
    const { mails } = read(confirmed(), [po, job, frontline]);
    const chips = refsOf(mails, confirmed());
    expect(chips.map((c) => `${c.kind} ${c.value}`)).toEqual([
      "reference SL262700",
      "po 26SOM0398",
      "agent_job HPQDOM2611163",
      "agent_job ENQ1020126007139",
      "agent_job ABSOH26110504",
      "hbl JASC2603037",
      "container MRKU4046894",
      "vessel KAWA KOPER 2603W",
      "carrier KAWA",
    ]);
    expect(chips[1]).toMatchObject({ label: "PO", copyLabel: "Copy PO number 26SOM0398" });
    expect(chips[1].proof).toMatchObject({ emailId: po.id, when: "Tue 03 Nov, 09:00" });
    expect(chips[2].copyLabel).toBe("Copy agent job number HPQDOM2611163");
    // The agent's own number is the HBL's when the mail says so: four letters and seven digits, and still no container.
    expect(chips[5]).toMatchObject({ label: "HBL", copyLabel: "Copy HBL number JASC2603037" });
    expect(chips[7].copyLabel).toBe("Copy vessel KAWA KOPER 2603W");
    // The stage tag in the agent's subject is the release of the SO.
    expect(node(journeyOf(confirmed(), mails, [], TODAY) as Journey, "so")).toMatchObject({ state: "proven", date: "2026-11-04" });
  });

  it("reads booking, MBL and HBL numbers and never takes a word for one", () => {
    const booking = toCustomer(
      "2026-11-05 09:00",
      "Dear Sir,\n\nPlease find below booking confirmation cargo pick up will be 06.11.2026 08:00 hrs.\n\n1X20' FOB\nBKK NO: 459HA1712683\nVESSEL / VOY: MSC DAKAR/V9605231\nETD : 13.11.2026",
      { subject: "HBL # AVAMUM30134 // MBL # : ACLBOM2600635 // SL262700 1X20' EX-WORKS NHAVA-SHEVA INDIA TO SOHAR OMAN" },
    );
    const words = fromCustomer("2026-11-06 09:00", "Dear Waheed,\n\nPOLYESTER fabric as per PO BOX details. SO RELEASE pending, BL confirm please. Please check PORT and POD.");
    const { mails } = read(confirmed(), [booking, words]);
    expect(refsOf(mails, confirmed()).map((c) => `${c.kind} ${c.value}`)).toEqual([
      "reference SL262700",
      "booking 459HA1712683",
      "mbl ACLBOM2600635",
      "hbl AVAMUM30134",
      "vessel MSC DAKAR / V9605231",
      "carrier MSC",
    ]);
    expect(datesOf(mails, null, [], TODAY).etd).toMatchObject({ date: "2026-11-13" });
  });

  it("takes a number for what the mail calls it, however the label is written", () => {
    const numbers = fromAgent(
      "2026-11-05 09:00",
      "Dear Abdul,\n\nMBL：KWSSHA26110176\nHB/L NO.: RHTSN26080362\nHBL : original\nMBL : surrender (we are waiting for surrender from carrier)\nM/V: ESL NINGBO 02645W\nSO NO: ESLCHNXIN017296 ETD:10-NOV",
    );
    const first = read(confirmed(), [numbers]);
    expect(refsOf(first.mails, confirmed()).map((c) => `${c.label} ${c.value}`)).toEqual([
      "Reference SL262700",
      "SO ESLCHNXIN017296",
      "MBL KWSSHA26110176",
      "HBL RHTSN26080362",
      "Vessel ESL NINGBO 02645W",
      "Carrier ESL",
    ]);
    // The SO's number given by the agent shows the SO is there.
    expect(node(first.journey(), "so")).toMatchObject({ state: "proven", date: "2026-11-05" });
    expect(datesOf(first.mails, null, [], TODAY).etd).toMatchObject({ date: "2026-11-10", text: "10-NOV" });

    const voyage = fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nVESSEL/VOY.: MSC DAKAR X (15614) NA645A\nMB/L NO.: 177NRLRLXVNN3506");
    expect(refsOf(read(confirmed(), [voyage]).mails, confirmed()).map((c) => `${c.label} ${c.value}`)).toEqual([
      "Reference SL262700",
      "MBL 177NRLRLXVNN3506",
      "Vessel MSC DAKAR X",
      "Carrier MSC",
    ]);
  });
});

describe("documentKind and documentsOf", () => {
  const kind = (filename: string, cue = "", size = 120_000, mime = "application/pdf") => {
    const doc = documentKind(filename, mime, size, cue);
    return doc.subKind ? `${doc.kind} / ${doc.subKind}` : doc.kind;
  };

  it("sorts files by their names, invoice and packing before BL", () => {
    expect(kind("Draft invoice.pdf")).toBe("invoice_payment / invoice");
    expect(kind("CI&PL.pdf")).toBe("packing");
    expect(kind("DeclarationPrint.pdf")).toBe("customs_do / bayan");
    expect(kind("MILIN1030751A-DO.PDF")).toBe("customs_do / do");
    expect(kind("L564 泽涛托书.doc", "", 37_888, "application/octet-stream")).toBe("booking_so / booking");
    expect(kind("HPQDOM2611149_BL_DRAFT.pdf")).toBe("bl_awb / draft");
    expect(kind("BOOKING FORM -320348- (1).xls")).toBe("booking_so / booking");
    expect(kind("HPSZOM7001003_BL_ORIGINAL.pdf")).toBe("bl_awb / original");
    expect(kind("15.GDWV26104219(HBL OBD).pdf")).toBe("bl_awb / original");
    expect(kind("MEDUBP608202_459HA1712683_MSC DAKAR X_SWB_1.pdf")).toBe("bl_awb / telex_seaway");
    expect(kind("KWSTAO26090811-20261104154807-SURRENDERED.pdf")).toBe("bl_awb / telex_seaway");
    expect(kind("MBL telex release.pdf")).toBe("bl_awb / telex_seaway");
    expect(kind("HPSHOM2611133_MBL.pdf")).toBe("bl_awb / final");
    expect(kind("14.PA ATD ETA KWSTAO26100414.pdf")).toBe("pre_alert_can");
    expect(kind("CAN.PDF")).toBe("pre_alert_can / can");
    expect(kind("FC.PDF")).toBe("pre_alert_can");
    expect(kind("199016003141 FREIGHT CERTIFICATE.PDF")).toBe("pre_alert_can");
    expect(kind("CEPA - COO.PDF")).toBe("customs_do / coo");
    expect(kind("DN26110070.pdf")).toBe("invoice_payment / debit_note");
    expect(kind("PDC CHEQUE - OMR 4277.400 ( Silver Lynx ).pdf")).toBe("invoice_payment / payment");
    expect(kind("MOLECULES_PL (2).pdf")).toBe("packing");
    expect(kind("Commercial Invoice and Packing List.pdf")).toBe("packing");
    expect(kind("Quote C183807.pdf")).toBe("quote");
    expect(kind("SO DETAILS.pdf")).toBe("booking_so / so");
    expect(kind("459HA1712683 BC MSC.pdf")).toBe("booking_so / booking");
  });

  it("files what its name does not explain under Other, photos apart, and takes the mail's word for a bare number", () => {
    expect(kind("006033_POD.PDF")).toBe("other");
    expect(kind("YQN LOGISTICS SHENZHEN CO LTD.pdf")).toBe("other");
    expect(kind("扫描全能王 2026-11-9 10.24.pdf")).toBe("other");
    expect(kind("WhatsApp Image 2026-11-04 at 12.51.54 PM.JPEG", "", 178_020, "image/jpeg")).toBe("photo");
    expect(kind("KMTCTAO8748592.pdf")).toBe("other");
    expect(kind("KMTCTAO8748592.pdf", "Please share SO details")).toBe("other");
    expect(kind("KMTCTAO8748592.pdf", "find attach SO details")).toBe("booking_so / so");
    expect(kind("20261105133320530.pdf", "Please find attached bayan and arrange payment")).toBe("customs_do / bayan");
    expect(kind("0553.pdf", "Cargo Arrival Notice attached")).toBe("pre_alert_can / can");
    expect(documentKind(null as unknown as string, "", 0, "")).toEqual({ kind: "other", subKind: null, label: "Other" });
    expect(documentKind("HPQDOM2611149_BL_DRAFT.pdf", "application/pdf", 34_909, "").label).toBe("BL draft");
    expect(documentKind("MCT HAWB.pdf", "application/pdf", 881_848, "").label).toBe("AWB");
    expect(documentKind("830-97012473提单2.pdf", "application/pdf", 120_000, "Please check the final AWB.").label).toBe("AWB");
    // The origin's export declaration is not the Bayan; our BL instructions are not a BL.
    expect(documentKind("Customs Export Goods Declaration Form.pdf", "application/pdf", 90_000, "")).toEqual({ kind: "customs_do", subKind: null, label: "Export declaration" });
    expect(documentKind("Silverlynx BL  Instruction.docx", "application/msword", 40_000, "Please find attached BL instruction.")).toEqual({ kind: "bl_awb", subKind: null, label: "BL instructions" });
  });

  it("takes a BL named as issued for a draft when it is a Word or Excel file, or when the mail sends it as one", () => {
    expect(kind("HPXMOM2611129A_HBL.docx")).toBe("bl_awb / draft");
    expect(kind("SORICH FOILS LIMITED - SOHAR - MBL.doc")).toBe("bl_awb / draft");
    expect(documentKind("MCT HAWB(2).xls", "application/vnd.ms-excel", 30_000, "").label).toBe("AWB draft");
    expect(kind("HPSHOM2611100_MBL.pdf", "MBL & HBL drafts consignee and notify details is OK from our side, cargo & packages details please take final approval from shipper and proceed.")).toBe("bl_awb / draft");
    expect(kind("HPSHOM2611115_MBL.pdf", "pls find below so，and check bls\nMBL：KWSSHA26110176")).toBe("bl_awb / draft");
    expect(kind("MEDUBP608202_459HA1712683_MSC DAKAR X_SWB_1.pdf", "Please find the draft MBL attached. Please check and confirm.")).toBe("bl_awb / draft");
    expect(kind("HBL.pdf", "Pls find attached Draft Pre alert docs for subject shipment. Kindly check and approve")).toBe("bl_awb / draft");
    // The issued BL stays issued.
    expect(kind("HPSHOM2610075_BL_COPY.pdf", "ATD10-22，pls find attachment final on board hbl")).toBe("bl_awb / final");
    expect(kind("YQNSZ-HBL-FINAL-TLX_ODSE4485356.pdf", "Please kindly find attached HBL TELEX RELEASE,thank you")).toBe("bl_awb / telex_seaway");
    // "As per your attached invoice" speaks of a file the other side sent before.
    expect(kind("63224-63312-2026.pdf", "The DO/Local charges (OMR 50+82) as per your attached invoice/CAN have been paid by Cash today.")).toBe("other");
  });

  it("groups a file by its name: versions are its distinct sizes, and every send is counted", () => {
    const draft = (at: string, size: number, name = "HPQDOM2611149_BL_DRAFT.pdf") => fromAgent(at, "Dear Abdul,\n\nPlease check and confirm the attached BL draft.", { attachments: [file(name, size)] });
    const two = documentsOf(read(confirmed(), [draft("2026-11-05 09:00", 34_909), draft("2026-11-06 09:00", 34_956)]).mails);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ kind: "bl_awb", subKind: "draft", label: "BL draft", version: 2, sentTimes: 2 });
    expect(two[0].latest.size).toBe(34_956);

    const six = documentsOf(
      read(confirmed(), [
        draft("2026-11-03 09:00", 36_007),
        draft("2026-11-03 10:00", 36_007),
        draft("2026-11-04 09:00", 36_100),
        draft("2026-11-04 10:00", 36_100, "HPQDOM2611149_BL_DRAFT (1).pdf"),
        draft("2026-11-05 09:00", 36_220),
        draft("2026-11-05 10:00", 36_220),
      ]).mails,
    );
    expect(six).toHaveLength(1);
    expect(six[0]).toMatchObject({ version: 3, sentTimes: 6 });
    expect(six[0].files).toHaveLength(6);

    // One name is one document, also when only one of the mails says what it is.
    const named = fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nAttached draft BL correction mentioned., kindly correct resend for us.,", { attachments: [file("20261105133320530.pdf", 81_000)] });
    const passed = toCustomer("2026-11-05 10:00", "Dear Sir,\n\nPlease see below.", { attachments: [file("20261105133320530.pdf", 81_000)] });
    expect(documentsOf(read(confirmed(), [named, passed]).mails).map((g) => [g.label, g.sentTimes])).toEqual([["BL draft", 2]]);

    // An MBL named as issued goes out with the HBL draft, and again under the same name: a draft each time.
    const pair = fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nmbl+hbl already sent to you，pls find attachment email", {
      attachments: [file("HPSHOM2611086_BL_DRAFT.pdf", 34_000), file("HPSHOM2611086_MBL.pdf", 52_000)],
    });
    const again = fromAgent("2026-11-06 09:00", "Dear Abdul,\n\nMBL has been modified，Please check for HBL", { attachments: [file("HPSHOM2611086_MBL.pdf", 52_400)] });
    const both = read(confirmed(), [pair, again]);
    expect(documentsOf(both.mails).map((g) => [g.label, g.latest.filename, g.version])).toEqual([
      ["BL draft", "HPSHOM2611086_MBL.pdf", 2],
      ["BL draft", "HPSHOM2611086_BL_DRAFT.pdf", 1],
    ]);
    expect(subs(both.of(again))).toEqual(["bl_draft"]);
    expect(node(both.journey(), "bl")).toMatchObject({ state: "current", proof: null });
  });

  it("lists the kinds in the shelf's order and leaves signature images out", () => {
    const { row: enquiryRow, emails } = sl262784();
    const logo = fromAgent("2026-11-05 09:00", "Dear Abdul,\n\nPlease find the invoice.", {
      attachments: [file("image001.png", 4_186, "image/png"), file("Outlook-abc.png", 60_000, "image/png"), file("INVOICE NO 067817.pdf"), file("5.jpg", 446_984, "image/jpeg")],
    });
    expect(documentsOf(read(enquiryRow, emails).mails).map((g) => [g.label, g.latest.filename, g.sentTimes])).toEqual([
      ["Booking", "BOOKING FORM -320348- (1).xls", 2],
      ["Other", "DOCS ASL OTM 320348.pdf", 1],
    ]);
    expect(documentsOf(read(confirmed(), [logo]).mails).map((g) => g.label)).toEqual(["Invoice", "Photo"]);
    expect(documentsOf(null as unknown as ReadMail[])).toEqual([]);
  });
});

describe("milestoneHits", () => {
  it("gives nothing for mail that feeds no rule, and never throws on odd input", () => {
    const { mails } = read(confirmed(), [fromAgent("2026-11-04 09:00", "Dear Abdul,\n\nSO released, please check the attachment.")]);
    expect(milestoneHits(mails[0], "sea_import", true)).toMatchObject([{ key: "so", proves: true }]);
    expect(milestoneHits({ ...mails[0], scope: "noise" }, "sea_import", true)).toEqual([]);
    expect(milestoneHits(null as unknown as ReadMail, "sea_import", true)).toEqual([]);
    expect(milestoneHits({ ...mails[0], clean: null as unknown as string, files: null as unknown as [] }, "air", false)).toEqual([]);
    expect(() => assignMilestones(null as unknown as ReadMail[], "sea_import", true)).not.toThrow();
    // A courier has no SO step.
    expect(milestoneHits(mails[0], "courier", true)).toEqual([]);
  });

  it("reads an export's gate-in and the loading words without proving the sailing", () => {
    const exportRow = confirmed({ trade_type: "EXP", pol: "SOHAR OMAN", pod: "HAMBURG GERMANY" });
    const notReady = toAgent("2026-11-05 09:00", "Dear Team,\n\nStatus is same as below\n\nCargo not ready for stuffing, we shall update you once container stuffing completed");
    const gateIn = fromAgent("2026-11-07 09:00", "Dear Ashwin,\n\nContainer gated in yesterday evening.");
    const loaded = fromAgent("2026-11-06 09:00", "dear abdul，\n\nshipper already finshed loaded");
    const { set, of, journey } = read(exportRow, [notReady, loaded, gateIn]);
    expect(set).toBe("sea_export");
    expect(journey().nodes.map((n) => n.label)).toEqual(["Booked", "SO released", "Gate-in", "Sailed", "BL", "Arrived"]);
    expect(subs(of(notReady))).toEqual(["cargo_not_ready"]);
    expect(subs(of(loaded))).toEqual(["stuffed"]);
    expect(node(journey(), "gate_in")).toMatchObject({ state: "proven", date: "2026-11-07" });
    expect(node(journey(), "sailed").state).toBe("todo");

    // Loading is done when the words say so: a stuffing plan or licence is not a loaded container.
    const planned = fromAgent("2026-11-07 09:48", "Dear Abdul,\n\nShipment carted yesterday at CFS., stuffing panned today.");
    const licence = fromCustomer("2026-11-09 17:09", "Dear Waheed,\n\nWe have factory stuffing licence, so accordingly manage the container.");
    const finished = toCustomer("2026-11-09 12:23", "Dear Sir,\n\nSubject shipment loading finished .");
    const words = read(confirmed(), [planned, licence, finished]);
    expect(subs(words.of(planned))).toEqual([]);
    expect(subs(words.of(licence))).toEqual([]);
    expect(subs(words.of(finished))).toEqual(["stuffed"]);
  });
});

describe("real mail checks", () => {
  it("takes the ETD the agent states, keeps the one that cannot be made as the earlier one, and skips an ETD offered as a question", () => {
    const { mails } = read(confirmed({ shipment_mode: "FCL", qty_text: "1X20" }), [
      fromAgent("2026-11-05 16:21", "Dear Abdul,\n\nOn 03-NOV, our team advised KAWA ETD is 21-NOV, no 06-NOV vessel any more and today is 05-NOV, not possible to make ETD 06-NOV, kindly explain to customer please,thanks"),
      fromAgent("2026-11-07 11:35", "Dear Abdul,\n\nOnly MSC hs earlier space on etd 16-Nov, rate is usd 6700/20gp, do we change on this sailing ?"),
    ]);
    const etd = datesOf(mails, null, [], TODAY).etd;
    expect(etd).toMatchObject({ date: "2026-11-21", slipDays: 15 });
    expect(etd?.earlier.map((e) => e.date)).toEqual(["2026-11-06"]);
  });

  it("measures a new ETD against the last one that held, not against one that could not be made", () => {
    const { mails } = read(confirmed({ shipment_mode: "FCL", qty_text: "1X20" }), [
      fromAgent("2026-11-05 16:21", "Dear Abdul,\n\nOn 03-NOV, our team advised KAWA ETD is 21-NOV, no 06-NOV vessel any more and today is 05-NOV, not possible to make ETD 06-NOV, kindly explain to customer please,thanks"),
      toCustomer("2026-11-10 12:44", "Dear Basil,\n\nAwaiting SO shipping line’s EMC / MSC ETD 18/11\n\nBest Regards"),
    ]);
    const etd = datesOf(mails, null, [], "2026-11-10").etd;
    expect(etd).toMatchObject({ date: "2026-11-18", slipDays: -3 });
    expect(etd?.earlier.map((e) => e.date)).toEqual(["2026-11-21", "2026-11-06"]);
  });

  it("groups one file sent with a non-breaking space in its name and with a plain one", () => {
    const named = (name: string) => ({ ...file(name, 37_888, "application/msword") });
    const docs = documentsOf(read(confirmed(), [
      fromAgent("2026-11-04 12:13", "Dear Abdul,\n\nPls kindly find attachment.", { attachments: [named("L564-L567OM\u00a0booking.doc")] }),
      toCustomer("2026-11-09 12:41", "Dear Basil,\n\nPlease find the booking attached.", { attachments: [named("L564-L567OM booking.doc")] }),
    ]).mails);
    expect(docs.filter((g) => g.kind === "booking_so").map((g) => g.sentTimes)).toEqual([2]);
  });

  it("reads no shipper details sent from our rate request with its pick-up address", () => {
    const r = row({ status: "quoted", quoted_date: "2026-11-02", shipment_mode: "FCL", qty_text: "1X40 OT" });
    const request = toAgent("2026-11-05 14:28", "Dear Team,\n\nPlease advise ocean freight quote for the below shipment on EX-WORKS TERMS :\n\nPOL : NEAREST SEAPORT\n\nPOD : SOHAR\n\nPICK UP ADDRESS :\n\nVIA ROMA, 48\n\n24027 NEMBRO (BG)\n\nBest Regards");
    const booking = toAgent("2026-11-09 16:03", "Dear Samule,\n\nPlease proceed this shipment.\n\nSHIPPER DETAILS\n\nPickup Jiangsu Machinery Co\n\nContact : Mr Li +86 130 0000 0000\n\nBest Regards");
    const { of } = read(r, [request, booking]);
    expect(subs(of(request))).not.toContain("shipper_details_sent");
    expect(subs(of(booking))).toContain("shipper_details_sent");
  });

  it("reads no step from a plan written as a condition: “Once … share us the BL draft”", () => {
    const r = row({ status: "quoted", quoted_date: "2026-11-02", shipment_mode: "FCL", qty_text: "1X40 OT" });
    const { mails, of } = read(r, [toAgent("2026-11-09 16:01", "Dear Luca,\n\nOnce you release the booking confirmation and cargo is loaded share us the BL draft, once approved we will arrange the payment.\n\nBest Regards")]);
    expect(of(mails[0].email).milestones.map((h) => h.key)).not.toContain("bl");
  });
});
