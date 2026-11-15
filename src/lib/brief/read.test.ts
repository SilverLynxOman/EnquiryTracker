import { describe, expect, it } from "vitest";
import { QUOTE_MARKER } from "../emailDrafts";
import type { HistoryRow } from "../types";
import {
  ageOf,
  agentNameForDomain,
  bounceAddressOf,
  classifyParty,
  cleanText,
  crossFiledOf,
  deadlineOf,
  deadlineText,
  excerptOf,
  isAck,
  isChase,
  isEscalation,
  isFreeMail,
  isHold,
  isRequest,
  isSignatureImage,
  noiseOf,
  outOfHoursOf,
  outsideRecipients,
  promiseOf,
  proofOf,
  readMails,
  replyWindowFor,
  sentencesOf,
  shortWhen,
  sideKeyOf,
  signatureTextOf,
  staffOf,
  workingHoursBetween,
} from "./read";
import { input, mail, oman, row, sl262784 } from "./testkit";
import type { PartyContext } from "./types";

const body = (body_text: string) => ({ body_text, snippet: null });
const sender = (from_email: string, from_name: string | null = null) => ({ sender_type: "external" as const, from_email, from_name });

const OURS = { sender_type: "staff" as const, from_email: "operation@silverlynxoman.com", from_name: "Ashwin luiz" };
const DISCLAIMER =
  "Disclaimer:\nDue to the prevailing geopolitical situation and the temporary closure of GCC airspace and seaports, airline and shipping line operations across the region are experiencing significant disruptions.";

describe("cleanText", () => {
  it("cuts an agent's standing notice below a one-line answer", () => {
    const text = `Noted with thanks Ashwin\n\nTransit delays are beyond our control, arrival date subject to change without prior notice\n\nNote:\n${DISCLAIMER}`;
    expect(cleanText(body(text))).toBe("Noted with thanks Ashwin");
  });

  it("keeps a price line above the disclaimer and drops from the sign-off", () => {
    const text = `OCEAN FREIGHT : OMR 309/-\nNOTE: Quoted rates are not valid and no validity can be provided\nThanking You..!\n${DISCLAIMER}`;
    expect(cleanText(body(text))).toBe("OCEAN FREIGHT : OMR 309/-\nNOTE: Quoted rates are not valid and no validity can be provided");
  });

  it("removes the greeting, misspelt or on two lines", () => {
    expect(cleanText(body("Dera Susie,\nGood day\nPlease share SO"))).toBe("Please share SO");
    expect(cleanText(body("Dear Team, Greetings !!!\nKindly advise"))).toBe("Kindly advise");
    expect(cleanText(body("Dear Sir\n\nGood day\n\nPlease find below our offer.\n\nThanks & Regards\n\nAnwar K. S."))).toBe("Please find below our offer.");
  });

  it("cuts at a quoted header that leaked into the new text, and removes link wrappers", () => {
    const french = "Bonjour, please find our rate USD 450.\n\nDe : Anwar <operation2@silverlynxoman.com>\nEnvoyé : jeudi 5 novembre 2026 09:37\nÀ : X\n\nDear Sir, please quote";
    expect(cleanText(body(french))).toBe("Bonjour, please find our rate USD 450.");
    const outlook = "Looping @Kumar\n\n*From:* Ashwin luiz [mailto:operation@silverlynxoman.com]\n*Sent:* Sunday, November 8, 2026 8:44 AM\n*To:* 'Priya'\n\nDear Priya, any update";
    expect(cleanText(body(outlook))).toBe("Looping @Kumar");
    const chinese = "Hbl is telex , we shared to shipper.\n\nSusie\n\n---- 回复的原邮件 ----\n发件人 Abdul Waheed<operation3@silverlynxoman.com>\n\nplease share HBL";
    expect(cleanText(body(chinese))).toBe("Hbl is telex , we shared to shipper.\n\nSusie");
    const links = "Rates on <https://secure-web.cisco.com/1abcDEF/https%3A%2F%2Fexample.com> our site, write to <mailto:a@b.c> a@b.c [cid:image001.png@01DD]";
    expect(cleanText(body(links))).toBe("Rates on  our site, write to  a@b.c");
  });

  it("reads only what was written above the quoted history, and falls back to the snippet", () => {
    expect(cleanText(body(`Please share the destination charges.\n\nBest regards,\nFahid\n${QUOTE_MARKER}\nFrom: Anwar\nPORT TO PORT : OMR 359.000`))).toBe(
      "Please share the destination charges.",
    );
    expect(cleanText({ body_text: null, snippet: "Dear Maria, noted" })).toBe("noted");
    expect(cleanText({ body_text: null, snippet: null })).toBe("");
  });

  it("gives the signature block: the lines after the sign-off up to the first standing notice", () => {
    const fahid = "Dear Anwar,\n\nPlease share the destination charges.\n\nBest regards,\n\nFahid K V\n\nOman Textile Mills\n\nCell: +968 9000 0104";
    expect(signatureTextOf(body(fahid))).toBe("Fahid K V\n\nOman Textile Mills\n\nCell: +968 9000 0104");
    expect(signatureTextOf(body(`Its our best.\n\nThanking You..!\n\n${DISCLAIMER}`))).toBe("");
    expect(signatureTextOf(body("Noted with thanks Ashwin"))).toBe("");
  });

  it("takes a contact block that ends with the sender's own address for the signature when no line signs off", () => {
    const robert = [
      "Dear Anwar，",
      "",
      "OK will contact shipper for pick up and will update to you later.",
      "",
      " Robert",
      "YUXING INTERNATIONAL LOGISTICS CO.,LTD",
      "Add:&nbsp; Room 1613-1614, Zhujiang Business Building, No. 348, Tan Cun Road, Tianhe District, Guangzhou",
      "TEL:+86-020-80000004",
      "WECHAT/SKYPE/WHATSAPP: +86 13000000005",
      "E-mail：marketing11@yxcargo.com",
      "IATA CODE: 00000000000",
      "",
      "&nbsp;",
      "------------------&nbsp;Original&nbsp;------------------",
      'From: &nbsp;"Anwar"<operation2@silverlynxoman.com>;',
      "",
      "Dear Robert Please proceed this shipment. USD 999",
    ].join("\n");
    const theirs = mail({ from_email: "marketing11@yxcargo.com", body_text: robert });
    expect(cleanText(theirs)).toBe("OK will contact shipper for pick up and will update to you later.");
    expect(signatureTextOf(theirs)).toBe(
      "Robert\nYUXING INTERNATIONAL LOGISTICS CO.,LTD\nAdd:  Room 1613-1614, Zhujiang Business Building, No. 348, Tan Cun Road, Tianhe District, Guangzhou\nTEL:+86-020-80000004\nWECHAT/SKYPE/WHATSAPP: +86 13000000005\nE-mail：marketing11@yxcargo.com\nIATA CODE: 00000000000",
    );
    // Without the sender the block stays: only the quoted history goes.
    expect(cleanText(body(robert))).toContain("E-mail：marketing11@yxcargo.com");
    expect(cleanText(body(robert))).not.toContain("USD 999");
    // Rates above an address are not a signature, nor is an address inside a sentence.
    const rates = mail({ from_email: "ops@bluewave.example", body_text: "Dear Anwar,\n\nOur rates:\n\nOcean freight USD 500\nTHC USD 50\nE-mail: ops@bluewave.example" });
    expect(cleanText(rates)).toContain("Ocean freight USD 500");
    const sentence = mail({ from_email: "ahmed@acme.example", body_text: "Dear Anwar,\n\nPlease send the invoice to\nAccounts department\nahmed@acme.example" });
    expect(cleanText(sentence)).toContain("Please send the invoice to");
  });

  it("keeps a first line of thanks when a later line signs off, and a shout above the greeting", () => {
    expect(cleanText(body("Dear Anwar\n\nThank you,\n\nAir Way bill shared with the shipper.\nKindly keep us updated on the pickup.\n\nKind regards\n\nYazan"))).toBe(
      "Thank you,\n\nAir Way bill shared with the shipper.\nKindly keep us updated on the pickup.",
    );
    expect(cleanText(body("Dear Sir,\n\nThanks.\n\nBest Regards,\n\nAbdul Waheed\nCell : 90000001"))).toBe("Thanks.");
    expect(cleanText(body("Thanks,\nBasil\nM: +968 90000002"))).toBe("");
    expect(cleanText(body("Thanks & Regards\n\nAnwar K. S."))).toBe("");
    expect(signatureTextOf(body("Dear Sir,\n\nThanks.\n\nBest Regards,\n\nAbdul Waheed\nCell : 90000001"))).toBe("Abdul Waheed\nCell : 90000001");
    expect(cleanText(body("URGENT\n\nDear Samuel,\n\nPlease confirm SO released to the shipper ? keep us posted.\n\nThanks.\n\nBest Regards,"))).toBe(
      "URGENT\n\nPlease confirm SO released to the shipper ? keep us posted.",
    );
    expect(cleanText(body("Derar Waheed\n\nAgreed sailing date already over"))).toBe("Agreed sailing date already over");
    expect(cleanText(body("SEA FOB\n\nPORT TO PORT : OMR 339.000"))).toBe("SEA FOB\n\nPORT TO PORT : OMR 339.000");
    const nbsp = String.fromCharCode(160);
    expect(cleanText(body(`Dear Sir,${nbsp}\nZAR 4${nbsp}000 all in <tel:+390200000007>`))).toBe("ZAR 4 000 all in");
  });

  it("makes a one-line excerpt and splits sentences without breaking amounts", () => {
    expect(excerptOf("Dear Sir,\nPlease find below our offer.\n\nPORT TO PORT : OMR 359.000")).toBe("Please find below our offer. PORT TO PORT : OMR 359.000");
    expect(excerptOf("word ".repeat(80)).length).toBeLessThanOrEqual(200);
    expect(excerptOf("word ".repeat(80)).endsWith("…")).toBe(true);
    expect(sentencesOf("Noted. Please share MBL Seaway bill\nPORT TO PORT : OMR 359.000. Is it final? Yes!")).toEqual([
      "Noted.",
      "Please share MBL Seaway bill",
      "PORT TO PORT : OMR 359.000.",
      "Is it final?",
      "Yes!",
    ]);
  });
});

describe("kinds", () => {
  it("tells an acknowledgement from a request and from a decision", () => {
    expect(isAck("Noted with thanks Ashwin")).toBe(true);
    expect(isAck("Well noted, thanks.")).toBe(true);
    expect(isAck("NOTED WITH THANKS")).toBe(true);
    expect(isAck("Noted your message will keep you posted .")).toBe(true);
    expect(isAck("Thank you for the update")).toBe(true);
    expect(isAck("FYI")).toBe(true);
    expect(isAck("Noted. Please share MBL Seaway bill")).toBe(false);
    expect(isRequest("Noted. Please share MBL Seaway bill")).toBe(true);
    expect(isAck("Approved")).toBe(false);
    expect(isAck("Confirmed")).toBe(false);
    expect(isAck("BL OK")).toBe(false);
    expect(isAck("Noted, we shall proceed without palletization")).toBe(false);
    expect(isAck("Noted rate is too high")).toBe(false);
    expect(isAck("Ok?")).toBe(false);
  });

  it("does not take information or a go-ahead for a request", () => {
    expect(isRequest("Please note we have received the shipper's booking as attached and issued S/O to the shipper accordingly.")).toBe(false);
    expect(isRequest("Please find below our offer.")).toBe(false);
    expect(isRequest("Please proceed this shipment.")).toBe(false);
    expect(isRequest("Please proceed without palletization")).toBe(false);
    expect(isRequest("Please refer to the following cargo details and confirm to proceed.")).toBe(true);
    expect(isRequest("Please find below message from origin and advise to proceed further")).toBe(true);
    expect(isRequest("Please find attached the BL draft for your approval")).toBe(true);
    expect(isRequest("Pls let us proceed with below. Its our best.")).toBe(true);
    expect(isRequest("Is the rate still valid? Thanks")).toBe(true);
    expect(isRequest("Mob?+86 13000000107")).toBe(false);
  });

  it("reads the one-liners of the mailbox the way a person would", () => {
    const all = (texts: string[], test: (text: string) => boolean) => texts.filter((t) => !test(t));
    expect(all(["Noted your mail.", "Well Noted......", "Noted with thanks", "Well noted your mail thanks.", "Noted your mail. thanks.", "Thank you for your support."], isAck)).toEqual([]);
    expect(
      all(
        [
          "Noted! Will share the docs soon.",
          "Noted please proceed...",
          "Noted your mail. Find attached BL instruction.",
          "Noted, we shall quote revised rates soon",
          "Noted your mail. Once get full set of Port and transport documents from Sohar team, accounts will share",
          "Thanks for your support. Please be informed this shipment is confirmed for rate mentioned in below trail mail,",
        ],
        (t) => !isAck(t),
      ),
    ).toEqual([]);
    expect(
      all(
        [
          "Noted your mail. please share SO details.",
          "Noted your mail. Why you shared 2 HBL’S for 4x40 containers ???",
          "Please kindly find update attached draft of MB/L and HB/L.Please recheck and confirm to us asap.TKS",
          "Please find attached Revised MBL Draft for approval.",
          "Please note our shipper details /share agent details /arrange booking asap",
          "Please note ETA tomorrow, kindly share endorsed BL copy to arrange D.O",
          "Please find attached BL draft, Kindly check and confirm us your approval",
          "We are waiting for your confirmation",
        ],
        isRequest,
      ),
    ).toEqual([]);
    expect(
      all(
        [
          "Further, please note that the vessel arrived at POL and is scheduled to sail by tomorrow.",
          "Please kindly find attached OBD HBL and MBL Documents for the subject shipment ,thanks",
          "Thank you for the enquiry. Please find below our best LCL ocean freight offer on EXW terms",
          "Thank you for your confirmation",
          "BL confirm, kindly proceed",
          "Please proceed, I will add you in supplier email loop",
          "Noted please proceed...",
        ],
        (t) => !isRequest(t),
      ),
    ).toEqual([]);
    expect(
      all(
        [
          "What's the SO status?",
          "What’s is the status of departure?",
          "Do we have any update on this inquiry?",
          "Customer is chasing for flight schedule, Please revert urgently",
          "We’re following up on the quotation we previously shared",
          "*GENTLE REMINDER !!!*",
          "Reminder",
        ],
        isChase,
      ),
    ).toEqual([]);
    expect(
      all(
        [
          "Noted and already informed our finance team to follow. If any update, I will let U know thks.",
          "We will request updated rates and revert as soon as possible.",
          "We are following up with the airline for the rates",
        ],
        (t) => !isChase(t),
      ),
    ).toEqual([]);
    expect(
      all(["TOP URGENT !", "Kindly share quotation asap.", "Please confirm ETA MCT urgently", "this is too high charges do not proceed COD", "Unfortunately, the shipper is not responding to our"], isEscalation),
    ).toEqual([]);
    expect(
      all(
        [
          "We will send it to you immediately once received.",
          "HBL have been done ,will send MBL TLX to you asap ,tks",
          "For Urgent inquiries/quotes pls contact sales support",
          "If you have any questions, please let me know asap",
          "If received in error, please notify the sender and delete it immediately.",
        ],
        (t) => !isEscalation(t),
      ),
    ).toEqual([]);
    const tuesday = oman("2026-11-10 10:13");
    expect(promiseOf("Noted! Will share the docs soon.", tuesday)?.due).toBe("2026-11-11");
    expect(promiseOf("Noted, we shall quote revised rates soon", tuesday)?.due).toBe("2026-11-11");
    expect(promiseOf("Well noted, will update you further details tomorrow", tuesday)).toEqual({ sentence: "Well noted, will update you further details tomorrow", due: "2026-11-11" });
  });

  it("folds an 'adding a colleague' note", () => {
    const note = "Dear Anwar,\n\nNoted. Will updated.\n\n++@Reena Aneesh<mailto:reena@flgshipping.net> pls.\n\nThanking You..!\n\n" + DISCLAIMER;
    const m = mail({ body_text: note });
    expect(noiseOf(m, cleanText(m), [])).toBe("loop_in");
    for (const text of [
      "Adding + Pricing team\n\nThanks.\n\nBest Regards,\nAbdul Waheed",
      "++ Amir bhai",
      "Adding Air Team",
      "++ Looping @Salim Al Harthy",
      "Noted your mail.\n\nAdding + Aamir\n\nThanks.",
      "Adding ++ <mailto:Operation4@silverlynxoman.com> @Operation4@silverlynxoman.com\n\nThanks\n\nRegards,",
    ]) {
      const short = mail({ body_text: text });
      expect(noiseOf(short, cleanText(short), [])).toBe("loop_in");
    }
    for (const text of [
      "Adding to the below, the cargo is non-stackable.",
      "Noted. Including DO charges the total is OMR 471.",
      "Noted your mail.\n\nAdding + Khalid – Sohar Team – Please pay and share the slip.",
    ]) {
      const real = mail({ body_text: text });
      expect(noiseOf(real, cleanText(real), [])).toBeNull();
    }
  });

  it("lets an 'adding a colleague' line above a long signature change nothing", () => {
    const signature = "CESARE GABRIELE IESSI (Mr)\nDeputy General Manager\n\n[icon] +39 02 0000 0008  [icon]  iessi@mleurope.com\n\nOFFICE :\nVia Cassanese 224\nPalazzo Caravaggio - 20054 Segrate Milano - Italy\n\nAll quotes will be subjected to Euro 15 Bank Commission Fee billed in the invoice";
    const adding = mail({ from_email: "iessi@mleurope.com", received_at: oman("2026-11-05 14:58"), body_text: `Adding Export TEAM\n\n${signature}` });
    const rate = mail({ from_email: "ancona@mleurope.com", received_at: oman("2026-11-05 15:00"), body_text: "Hello\nWith HPL door to Sohar € 12500/OTHC IG\nTT:75 DAYS\nRegards" });
    const read = readMails(input(row(), [adding, rate]));
    expect(read.mails.map((m) => [m.scope, m.kind])).toEqual([["in", "substantive"], ["in", "ack"]]);
    expect(read.sides[1].chase).toBeNull();
    // A message under the line is a message.
    const priced = mail({ from_email: "iessi@mleurope.com", body_text: "Adding our export team.\n\nOur rate is EUR 8,995 per 40 OT, valid till 30 Nov.\n\nVia Cassanese 224, 20054 Segrate Milano, Italy, office hours 9 to 18, closed on Saturdays and Sundays, see you soon" });
    expect(readMails(input(row(), [priced])).mails[0].kind).toBe("substantive");
    const asking = mail({ from_email: "iessi@mleurope.com", body_text: "Adding our export team.\n\nCould you tell us the cargo ready date, the commodity and whether the cargo is stackable, so that we can check the space with the carrier" });
    expect(readMails(input(row(), [asking])).mails[0]).toMatchObject({ kind: "substantive", isRequest: true });
  });

  it("reads who is waited for: news about someone else is not a request, a complaint is", () => {
    expect(isChase("What’s the  SO status?")).toBe(true);
    expect(isRequest("now space is not opon,  so s/o is pending , pls waiting, will share to you once available.")).toBe(false);
    expect(isRequest("Awaiting SO from carrier we will keep you posted.")).toBe(false);
    expect(isRequest("Attached booking received from shipper, awaiting SO from carrier we will keep you posted.")).toBe(false);
    expect(isRequest("Awaiting your confirmation")).toBe(true);
    expect(isRequest("Awaiting reply on below .")).toBe(true);

    const enquiryRow = row({ contact_email: "basil@sterling.example" });
    const toCustomer = { ...OURS, to_emails: ["basil@sterling.example"] };
    const news = mail({ ...toCustomer, body_text: "Dear Sir,\n\nReceived booking from shipper but the cargo wt. is 24800 kgs.\n\nAwaiting SO shipping line’s EMC / MSC ETD 18/11\n\nWe will keep you posted." });
    const ask = mail({ ...toCustomer, body_text: "Dear Sir,\n\nAwaiting your approval of the BL draft." });
    const toAgent = mail({ ...OURS, to_emails: ["robert@yxcargo.com"], body_text: "Dear Robert\n\nAwaiting the quote." });
    const complaint = mail({ from_email: "basil@sterling.example", received_at: oman("2026-11-09 14:12"), body_text: "So shouldn't be delayed and to sail asap without rollover\n\nThanks & Best Regards\nBasil Iqbal" });
    const read = readMails(input(enquiryRow, [news, ask, toAgent, complaint]));
    const by = new Map(read.mails.map((m) => [m.id, m]));
    expect(by.get(news.id)).toMatchObject({ isRequest: false, toParty: "customer" });
    expect(by.get(ask.id)?.isRequest).toBe(true);
    expect(by.get(toAgent.id)).toMatchObject({ isRequest: true, toParty: "agent" });
    expect(by.get(complaint.id)).toMatchObject({ isRequest: true, urgent: true, isChase: false });
    expect(read.sides[0].questions.at(-1)).toMatchObject({ sentence: "So shouldn't be delayed and to sail asap without rollover", answered: false });
  });

  it("takes neither 'undelivered cargo' for a bounce nor a long mail about a leave for an auto-reply", () => {
    const cargo = mail({ subject: "RE: SL262700 undelivered cargo at Sohar", body_text: "Dear Sir, the cargo is still at the port. Please arrange delivery." });
    expect(noiseOf(cargo, cleanText(cargo), [])).toBeNull();
    const failure = mail({ from_email: "postmaster@outlook.example", subject: "Undeliverable: SL262700 LCL SHANGHAI CHINA TO SOHAR OMAN", body_text: "Your message to buyer@acme.example couldn't be delivered." });
    expect(noiseOf(failure, cleanText(failure), [])).toBe("bounce");
    const leave = "I will be on annual leave from tomorrow, so kindly coordinate with Ahmed from our team for this shipment. ";
    const long = mail({ body_text: `Dear Anwar,\n${leave}${"The consignee needs the cargo before the end of the month and the supplier has confirmed readiness. ".repeat(6)}Please proceed with the booking.` });
    expect(noiseOf(long, cleanText(long), [])).toBeNull();
  });

  it("folds an automatic reply and never calls it urgent", () => {
    const auto = mail({
      subject: "Automatic reply: SL262700 // 1X40 KOLKATA INDIA TO SOHAR OMAN",
      body_text: "Dear Partner,\nThank you for below mail. Our office will be closed on 9th Nov on account of Diwali holiday. For any urgent matters please contact my colleague.",
    });
    expect(noiseOf(auto, cleanText(auto), [])).toBe("auto_reply");
    const read = readMails(input(row(), [auto]));
    expect(read.mails[0].scope).toBe("noise");
    expect(read.mails[0].urgent).toBe(false);
    expect(read.hidden.autoReplies).toBe(1);
    expect(read.hidden.text).toBe("1 auto-reply hidden");
    expect(isEscalation("For any urgent matters please contact my colleague.")).toBe(false);
    expect(isEscalation("I will check and advise asap")).toBe(false);
    expect(isEscalation("Kindly provide an urgent update on the handover status.")).toBe(true);
    expect(isEscalation("your team is not responding")).toBe(true);
    const away = mail({ body_text: "I am on annual leave until 15 Nov with limited access to my emails." });
    expect(noiseOf(away, cleanText(away), [])).toBe("auto_reply");
  });

  it("reads a reminder with a clock deadline, cleared once we wrote back", () => {
    const text = "Dear Maria,\nKind reminder on the below. We are finalizing this shipment today, so appreciate your reply by 12:00 PM";
    const at = oman("2026-11-09 09:59");
    expect(isRequest(cleanText(body(text)))).toBe(true);
    expect(isChase(cleanText(body(text)))).toBe(true);
    expect(deadlineOf(cleanText(body(text)), at)).toEqual({ at: "2026-11-09T12:00+04:00", text: "by 12:00 on Mon 09 Nov" });

    const enquiryRow = row({ contact_email: "buyer@synergies.example" });
    const theirs = mail({ from_email: "buyer@synergies.example", received_at: at, body_text: text });
    const waiting = readMails(input(enquiryRow, [theirs], { now: oman("2026-11-09 10:00") })).sides[0];
    expect(waiting.deadline).toMatchObject({ at: "2026-11-09T12:00+04:00", text: "by 12:00 today", passed: false, cleared: false });
    expect(waiting.deadline?.proof.sentence).toContain("appreciate your reply by 12:00 PM");

    const reply = mail({ ...OURS, to_emails: ["buyer@synergies.example"], received_at: oman("2026-11-09 10:24"), body_text: "Dear Sir,\nWe reconfirm the rate of OMR 768." });
    const answered = readMails(input(enquiryRow, [theirs, reply], { now: oman("2026-11-09 13:00") })).sides[0];
    expect(answered.deadline).toMatchObject({ passed: true, cleared: true });
    expect(answered.mails.map((m) => m.isRequest)).toEqual([false, true]);
    expect(answered.mails[1].isPureChase).toBe(true);
  });

  it("resolves the other deadline wordings on the Oman clock", () => {
    const thu = oman("2026-11-05 15:00");
    expect(deadlineOf("Please confirm by 5 pm", thu)?.at).toBe("2026-11-05T17:00+04:00");
    expect(deadlineOf("Please confirm by 10 am", thu)?.at).toBe("2026-11-06T10:00+04:00");
    expect(deadlineOf("Please revert by EOD", thu)?.at).toBe("2026-11-05T18:00+04:00");
    expect(deadlineOf("Kindly share by tomorrow", thu)?.at).toBe("2026-11-06T18:00+04:00");
    expect(deadlineOf("Need the rates before Monday", thu)?.at).toBe("2026-11-09T18:00+04:00");
    expect(deadlineOf("Please reply within 24 hours", thu)?.at).toBe("2026-11-06T15:00+04:00");
    expect(deadlineOf("Please reply within 2 days", thu)?.at).toBe("2026-11-07T15:00+04:00");
    expect(deadlineOf("We are closing this order today, kindly confirm", thu)?.at).toBe("2026-11-05T18:00+04:00");
    expect(deadlineOf("confirmed by shipper", thu)).toBeNull();
    expect(deadlineOf("Please confirm", "not a date")).toBeNull();
    expect(deadlineText("2026-11-10T18:00+04:00", "2026-11-09")).toBe("by 18:00 tomorrow");
    expect(deadlineText("2026-11-12T12:00+04:00", "2026-11-09")).toBe("by 12:00 on Thu 12 Nov");
  });

  it("counts working days from Sunday to Thursday", () => {
    // Thursday + 2 working days is Monday (Sunday, Monday), not Saturday.
    expect(deadlineOf("Kindly quote within 2 working days.", oman("2026-11-12 10:00"))).toEqual({ at: "2026-11-16T10:00+04:00", text: "by 10:00 on Mon 16 Nov" });
    expect(deadlineOf("Please revert within 1 working day", oman("2026-11-11 09:30"))?.at).toBe("2026-11-12T09:30+04:00");
    expect(deadlineOf("Please revert within 1 working day", oman("2026-11-12 09:30"))?.at).toBe("2026-11-15T09:30+04:00");
    // Sent on a Friday: Sunday is the first working day.
    expect(deadlineOf("Please quote within 3 working days", oman("2026-11-13 11:00"))?.at).toBe("2026-11-17T11:00+04:00");
    // Plain days stay calendar days.
    expect(deadlineOf("Please reply within 2 days", oman("2026-11-12 10:00"))?.at).toBe("2026-11-14T10:00+04:00");

    // On the first working morning the deadline has not passed yet.
    const enquiryRow = row({ contact_email: "buyer@synergies.example" });
    const theirs = mail({ from_email: "buyer@synergies.example", received_at: oman("2026-11-12 10:00"), body_text: "Dear Maria,\nKindly quote within 2 working days." });
    const side = readMails(input(enquiryRow, [theirs], { now: oman("2026-11-15 08:30") })).sides[0];
    expect(side.deadline).toMatchObject({ at: "2026-11-16T10:00+04:00", passed: false });
  });

  it("moves a day-word deadline to the next day when the mail came in after 18:00", () => {
    const thuEvening = oman("2026-11-12 20:00");
    expect(deadlineOf("Please quote by EOD.", thuEvening)).toEqual({ at: "2026-11-13T18:00+04:00", text: "by 18:00 on Fri 13 Nov" });
    expect(deadlineOf("Please confirm by COB", thuEvening)?.at).toBe("2026-11-13T18:00+04:00");
    expect(deadlineOf("Need it by today", thuEvening)?.at).toBe("2026-11-13T18:00+04:00");
    expect(deadlineOf("Please revert by this evening", thuEvening)?.at).toBe("2026-11-13T18:00+04:00");
    expect(deadlineOf("Please quote by end of week", thuEvening)?.at).toBe("2026-11-19T18:00+04:00");
    expect(deadlineOf("We are closing this order today, kindly confirm", thuEvening)?.at).toBe("2026-11-13T18:00+04:00");
    // At 18:00 sharp the day is over; before it, the same day.
    expect(deadlineOf("Please quote by EOD.", oman("2026-11-12 18:00"))?.at).toBe("2026-11-13T18:00+04:00");
    expect(deadlineOf("Please quote by EOD.", oman("2026-11-12 17:59"))?.at).toBe("2026-11-12T18:00+04:00");
    expect(deadlineOf("Please quote by end of week", oman("2026-11-12 15:00"))?.at).toBe("2026-11-12T18:00+04:00");
    expect(deadlineOf("Please quote by end of week", oman("2026-11-10 20:00"))?.at).toBe("2026-11-12T18:00+04:00");

    // Read at 20:05 the same evening, the deadline is still ahead.
    const enquiryRow = row({ contact_email: "buyer@synergies.example" });
    const theirs = mail({ from_email: "buyer@synergies.example", received_at: thuEvening, body_text: "Dear Maria,\nPlease quote by EOD." });
    const side = readMails(input(enquiryRow, [theirs], { now: oman("2026-11-12 20:05") })).sides[0];
    expect(side.deadline).toMatchObject({ at: "2026-11-13T18:00+04:00", passed: false });
  });

  it("reads a promise with the day it falls due, and never a deadline inside it", () => {
    const text = "Due to weekend at origin Will update by tomorrow";
    const sunday = oman("2026-11-08 11:28");
    expect(promiseOf(text, sunday)).toEqual({ sentence: text, due: "2026-11-09" });
    expect(deadlineOf(text, sunday)).toBeNull();
    // No day named: the next working day (Thursday → Sunday).
    expect(promiseOf("We shall update you further once shipper hand over cargo", oman("2026-11-05 11:15"))?.due).toBe("2026-11-08");
    expect(promiseOf("We will revert by Monday", oman("2026-11-05 11:15"))?.due).toBe("2026-11-09");
    expect(promiseOf("Noted your message will keep you posted .", oman("2026-11-09 08:59"))?.due).toBe("2026-11-10");
    expect(promiseOf("Please share the rates", sunday)).toBeNull();

    const enquiryRow = row({ contact_email: "buyer@synergies.example" });
    const ours = mail({ ...OURS, to_emails: ["buyer@synergies.example"], received_at: sunday, body_text: `Dear Sir,\n${text}` });
    const open = readMails(input(enquiryRow, [ours])).sides[0];
    expect(open.promise).toMatchObject({ by: "us", due: "2026-11-09", kept: false });
    expect(open.promise?.proof.who).toBe("Ashwin Luiz");
    const later = mail({ ...OURS, to_emails: ["buyer@synergies.example"], received_at: oman("2026-11-09 09:00"), body_text: "Dear Sir,\nThe vessel sails on 12 Nov." });
    const kept = readMails(input(enquiryRow, [ours, later]));
    expect(kept.sides[0].promise).toBeNull();
    expect(kept.mails[1].promise?.kept).toBe(true);
  });

  it("reads hold words only from the customer of an open enquiry", () => {
    const text = "Dear Maria,\nPls hold this for now, we are planning via Jeddah.";
    expect(isHold(cleanText(body(text)))).toBe(true);
    const enquiryRow = row({ contact_email: "buyer@synergies.example", quoted_date: "2026-11-03" });
    const theirs = mail({ from_email: "buyer@synergies.example", body_text: text });
    expect(readMails(input(enquiryRow, [theirs])).mails[0].hold).toBe(true);
    expect(readMails(input(row({ contact_email: "buyer@synergies.example", quoted_date: "2026-11-03", confirmed_date: "2026-11-04" }), [theirs])).mails[0].hold).toBe(false);

    const agent = mail({ from_email: "susie@jasclog.com", body_text: "Dear Abdul,\nKindly cancel current booking and advise next vessel. Cargo is not ready." });
    const read = readMails(input(enquiryRow, [agent]));
    expect(read.mails[0].party).toBe("agent");
    expect(read.mails[0].hold).toBe(false);
  });

  it("marks an agent we asked to hold as paused by us, until we write again", () => {
    const hold = mail({ ...OURS, to_emails: ["ops@wwl.cn"], received_at: oman("2026-11-09 18:29"), body_text: "Dear Team,\nPlease hold this shipment until further notice." });
    const noted = mail({ from_email: "ops@wwl.cn", received_at: oman("2026-11-09 18:40"), body_text: "Noted with thanks" });
    const paused = readMails(input(row(), [hold, noted], { now: oman("2026-11-10 09:00") })).sides[1];
    expect(paused.key).toBe("wwl.cn");
    expect(paused.pausedByUs).toMatchObject({ emailId: hold.id, who: "Ashwin Luiz", sentence: "Please hold this shipment until further notice." });
    const resume = mail({ ...OURS, to_emails: ["ops@wwl.cn"], received_at: oman("2026-11-10 08:00"), body_text: "Dear Team,\nPlease proceed with the booking." });
    expect(readMails(input(row(), [hold, noted, resume], { now: oman("2026-11-10 09:00") })).sides[1].pausedByUs).toBeNull();
  });

  it("folds the second of two identical mails sent within two minutes", () => {
    const first = mail({ from_email: "liu@consolclub.com", received_at: oman("2026-11-05 10:00"), body_text: "Dear Anwar,\nRate is USD 450/cbm, valid till 15 Nov." });
    const second = mail({ ...first, id: "dup", gmail_message_id: "gdup", received_at: new Date(Date.parse(first.received_at) + 90_000).toISOString() });
    expect(noiseOf(second, cleanText(second), [first])).toBe("duplicate");
    expect(noiseOf(first, cleanText(first), [])).toBeNull();
    const late = mail({ ...first, id: "late", gmail_message_id: "glate", received_at: new Date(Date.parse(first.received_at) + 10 * 60_000).toISOString() });
    expect(noiseOf(late, cleanText(late), [first])).toBeNull();
    const otherTo = mail({ ...second, id: "other", to_emails: ["operation@silverlynxoman.com"] });
    expect(noiseOf(otherTo, cleanText(otherTo), [first])).toBeNull();

    const read = readMails(input(row(), [second, first]));
    expect(read.mails.map((m) => m.scope)).toEqual(["noise", "in"]);
    expect(read.hidden).toMatchObject({ duplicates: 1, text: "1 duplicate hidden" });
    expect(read.sides[1].mails).toHaveLength(1);
    expect(read.sides[1].hiddenCount).toBe(1);
  });

  it("knows a bounce, and which address it could not reach", () => {
    const bounce = mail({
      from_email: "mailer-daemon@googlemail.com",
      from_name: "Mail Delivery Subsystem",
      subject: "Delivery Status Notification (Failure)",
      body_text: "** Message blocked **\n\nYour message to purchase@fahmyfurniture.com has been blocked.\n\nFinal-Recipient: rfc822; purchase@fahmyfurniture.com\nAction: failed\nStatus: 5.7.1",
    });
    expect(noiseOf(bounce, cleanText(bounce), [])).toBe("bounce");
    expect(bounceAddressOf(bounce)).toBe("purchase@fahmyfurniture.com");
    expect(bounceAddressOf(body("** Address not found **\nYour message wasn't delivered to gao@consolclub.com because the address couldn't be found."))).toBe("gao@consolclub.com");

    const read = readMails(input(row({ customer_name: "FAHMY FURNITURE" }), [bounce]));
    expect(read.mails[0]).toMatchObject({ scope: "noise", noise: "bounce", sideKey: "customer", crossFiled: null });
    // A bounce is a flag and a red row, not one of the folded mails.
    expect(read.hidden.mails).toHaveLength(0);
    expect(read.hidden.text).toBe("");
  });
});

describe("parties and sides", () => {
  const otm = (over: Partial<PartyContext> = {}): PartyContext => ({ row: { customer_name: "OMAN TEXTILES", contact_email: null, agent_name: null, reference: "SL262784" }, ...over });

  it("takes an unrecognisable domain for the customer once our offer went to it", () => {
    const fahid = sender("purchase_otm@omzest.com", "Fahid, OTM");
    expect(classifyParty(fahid, otm())).toBe("other");
    expect(classifyParty(fahid, otm({ offerRecipients: new Set(["purchase_otm@omzest.com"]) }))).toBe("customer");
    // A colleague at the same company domain; never a stranger on a free-mail domain.
    expect(classifyParty(sender("raghavan_otm@omzest.com"), otm({ offerRecipients: new Set(["purchase_otm@omzest.com"]) }))).toBe("customer");
    expect(classifyParty(sender("other@gmail.com"), otm({ offerRecipients: new Set(["someone@gmail.com"]) }))).toBe("other");

    const offer = mail({
      sender_type: "staff", from_email: "operation2@silverlynxoman.com", to_emails: ["purchase_otm@omzest.com"], subject: "RE: SL262784 // Request for Sea Freight Quotation",
      received_at: oman("2026-11-05 08:20"), body_text: "Dear Sir\n\nPlease find below our offer.\n\nSEA FOB PORT TO PORT : OMR 359.000",
    });
    const reply = mail({ ...fahid, subject: offer.subject, received_at: oman("2026-11-05 08:44"), body_text: "Please share the destination charges for our reference." });
    const read = readMails(input(row({ reference: "SL262784", customer_name: "OMAN TEXTILES" }), [offer, reply]));
    expect(read.ctx.offerRecipients?.has("purchase_otm@omzest.com")).toBe(true);
    expect(read.mails.map((m) => [m.party, m.toParty, m.sideKey])).toEqual([["customer", null, "customer"], ["us", "customer", "customer"]]);
  });

  it("recognises the customer by its name in the domain, by its contact and by a free-mail local part", () => {
    const named = (customer_name: string, contact_email: string | null = null): PartyContext => ({ row: { customer_name, contact_email, agent_name: null, reference: "SL262700" } });
    const customers: [string, string][] = [
      ["purchase@hydrotecinternational.com", "HYDROTEC INTERNATIONAL"],
      ["basil@sterlingsites.co", "STERLING INTERNATIONAL"],
      ["info@omantextiles.com", "OMAN TEXTILES"],
      ["logistics@cms-egypt.com", "CONSOLIDATED MARINE SERVICES"],
      ["yousuf@oneic.com.om", "OMAN NATIONAL ENG & INVESTMENT CO (SAOG)"],
      // Initials or a short name with a usual ending.
      ["buyer@gesoman.com", "GULF ENGG. SUPPLIES CO."],
      ["stores@npioman.om", "NATIONAL PHARMACEUTICALS IND."],
      ["purchase@ttcoman.com", "TECHNICAL TRADING CO. LLC"],
      ["ops@sfomuscat.com", "SHARKIYAH FANNIYAH OMANIYAH"],
      ["buyer@xomoman.com", "XOM LLC"],
      ["buyer@abctrading.com", "ABC TRADING LLC"],
      ["hydrotec.oman@gmail.com", "HYDROTEC INTERNATIONAL"],
    ];
    expect(customers.filter(([address, name]) => classifyParty(sender(address), named(name)) !== "customer")).toEqual([]);
    expect(classifyParty(sender("someone@gmail.com", "WHITEROCKUNITED OMAN"), named("WHITE ROCK UNITED LLC"))).toBe("customer");
    expect(classifyParty(sender("b@acme.com"), named("SOMETHING ELSE", "a@acme.com"))).toBe("customer");
    expect(classifyParty(sender("b@gmail.com"), named("SOMETHING ELSE", "a@gmail.com"))).toBe("other");
    // Domains that say nothing about the customer stay "other" until our offer goes to them; common words alone never count.
    expect(classifyParty(sender("purchase@hadid.com"), named("AL KHOUD STEEL"))).toBe("other");
    expect(classifyParty(sender("stores@cbcoman.com"), named("CHANNEL BUSINESS LLC"))).toBe("other");
    expect(classifyParty(sender("rates@omanshipping.com"), named("OMAN NATIONAL TRADING"))).toBe("agent");
  });

  it("knows agents by the seed table, carriers, ourselves, shippers and what the person chose", () => {
    const ctx = otm();
    expect(classifyParty(sender("manukrishna@flgshipping.net"), ctx)).toBe("agent");
    expect(agentNameForDomain("flgshipping.net")).toBe("FRONTLINE");
    expect(classifyParty(sender("liuzhiyong@consolclub.com"), ctx)).toBe("agent");
    expect(agentNameForDomain("consolclub.com")).toBe("CONSOLE CLUB");
    expect(classifyParty(sender("x@hlag.com"), ctx)).toBe("carrier");
    expect(classifyParty(sender("silverlynxco@gmail.com"), ctx)).toBe("us");
    expect(classifyParty({ sender_type: "self", from_email: "pricing@silverlynxoman.com", from_name: null }, ctx)).toBe("us");
    expect(classifyParty(sender("mailer-daemon@googlemail.com"), ctx)).toBe("other");
    expect(classifyParty(sender("ops@hutchisonportssohar.com"), ctx)).toBe("other");
    expect(classifyParty(sender("gufran0909@gmail.com"), ctx)).toBe("other");
    expect(classifyParty(sender("gufran0909@gmail.com"), otm({ overrides: { party: { "gufran0909@gmail.com": "customer" }, keptThreads: [], dismissed: [] } }))).toBe("customer");
    expect(classifyParty(sender("qduniontop@yahoo.com"), otm({ shipperAddresses: new Set(["qduniontop@yahoo.com"]) }))).toBe("shipper");
    // The register's agent of this enquiry, and an address our rate request went to.
    expect(classifyParty(sender("alessia@cdcitalia.it", "Alessia Dotelli - CDC Italia"), otm())).toBe("agent");
    expect(classifyParty(sender("ops@bluewave.vn"), { row: { ...otm().row, agent_name: "BLUEWAVE" } })).toBe("agent");
    expect(classifyParty(sender("rates@oscar.example"), otm({ requestRecipients: new Set(["rates@oscar.example"]) }))).toBe("agent");
    expect(classifyParty(sender("rates@oscar.example"), otm())).toBe("other");
    expect(classifyParty(sender(""), ctx)).toBe("other");
  });

  it("takes a mail of ours for a rate request only when two signs agree", () => {
    const enquiryRow = row({ customer_name: "AL KHOUD STEEL" });
    const question = mail({ ...OURS, to_emails: ["purchase@hadid.example"], subject: "RE: SL262700 // Enquiry for steel coils", body_text: "Dear Sir,\n\nKindly share your target rate." });
    const reply = mail({ from_email: "purchase@hadid.example", subject: question.subject, received_at: oman("2026-11-05 11:00"), body_text: "We do not have a target." });
    const asked = readMails(input(enquiryRow, [question, reply]));
    expect(asked.ctx.requestRecipients?.size).toBe(0);
    expect(asked.mails[0]).toMatchObject({ party: "other", scope: "in" });

    const request = mail({ ...OURS, to_emails: ["rates@oscar.example"], subject: "LCL FOB SHANGHAI CHINA TO SOHAR OMAN", sl_refs: [], gmail_thread_id: "t-ask", body_text: "Dear Team,\n\nPlease advise the quote for below sea shipment on FOB TERMS." });
    const rate = mail({ from_email: "rates@oscar.example", subject: "RE: LCL FOB SHANGHAI CHINA TO SOHAR OMAN", sl_refs: [], gmail_thread_id: "t-ask", match_method: "reply", received_at: oman("2026-11-05 11:00"), body_text: "USD 60/cbm" });
    const read = readMails(input(enquiryRow, [request, rate]));
    expect([...(read.ctx.requestRecipients ?? [])]).toEqual(["rates@oscar.example"]);
    expect(read.mails[0]).toMatchObject({ party: "agent", scope: "in", sideKey: "oscar.example" });
  });

  it("maps a domain to the register's spelling of the agent, or to nothing the register does not know", () => {
    const names = ["Frontline", "WINCO", "ALPAGU", "MALONE"];
    expect(agentNameForDomain("flgshipping.net", names)).toBe("Frontline");
    expect(agentNameForDomain("consolclub.com", names)).toBeNull();
    expect(agentNameForDomain("mail.wincologistics.com", names)).toBe("WINCO");
    expect(agentNameForDomain("alpagulogistics.com", names)).toBe("ALPAGU");
    expect(agentNameForDomain("maloney-furniture.com", names)).toBeNull();
    expect(agentNameForDomain("unknown.example")).toBeNull();
    expect(agentNameForDomain("")).toBeNull();
  });

  it("finds the shipper's address in a contact block and never takes a request for details for one", () => {
    const block = "Dear Manu\n\nPlease proceed this shipment.\n\nVENDOR NAME\nUnion Top\nCONTACT PERSON\nMr. David\nMOBILE\n+86 13000000108\nEMAIL\nqduniontop@yahoo.com\n\nThanks & Regards\n\nAnwar K. S.\n\nE: operation2@silverlynxoman.com";
    const ours = mail({ sender_type: "staff", from_email: "operation2@silverlynxoman.com", to_emails: ["manukrishna@flgshipping.net"], received_at: oman("2026-11-05 16:04"), body_text: block });
    const theirs = mail({ from_email: "qduniontop@yahoo.com", received_at: oman("2026-11-06 09:00"), body_text: "Dear Sir, cargo will be ready on 10 Nov." });
    const read = readMails(input(row(), [ours, theirs]));
    expect([...(read.ctx.shipperAddresses ?? [])]).toEqual(["qduniontop@yahoo.com"]);
    expect(read.mails[0]).toMatchObject({ party: "shipper", sideKey: "qduniontop@yahoo.com" });
    expect(read.sides.map((s) => [s.key, s.kind, s.name])).toEqual([
      ["customer", "customer", "Test Customer LLC"],
      ["qduniontop@yahoo.com", "shipper", "qduniontop@yahoo.com"],
      ["flgshipping.net", "agent", "Frontline"],
    ]);

    const asking = mail({ sender_type: "staff", from_email: "operation2@silverlynxoman.com", to_emails: ["buyer@customer.example"], body_text: "Please share the shipper contact details.\n\nAgent:\nYoyo\nEMAIL：overseas04@we-can.sh.cn" });
    expect(readMails(input(row(), [asking])).ctx.shipperAddresses?.size).toBe(0);
  });

  it("takes a domain with a forwarder's word for an agent and names its side by the domain", () => {
    const rate = mail({ from_email: "ops@bluewavelogistics.com", from_name: "Minh", body_text: "Dear Anwar,\nOur rate is USD 450/cbm." });
    const read = readMails(input(row(), [rate]));
    expect(read.mails[0].party).toBe("agent");
    expect(read.sides[1]).toMatchObject({ key: "bluewavelogistics.com", kind: "agent", name: "bluewavelogistics.com", domain: "bluewavelogistics.com", agentName: null });
    expect(read.sides[1].currentWriter).toEqual({ name: "Minh", email: "ops@bluewavelogistics.com", staff: null });
    expect(proofOf(read.mails[0], read.today).who).toBe("Minh (bluewavelogistics.com)");
    // A copy of the mail (a later module adding its cues) still knows its conversation.
    expect(proofOf({ ...read.mails[0], cues: [] }, read.today, "Our rate is USD 450/cbm.")).toEqual({
      emailId: rate.id,
      who: "Minh (bluewavelogistics.com)",
      when: "Thu 05 Nov, 10:00",
      sentence: "Our rate is USD 450/cbm.",
    });
  });

  it("reads the conversation of SL262784 into its three sides", () => {
    const { row: enquiryRow, emails } = sl262784();
    const read = readMails(input(enquiryRow, emails));
    expect(read.today).toBe("2026-11-09");
    expect(read.mails).toHaveLength(26);
    expect(read.mails[0].at > read.mails[25].at).toBe(true);
    expect(read.sides.map((s) => [s.key, s.kind, s.name, s.mails.length, s.threads.length])).toEqual([
      ["customer", "customer", "Oman Textiles", 11, 1],
      ["flgshipping.net", "agent", "Frontline", 13, 3],
      ["internal", "internal", "Our side", 1, 1],
    ]);
    const [customer, frontline, internal] = read.sides;

    // omzest.com says nothing about Oman Textiles: its people are the customer because our offer went to them.
    expect(read.ctx.offerRecipients).toEqual(new Set(["purchase_otm@omzest.com", "raghavan_otm@omzest.com"]));
    expect(customer.mails.filter((m) => m.party === "customer")).toHaveLength(5);
    expect(customer.domain).toBe("omzest.com");
    expect(customer.currentWriter).toMatchObject({ name: "Fahid", email: "purchase_otm@omzest.com" });
    expect(customer.lastFromThem?.time).toBe("09:25");
    expect(customer.lastFromUs?.time).toBe("11:15");
    expect(customer.lastFromUs?.isRequest).toBe(false);
    expect(customer.fileCount).toBe(1);
    expect(customer.threads[0].gmailUrl).toBe("https://mail.google.com/mail/?authuser=pricing%40silverlynxoman.com#all/1a1a9ef8c9e3481b");

    // Frontline: the seed name, Oman hours, and the disclaimer gone from every excerpt.
    expect(frontline).toMatchObject({ agentName: "FRONTLINE", domain: "flgshipping.net", fileCount: 1, hiddenCount: 1, pausedByUs: null });
    expect(frontline.replyWindow?.text).toBe("Works Oman hours · weekend Fri–Sat");
    expect(frontline.threads.map((t) => t.count)).toEqual([7, 4, 2]);
    expect(frontline.mails.every((m) => !/disclaimer|geopolitical|transit delays/i.test(m.clean))).toBe(true);
    expect(frontline.mails[0]).toMatchObject({ excerpt: "Noted with thanks Ashwin", kind: "ack", party: "agent" });
    expect(frontline.lastFromUs).toMatchObject({ excerpt: "Please proceed", isRequest: false, toParty: "agent" });
    expect(frontline.currentWriter?.name).toBe("Reena Aneesh");
    const firstRate = frontline.mails[frontline.mails.length - 2];
    expect(firstRate.clean).toContain("OCEAN FREIGHT                                      : OMR  309/- All in for  6 CBM");
    expect(firstRate.clean).toContain("NOTE: Quoted rates are not valid and no validity can be provided");
    expect(firstRate.clean).not.toContain("Thanking You");
    expect(firstRate.outOfHours).toBe("overnight");

    // The hidden row counts the loop-in note.
    expect(read.hidden).toMatchObject({ autoReplies: 0, loopIns: 1, duplicates: 0, text: "1 'adding a colleague' note hidden" });
    expect(read.hidden.mails[0]).toMatchObject({ noise: "loop_in", sideKey: "flgshipping.net", time: "16:06" });
    expect(read.crossFiled).toEqual([]);

    // The sales person's forward: no new text, one file, on our side.
    expect(internal.mails[0]).toMatchObject({ party: "us", toParty: "internal", clean: "", kind: "substantive" });
    expect(internal.mails[0].from).toMatchObject({ name: "Jittu Jacob", email: "sales7@silverlynxoman.com" });
    expect(internal.mails[0].files.map((f) => f.filename)).toEqual(["DOCS ASL OTM 320348.pdf"]);

    // What the later modules read: the nomination, the complaint (answered), the SO with its file, the shipper.
    const nomination = customer.mails.find((m) => m.clean.includes("here by nominated"));
    expect(nomination).toMatchObject({ party: "customer", time: "15:11", day: "2026-11-05", urgent: true, siblingHint: null });
    expect(nomination?.clean).toContain("PORT TO PORT        :  OMR 339.000");
    expect(proofOf(nomination!, read.today)).toMatchObject({ who: "Fahid (Oman Textiles)", when: "Thu 05 Nov, 15:11" });
    const complaint = customer.mails.find((m) => m.clean.includes("not responding"));
    expect(complaint).toMatchObject({ urgent: true, isRequest: true, isChase: true });
    expect(customer.questions.filter((q) => q.id.startsWith(`q:${complaint!.id}`)).map((q) => [q.sentence, q.answered, q.answeredText])).toEqual([
      ["Kindly check with your team and provide an urgent update on the handover status.", true, "answered Mon 11:15"],
    ]);
    expect(customer.questions.every((q) => q.answered)).toBe(true);
    expect(customer.chase).toMatchObject({ count: 2, urgent: true, unanswered: 0, text: "Asked 2 times since Thu 15:11 · last Mon 09:25 · urgent" });
    expect(customer.promise).toMatchObject({ by: "us", due: "2026-11-10", kept: false, sentence: "We shall update you further once shipper hand over cargo" });

    const so = frontline.mails.find((m) => m.clean.includes("issued S/O"));
    expect(so).toMatchObject({ party: "agent", time: "10:58", isRequest: true });
    expect(so?.files).toEqual([
      { filename: "BOOKING FORM -320348- (1).xls", mime: "application/vnd.ms-excel", size: 30720, storagePath: "2026/11/1a1bf1a77945b7fa/1-BOOKING_FORM_-320348-_1.xls", emailId: so!.id, at: so!.at, from: "Frontline", sideKey: "flgshipping.net", crossFiled: false },
    ]);
    expect(proofOf(so!, read.today, "Agent have received the shipper's booking  and issued S/O to the shipper accordingly.", "BOOKING FORM -320348- (1).xls")).toEqual({
      emailId: so!.id,
      who: "Reena Aneesh (Frontline)",
      when: "Mon 09 Nov, 10:58",
      sentence: "Agent have received the shipper's booking and issued S/O to the shipper accordingly.",
      file: "BOOKING FORM -320348- (1).xls",
    });
    expect(frontline.questions.at(-1)).toMatchObject({ sentence: "Please refer to the following cargo details and confirm to proceed.", answered: true, answeredText: "answered Mon 11:13" });
    expect(frontline.promise).toBeNull();
    expect(read.ctx.shipperAddresses).toEqual(new Set(["ravi@aslchina.net"]));
    expect(read.ctx.requestRecipients?.has("manukrishna@flgshipping.net")).toBe(true);

    // Nothing is filled for the later modules, and the sides wait for their state.
    expect(read.mails.every((m) => !m.cues.length && !m.money.length && !m.milestones.length && m.moneyRole === null)).toBe(true);
    expect(read.sides.every((s) => s.agent === null && s.state.kind === "nothing_pending" && s.state.text === "")).toBe(true);
  });

  it("puts our one request to eight agents on each agent's side", () => {
    const agents = ["consolclub.com", "wwl.cn", "yxcargo.com", "jasclog.com", "sancologistics.com", "wincologistics.com", "oscar.example", "delta.example"];
    const ask = "Dear Team,\n\nPlease advise your best rates for below shipment.\n\nPOL : SHANGHAI\nPOD : SOHAR\nCOMMODITY : TILES\n\nThanks & Regards\nFahad";
    const pricing = { sender_type: "self" as const, from_email: "pricing@silverlynxoman.com", from_name: "Silver Lynx Pricing", subject: "SL262700 LCL FOB SHANGHAI CHINA TO SOHAR OMAN" };

    const separate = agents.map((d, i) => mail({ ...pricing, to_emails: [`rates@${d}`], received_at: new Date(Date.parse(oman("2026-11-05 14:28")) + i * 20_000).toISOString(), body_text: ask }));
    const each = readMails(input(row(), separate));
    expect(each.mails.every((m) => m.scope === "in" && m.toParty === "agent")).toBe(true);
    expect(each.sides.slice(1).map((s) => [s.kind, s.mails.length])).toEqual(agents.map(() => ["agent", 1]));
    expect(each.sides.slice(1).map((s) => s.key).sort()).toEqual([...agents].sort());
    expect(each.sides[2].currentWriter?.email).toMatch(/^rates@/);

    const one = mail({ ...pricing, to_emails: agents.map((d) => `rates@${d}`), received_at: oman("2026-11-05 14:28"), body_text: ask });
    const all = readMails(input(row(), [one]));
    expect(all.mails).toHaveLength(1);
    expect(all.mails[0].sideKey).toBe("consolclub.com");
    expect(all.sides.slice(1).map((s) => s.key)).toEqual(agents);
    expect(all.sides.slice(1).every((s) => s.kind === "agent" && s.mails[0] === all.mails[0])).toBe(true);
    expect(all.sides[1].name).toBe("Console Club");
  });

  it("keys a side by the domain, by the exact address for free mail, and our own notes as internal", () => {
    const ctx = otm({ offerRecipients: new Set(["purchase_otm@omzest.com"]), requestRecipients: new Set(["agent88@gmail.com"]) });
    expect(sideKeyOf(mail({ from_email: "reena@flgshipping.net" }), "agent", null, ctx)).toBe("flgshipping.net");
    expect(sideKeyOf(mail({ from_email: "agent88@gmail.com" }), "agent", null, ctx)).toBe("agent88@gmail.com");
    expect(sideKeyOf(mail({ from_email: "purchase_otm@omzest.com" }), "customer", null, ctx)).toBe("customer");
    expect(sideKeyOf(mail({ ...OURS, to_emails: ["purchase_otm@omzest.com"], cc_emails: ["reena@flgshipping.net"] }), "us", "customer", ctx)).toBe("customer");
    expect(sideKeyOf(mail({ ...OURS, to_emails: ["sales7@silverlynxoman.com", "agent88@gmail.com"] }), "us", "agent", ctx)).toBe("agent88@gmail.com");
    expect(sideKeyOf(mail({ ...OURS, to_emails: ["sales7@silverlynxoman.com"] }), "us", "internal", ctx)).toBe("internal");
    expect(outsideRecipients({ to_emails: ["Reena@FLGshipping.net", "pricing@silverlynxoman.com"], cc_emails: ["reena@flgshipping.net", "x@y.com"] }, "pricing@silverlynxoman.com")).toEqual(["reena@flgshipping.net", "x@y.com"]);
    expect(isFreeMail("gmail.com")).toBe(true);
    expect(isFreeMail("omzest.com")).toBe(false);
    expect(staffOf("operation2@silverlynxoman.com")?.name).toBe("Anwar K. S.");
    expect(staffOf("silverlynxco@gmail.com")?.name).toBe("Ali Hassan");
    expect(staffOf("constructor@silverlynxoman.com")).toBeNull();
    expect(staffOf("reena@flgshipping.net")).toBeNull();
  });

  it("orders the sides and says who a reply goes to when they have not written", () => {
    const enquiryRow = row({ contact_email: "buyer@acme.example", contact_name: "Sara" });
    expect(readMails(input(enquiryRow, [])).sides).toMatchObject([{ key: "customer", mails: [], currentWriter: { name: "Sara", email: "buyer@acme.example" }, lastFromThem: null }]);
    const older = mail({ from_email: "liu@consolclub.com", received_at: oman("2026-11-04 09:00"), body_text: "Rate USD 450/cbm" });
    const newer = mail({ from_email: "ops@wwl.cn", received_at: oman("2026-11-05 09:00"), body_text: "Rate USD 430/cbm" });
    const note = mail({ ...OURS, to_emails: ["pricing@silverlynxoman.com"], received_at: oman("2026-11-06 09:00"), body_text: "Customer called, wants sea only." });
    expect(readMails(input(enquiryRow, [older, note, newer])).sides.map((s) => s.key)).toEqual(["customer", "wwl.cn", "consolclub.com", "internal"]);
  });

  it("counts their chases, lists their questions and notes a holiday at origin", () => {
    const enquiryRow = row({ contact_email: "basil@sterling.example" });
    const from = { from_email: "basil@sterling.example", from_name: "Basil Iqbal" };
    const to = { ...OURS, to_emails: ["basil@sterling.example"] };
    const emails = [
      mail({ ...from, received_at: oman("2026-11-04 16:33"), body_text: "Dear Abdul,\nPlease share the SO." }),
      mail({ ...to, received_at: oman("2026-11-05 09:00"), body_text: "Dear Basil,\nWe are checking with the agent." }),
      mail({ ...from, received_at: oman("2026-11-05 12:00"), body_text: "What's the SO status?" }),
      mail({ ...from, received_at: oman("2026-11-08 10:00"), body_text: "Any update? This is urgent." }),
      mail({ ...to, received_at: oman("2026-11-09 14:08"), body_text: "Noted" }),
      mail({ ...from, received_at: oman("2026-11-09 14:12"), body_text: "Kind reminder. Which vessel is it booked on?" }),
    ];
    const side = readMails(input(enquiryRow, emails)).sides[0];
    expect(side.chase).toMatchObject({ count: 3, since: oman("2026-11-05 12:00"), last: oman("2026-11-09 14:12"), urgent: true, unanswered: 3 });
    expect(side.chase?.text).toBe("Asked 3 times since Thu 12:00 · last Mon 14:12 · urgent");
    expect(side.questions.map((q) => [q.sentence, q.answered])).toEqual([
      ["Please share the SO.", true],
      ["What's the SO status?", false],
      ["Any update?", false],
      ["Kind reminder.", false],
      ["Which vessel is it booked on?", false],
    ]);
    expect(side.questions[0].answeredText).toBe("answered Thu 09:00");
    // Thu 12:00 to Mon 18:00: 6 + 5 (Saturday at half) + 10 + 10 working hours.
    expect(side.questions[1].age.label).toBe("3.1 working days (102 h)");
    // Our "Noted" is an acknowledgement: it answers nothing.
    expect(side.lastFromUs?.kind).toBe("ack");

    const closed = mail({ from_email: "docs@fastlogisticscargo.com", received_at: oman("2026-11-08 09:00"), body_text: "Dear Partner,\nPlease be informed that our office will be closed on 9th Nov and 10th Nov on account of Diwali holiday." });
    const origin = readMails(input(enquiryRow, [closed])).sides[1];
    expect(origin.holiday?.value).toBe("Diwali");
    expect(origin.holiday?.proof.when).toBe("Sun 08 Nov, 09:00");
    expect(readMails(input(enquiryRow, [closed], { now: oman("2026-11-20 09:00") })).sides[1].holiday).toBeNull();
  });

  it("names who sent a reply from the app", () => {
    const sent = mail({ ...OURS, sender_type: "self", from_email: "pricing@silverlynxoman.com", gmail_message_id: "g-app", to_emails: ["buyer@acme.example"], body_text: "Dear Sir, any update on our offer?" });
    const reply = { id: "r1", enquiry_id: "SL262700", reply_to_email_id: null, sent_by: "u1", from_email: "pricing@silverlynxoman.com", to_emails: [], cc_emails: [], subject: "", body_text: "", attachments: [], gmail_message_id: "g-app", gmail_thread_id: "t1", sent_at: sent.received_at };
    expect(readMails(input(row(), [sent], { replies: [reply], profileNames: new Map([["u1", "Sahan"]]) })).mails[0].sentFromApp).toBe("Sahan");
    expect(readMails(input(row(), [sent], { replies: [reply] })).mails[0].sentFromApp).toBe("a colleague");
    expect(readMails(input(row(), [sent])).mails[0].sentFromApp).toBeNull();
  });
});

describe("wrong enquiry", () => {
  const history = (over: Partial<HistoryRow> & Pick<HistoryRow, "reference">): HistoryRow => ({
    id: over.reference, enquiry_date: "2026-11-02", quoted_date: null, confirmed_date: null, status: "new", shipment_mode: "FCL", qty_text: "1X40 HQ",
    pol: "QINGDAO CHINA", pod: "SOHAR OMAN", customer_name: "STERLING SITES", agent_name: null, buy_total: null, sell_total: null, profit: null, ...over,
  });

  it("leaves out a mail whose subject carries another enquiry's reference", () => {
    const enquiryRow = row({ reference: "SL262713", customer_name: "STERLING SITES", confirmed_date: "2026-11-03", quoted_date: "2026-11-02" });
    const so = mail({
      from_email: "liu@consolclub.com", subject: "RE: SL262790 QINGDAO - SOHAR 40 HQ", gmail_thread_id: "t-other", received_at: oman("2026-11-08 10:00"),
      body_text: "Dear Abdul,\nPls find attach SO details.",
      attachments: [{ filename: "KMTCTAO8748592.pdf", mime_type: "application/pdf", size: 81234, storage_path: "p/so.pdf", skipped: null }],
    });
    const ok = mail({ ...OURS, to_emails: ["liu@consolclub.com"], subject: so.subject, gmail_thread_id: "t-other", received_at: oman("2026-11-09 10:00"), body_text: "Dear Liu,\nBL drafts OK." });
    const mine = mail({ from_email: "liu@consolclub.com", subject: "RE: SL262713 QINGDAO - SOHAR 20 OT", received_at: oman("2026-11-09 11:00"), body_text: "Dear Abdul,\nETD is 21-NOV." });

    expect(crossFiledOf(so, enquiryRow, [so, ok], "agent", { row: enquiryRow })).toEqual({ why: "other_reference", looksLike: "SL262790", about: null });
    const read = readMails(input(enquiryRow, [so, ok, mine], { customerHistory: [history({ reference: "SL262790" })] }));
    expect(read.mails.map((m) => m.scope)).toEqual(["in", "cross_filed", "cross_filed"]);
    expect(read.sides.flatMap((s) => s.mails.map((m) => m.id))).toEqual([mine.id]);
    expect(read.mails[2].files[0]).toMatchObject({ filename: "KMTCTAO8748592.pdf", crossFiled: true });
    expect(read.mails[2].isRequest).toBe(false);
    expect(read.crossFiled).toHaveLength(1);
    expect(read.crossFiled[0]).toMatchObject({ looksLike: "SL262790", why: "other_reference", threadIds: ["t-other"], about: "1X40 HQ Qingdao → Sohar", text: "2 e-mails look like SL262790 (1X40 HQ Qingdao → Sohar)" });
    expect(read.crossFiled[0].mails.map((m) => m.id)).toEqual([ok.id, so.id]);
    expect(readMails(input(enquiryRow, [so])).crossFiled[0].text).toBe("1 e-mail looks like SL262790");
  });

  it("keeps a subject that carries this reference and another one, with a warning", () => {
    const enquiryRow = row({ reference: "SL262572" });
    const both = mail({ from_email: "liu@consolclub.com", subject: "RE: SL262572 & SL262573 // 2X40 HC QINGDAO TO SOHAR", body_text: "Both SO released." });
    const read = readMails(input(enquiryRow, [both]));
    expect(read.mails[0]).toMatchObject({ scope: "in", siblingHint: "SL262573", crossFiled: null });
    expect(read.crossFiled).toEqual([]);
  });

  it("takes a contradicting house subject for another enquiry only when it lacks our reference", () => {
    const enquiryRow = row({ reference: "SL262731", customer_name: "SYNERGIES CASTING", contact_email: "purchase@synergies.example", shipment_mode: "LCL", qty_text: "LCL", pol: "SHANGHAI CHINA", pod: "SOHAR OMAN" });
    const air = mail({ from_email: "leo@yxcargo.com", subject: "RE: SL262731 AIR EX-WORKS DANYANG CHINA TO MUSCAT OMAN", gmail_thread_id: "t-air", body_text: "5.4 usd per KG, Airline:Y9" });
    const courier = mail({ from_email: "purchase@synergies.example", subject: "RE: COURIER EX-WORKS UTTENDORF AUSTRIA TO SOHAR OMAN", gmail_thread_id: "t-courier", body_text: "Please proceed with the courier booking." });
    const same = mail({ from_email: "leo@yxcargo.com", subject: "RE: LCL FOB SHANGHAI CHINA TO SOHAR", gmail_thread_id: "t-lcl", body_text: "USD 60/cbm" });
    const read = readMails(input(enquiryRow, [air, courier, same]));
    const scopes = new Map(read.mails.map((m) => [m.id, m]));
    expect(scopes.get(air.id)).toMatchObject({ scope: "in", crossFiled: null });
    expect(scopes.get(same.id)).toMatchObject({ scope: "in", crossFiled: null });
    expect(scopes.get(courier.id)).toMatchObject({ scope: "cross_filed", party: "customer", crossFiled: { why: "contradicts_register", looksLike: null, about: "COURIER Uttendorf Austria → Sohar" } });
    expect(read.sides[0].mails).toHaveLength(0);
    expect(read.crossFiled.map((g) => g.text)).toEqual(["1 e-mail may not belong here (COURIER Uttendorf Austria → Sohar)"]);
  });

  it("leaves out a thread whose subject is the subject of mail filed under another reference", () => {
    const enquiryRow = row({ reference: "SL262731", customer_name: "SYNERGIES CASTING", shipment_mode: "LCL", qty_text: "LCL", pol: "SHANGHAI CHINA", pod: "SOHAR OMAN", quoted_date: "2026-11-04" });
    const yazan = { from_email: "yazan@synergies-oman.example", from_name: "Yazan Al Marzouqi" };
    const toYazan = { ...OURS, to_emails: ["yazan@synergies-oman.example"] };
    const mine = { gmail_thread_id: "t-danyang", subject: "RE: SL262731 // RFQ – Import, Danyang (China) to Sohar – 1 Case / 280 kg / 0.63 CBM", sl_refs: ["SL262731"] };
    const base = "RFQ – Air Import, Uttendorf (Austria) to Sohar – 2 Packages / 265.4 kg – PO04828 & PO04845 – Silver Lynx";
    const bare = { gmail_thread_id: "t-uttendorf", subject: `RE: ${base}`, sl_refs: [] as string[], match_method: "reply" as const };
    const theirs = { gmail_thread_id: "t-sl262810", subject: `RE: SL262810 // ${base}`, sl_refs: ["SL262810"], match_method: "reply" as const };
    const emails = [
      mail({ ...toYazan, ...mine, received_at: oman("2026-11-04 12:04"), body_text: "Dear Sir\n\nPlease find below our offer for Air.\n\nAIR DOOR TO DOOR: OMR 768.000" }),
      mail({ ...yazan, ...bare, subject: base, match_method: "ai", received_at: oman("2026-11-08 09:10"), body_text: "Dear Anwar,\n\nKindly quote for the urgent air shipment below." }),
      mail({ ...yazan, ...bare, sl_refs: ["SL262731"], match_method: "reference", received_at: oman("2026-11-08 09:39"), body_text: "Dear Ashwin,\nThe Danyang shipment (SL262731) is still under internal review.\n\nFor this Uttendorf shipment, please share your best offer, if possible today by 1:00 PM, as it’s urgent." }),
      mail({ ...yazan, ...mine, received_at: oman("2026-11-09 09:59"), body_text: "Dear Anwar,\n\nKind reminder on the below. We are finalizing this shipment today, so appreciate your reply by 12:00 PM if possible." }),
      mail({ ...toYazan, ...mine, received_at: oman("2026-11-09 10:24"), body_text: "Dear Sir,\n\nBelow quoted is our best rate, kindly support with your nomination." }),
      mail({ ...yazan, ...bare, received_at: oman("2026-11-09 11:23"), body_text: "Dear Anwar,\n\nPlease proceed with the courier booking for PO04828, as per your quotation dated 9 Nov 2026 (OMR 75.000 + admin fee at actuals)." }),
      mail({ ...toYazan, ...theirs, received_at: oman("2026-11-09 11:30"), body_text: "Dear Sir\n\nThank you for the confirmation, please share the shipper email id to book the shipment." }),
    ];
    const read = readMails(input(enquiryRow, emails));
    expect(read.mails.map((m) => [m.time, m.scope, m.crossFiled?.looksLike ?? null])).toEqual([
      ["11:30", "cross_filed", "SL262810"],
      ["11:23", "cross_filed", "SL262810"],
      ["10:24", "in", null],
      ["09:59", "in", null],
      ["09:39", "cross_filed", "SL262810"],
      ["09:10", "cross_filed", "SL262810"],
      ["12:04", "in", null],
    ]);
    expect(read.crossFiled).toHaveLength(1);
    expect(read.crossFiled[0]).toMatchObject({ looksLike: "SL262810", why: "other_reference", threadIds: ["t-sl262810", "t-uttendorf"], text: "4 e-mails look like SL262810" });
    // The courier's "please proceed" and its deadline stay out of this enquiry's conversation.
    const customer = read.sides[0];
    expect(customer.mails.map((m) => m.time)).toEqual(["10:24", "09:59", "12:04"]);
    expect(customer.lastFromUs).toMatchObject({ time: "10:24", isRequest: true });
    expect(customer.deadline).toMatchObject({ at: "2026-11-09T12:00+04:00", cleared: true });
    expect(customer.chase).toBeNull();

    // A like subject under our own reference keeps the bare one here; so does the person's choice.
    const own = mail({ ...toYazan, gmail_thread_id: "t-own", subject: `RE: SL262731 // ${base}`, sl_refs: ["SL262731"], body_text: "Dear Sir, noted." });
    expect(readMails(input(enquiryRow, [...emails, own])).mails.filter((m) => m.email.gmail_thread_id === "t-uttendorf").every((m) => m.scope === "in")).toBe(true);
    const kept = readMails(input(enquiryRow, emails, { overrides: { party: {}, keptThreads: ["t-uttendorf"], dismissed: [] } }));
    expect(kept.crossFiled[0].text).toBe("1 e-mail looks like SL262810");
  });

  it("reads what another enquiry's subject is about from the house subject after the customer's own words", () => {
    const enquiryRow = row({ reference: "SL262713", shipment_mode: "FCL", qty_text: "1X20'", pol: "QINGDAO CHINA", pod: "SOHAR OMAN" });
    const other = mail({ from_email: "liu@consolclub.com", subject: "RE: SL262790 QINGDAO - SOHAR 40 HQ -QINGDAO QUANLIN MACHINERY- PO - 26SOM0321 - USD 7700/40HQ// 1X40' QINGDAO CHINA TO SOHAR OMAN", sl_refs: ["SL262790"], gmail_thread_id: "t-o", body_text: "SO attached" });
    expect(readMails(input(enquiryRow, [other])).crossFiled[0]).toMatchObject({ about: "1X40' Qingdao → Sohar", text: "1 e-mail looks like SL262790 (1X40' Qingdao → Sohar)" });
    // An agent's own job numbers before the house subject do not hide a contradiction.
    const air = mail({ from_email: "leo@yxcargo.com", subject: "RE: ENQ1020126007139//ABSOH26110504// AIR EX-WORKS DANYANG CHINA TO MUSCAT OMAN", sl_refs: [], gmail_thread_id: "t-a", body_text: "5.4 usd per KG" });
    expect(readMails(input(enquiryRow, [air])).mails[0].crossFiled).toEqual({ why: "contradicts_register", looksLike: null, about: "AIR Danyang → Muscat" });
  });

  it("greys an unknown sender on a thread that never carries our reference, and nothing the person kept", () => {
    const stranger = mail({ from_email: "sales@unknown.example", subject: "Offer for your tiles", sl_refs: [], gmail_thread_id: "t-x", body_text: "Dear Sir, please find our catalogue." });
    const read = readMails(input(row(), [stranger]));
    expect(read.mails[0]).toMatchObject({ scope: "cross_filed", crossFiled: { why: "unknown_sender", looksLike: null, about: null } });
    expect(read.crossFiled[0].text).toBe("1 e-mail may not belong here");
    // The same sender on a thread where a later subject carries the reference stays.
    const later = mail({ ...OURS, to_emails: ["sales@unknown.example"], subject: "RE: SL262700 // Offer for your tiles", gmail_thread_id: "t-x", body_text: "Dear Sir, noted." });
    expect(readMails(input(row(), [stranger, later])).mails.map((m) => m.scope)).toEqual(["in", "in"]);

    const kept = readMails(input(row(), [stranger], { overrides: { party: {}, keptThreads: ["t-x"], dismissed: [] } }));
    expect(kept.mails[0]).toMatchObject({ scope: "in", crossFiled: null });
    expect(kept.crossFiled).toEqual([]);
    expect(kept.sides[1]).toMatchObject({ key: "unknown.example", kind: "other", name: "unknown.example" });

    const other = mail({ from_email: "liu@consolclub.com", subject: "RE: SL262790 QINGDAO - SOHAR 40 HQ", gmail_thread_id: "t-o", body_text: "SO attached" });
    expect(readMails(input(row(), [other])).mails[0].scope).toBe("cross_filed");
    expect(readMails(input(row(), [other], { overrides: { party: {}, keptThreads: ["t-o"], dismissed: [] } })).mails[0].scope).toBe("in");
    // A mail a person filed here by hand is theirs to judge; one whose text names our reference is ours.
    expect(readMails(input(row(), [{ ...other, match_method: "manual" }])).mails[0].scope).toBe("in");
    expect(readMails(input(row(), [{ ...stranger, sl_refs: ["SL262700"] }])).mails[0].scope).toBe("in");
  });

  it("warns when a customer's mail without a reference names the port of another open enquiry of theirs", () => {
    const enquiryRow = row({ contact_email: "buyer@acme.example", pol: "SHANGHAI CHINA", pod: "SOHAR OMAN" });
    const customerHistory = [
      history({ reference: "SL262810", pol: "HAMBURG GERMANY", pod: "SOHAR OMAN", shipment_mode: "COURIER" }),
      history({ reference: "SL262600", pol: "ROTTERDAM NETHERLANDS", pod: "SOHAR OMAN", status: "confirmed", confirmed_date: "2026-10-01" }),
    ];
    const about = mail({ from_email: "buyer@acme.example", subject: "Courier from Hamburg", gmail_thread_id: "t-u", body_text: "Please proceed." });
    const plain = mail({ from_email: "buyer@acme.example", subject: "Rotterdam shipment and Sohar delivery", gmail_thread_id: "t-h", body_text: "Any update?" });
    const read = readMails(input(enquiryRow, [about, plain], { customerHistory }));
    const hints = new Map(read.mails.map((m) => [m.id, m]));
    expect(hints.get(about.id)).toMatchObject({ scope: "in", siblingHint: "SL262810" });
    expect(hints.get(plain.id)).toMatchObject({ scope: "in", siblingHint: null });
  });
});

describe("clock", () => {
  it("counts working hours on the Oman clock: Saturday at half weight, Friday not at all", () => {
    const a = workingHoursBetween(oman("2026-11-05 15:11"), oman("2026-11-09 09:00"));
    expect(a.working).toBeCloseTo(18.82, 2);
    expect(a.raw).toBeCloseTo(89.82, 2);
    expect(workingHoursBetween(oman("2026-11-05 17:00"), oman("2026-11-08 09:00"))).toEqual({ working: 7, raw: 64 });
    expect(workingHoursBetween(oman("2026-11-05 18:05"), oman("2026-11-07 08:00")).working).toBe(0);
    expect(workingHoursBetween(oman("2026-11-09 09:00"), oman("2026-11-05 15:11"))).toEqual({ working: 0, raw: 0 });
    expect(workingHoursBetween("nonsense", oman("2026-11-05 15:11"))).toEqual({ working: 0, raw: 0 });
  });

  it("labels an age with its working hours and its real hours", () => {
    expect(ageOf(oman("2026-11-09 08:00"), oman("2026-11-09 08:35"))).toEqual({ workingHours: 0.58, rawHours: 0.58, label: "35 min" });
    expect(ageOf(oman("2026-11-05 13:48"), oman("2026-11-06 11:48"))).toEqual({ workingHours: 4.2, rawHours: 22, label: "4 working h (22 h)" });
    expect(ageOf(oman("2026-11-06 17:00"), oman("2026-11-10 13:00"))).toEqual({ workingHours: 30, rawHours: 92, label: "3 working days (92 h)" });
    expect(ageOf(oman("2026-11-08 08:00"), oman("2026-11-09 13:00")).label).toBe("1.5 working days (29 h)");
    expect(ageOf(oman("2026-11-08 08:00"), oman("2026-11-08 18:00")).label).toBe("1 working day (10 h)");
    // A wait that is mostly a night shows the real hours too.
    expect(ageOf(oman("2026-11-05 17:50"), oman("2026-11-06 08:10")).label).toBe("10 working min (14 h)");
    expect(ageOf("", oman("2026-11-08 08:10"))).toEqual({ workingHours: 0, rawHours: 0, label: "0 min" });
  });

  it("says when a mail came in outside working hours", () => {
    expect(outOfHoursOf(oman("2026-11-05 07:11"))).toBe("overnight");
    expect(outOfHoursOf(oman("2026-11-05 18:00"))).toBe("overnight");
    expect(outOfHoursOf(oman("2026-11-05 15:11"))).toBeNull();
    expect(outOfHoursOf(oman("2026-11-06 11:00"))).toBe("weekend");
    expect(outOfHoursOf(oman("2026-11-07 10:01"))).toBe("weekend");
    expect(outOfHoursOf("nonsense")).toBeNull();
  });

  it("knows the fixed reply windows by domain", () => {
    expect(replyWindowFor("wwl.cn")?.text).toBe("Usually writes 05:00–09:00 Oman · weekend Sat–Sun");
    expect(replyWindowFor("consolclub.com")?.text).toBe("Usually writes 05:00–09:00 Oman · weekend Sat–Sun");
    expect(replyWindowFor("avaglobal.in")?.text).toBe("Usually writes 10:00–18:00 Oman");
    expect(replyWindowFor("flgshipping.net")?.text).toBe("Works Oman hours · weekend Fri–Sat");
    expect(replyWindowFor("oneic.com.om")?.text).toBe("Works Oman hours · weekend Fri–Sat");
    expect(replyWindowFor("cdcitalia.it")?.text).toBe("Usually writes after 12:00 Oman · weekend Sat–Sun");
    expect(replyWindowFor("transit.dz")?.text).toBe("Usually writes after 12:00 Oman · weekend Fri–Sat");
    expect(replyWindowFor("omzest.com")).toBeNull();
    expect(replyWindowFor("")).toBeNull();
  });

  it("writes a time the short way within the week", () => {
    expect(shortWhen(oman("2026-11-09 14:12"), "2026-11-09")).toBe("Mon 14:12");
    expect(shortWhen(oman("2026-11-04 16:33"), "2026-11-09")).toBe("Wed 16:33");
    expect(shortWhen(oman("2026-10-28 16:33"), "2026-11-09")).toBe("Wed 28 Oct 16:33");
    expect(shortWhen("nonsense", "2026-11-09")).toBe("");
  });
});

describe("signature images", () => {
  it("drops logos and small images, keeps photos and documents", () => {
    const image = (filename: string, size: number, mime_type = "image/png") => ({ filename, mime_type, size });
    expect(isSignatureImage(image("image001.png", 4_210))).toBe(true);
    expect(isSignatureImage(image("Outlook-abc.png", 51_000))).toBe(true);
    expect(isSignatureImage(image("InsertPic_1A2B.png", 88_000))).toBe(true);
    expect(isSignatureImage(image("logo-footer.jpg", 12 * 1024, "image/jpeg"))).toBe(true);
    expect(isSignatureImage(image("WhatsApp Image 2026-11-04.jpeg", 178 * 1024, "image/jpeg"))).toBe(false);
    expect(isSignatureImage(image("BOOKING FORM -320348- (1).xls", 30_720, "application/vnd.ms-excel"))).toBe(false);
    expect(isSignatureImage(image("small.pdf", 2_000, "application/pdf"))).toBe(false);

    const withLogo = mail({ attachments: [
      { filename: "image001.png", mime_type: "image/png", size: 4_210, storage_path: null, skipped: null },
      { filename: "HPQDOM2611149_BL_DRAFT.pdf", mime_type: "application/pdf", size: 34_909, storage_path: "p/bl.pdf", skipped: null },
    ] });
    expect(readMails(input(row(), [withLogo])).mails[0].files.map((f) => f.filename)).toEqual(["HPQDOM2611149_BL_DRAFT.pdf"]);
  });
});

describe("real mail checks", () => {
  it("cuts an Italian agent's GDPR and printing notice: a loop-in above it asks nothing", () => {
    const text = [
      "Hello,\nAdding @Project Desk",
      "*** RATES TO BE RECONFIRMED AT THE MOMENT OF THE BOOKING!!! ***",
      "Giada Rossi\n\nExport dept.\n\nPh. +39 0331 000000",
      "P Please consider the environment before printing this e-mail",
      "According to article nbr 13 of the EU Regulation 2016/679 (GDPR), we inform you that the personal information in this document are treated by our company. If you have received this message by mistake, you are kindly requested to destroy it.",
    ].join("\n\n");
    const clean = cleanText(body(text));
    expect(clean).not.toMatch(/environment|mistake|GDPR/);
    const r = row();
    const agent = mail({ ...sender("exportsales@sebi.example", "exportsales SEBI"), received_at: oman("2026-11-05 15:29"), body_text: text });
    const read = readMails(input(r, [mail({ ...OURS, to_emails: ["exportsales@sebi.example"], received_at: oman("2026-11-05 14:28"), body_text: "Dear Team,\n\nPlease advise ocean freight quote for the below shipment.\n\nPOL : NEAREST SEAPORT\n\nRegards" }), agent]));
    expect(read.mails.find((m) => m.id === agent.id)?.isRequest).toBe(false);
  });

  it("puts right punctuation a mail program garbled", () => {
    expect(cleanText(body("Please write to Luca Ancona â€“ ancona@agent.example for rates â€™till Friday."))).toBe("Please write to Luca Ancona – ancona@agent.example for rates ’till Friday.");
  });

  it("does not end a sentence at “no.”", () => {
    expect(sentencesOf("Please advise correct no. of wooden boxes & provide dimensions of fitting & pipes.\nOur Office will remain close on 02nd Saturday.")).toEqual([
      "Please advise correct no. of wooden boxes & provide dimensions of fitting & pipes.",
      "Our Office will remain close on 02nd Saturday.",
    ]);
  });

  it("keeps the same words sent to two threads within a minute: one answers each", () => {
    const r = row();
    const words = "Dear Maria,\n\nGohead – and share the forwarder details.\n\nRegards,\n\nAkshay.";
    const other = mail({ ...sender("purchase@hydro.example"), gmail_thread_id: "t-india", subject: "RE: Enquiry- sea freight 40 ft open top India to Sohar", sl_refs: [], received_at: oman("2026-11-05 11:43"), body_text: words });
    const ours = mail({ ...sender("purchase@hydro.example"), gmail_thread_id: "t-italy", received_at: oman("2026-11-05 11:43:46"), body_text: words });
    const read = readMails(input(r, [other, ours]));
    expect(read.mails.map((m) => m.noise)).toEqual([null, null]);
    const repeat = mail({ ...sender("purchase@hydro.example"), gmail_thread_id: "t-italy", received_at: oman("2026-11-05 11:44:30"), body_text: words });
    expect(readMails(input(r, [ours, repeat])).mails.find((m) => m.id === repeat.id)?.noise).toBe("duplicate");
  });

  it("finds no promise of ours due by a day in what waits on the other side first", () => {
    const at = oman("2026-11-09 16:01");
    expect(promiseOf("Once you release the booking confirmation and cargo is loaded share us the BL draft, once received we will arrange the payment.", at)).toBeNull();
    expect(promiseOf("Will share the SO once received from the carrier.", at)).toMatchObject({ due: "2026-11-10" });
  });

  it("reads “please fine below rates” and “please feel free to connect” as no request", () => {
    expect(isRequest("Please fine below rates for the sub shipment")).toBe(false);
    expect(isRequest("I look forward for your valuable booking order & support, please feel free to connect with me in case of any query")).toBe(false);
    expect(isRequest("Can you please share feedback on below quoted rates.")).toBe(true);
  });
});

describe("odd input", () => {
  it("never throws and gives the empty value", () => {
    const nothing = null as never;
    expect(cleanText(nothing)).toBe("");
    expect(signatureTextOf(nothing)).toBe("");
    expect(excerptOf(nothing)).toBe("");
    expect(sentencesOf(nothing)).toEqual([]);
    expect(classifyParty(nothing, nothing)).toBe("other");
    expect(sideKeyOf(nothing, "agent", null, nothing)).toBe("unknown");
    expect(crossFiledOf(nothing, nothing, nothing, "other", nothing)).toBeNull();
    expect(noiseOf(nothing, nothing, nothing)).toBeNull();
    expect(isAck(nothing)).toBe(false);
    expect(isRequest(nothing)).toBe(false);
    expect(promiseOf(nothing, nothing)).toBeNull();
    expect(deadlineOf(nothing, nothing)).toBeNull();
    expect(isSignatureImage(nothing)).toBe(false);
    expect(proofOf(nothing, "2026-11-09")).toEqual({ emailId: "", who: "", when: "", sentence: "" });
    expect(isChase(nothing) || isEscalation(nothing) || isHold(nothing)).toBe(false);
    expect(workingHoursBetween(nothing, nothing)).toEqual({ working: 0, raw: 0 });
    expect(ageOf(nothing, nothing).label).toBe("0 min");
    expect(outOfHoursOf(nothing)).toBeNull();
    expect(replyWindowFor(nothing)).toBeNull();
    expect(agentNameForDomain(nothing, nothing)).toBeNull();
    expect(bounceAddressOf(nothing)).toBeNull();
    expect(staffOf(nothing)).toBeNull();
    expect(outsideRecipients(nothing)).toEqual([]);
    expect(deadlineText(nothing, nothing)).toBe("");
    expect(deadlineText("2026-11-10T18:00+04:00", nothing)).toBe("by 18:00 on Tue 10 Nov");
    expect(shortWhen(oman("2026-11-09 14:12"), nothing)).toBe("Mon 09 Nov 14:12");
    expect(isSignatureImage({} as never)).toBe(false);

    const empty = readMails(nothing);
    expect(empty.mails).toEqual([]);
    expect(empty.sides.map((s) => s.key)).toEqual(["customer"]);

    const odd = mail({ received_at: "not a date", body_text: null, from_email: null, to_emails: null as never, attachments: null as never, subject: null });
    const read = readMails(input(row(), [odd, null as never], { now: "not a date" }));
    expect(read.mails).toHaveLength(1);
    expect(read.mails[0]).toMatchObject({ at: "1970-01-01T00:00:00.000Z", party: "other", clean: "", files: [], kind: "ack" });
    expect(read.today).toBe("1970-01-01");
  });
});
