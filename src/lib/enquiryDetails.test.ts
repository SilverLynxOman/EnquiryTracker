import { describe, expect, it } from "vitest";
import { QUOTE_MARKER } from "./emailDrafts";
import {
  asksForBetterRate,
  buildStages,
  customerMarks,
  customerStats,
  dayWithWeekday,
  emailParty,
  emailSuggestion,
  excerpt,
  isCustomerSender,
  laneStats,
  looksLikeQuote,
  looksLikeRateRequest,
  looksLikeYes,
  newText,
  quoteSpeed,
  readThread,
  whenSent,
} from "./enquiryDetails";
import { enquiry } from "./testFixtures";
import type { EmailMessage, FollowUpRecord, HistoryRow } from "./types";

const TODAY = "2026-11-05"; // a Thursday
const SEASON = "2026-01-01";
const HYDROTEC = { name: "HYDROTEC INTERNATIONAL" };

let seq = 0;
function mail(over: Partial<EmailMessage> & Pick<EmailMessage, "received_at" | "body_text">): EmailMessage {
  seq++;
  return {
    id: `m${seq}`,
    mailbox_id: null,
    gmail_message_id: `g${seq}`,
    gmail_thread_id: "t1",
    sender_type: "external",
    from_email: "someone@example.com",
    from_name: null,
    to_emails: ["pricing@silverlynxoman.com"],
    cc_emails: [],
    subject: "SL262735 1X40 OT(HC) EX-WORKS ITALY TO SOHAR OMAN",
    snippet: null,
    sl_refs: ["SL262735"],
    attachments: [],
    status: "linked",
    classification: "follow_up",
    match_method: "reference",
    confidence: 1,
    summary: null,
    note: null,
    suggested_enquiry_id: null,
    enquiry_id: "e1",
    draft_id: null,
    ...over,
  };
}

function hist(over: Partial<HistoryRow> & Pick<HistoryRow, "id" | "enquiry_date">): HistoryRow {
  return {
    reference: over.id,
    quoted_date: null,
    confirmed_date: null,
    status: over.confirmed_date ? "confirmed" : over.quoted_date ? "quoted" : "new",
    shipment_mode: "FCL",
    qty_text: "1X40'",
    pol: "ITALY",
    pod: "SOHAR OMAN",
    customer_name: "HYDROTEC INTERNATIONAL",
    agent_name: null,
    buy_total: null,
    sell_total: null,
    profit: null,
    ...over,
  };
}

describe("who wrote an e-mail", () => {
  it("knows a customer by the distinctive words or the initials of its name", () => {
    expect(customerMarks("HYDROTEC INTERNATIONAL")).toEqual({ words: ["hydrotec"], initials: [] });
    expect(customerMarks("CONSOLIDATED MARINE SERVICES").initials).toEqual(["cms"]);
    // Legal forms drop out; "CO" counts in one spelling of the initials and not in the other.
    expect(customerMarks("OMAN NATIONAL ENG & INVESTMENT CO (SAOG)")).toEqual({ words: [], initials: ["oneic", "onei"] });
  });

  it("matches the sender's domain, the contact's address or the sender's name", () => {
    expect(isCustomerSender("purchase@hydrotecinternational.com", "Akshay", HYDROTEC)).toBe(true);
    expect(isCustomerSender("logistics@cms-egypt.com", "Heba", { name: "CONSOLIDATED MARINE SERVICES" })).toBe(true);
    expect(isCustomerSender("yousuf@oneic.com.om", null, { name: "OMAN NATIONAL ENG & INVESTMENT CO (SAOG)" })).toBe(true);
    expect(isCustomerSender("someone@gmail.com", "WHITEROCKUNITED OMAN", { name: "WHITE ROCK UNITED LLC" })).toBe(true);
    expect(isCustomerSender("ops@gmail.com", "Ops", { name: "ANY CO", contactEmail: "ops@gmail.com" })).toBe(true);
    expect(isCustomerSender("b@acme.com", null, { name: "SOMETHING ELSE", contactEmail: "a@acme.com" })).toBe(true);
  });

  it("does not take an agent, a free-mail domain or a common word for the customer", () => {
    expect(isCustomerSender("alessia.dotelli@cdcitalia.it", "Alessia Dotelli - CDC Italia", HYDROTEC)).toBe(false);
    expect(isCustomerSender("someone@gmail.com", "Someone", HYDROTEC)).toBe(false);
    // OMAN and NATIONAL are too common to recognise a customer by.
    expect(isCustomerSender("rates@omanshipping.com", null, { name: "OMAN NATIONAL TRADING" })).toBe(false);
    expect(isCustomerSender(null, null, HYDROTEC)).toBe(false);
  });

  it("puts our own mail on our side whatever the address", () => {
    expect(emailParty({ sender_type: "self", from_email: "pricing@silverlynxoman.com", from_name: null }, HYDROTEC)).toBe("us");
    expect(emailParty({ sender_type: "staff", from_email: "pricing1@silverlynxoman.com", from_name: "Fahad" }, HYDROTEC)).toBe("us");
    expect(emailParty({ sender_type: "external", from_email: "luca@gallianosrl.it", from_name: "Luca" }, HYDROTEC)).toBe("other");
  });
});

describe("what an e-mail says", () => {
  it("reads only what the sender wrote: no quoted history, no signature", () => {
    const body = `Dear Maria,\n\nGohead – and share the forwarder details.\n\nRegards,\nAkshay.\nPurchase dept.\n${QUOTE_MARKER}\nFrom: Pricing … DOOR TO DOOR : OMR 5012/40 OT HC`;
    expect(newText({ body_text: body, snippet: null })).toBe("Dear Maria,\n\nGohead – and share the forwarder details.");
  });

  it("keeps a first line that starts with thanks", () => {
    const body = "Dear Sir,\nMany thanks for the below enquiry, please find our quote for your kind reference :\nDOOR TO DOOR : OMR 2596/40 HC\nBest Regards.......*?*\nMaria";
    expect(newText({ body_text: body, snippet: null })).toContain("DOOR TO DOOR : OMR 2596/40 HC");
  });

  it("makes a one-line excerpt without the greeting", () => {
    expect(excerpt("Dear Maria,\n\nGohead – and share the forwarder details.")).toBe("Gohead – and share the forwarder details.");
    expect(excerpt("Dear sir\nGood day\nPls find below our best offer")).toBe("Pls find below our best offer");
    expect(excerpt("word ".repeat(80), 30)).toBe("word word word word word…");
  });

  it("recognises a quote: a price in rials and the words of an offer", () => {
    expect(looksLikeQuote("Please find below our offer.\nAIR DOOR TO DOOR: OMR 568.000\nPOL : EGYPT")).toBe(true);
    expect(looksLikeQuote("Pls find belowour best offer\nDOOR TO DOOR : OMR 552.000 BASED ON CW 140 KGS")).toBe(true);
    expect(looksLikeQuote("please find our quote for your kind reference :\nDOOR TO SOHAR PORT : OMR 1312/20 GP")).toBe(true);
    expect(looksLikeQuote("Resenting…\nAIR DOOR TO DOOR: OMR 4900.000")).toBe(true);
  });

  it("does not take a target or a booking instruction to an agent for a quote", () => {
    expect(looksLikeQuote("Dear Manu\nPlease support for below.\nOCEAN FREIGHT : OMR 285/- All in for 6 CBM")).toBe(false);
    expect(looksLikeQuote("Dear ALI\nPlease proceed this shipment\nAgreed rate OMR 4.5/KG CW 16 KGS")).toBe(false);
    expect(looksLikeQuote("customer TARGET is USD 10500 ALL IN including ocean freight")).toBe(false);
  });

  it("recognises a request for rates", () => {
    expect(looksLikeRateRequest("Dear Team,\nPlease advise ocean freight quote for the below shipment on EX-WORKS TERMS")).toBe(true);
    expect(looksLikeRateRequest("Can you please share the quote for 1X40 OT")).toBe(true);
    expect(looksLikeRateRequest("Please quote from Salalah port with confirm inventory.")).toBe(true);
    expect(looksLikeRateRequest("Dear Vinod, Awaiting quote for the below shipment.")).toBe(true);
    expect(looksLikeRateRequest("Many thanks for the below confirmation. Will share you agent's details shortly.")).toBe(false);
  });

  it("recognises a customer's yes", () => {
    expect(looksLikeYes("Dear Maria,\n\nGohead – and share the forwarder details. Request you to please re check again.")).toBe(true);
    expect(looksLikeYes("Dear Mr. Ashwin,\nIt is approved.")).toBe(true);
    expect(looksLikeYes("Confirmed.")).toBe(true);
    expect(looksLikeYes("Please proceed with this shipment through COURIER DOOR TO DOOR: OMR 105.000")).toBe(true);
    expect(looksLikeYes("Dear Fahad , Please proceed and share BL copy as soon as possible .")).toBe(true);
  });

  it("does not take a question, a condition or an acknowledgement for a yes", () => {
    expect(looksLikeYes("Is that shipment still ready to go ? Can we try to book with Hapag Lloyd and go ahead ?")).toBe(false);
    expect(looksLikeYes("ETA Sohar is not yet updated by the carrier, will update once confirmed.")).toBe(false);
    expect(looksLikeYes("RATES TO BE RECONFIRMED AT THE MOMENT OF THE BOOKING!!!")).toBe(false);
    expect(looksLikeYes("We confirm receipt of your quote and will revert.")).toBe(false);
    expect(looksLikeYes("Please share your best rate for 2X40.")).toBe(false);
  });

  it("notices a request for a better rate", () => {
    expect(asksForBetterRate("offer us a more competitive rate or apply a discount to the quoted price")).toBe(true);
    expect(asksForBetterRate("Gohead – and share the forwarder details.")).toBe(false);
  });
});

describe("the e-mail thread", () => {
  const enquiryMail = mail({
    received_at: "2026-11-01T04:29:00Z",
    from_email: "purchase@hydrotecinternational.com",
    from_name: "Akshay",
    body_text: "Dear Maria,\nCan you please quote your offer along with delivery time for 1x 20' HC OT.",
  });
  const rateRequest = mail({
    received_at: "2026-11-05T10:28:00Z",
    sender_type: "staff",
    from_email: "pricing1@silverlynxoman.com",
    from_name: "Mr.Fahad",
    to_emails: ["luca@gallianosrl.it"],
    body_text: "Dear Team,\nPlease advise ocean freight quote for the below shipment on EX-WORKS TERMS.\nThanks\nFahad",
  });
  const agentRate = mail({
    received_at: "2026-11-05T10:49:00Z",
    from_email: "alessia.dotelli@cdcitalia.it",
    from_name: "Alessia Dotelli - CDC Italia",
    body_text: "Dear Maria\nHere it is:\nFm EXW Nembro (BG) to CFR Sohar Usd 13.700/40 OT HC\nVGM Usd 95/cntr\nCARRIER: HL fm Genoa",
  });
  const internal = mail({
    received_at: "2026-11-05T09:00:00Z",
    sender_type: "staff",
    from_email: "sales3@silverlynxoman.com",
    to_emails: ["pricing@silverlynxoman.com"],
    body_text: "Please find below our offer. DOOR TO DOOR : OMR 5012",
  });
  const yes = mail({
    received_at: "2026-11-05T07:43:00Z",
    from_email: "purchase@hydrotecinternational.com",
    from_name: "Akshay",
    body_text: `Dear Maria,\nGohead – and share the forwarder details. Request you to please re check again and offer us a more competitive rate or apply a discount to the quoted price.\nRegards,\nAkshay.\n${QUOTE_MARKER}\nFrom: Pricing`,
  });

  it("lists the e-mails newest first with who wrote them and what they look like", () => {
    const thread = readThread([enquiryMail, rateRequest, agentRate, internal, yes], HYDROTEC);
    expect(thread.map((t) => [t.email.id, t.party, t.cue])).toEqual([
      [agentRate.id, "other", "rate"],
      [rateRequest.id, "us", "rate_request"],
      [internal.id, "us", null], // between colleagues: not a quote to anyone outside
      [yes.id, "customer", "yes"],
      [enquiryMail.id, "customer", null],
    ]);
    expect(thread[3].day).toBe("2026-11-05");
    expect(thread[3].excerpt).toBe(
      "Gohead – and share the forwarder details. Request you to please re check again and offer us a more competitive rate or apply a discount to the quoted price.",
    );
  });

  it("suggests confirming when the customer said yes after the quote, and notes a request for a better rate", () => {
    const row = enquiry({ reference: "SL262735", enquiry_date: "2026-11-01", quoted_date: "2026-11-02" });
    const s = emailSuggestion(row, readThread([enquiryMail, yes, agentRate], HYDROTEC));
    expect(s).toMatchObject({ kind: "confirm", date: "2026-11-05", betterRate: true });
    expect(s?.item.email.id).toBe(yes.id);
  });

  it("ignores a yes from before the quote, and anyone's yes but the customer's", () => {
    const row = enquiry({ reference: "SL262735", enquiry_date: "2026-11-01", quoted_date: "2026-11-06" });
    expect(emailSuggestion(row, readThread([yes], HYDROTEC))).toBeNull();
    const agentYes = mail({ received_at: "2026-11-05T08:00:00Z", from_email: "x@cdcitalia.it", body_text: "Please proceed with the booking." });
    const quoted = enquiry({ reference: "SL262735", enquiry_date: "2026-11-01", quoted_date: "2026-11-02" });
    expect(emailSuggestion(quoted, readThread([agentYes], HYDROTEC))).toBeNull();
  });

  it("suggests marking quoted on the day the first quote went to the customer", () => {
    const quote = (at: string, amount: string) =>
      mail({
        received_at: at,
        sender_type: "staff",
        from_email: "sales7@silverlynxoman.com",
        to_emails: ["yousuf@oneic.com.om"],
        body_text: `Dear sir\nGood day\nPls find below our best offer\nDOOR TO DOOR : OMR ${amount} BASED ON CW 140 KGS`,
      });
    const row = enquiry({ reference: "SL262780", enquiry_date: "2026-11-04" });
    const customer = { name: "OMAN NATIONAL ENG & INVESTMENT CO (SAOG)" };
    const early = quote("2026-11-03T08:00:00Z", "600.000"); // a day before the enquiry: an older conversation
    const first = quote("2026-11-05T09:45:00Z", "552.000");
    const revised = quote("2026-11-06T05:00:00Z", "540.000");
    const s = emailSuggestion(row, readThread([early, first, revised], customer));
    expect(s).toMatchObject({ kind: "mark_quoted", date: "2026-11-05" });
    expect(s?.item.email.id).toBe(first.id);
    expect(s?.item.excerpt).toBe("Pls find below our best offer DOOR TO DOOR : OMR 552.000 BASED ON CW 140 KGS");
  });

  it("suggests nothing for a confirmed or closed enquiry", () => {
    const row = enquiry({ reference: "SL1", enquiry_date: "2026-11-01", quoted_date: "2026-11-02", confirmed_date: "2026-11-03" });
    expect(emailSuggestion(row, readThread([yes], HYDROTEC))).toBeNull();
  });
});

describe("the progress line", () => {
  it("names the weekday, and the year only when it isn't this one", () => {
    expect(dayWithWeekday("2026-11-01", TODAY)).toBe("Sun 01 Nov");
    expect(dayWithWeekday("2025-12-20", TODAY)).toBe("Sat 20 Dec 2025");
    // 21:30 UTC is past midnight in Muscat.
    expect(whenSent("2026-11-04T21:30:00Z", TODAY)).toBe("Thu 05 Nov, 01:30");
  });

  it("measures the quote against the end of the next working day", () => {
    expect(quoteSpeed({ enquiry_date: "2026-11-01", quoted_date: "2026-11-01" })).toEqual({ text: "The same day", quick: true });
    // Thursday to Sunday: Friday and Saturday are the weekend.
    expect(quoteSpeed({ enquiry_date: "2026-10-29", quoted_date: "2026-11-01" })).toEqual({ text: "By the next working day", quick: true });
    expect(quoteSpeed({ enquiry_date: "2026-11-01", quoted_date: "2026-11-04" })).toEqual({ text: "3 days after the enquiry", quick: false });
    expect(quoteSpeed({ enquiry_date: "2026-11-01", quoted_date: null })).toBeNull();
  });

  it("shows when a waiting enquiry's quote is due", () => {
    const stages = (enquiry_date: string) => buildStages(enquiry({ reference: "SL1", enquiry_date }), [], TODAY);
    expect(stages("2026-11-05")[1]).toMatchObject({ state: "current", note: "Due by the end of 08 Nov", tone: null });
    expect(stages("2026-11-04")[1]).toMatchObject({ note: "Due by the end of today", tone: "warn" });
    expect(stages("2026-11-02")[1]).toMatchObject({ note: "Overdue since 04 Nov", tone: "bad" });
    expect(stages("2026-11-02").map((s) => s.state)).toEqual(["done", "current", "todo", "todo"]);
  });

  it("counts the wait and the follow-ups of an open quote", () => {
    const chases: FollowUpRecord[] = [
      { enquiry_id: "SL1", sales_person_id: "s1", followed_up_on: "2026-10-20" },
      { enquiry_id: "SL1", sales_person_id: "s2", followed_up_on: "2026-10-27" },
    ];
    const row = enquiry({ reference: "SL1", enquiry_date: "2026-10-15", quoted_date: "2026-10-16", source: "import" });
    const [received, quoted, chased, outcome] = buildStages(row, chases, TODAY);
    expect(received).toMatchObject({ date: "2026-10-15", note: "From the Excel register" });
    expect(quoted).toMatchObject({ state: "done", note: "By the next working day", tone: "good" });
    expect(chased).toMatchObject({ label: "Waiting 20 days", state: "current", note: "2 follow-ups, last 27 Oct", tone: "warn" });
    expect(outcome).toMatchObject({ state: "todo", label: "Won or lost" });
  });

  it("closes the line with the confirmation or the reason it was lost", () => {
    const won = enquiry({ reference: "SL1", enquiry_date: "2026-11-01", quoted_date: "2026-11-02", confirmed_date: "2026-11-05" });
    expect(buildStages(won, [], TODAY)[3]).toMatchObject({ state: "done", label: "Job confirmed", note: "3 days after the quote", tone: "good" });
    expect(buildStages(won, [], TODAY)[2]).toMatchObject({ state: "todo", note: "None logged" });
    const lost = enquiry({ reference: "SL2", enquiry_date: "2026-05-03", quoted_date: "2026-05-05", status: "lost", closure: "lost", closure_reason: "Rate not competitive" });
    expect(buildStages(lost, [], TODAY)[3]).toMatchObject({ state: "closed", label: "Lost", note: "Rate not competitive" });
    const cancelled = enquiry({ reference: "SL3", enquiry_date: "2026-05-03", status: "cancelled", closure: "cancelled" });
    expect(buildStages(cancelled, [], TODAY).map((s) => [s.state, s.note])).toEqual([
      ["done", "Entered in the app"],
      ["todo", "Never quoted"],
      ["todo", "None logged"],
      ["closed", "No reason recorded"],
    ]);
  });
});

describe("the customer's record", () => {
  const rows = [
    hist({ id: "now", enquiry_date: "2026-11-01", quoted_date: "2026-11-02" }),
    hist({ id: "w1", enquiry_date: "2026-10-24", quoted_date: "2026-10-24", confirmed_date: "2026-10-26", sell_total: 1813, profit: 358 }),
    hist({ id: "w2", enquiry_date: "2026-07-05", quoted_date: "2026-07-06", confirmed_date: "2026-07-08", sell_total: 5894, profit: 793 }),
    hist({ id: "w3", enquiry_date: "2026-02-04", quoted_date: "2026-02-04", confirmed_date: "2026-02-05", sell_total: 6140, profit: 690 }),
    hist({ id: "q1", enquiry_date: "2026-10-24", quoted_date: "2026-10-24" }), // 12 days ago
    hist({ id: "q2", enquiry_date: "2026-05-03", quoted_date: "2026-05-05" }), // long ago
    hist({ id: "n1", enquiry_date: "2026-11-04" }),
    hist({ id: "c1", enquiry_date: "2026-09-01", status: "cancelled" }),
    hist({ id: "old", enquiry_date: "2025-12-20", quoted_date: "2025-12-20", confirmed_date: "2026-01-10", sell_total: 999, profit: 99 }),
  ];

  it("adds up this year's enquiries and wins, and finds the usual time to confirm", () => {
    const s = customerStats(rows, "now", SEASON, TODAY);
    // Days from quote to confirmation: 2, 2 and 1.
    expect(s).toMatchObject({ enquiries: 7, won: 3, sold: 1813 + 5894 + 6140, profit: 358 + 793 + 690, usualDays: 2 });
    // The latest win of any year, other than this enquiry.
    expect(s.lastWin?.id).toBe("w1");
    expect(s).toMatchObject({ awaiting: 1, quoted: 2, stale: 1 });
  });

  it("gives no usual time from fewer than 3 wins", () => {
    expect(customerStats(rows.slice(0, 3), "now", SEASON, TODAY).usualDays).toBeNull();
  });
});

describe("the lane's history", () => {
  it("counts the other enquiries on the lane in the same mode, and lists the latest wins with prices", () => {
    const rows = [
      hist({ id: "now", enquiry_date: "2026-11-01", quoted_date: "2026-11-02" }),
      hist({ id: "a", enquiry_date: "2026-10-13", confirmed_date: "2026-10-27", buy_total: 6436, sell_total: 7332, profit: 896 }),
      hist({ id: "b", enquiry_date: "2026-06-11", confirmed_date: "2026-07-01", buy_total: 10621, sell_total: 10881, profit: 260 }),
      hist({ id: "c", enquiry_date: "2026-02-04", confirmed_date: "2026-02-05", buy_total: 5450, sell_total: 6140, profit: 690 }),
      hist({ id: "d", enquiry_date: "2026-09-20", quoted_date: "2026-09-21" }),
      hist({ id: "lcl", enquiry_date: "2026-07-01", confirmed_date: "2026-07-05", shipment_mode: "LCL" }),
      hist({ id: "x", enquiry_date: "2026-08-01", status: "cancelled" }),
      hist({ id: "y", enquiry_date: "2025-11-01", confirmed_date: "2025-11-03" }),
    ];
    const s = laneStats(rows, { id: "now", shipment_mode: "FCL" }, SEASON, 2);
    expect(s).toMatchObject({ enquiries: 4, won: 3, open: 1 });
    expect(s.wins.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
