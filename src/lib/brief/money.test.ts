import { describe, expect, it } from "vitest";
import { QUOTE_MARKER } from "../emailDrafts";
import { enquiry } from "../testFixtures";
import type { EnquiryRow, HistoryRow } from "../types";
import {
  agentsSummaryOf,
  agreedBuy,
  assignMoney,
  basisOf,
  carrierOf,
  currencyClash,
  equipmentOf,
  freeDaysOf,
  isApproximate,
  laneBenchmark,
  marginOf,
  moneyTokens,
  negotiationTrail,
  offerDependsOn,
  offerFigureOf,
  readAgentRates,
  readOffer,
  readTargets,
  registerMoneyOf,
  toOmr,
  toUsd,
  transitOf,
  validityOf,
} from "./money";
import { readMails } from "./read";
import { input, mail, oman, row, sl262784 } from "./testkit";
import type { BriefInput, MailInput, MoneyToken } from "./types";

/** Everything the money readers give for one enquiry, read in the order the page reads it. */
function money(enquiryRow: EnquiryRow, emails: MailInput[], over: Partial<BriefInput> = {}) {
  const briefInput = input(enquiryRow, emails, over);
  const read = readMails(briefInput);
  assignMoney(read.mails, enquiryRow);
  const offer = readOffer(read.mails, enquiryRow);
  const rates = readAgentRates(read.sides, read.mails, enquiryRow, briefInput.now);
  const buy = agreedBuy(read.mails, rates, enquiryRow, offer?.basis ?? null);
  const clash = currencyClash(read.mails);
  const margin = marginOf(offer, buy, rates.find((r) => r.lowestOnFile) ?? null, enquiryRow, clash);
  const trail = negotiationTrail(read.mails, offer, buy);
  const byId = (id: string) => read.mails.find((m) => m.id === id);
  return { read, offer, rates, buy, clash, margin, trail, targets: readTargets(read.mails), summary: agentsSummaryOf(read.sides, rates, read.today), byId };
}

const brief = (tokens: MoneyToken[]) => tokens.map((t) => [t.currency, t.amount, t.unit]);

const ANWAR = { sender_type: "staff" as const, from_email: "operation2@silverlynxoman.com", from_name: "Anwar" };
const ASHWIN = { sender_type: "staff" as const, from_email: "operation@silverlynxoman.com", from_name: "Ashwin luiz" };
const MARIA = { sender_type: "self" as const, from_email: "pricing@silverlynxoman.com", from_name: "Silver Lynx Pricing" };
const SIGN_OFF = "Thanks & Regards\n\nAnwar K. S.\n\nM: +968 9000 0102";

describe("money tokens", () => {
  it("reads the amount whatever the spelling of the figure", () => {
    expect(moneyTokens("PORT TO PORT        :  OMR 359.000")).toMatchObject([{ currency: "OMR", amount: 359, raw: "OMR 359.000", unit: null, label: "PORT TO PORT", soft: false, index: 23 }]);
    expect(moneyTokens("OCEAN FREIGHT : OMR  285/- All in for\n6 CBM")).toMatchObject([{ currency: "OMR", amount: 285, raw: "OMR 285/-", unit: null, allIn: true, label: "OCEAN FREIGHT" }]);
    expect(brief(moneyTokens("Fm EXW Nembro (BG) to CFR Sohar                   Usd 13.700/40 OT HC"))).toEqual([["USD", 13700, "/40 OT HC"]]);
    expect(brief(moneyTokens("With MSK door to Sohar:€8995/40 OTHC IG."))).toEqual([["EUR", 8995, "/40 OTHC"]]);
    expect(brief(moneyTokens("Total 758.500 OMR"))).toEqual([["OMR", 758.5, null]]);
    expect(brief(moneyTokens("USD 980.00/- (OMR 376.00/-)"))).toEqual([["USD", 980, null], ["OMR", 376, null]]);
    expect(brief(moneyTokens("ZAR 4 000 all in"))).toEqual([["ZAR", 4000, null]]);
    expect(brief(moneyTokens("USD 4,161 and Rs. 12,500 and RO 58.346 and US$ 1,250.50 and 40USD"))).toEqual([
      ["USD", 4161, null],
      ["INR", 12500, null],
      ["OMR", 58.346, null],
      ["USD", 1250.5, null],
      ["USD", 40, null],
    ]);
    expect(brief(moneyTokens("EUR 1.234,50 or EUR 1,25 or 8995€"))).toEqual([["EUR", 1234.5, null], ["EUR", 1.25, null], ["EUR", 8995, null]]);
  });

  it("drops liability clauses, fines, exchange rates, weight breaks, zero amounts and addresses", () => {
    for (const text of [
      "Our liability is limited to EUR 1,25 million per damage claim",
      "TEHERAN-RO 507, GANGNAM-GU, SEOUL",
      "Misdeclaration leads to fines of USD30,000~USD100000 per container",
      "$0.50 cents per pound or $250 maximum liability",
      "EXCHANGE RATE : USD @ 0.386 OMR",
      "1 USD = QAR 3.65",
      "IATA Rate: 1.00 USD = 16.20 ZAR",
      "+100kg +300kg +500kg USD 4.58 4.43 4.36",
      "Additional BAF USD 0",
      "<mailto:$purchase@x.com>",
      "Container deposit 20'/RO 300/- 40'/RO 600/-",
      "2 RO-RO units from Jebel Ali",
      // An agent's standing notice in their own language: a fee for changing the papers, a customs filing fee.
      "1.目的国规定:去往中东、红海地区，请在提供补料时注明8位数HS CODE,如有多个品名的，请对应地提供商编，否则会有改单费RMB500/BILL!",
      "2.根据2026年阿拉伯联合酋长国国家规定，所有运往或途经阿联酋的货物必须强制申报MPCI(海运预装载货物信息申报制度),船司将对货物收取MPCI申报费USD35/BL.请知悉。",
    ]) {
      expect(moneyTokens(text), text).toEqual([]);
    }
  });

  it("reads each item of a line that prices several under its own label", () => {
    const labels = (text: string) => moneyTokens(text).map((t) => [t.amount, t.unit, t.label]);
    // The unit written with one amount is not the next one's label.
    expect(labels("O/F: 6100USD/20GP+PS 25USD/CNTR+EXW 750USD/20GP")).toEqual([
      [6100, "/20 GP", "O/F"],
      [25, "/cntr", null],
      [750, "/20 GP", "EXW"],
    ]);
    expect(labels("EXW Rate：O/F：USD7150/40HQ，Truck Fee：USD210，POL Charge：USD480，Customs clearance fees：USD50/BL，Total：USD7890.")).toEqual([
      [7150, "/40 HQ", "EXW Rate：O/F"],
      [210, null, "Truck Fee"],
      [480, null, "POL Charge"],
      [50, "/bl", "Customs clearance fees"],
      [7890, null, "Total"],
    ]);
    // A name that ends in "fee" needs no colon.
    expect(labels("LCL handing fee OMR 12 w/m")).toEqual([[12, "/w/m", "LCL handing fee"]]);
  });

  it("keeps a rate per kilo, a multiplier and a rate beside its weight break", () => {
    expect(moneyTokens("Agreed rate\n\nOMR 2.6/KG CW 61 KGS")).toMatchObject([{ currency: "OMR", amount: 2.6, unit: "/kg", multiplier: null }]);
    expect(moneyTokens("Palletization USD 60 x 7 PALLET")).toMatchObject([{ currency: "USD", amount: 60, unit: "/pallet", multiplier: 7, label: "Palletization" }]);
    expect(moneyTokens("Air freight: 5.4 usd per KG(+100KG general pallets cargo）")).toMatchObject([{ currency: "USD", amount: 5.4, unit: "/kg", label: "Air freight" }]);
    expect(brief(moneyTokens("Freight: OMR 1.080 /kg  +100 kg  GCR KWI\nAWB/HAWB: OMR 13.00\nUSD 5.14 / PER KG\nBL Fee Usd.80 x set\nVGM Usd 95/cntr"))).toEqual([
      ["OMR", 1.08, "/kg"],
      ["OMR", 13, null],
      ["USD", 5.14, "/kg"],
      ["USD", 80, "/set"],
      ["USD", 95, "/cntr"],
    ]);
  });

  it("gives a bare figure the rial only in our own quote, on a line that names a charge", () => {
    const quote = "Custom Clearance : 25\nTransportation To Ghala : 150\nTransit Time : 35\nFree Time : 14\nGrand total : 99999";
    expect(moneyTokens(quote)).toEqual([]);
    expect(moneyTokens(quote, { ourQuote: true })).toMatchObject([
      { currency: "OMR", amount: 25, label: "Custom Clearance", raw: "25" },
      { currency: "OMR", amount: 150, label: "Transportation To Ghala" },
    ]);
    expect(brief(moneyTokens("SEA FOB\n\nPORT TO PORT : 359.000\nDOOR TO DOOR : OMR 768.000", { ourQuote: true }))).toEqual([["OMR", 359, null], ["OMR", 768, null]]);
  });

  it("marks what is not a firm price: at actuals, approximate, if requested, free time", () => {
    expect(moneyTokens("CFS CHARGES      : AT ACTUALS")).toEqual([]);
    expect(moneyTokens("Approx Oman aviation charge : OMR 44")).toMatchObject([{ amount: 44, soft: true, label: "Approx Oman aviation charge" }]);
    expect(moneyTokens("ADMIN FEE : OMR 10-13 (AT ACTUALS)")).toMatchObject([{ amount: 10, soft: true }]);
    expect(moneyTokens("VGM (if requested) Usd.100/cnt")).toMatchObject([{ amount: 100, unit: "/cntr", soft: true }]);
    expect(moneyTokens("3 days free time at POD granted + 7 days Usd.480")).toMatchObject([{ amount: 480, soft: true }]);
    // Softness belongs to the amount it stands beside, not to the whole line.
    expect(moneyTokens("as per your quotation (OMR 768.000 door to door + Oman aviation charges at actuals, approx. OMR 44)").map((t) => [t.amount, t.soft])).toEqual([
      [768, false],
      [44, true],
    ]);
  });

  it("converts through the dollar and knows which rates move", () => {
    expect(toUsd(471, "OMR")).toBeCloseTo(1224.6);
    expect(toOmr(7000, "USD")).toBeCloseTo(2692.31, 2);
    expect(toUsd(8995, "EUR")).toBeCloseTo(9714.6);
    expect([isApproximate("EUR"), isApproximate("INR"), isApproximate("OMR"), isApproximate("AED"), isApproximate("USD")]).toEqual([true, true, false, false, false]);
  });

  it("returns the empty value on odd input and never throws", () => {
    const odd = [null, undefined, 42, {}, ""] as unknown as string[];
    for (const value of odd) {
      expect(moneyTokens(value)).toEqual([]);
      expect(validityOf(value, value, true)).toBeNull();
      expect(transitOf(value)).toBeNull();
      expect(freeDaysOf(value)).toBeNull();
      expect(carrierOf(value)).toBeNull();
      expect(equipmentOf(value)).toBeNull();
      expect(basisOf(value)).toBeNull();
    }
    const nothing = null as unknown as never;
    expect(() => assignMoney(nothing, nothing)).not.toThrow();
    expect(readOffer(nothing, nothing)).toBeNull();
    expect(readAgentRates(nothing, nothing, nothing, nothing)).toEqual([]);
    expect(agreedBuy(nothing, nothing, nothing, null)).toBeNull();
    expect(readTargets(nothing)).toEqual([]);
    expect(currencyClash(nothing)).toBeNull();
    expect(negotiationTrail(nothing, null, null)).toEqual({ points: [], sentence: null });
    expect(marginOf(null, null, null, nothing, null)).toMatchObject({ figure: null, why: "Needs an offer and an agreed buy", source: "mail" });
    expect(registerMoneyOf(nothing, null, null, nothing)).toEqual({ hasRates: false, missingText: null, differs: null, slip: null, prefill: null });
    expect(laneBenchmark(nothing, nothing)).toBeNull();
    expect(agentsSummaryOf(nothing, nothing, nothing)).toMatchObject({ writtenTo: null, text: "" });
    // A mail with no body, no addresses and no date.
    const bare = mail({ body_text: null, from_email: null, to_emails: [], received_at: "not a date" });
    const read = readMails(input(row(), [bare]));
    expect(() => assignMoney(read.mails, row())).not.toThrow();
    expect(readOffer(read.mails, row())).toBeNull();
  });
});

describe("offer, rates, margin", () => {
  it("reads the offer of SL262784 from three mails, and the customer's nomination as its acceptance", () => {
    const { row: enquiryRow, emails } = sl262784();
    const { offer, read, byId } = money(enquiryRow, emails);
    expect(offer).toMatchObject({
      total: 471, currency: "OMR", twin: "≈ USD 1,225 at 2.6", linesText: "339 port to port + 132 LCL & DO", scope: "port to port",
      final: true, revised: false, transit: "35 days", freeDays: null, validUntil: null, validityStated: false,
      basis: { cbm: 6, packages: 41, chargeableKg: null, text: "6 cbm · 41 packages" },
      sentAt: oman("2026-11-05 09:37"), sentTo: ["purchase_otm@omzest.com", "raghavan_otm@omzest.com"], fromQuotedHistory: false,
    });
    expect(offer?.sentBy.name).toBe("Anwar K. S.");
    expect(offer?.lines.map((l) => [l.label, l.amount, l.main, l.soft, l.softText])).toEqual([
      ["Port to port", 339, true, false, null],
      ["LCL & DO", 132, false, false, null],
      ["CFS", null, false, true, "at actuals"],
    ]);
    expect(offer?.proof).toEqual({ emailId: "sl84-07", who: "Anwar K. S.", when: "Thu 05 Nov, 09:37", sentence: "PORT TO PORT : OMR 339.000" });
    expect(offer?.earlier.map((e) => [e.amount, e.proof.when])).toEqual([[359, "Thu 05 Nov, 08:20"]]);
    expect(offer?.options.map((o) => [o.total, o.current])).toEqual([[471, true]]);
    expect(offer?.acceptedBy).toMatchObject({ emailId: "sl84-08", who: "Fahid (Oman Textiles)", sentence: "You are here by nominated to arrange for collection of cargo immediately." });

    // The roles: three offer mails (the add-on sent 26 minutes later is one), the echo, nothing on the rest.
    expect(read.mails.filter((m) => m.moneyRole === "offer").map((m) => m.time).sort()).toEqual(["08:20", "08:46", "09:37"]);
    expect(byId("sl84-08")).toMatchObject({ moneyRole: "customer_echo" });
    expect(brief(byId("sl84-08")!.money)).toEqual([["OMR", 339, null], ["OMR", 132, null]]);
    expect(read.mails.filter((m) => m.party === "customer" && m.id !== "sl84-08").every((m) => m.moneyRole === null && m.money.length === 0)).toBe(true);
  });

  it("follows Frontline's rate down to the agreed buy, the margin and the trail", () => {
    const { row: enquiryRow, emails } = sl262784();
    const { rates, buy, margin, trail, clash, summary, byId, targets } = money(enquiryRow, emails);
    expect(byId("sl84-09")).toMatchObject({ moneyRole: "push_to_agent", time: "15:17" });
    expect(byId("sl84-14")).toMatchObject({ moneyRole: "agreed_buy", time: "16:04" });
    // "Please proceed without palletization" and "Please proceed" agree nothing new.
    expect(byId("sl84-20")?.moneyRole).toBeNull();
    expect(byId("sl84-24")?.moneyRole).toBeNull();

    expect(rates).toHaveLength(1);
    const frontline = rates[0];
    expect(frontline).toMatchObject({
      sideKey: "flgshipping.net", name: "Frontline", domain: "flgshipping.net", state: "agreed", requestOnFile: true, askedAt: oman("2026-11-04 18:05"),
      earlier: [309, 303], lowestOnFile: true, repliedInHours: 13, question: null,
      summary: "OMR 309 → 303 → 298 + 117 · agreed · TT 25–35 days · no validity given",
    });
    expect(frontline.validity).toMatchObject({ who: "Frontline", none: true, until: null, ended: false, boilerplate: false, text: "no validity given" });
    expect(frontline.validity?.proof).toMatchObject({ emailId: "sl84-03", sentence: "no validity can be provided" });
    expect(frontline.options).toHaveLength(1);
    expect(frontline.latest).toMatchObject({ carrier: null, total: 415, transit: "25–35 days", allIn: true, declined: false });
    expect(frontline.latest?.main).toMatchObject({ label: "Ocean freight", amount: 298, currency: "OMR", unit: null, main: true });
    expect(frontline.latest?.extras.map((e) => [e.label, e.amount])).toEqual([["LCL & DO", 117]]);

    expect(buy).toEqual({
      agreed: true, agentName: "Frontline", sideKey: "flgshipping.net", total: 415, currency: "OMR", twin: "≈ USD 1,079 at 2.6",
      linesText: "298 ocean freight + 117 LCL & DO", freightOnly: false,
      proof: { emailId: "sl84-14", who: "Anwar K. S.", when: "Thu 05 Nov, 16:04", sentence: "Please proceed this shipment." },
    });
    expect(clash).toBeNull();
    expect(targets).toEqual([]);
    expect(margin).toEqual({
      figure: { amount: 56, currency: "OMR", pct: 12, negative: false, text: "about OMR 56" },
      inputs: "buy OMR 415, Frontline, agreed Thu 05 Nov 16:04", why: null, notes: [], clash: null, source: "mail",
    });

    expect(trail.points.map((p) => [p.label, p.party, p.role, p.marked])).toEqual([
      ["Frontline 309", "agent", "agent_rate", false],
      ["Offer 359", "us", "offer", false],
      ["Offer 339 · final", "us", "offer", false],
      ["Yes 471", "customer", "yes", true],
      ["→ Frontline 285", "us", "push_to_agent", false],
      ["Frontline 303", "agent", "agent_rate", false],
      ["Frontline 298", "agent", "agent_rate", true],
    ]);
    expect(trail.points[3]).toMatchObject({ amount: 471, currency: "OMR", proof: { emailId: "sl84-08" } });
    expect(trail.sentence).toBe("Down OMR 20 for the customer, down OMR 11 from Frontline.");

    expect(summary).toMatchObject({ writtenTo: 1, replied: 1, rates: 1, declined: 0, requestOnFile: true, noReplyOnFile: [], text: "Asked 1 agent Wed 18:05 · 1 replied · 1 rate · best on file OMR 298 (Frontline)" });
    expect(summary.lowest).toBe(frontline);
  });

  it("takes a commission in the remarks off the margin, and says so", () => {
    const { row: enquiryRow, emails } = sl262784();
    const withCommission = { ...enquiryRow, remarks: "COMMISSION OMR 40/CNTR." };
    const { margin } = money(withCommission, emails);
    expect(margin.figure?.text).toBe("about OMR 56");
    expect(margin.notes).toEqual(["after commission OMR 16"]);
  });

  it("says first offer accepted when one offer got a yes", () => {
    const { row: enquiryRow, emails } = sl262784();
    const one = emails.filter((e) => !["sl84-04", "sl84-06"].includes(e.id));
    const { offer, trail } = money(enquiryRow, one);
    expect(offer).toMatchObject({ total: 471, earlier: [] });
    expect(trail.points.filter((p) => p.role === "offer")).toHaveLength(1);
    expect(trail.sentence).toBe("First offer accepted, down OMR 11 from Frontline.");
    const noAgent = one.filter((e) => !/flgshipping/.test(`${e.from_email} ${e.to_emails.join(" ")}`));
    expect(money(enquiryRow, noAgent).trail).toMatchObject({ sentence: "First offer accepted." });
  });

  // SL262731: Synergies Castings, quoted by sea and then by air; Yuxing prices the air freight per kilo.
  function sl262731(withWeight: boolean) {
    const enquiryRow = enquiry({ reference: "SL262731", enquiry_date: "2026-11-01", quoted_date: "2026-11-02", customer_name: "SYNERGIES CASTING" });
    const customer = "yazan.almarzouqi@synergies-oman.com";
    const subject = "RE: SL262731 // RFQ – Import, Danyang (China) to Sohar – 1 Case / 280 kg / 0.63 CBM";
    const air = "RE: SL262731 AIR EX-WORKS SHANGHAI CHINA TO MUSCAT OMAN";
    const filed = (id: string, at: string, over: Partial<MailInput>) => mail({ id, received_at: oman(at), sl_refs: ["SL262731"], enquiry_id: "SL262731", subject, gmail_thread_id: "t-customer", ...over });
    const emails = [
      filed("sl31-01", "2026-11-02 10:10", {
        ...ANWAR, to_emails: [customer],
        body_text: `Dear Sir\n\nGood day\n\nPlease find below our offer.\n\nLCL\n\nDOOR TO DOOR : OMR 315.000\n\nPOL                        : SHANGHAI\n\nPOD                       : SOHAR\n\nTRANSIT TIME        : 35 - 45 DAYS\n\nCUSTOM DUTY & VAT : AT ACTUALS\n\n${SIGN_OFF}`,
      }),
      filed("sl31-02", "2026-11-04 12:00", {
        from_email: "marketing11@yxcargo.com", from_name: "Robert", to_emails: ["operation2@silverlynxoman.com"], subject: `Re:${air}`, gmail_thread_id: "t-yuxing",
        body_text: "Dear Anwar，\n\nProposal:\nAirline:Y9\nROUTE:URC-MCT\nAir freight: 5.4 usd per KG(+100KG general pallets cargo）\nETD :D257\nTransit time:1-2\n\nLocal charges:\nPick up charge:0.2USD/KG\nCustoms declaration:40USD\nAirport handling charge:30USD\n\n Robert\nYUXING INTERNATIONAL LOGISTICS CO.,LTD\nTEL:+86-020-80000004\nE-mail：marketing11@yxcargo.com",
      }),
      filed("sl31-03", "2026-11-04 12:04", {
        ...ANWAR, to_emails: [customer, "operation@silverlynxoman.com"],
        body_text: `Dear Sir\n\nGood day\n\nPlease find below our offer for Air.\n\nAIR\n\nDOOR TO DOOR: OMR 768.000\n\nPOL                        : CHINA\n\nPOD                       : MUSCAT\n\nTRANSIT               : 2-3 DAY\n\nAVIATION           : AT ACTUALS\n\nCUSTOM DUTY  : AT ACTUALS\n\nVAT                        : AT ACTUALS\n\nINPECTION          : AT ACTUALS (IF REQUIRED)\n\n${withWeight ? "•             Quoted rate based on Chargeable weight 280 Kgs / 1 Package.\n\n" : ""}•             Quoted rate based on General / Stackable cargo / Non Dg.\n\nfor the sea offer (OMR 315), please confirm:\n\n1.\tThe quote validity / 2 WEEKS\n\n${SIGN_OFF}`,
      }),
      filed("sl31-04", "2026-11-08 15:28", {
        from_email: customer, from_name: "Yazan Al Marzouqi", to_emails: ["operation2@silverlynxoman.com", "operation@silverlynxoman.com"],
        body_text: "Dear Anwar,\n\nThank you for the air offer.\n\nCould you kindly reconfirm the rate of OMR 768 and let us know the validity?\n\nPlease also share an estimate of the Oman aviation charges, and confirm it includes all charges up to delivery in Sohar, with duty and VAT excluded.\n\nKind regards,\n\nYazan Al Marzouqi",
      }),
      filed("sl31-05", "2026-11-09 10:24", {
        ...ASHWIN, to_emails: [customer],
        body_text: "Dear Sir,\n\nBelow quoted is our best rate to secure first shipment from your good company, kindly support with your nomination.\n\nApprox Oman aviation charge : OMR 44\n\nThanks & Regards,\n\nAshwin Luiz\nCell : 90000103",
      }),
    ];
    return { row: enquiryRow, emails };
  }

  it("keeps sea and air as two options on SL262731 and gives no margin on a rate per kilo without the weight", () => {
    const { row: enquiryRow, emails } = sl262731(false);
    const { offer, rates, buy, margin, trail, byId } = money(enquiryRow, emails);
    expect(offer).toMatchObject({ total: 768, currency: "OMR", scope: "door to door", transit: "2–3 days", earlier: [], acceptedBy: null, validUntil: "2026-11-18", validityStated: true, basis: null });
    expect(offer?.options.map((o) => [o.label, o.total, o.current])).toEqual([["LCL", 315, false], ["air", 768, true]]);
    expect(offer?.lines.map((l) => [l.label, l.amount, l.softText])).toEqual([
      ["Door to door", 768, null],
      ["Aviation", null, "at actuals"],
      ["Custom duty", null, "at actuals"],
      ["VAT", null, "at actuals"],
      ["Inpection", null, "at actuals"],
    ]);
    // A question about our price is neither an echo nor a figure of their own; an approximate charge is never an offer.
    expect(byId("sl31-04")).toMatchObject({ moneyRole: null });
    expect(byId("sl31-05")).toMatchObject({ moneyRole: null });
    expect(byId("sl31-05")!.money).toMatchObject([{ amount: 44, soft: true }]);

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ name: "Yuxing", state: "rated", requestOnFile: false, askedAt: null, repliedInHours: null, validity: null, summary: "USD 5.4/kg + 3 small items · Y9" });
    expect(rates[0].latest).toMatchObject({ carrier: "Y9", total: null, transit: null });
    expect(rates[0].latest?.main).toMatchObject({ label: "Air freight", amount: 5.4, currency: "USD", unit: "/kg" });
    expect(rates[0].latest?.extras.map((e) => [e.label, e.amount, e.unit])).toEqual([["Pick up", 0.2, "/kg"], ["Customs declaration", 40, null], ["Airport handling", 30, null]]);
    expect(buy).toBeNull();
    expect(margin).toMatchObject({ figure: null, why: "USD 5.4/kg × ? kg — the weight is not known", source: "mail", clash: null });
    expect(trail.points.map((p) => p.label)).toEqual(["Offer OMR 315 LCL", "Yuxing USD 5.4/kg", "Offer OMR 768 air"]);
    expect(trail.sentence).toBeNull();
  });

  it("works the rate per kilo out once the offer states the chargeable weight, and once we tell the agent to proceed", () => {
    const { row: enquiryRow, emails } = sl262731(true);
    const quoted = money(enquiryRow, emails);
    expect(quoted.offer?.basis).toMatchObject({ chargeableKg: 280, packages: 1 });
    expect(quoted.buy).toBeNull();
    // 5.4 × 280 + 0.2 × 280 + 40 + 30 = USD 1,638; OMR 768 is about USD 1,997.
    expect(quoted.margin).toMatchObject({ figure: null, why: "about OMR 138 if bought at USD 1,638 (Yuxing, not agreed)" });

    const proceed = mail({
      id: "sl31-06", received_at: oman("2026-11-10 11:07"), ...ANWAR, to_emails: ["marketing11@yxcargo.com"], sl_refs: ["SL262731"], enquiry_id: "SL262731",
      subject: "RE: RE: SL262731 AIR EX-WORKS SHANGHAI CHINA TO MUSCAT OMAN", gmail_thread_id: "t-yuxing",
      body_text: `Dear Robert\n\nPlease proceed this shipment.\n\nSHIPPER DETAILS\n\nJiangsu Tianhong Machinery Industry Co., Ltd, Danyang, Jiangsu, China.\n\n${SIGN_OFF}`,
    });
    const booked = money(enquiryRow, [...emails, proceed], { now: oman("2026-11-10 18:00") });
    expect(booked.rates[0].state).toBe("agreed");
    expect(booked.buy).toMatchObject({
      agreed: true, agentName: "Yuxing", total: 1638, currency: "USD", twin: "≈ OMR 630", freightOnly: false,
      linesText: "USD 5.4/kg × 280 kg + USD 0.2/kg × 280 kg + 40 customs declaration + 30 airport handling",
    });
    expect(booked.margin).toMatchObject({ figure: { amount: 138, currency: "OMR", pct: 18, negative: false, text: "about OMR 138" }, inputs: "buy USD 1,638, Yuxing, agreed Tue 10 Nov 11:07", notes: ["converted at 2.6"] });
  });

  // SL262735: an open-top container from Italy, asked of several agents; MLE prices in euros, we confirm in dollars.
  function sl262735(withThird: boolean) {
    const enquiryRow = enquiry({ reference: "SL262735", enquiry_date: "2026-11-01", quoted_date: "2026-11-02", customer_name: "HYDROTEC INTERNATIONAL", shipment_mode: "FCL", qty_text: "1X20 OT", units: 1, pol: "ITALY", pod: "SOHAR OMAN" });
    const subject = "SL262735 1X40 OT(HC) EX-WORKS ITALY TO SOHAR OMAN";
    const fee = "All quotes will be subjected to Euro 15 Bank Commission Fee billed in the invoice\n\nLUCA ANCONA (Mr)\nHead Of Ocean export division";
    const luca = { from_email: "ancona@mleurope.com", from_name: "Luca Ancona", to_emails: ["pricing@silverlynxoman.com"], subject: `R: ${subject}`, gmail_thread_id: "t-mle" };
    const toLuca = { ...MARIA, to_emails: ["ancona@mleurope.com"], subject: `Re: ${subject}`, gmail_thread_id: "t-mle" };
    const filed = (id: string, at: string, over: Partial<MailInput>) => mail({ id, received_at: oman(at), sl_refs: ["SL262735"], enquiry_id: "SL262735", subject, ...over });
    const agents = ["ancona@mleurope.com", "alessia.dotelli@cdcitalia.it", ...(withThird ? ["rates@adrialogistics.example"] : [])];
    const emails = [
      filed("sl35-01", "2026-11-05 14:28", {
        ...MARIA, to_emails: agents, gmail_thread_id: "t-ask",
        body_text: "Dear Team,\n\nPlease advise your best rates for below shipment.\n\nPOL : GENOA\nPOD : SOHAR\nUNIT : 1X40 OT(HC)\nCOMMODITY : CRANE\n\nBest Regards\n\nMaria Britto",
      }),
      filed("sl35-02", "2026-11-05 14:49", {
        from_email: "alessia.dotelli@cdcitalia.it", from_name: "Alessia Dotelli", to_emails: ["pricing@silverlynxoman.com"], subject: `R: RE : ${subject}`, gmail_thread_id: "t-cdc",
        body_text: "Dear Maria\n\nHere it is:\n\nFm EXW Nembro (BG) to CFR Sohar                   Usd 13.700/40 OT HC\nVGM                                                                                   Usd 95/cntr\n\nCARRIER: HL fm Genoa\nVALIDITY: NOV. 30 (PSS/BAF/EBS/WAR/FUEL VATOS)\nFREETIME: 3 DAYS\n\nRATES ARE SUBJECT TO THE EQUIPMENT AND SPACE AVAILABILITY AT TIME OF BOOKING\n\nWaiting for yr feedback\n\nGrazie e Saluti / Thanks & Best Regards\n\nAlessia Dotelli",
      }),
      filed("sl35-03", "2026-11-05 15:00", { ...luca, body_text: `Hello\nWith HPL door to Sohar € 12500/OTHC IG\nTT:75 DAYS\n\nRegards\n\n${fee}` }),
      filed("sl35-04", "2026-11-05 15:02", {
        ...toLuca,
        body_text: "Dear Luca,\n\nMany thanks for the below quote, however customer TARGET is USD 10500 ALL\nIN including ocean freight and ex-works upto Sohar port for this shipment.\nRequest you kindly check with other carrier and advise us.\n\n*Best Regards*.......*?*\n\n*Maria Britto*",
      }),
      filed("sl35-05", "2026-11-05 15:28", { ...luca, body_text: `Hello\nWith MSK door to Sohar:€8995/40 OTHC IG.\nMAX HEIGHT 265 CM\nTT:40-45 DAYS\nFREE TIME AT POD:11 DAY DET\nSUBJECT TO EQUIP/VESSEL SPACE\n\n${fee}` }),
      filed("sl35-06", "2026-11-05 17:19", { ...luca, body_text: `Hello\n8995€ is well under the customer’s target so we expect/assume to receive the shipment ,am I correct?\n${fee}` }),
      filed("sl35-07", "2026-11-05 18:02", {
        ...toLuca,
        body_text: "Dear Luca,\n\nMany thanks for your support, this shipment is confirmed based on the below\nagreed rate USD 8995/40 OT ALL IN INCLUDING OCEAN FREIGHT & EX-WORKS\nCHARGES . Please find shipper's contact details for your reference :\n\n*Raffaella*\n\nExport Department\n\n*Best Regards*.......*?*\n\n*Maria Britto*",
      }),
      filed("sl35-08", "2026-11-05 18:48", { ...luca, body_text: `Wait it’s € BASIS\n\nWith MSK door to Sohar:€8995/40 OTHC IG.\n\n${fee}` }),
      ...(withThird
        ? [
            filed("sl35-09", "2026-11-06 09:15", {
              from_email: "rates@adrialogistics.example", from_name: "Marco", to_emails: ["pricing@silverlynxoman.com"], subject: `RE: ${subject}`, gmail_thread_id: "t-adria",
              body_text: "Dear Maria,\n\nPlease find our rates:\n\nMSC : USD 13,200/40 OT HC\nMAERSK : NO SPACE\nHAPAG : USD 13,900/40 OT HC\n\nTT 60/70 days\n\nRgds\n\nMarco",
            }),
          ]
        : []),
    ];
    return { row: enquiryRow, emails };
  }

  it("flags the euro rate we confirmed in dollars on SL262735, and reads the target we gave", () => {
    const { row: enquiryRow, emails } = sl262735(false);
    const { read, offer, rates, buy, clash, margin, targets, summary, byId } = money(enquiryRow, emails);
    const mle = read.sides.find((s) => s.key === "mleurope.com")!;
    expect(offer).toBeNull();
    expect(byId("sl35-04")).toMatchObject({ moneyRole: "target" });
    expect(byId("sl35-07")).toMatchObject({ moneyRole: "agreed_buy" });
    expect(byId("sl35-06")).toMatchObject({ moneyRole: null });

    expect(clash).toMatchObject({ amount: 8995, currencies: ["EUR", "USD"], text: `Two currencies for 8,995: ${mle.name} wrote EUR, we wrote USD` });
    expect(clash?.proofs.map((p) => p.emailId)).toEqual(["sl35-05", "sl35-07"]);
    expect(buy).toMatchObject({ agreed: true, sideKey: "mleurope.com", total: 8995, currency: "USD", twin: "≈ OMR 3,460", linesText: "USD 8,995/40 OT × 1 container", freightOnly: false });
    expect(margin).toMatchObject({ figure: null, source: "mail", why: "Two currencies for the same amount: settle that before a margin" });
    expect(margin.clash).toBe(clash);

    expect(targets).toMatchObject([{ who: "us_to_agent", amount: 10500, currency: "USD", none: false, agentName: mle.name, text: `We asked ${mle.name} for USD 10,500 all in`, proof: { emailId: "sl35-04" } }]);

    const quote = rates.find((r) => r.sideKey === "mleurope.com")!;
    expect(quote).toMatchObject({ state: "agreed", requestOnFile: true, earlier: [], lowestOnFile: true, repliedInHours: 1, validity: null });
    expect(quote.options.map((o) => [o.carrier, o.main.amount, o.main.unit, o.transit, o.freeDays])).toEqual([
      ["Maersk", 8995, "/40 OTHC", "40–45 days", 11],
      ["Hapag-Lloyd", 12500, null, "75 days", null],
    ]);
    expect(quote.latest).toMatchObject({ carrier: "Maersk", total: 9010 });
    expect(quote.summary).toBe("EUR 8,995/40 OTHC + 15 · agreed · Maersk · TT 40–45 days · 11 free days");

    const cdc = rates.find((r) => r.sideKey === "cdcitalia.it")!;
    expect(cdc).toMatchObject({ state: "rated", lowestOnFile: false });
    expect(cdc.latest).toMatchObject({ carrier: "Hapag-Lloyd", total: 13795, freeDays: 3 });
    expect(cdc.latest?.main).toMatchObject({ label: "Fm EXW Nembro (BG) to CFR Sohar", amount: 13700, currency: "USD", unit: "/40 OT HC" });
    expect(cdc.validity).toMatchObject({ until: "2026-11-30", daysLeft: 21, ended: false, none: false, boilerplate: false, text: "valid until Mon 30 Nov" });

    expect(summary).toMatchObject({ writtenTo: 2, replied: 2, rates: 2, declined: 0, noReplyOnFile: [] });
    expect(summary.text).toBe(`Asked 2 agents Thu 14:28 · 2 replied · 2 rates · best on file EUR 8,995/40 OTHC (${mle.name}) · we asked for USD 10,500`);
  });

  it("counts a fee an agent writes under every mail once", () => {
    const { row: enquiryRow, emails } = sl262735(false);
    const { read, rates } = money(enquiryRow, emails);
    const fees = read.mails.flatMap((m) => m.money.filter((t) => t.currency === "EUR" && t.amount === 15).map(() => m.id));
    expect(fees).toEqual(["sl35-05"]);
    const quote = rates.find((r) => r.sideKey === "mleurope.com")!;
    for (const option of quote.options) expect(option.extras.map((e) => [e.label, e.amount, e.currency])).toEqual([["Bank commission", 15, "EUR"]]);
    // A mail that carries nothing but the fee is not a rate.
    expect(read.mails.find((m) => m.id === "sl35-06")?.money.map((t) => t.amount)).toEqual([8995]);
  });

  it("keeps an agent rated when one of several carriers has no space, and marks no lowest when the rates cover different things", () => {
    const { row: enquiryRow, emails } = sl262735(true);
    const { rates, summary } = money(enquiryRow, emails);
    const adria = rates.find((r) => r.sideKey === "adrialogistics.example")!;
    expect(adria).toMatchObject({ state: "rated", requestOnFile: true });
    expect(adria.options.map((o) => [o.carrier, o.main.amount, o.declined, o.declinedText, o.transit])).toEqual([
      ["MSC", 13200, false, null, "60–70 days"],
      ["Hapag-Lloyd", 13900, false, null, "60–70 days"],
      ["Maersk", null, true, "no space", null],
    ]);
    expect(adria.latest).toMatchObject({ carrier: "MSC", total: 13200 });
    expect(adria.summary).toBe("USD 13,200/40 OT HC · MSC · TT 60–70 days · Maersk: no space");
    // Two say "from the works", one does not say: nothing is called the lowest.
    expect(rates.some((r) => r.lowestOnFile)).toBe(false);
    expect(summary).toMatchObject({ writtenTo: 3, rates: 3, lowest: null });
    expect(summary.text).toBe("Asked 3 agents Thu 14:28 · 3 replied · 3 rates · we asked for USD 10,500");
  });

  // SL262779: a courier job. Our offer is not filed: the customer's replies quote it.
  function sl262779() {
    const enquiryRow = enquiry({
      reference: "SL262779", enquiry_date: "2026-11-04", quoted_date: "2026-11-04", confirmed_date: "2026-11-04", customer_name: "FAHMY FURNITURE",
      shipment_mode: "COURIER", qty_text: "COURIER", pol: "ZHEJIANG CHINA", pod: "MUSCAT OMAN", agent_name: "RCS", sell_total: 273, buy_total: 187, profit: 86,
    });
    const subject = "RE: SL262779 // SINOAMIGO -AIR FREIGHT - DOOR TO DOOR - ZHEJIANG, CHINA TO GHALA WAREHOUSE - NEED BEST AIR FREIGHT RATE / TRANSIT";
    const anish = { from_email: "purchase@fahmyfurniture.com", from_name: "Anish R Nair", to_emails: ["operation2@silverlynxoman.com"], cc_emails: ["sales7@silverlynxoman.com"], subject, gmail_thread_id: "t-customer" };
    const tail = "Regards,\n\nAnish.R. Nair .\n\nPurchase Manager\n\nFahmy Furniture Contracting & Trading LLC";
    const quoted = (at: string, text: string) =>
      `---- On Wed, 04 Nov 2026 ${at} +04:00 Anwar < mailto:operation2@silverlynxoman.com > wrote ----\n\nDear Sir\n\nGood day\n\n${text}\n\nCOURIER\n\nDOOR TO DOOR: OMR ${text.startsWith("We can") ? "105" : "118"}.000\n\nCUSTOM DUTY & VAT : AT ACTUALS\n\nADMIN FEE                  : AT ACTUALS\n\n•           Quoted rate based on Chargeable weight: 16 Kgs / 1 Package.\n\n•           Quoted rate based on General / Stackable cargo / Non DG.\n\nThanks & Regards\n\nAnwar K. S.\n\nM: +968 9000 0102`;
    const filed = (id: string, at: string, over: Partial<MailInput>) => mail({ id, received_at: oman(at), sl_refs: ["SL262779"], enquiry_id: "SL262779", ...over });
    const emails = [
      filed("sl79-01", "2026-11-04 17:08", { ...anish, body_text: `Dear Jithu,\n\n    Target rate- OMR 105\n\n${tail}\n\n${quoted("12:18:24", "Please find below our offer.")}` }),
      filed("sl79-02", "2026-11-04 17:34", {
        ...anish,
        body_text: `Dear Anwar/Jithu,\n\n   Please proceed with this shipment through \n\nCOURIER\n\nDOOR TO DOOR: OMR 105.000\n\n Please\ncontact the shipper using the details mentioned below and take the necessary\nurgent action.Please send me your counterpart details also.\n\n${tail}\n\n${quoted("17:11:25", "We can match the indication. Kindly share the Commercial Invoice & packing list with shipper contact details.")}`,
      }),
      filed("sl79-03", "2026-11-05 11:06", {
        ...ANWAR, to_emails: ["info@rcsworldwide.com", "sales.mct@rcsworldwide.com"], cc_emails: ["pricing@silverlynxoman.com"], subject: "SL262779 COURIER ZHEJIANG CHINA TO MUSCAT OMAN", gmail_thread_id: "t-rcs",
        body_text: `Dear ALI\n\nPlease proceed this shipment\n\nAgreed rate\n\nOMR 4.5/KG\n\nCW 16 KGS\n\nSHIPPER DETAILS\n\nWENZHOU SINO-AMIGO IMPORT & EXPORT CORP\n\n${SIGN_OFF}`,
      }),
    ];
    return { row: enquiryRow, emails };
  }

  it("reads the customer's target and the buy agreed per kilo on SL262779, with the offer from the quoted history", () => {
    const { row: enquiryRow, emails } = sl262779();
    const { offer, targets, buy, rates, margin, trail, byId, read } = money(enquiryRow, emails);
    expect(byId("sl79-01")).toMatchObject({ clean: "Target rate- OMR 105", moneyRole: "target" });
    expect(targets).toMatchObject([{ who: "customer", amount: 105, currency: "OMR", none: false, agentName: null, text: "The customer's target: OMR 105 (Wed 04 Nov)", proof: { emailId: "sl79-01", sentence: "Target rate- OMR 105" } }]);

    // Both offers come from what the customer quoted below their replies: 118, then 105 to match the target.
    expect(offer).toMatchObject({
      total: 105, currency: "OMR", twin: "≈ USD 273 at 2.6", scope: "door to door", fromQuotedHistory: true, sentAt: oman("2026-11-04 17:11"),
      sentTo: ["purchase@fahmyfurniture.com"], basis: { chargeableKg: 16, packages: 1 },
    });
    expect(offer?.sentBy).toMatchObject({ name: "Anwar K. S.", email: "operation2@silverlynxoman.com" });
    expect(offer?.earlier.map((e) => e.amount)).toEqual([118]);
    expect(offer?.proof.emailId).toBe("sl79-02");
    expect(offer?.acceptedBy).toMatchObject({ emailId: "sl79-02" });
    expect(byId("sl79-02")).toMatchObject({ moneyRole: "customer_echo" });

    expect(byId("sl79-03")).toMatchObject({ moneyRole: "agreed_buy", toParty: "agent" });
    expect(buy).toMatchObject({ agreed: true, agentName: read.sides.find((s) => s.key === "rcsworldwide.com")?.name, sideKey: "rcsworldwide.com", total: 72, currency: "OMR", twin: "≈ USD 187 at 2.6", linesText: "OMR 4.5/kg × 16 kg", freightOnly: false });
    expect(rates).toMatchObject([{ sideKey: "rcsworldwide.com", state: "agreed", latest: null, options: [], requestOnFile: false, summary: "Agreed by our e-mail of Thu 11:06 · their rate is not on file" }]);
    expect(margin).toMatchObject({ figure: { amount: 33, currency: "OMR", pct: 31, text: "about OMR 33" }, source: "mail", inputs: `buy OMR 72, ${buy?.agentName}, agreed Thu 05 Nov 11:06` });
    expect(trail.points.map((p) => [p.label, p.marked])).toEqual([
      ["Offer 118", false],
      ["Target 105", false],
      ["Offer 105", false],
      ["Yes 105", true],
      [`${buy?.agentName} 4.5/kg`, true],
    ]);
    // The register agrees with the e-mails: nothing to enter, nothing differs.
    expect(registerMoneyOf(enquiryRow, offer, buy, [])).toMatchObject({ hasRates: true, missingText: null, differs: null, slip: null });
  });

  it("uses the register's own profit on a confirmed job when the e-mails give no figure", () => {
    const { row: enquiryRow } = sl262779();
    expect(marginOf(null, null, null, enquiryRow, null)).toEqual({
      figure: { amount: 86, currency: "USD", pct: 32, negative: false, text: "USD 86" },
      inputs: "register: sell USD 273, buy USD 187", why: null, notes: [], clash: null, source: "register",
    });
    expect(marginOf(null, null, null, { ...enquiryRow, status: "quoted" }, null)).toMatchObject({ figure: null, why: "Needs an offer and an agreed buy" });
  });

  it("gives no margin when a door-to-door offer meets a buy that covers the freight only", () => {
    const enquiryRow = row({ quoted_date: "2026-11-03" });
    const agent = "ops@bluewavelogistics.example";
    const emails = [
      mail({ id: "d1", received_at: oman("2026-11-03 09:00"), from_email: agent, from_name: "Minh", gmail_thread_id: "t-agent", body_text: "Dear Anwar,\n\nO/F : USD 2,322\n\nTT 30 days\n\nBest regards\nMinh" }),
      mail({
        id: "d2", received_at: oman("2026-11-03 10:00"), ...ANWAR, to_emails: ["buyer@acme.example"], gmail_thread_id: "t-customer",
        body_text: `Dear Sir\n\nPlease find below our offer.\n\nSEA\n\nDOOR TO DOOR : OMR 1,312.000\n\n${SIGN_OFF}`,
      }),
      mail({ id: "d3", received_at: oman("2026-11-04 09:00"), ...ANWAR, to_emails: [agent], gmail_thread_id: "t-agent", body_text: `Dear Minh\n\nPlease proceed this shipment.\n\n${SIGN_OFF}` }),
    ];
    const { offer, buy, margin } = money(enquiryRow, emails);
    expect(offer).toMatchObject({ total: 1312, scope: "door to door", twin: "≈ USD 3,411 at 2.6" });
    expect(buy).toMatchObject({ agreed: true, total: 2322, currency: "USD", linesText: "2,322 O/F", freightOnly: true });
    expect(margin.figure).toBeNull();
    expect(margin.why).toBe("The agreed buy covers freight only; the offer is door to door");
    // With the trucking in the buy the figure is there, converted and said so.
    emails[0] = { ...emails[0], body_text: "Dear Anwar,\n\nO/F : USD 2,322\nTransport to door : USD 266\n\nBest regards\nMinh" };
    const whole = money(enquiryRow, emails);
    expect(whole.buy).toMatchObject({ total: 2588, freightOnly: false, linesText: "2,322 O/F + 266 transport to door" });
    expect(whole.margin).toMatchObject({ figure: { amount: 316.615, currency: "OMR", pct: 24, text: "about OMR 317" }, notes: ["converted at 2.6"] });
  });

  it("takes the customer's yes to our offer, not their yes to another shipment in the same thread", () => {
    const { row: enquiryRow, emails } = sl262731(true);
    const customer = { from_email: "yazan.almarzouqi@synergies-oman.com", from_name: "Yazan Al Marzouqi", to_emails: ["operation2@silverlynxoman.com", "operation@silverlynxoman.com"] };
    const filed = (id: string, at: string, body_text: string) =>
      mail({ id, received_at: oman(at), sl_refs: ["SL262731"], enquiry_id: "SL262731", subject: "RE: SL262731 // RFQ – Import, Danyang (China) to Sohar", gmail_thread_id: "t-customer", ...customer, body_text });
    const more = [
      filed("sl31-07", "2026-11-09 11:23", "Dear Anwar, Dear Ashwin,\n\nPlease proceed with the courier booking for PO04828, as per your quotation dated 9 Nov 2026 (OMR 75.000 + admin fee at actuals).\n\nKind regards,\n\nYazan Al Marzouqi"),
      filed("sl31-08", "2026-11-10 09:01", "Dear Ashwin, Dear Anwar,\n\nThank you for your offer. Please proceed with the air freight booking for the shipment below, as per your quotation (OMR 768.000 door to door + Oman aviation charges at actuals, approx. OMR 44).\n\nKind regards,\n\nYazan Al Marzouqi"),
    ];
    const { offer, trail, byId } = money(enquiryRow, [...emails, ...more], { now: oman("2026-11-10 18:00") });
    expect(byId("sl31-07")?.moneyRole).toBeNull();
    expect(byId("sl31-08")?.moneyRole).toBe("customer_echo");
    expect(offer?.acceptedBy).toMatchObject({ emailId: "sl31-08" });
    const yes = trail.points.filter((p) => p.role === "yes");
    expect(yes.map((p) => [p.label, p.proof.emailId])).toEqual([["Yes OMR 768", "sl31-08"]]);
    // Two options were offered: no sentence sums the haggle up.
    expect(trail.sentence).toBeNull();
  });

  it("keeps an agent's options under 'Option1' and 'Option2' apart, each with its own carrier and transit", () => {
    const body = [
      "Dear Team,",
      "Route：From Shanghai-Sohar ，Via Shanghai port",
      "Option1\nEXW Rate：O/F：USD7150/40HQ，Truck Fee：USD210，POL Charge：USD480，Customs clearance fees：USD50/BL，Total：USD7890.",
      "By Zhong Gu, ETD11.18, Direct，TT  23 days, Vessel：SATTA BHUM 173W ，Valid :until11.16",
      "Option2\nEXW Rate：O/F：USD6900/40HQ，Truck Fee：USD210，POL Charge：USD480，Customs clearance fees：USD50/BL，Total：USD7640.",
      "By ASYAD, ETD11.19, Via MUN，TT  35 days, Vessel：INTERASIA ACCELERATE/W019，Valid :until11.16",
      "Port of destination: Free of containers for 14 days",
      "Please check and Looking forward to your reply.",
      "Samule/ OVERSEAS SALES\nThanks & B.Regards !",
    ].join("\n\n");
    const rate = mail({ from_email: "rates@consolclub.com", from_name: "Samule", received_at: oman("2026-11-06 09:00"), body_text: body });
    const { rates } = money(row({ shipment_mode: "FCL", qty_text: "1X40HC", units: 1 }), [rate]);
    expect(rates).toHaveLength(1);
    const [quote] = rates;
    expect(quote.options.map((o) => [o.carrier, o.main.label, o.main.amount, o.main.unit, o.total, o.extras.length, o.transit, o.freeDays, o.allIn])).toEqual([
      ["Asyad", "Total", 7640, "/40 HQ", 7640, 0, "35 days", 14, true],
      [null, "Total", 7890, "/40 HQ", 7890, 0, "23 days", 14, true],
    ]);
    // Two options of one mail are not a revision of each other.
    expect(quote.earlier).toEqual([]);
    expect(quote.latest).toMatchObject({ carrier: "Asyad", total: 7640 });
    expect(quote.validity).toMatchObject({ until: "2026-11-16", ended: false });
    expect(quote.summary).toBe("USD 7,640/40 HQ · Asyad · TT 35 days · 14 free days · valid until Mon 16 Nov");
  });

  it("names no charge after a rate from what is said of it, and leaves an agent's notice in their own language out", () => {
    const winco = mail({
      from_email: "devin@wincologistics.com", from_name: "Devin Qiu", received_at: oman("2026-11-06 09:00"),
      body_text: "Dear  Fahad\n\nhi deaar good day pls kindly check my best rate belows for u ref\n\nfrom shanghai to sohar USD 8300/40hq with 14 days free time and space ok etd is on 17th by kmtc and the esl line all in included the ex-work charge\n\nThanks & Regards,\n\nDevin Qiu",
    });
    const sanco = mail({
      from_email: "ov40-sz@sancologistics.com", from_name: "Donna Li", received_at: oman("2026-11-06 10:00"),
      body_text:
        "Dear Waheed,\n\nWe will release HBL after shipper confirmed to release shpt.Keep your posted.\n\nThank you so much and best regards~\n***Warm prompt***\n2.根据2026年阿拉伯联合酋长国国家规定，所有运往或途经阿联酋的货物必须强制申报MPCI(海运预装载货物信息申报制度),船司将对货物收取MPCI申报费USD35/BL.请知悉。\n\nDonna Li (Ms.)",
    });
    const { rates, byId } = money(row({ shipment_mode: "FCL", units: 1 }), [winco, sanco]);
    expect(byId(sanco.id)).toMatchObject({ moneyRole: null, money: [] });
    expect(rates.map((r) => r.sideKey)).toEqual(["wincologistics.com"]);
    expect(rates[0].latest).toMatchObject({ carrier: null, freeDays: 14, allIn: true, total: 8300 });
    expect(rates[0].latest?.main).toMatchObject({ label: "Rate", amount: 8300, unit: "/40 HQ" });
  });

  it("counts the boxes our offer states, and adds the charges to one box when it does not say", () => {
    const quote = (count: string) =>
      mail({
        id: "q1", received_at: oman("2026-11-03 10:00"), ...ANWAR, to_emails: ["buyer@acme.example"],
        body_text: `Dear Sir\n\nGood day\n\nPlease find below our offer.\n\n${count}PORT TO PORT                      : OMR 3282.000 / 40\n\nCUSTOM CLEARANCE       : OMR 15.000 / DOC\n\nTRANSPORTATION               : OMR 120.000\n\nPOL                                              : QINGDAO\n\nPOD                                             : SOHAR\n\nFREETIME                                  : 14 DAYS AT POD\n\nTT                                                  : 28 DAYS\n\nETD                                                 : 18 NOV\n\nSHIPPING LINE CHARGES  : AT ACTUALS\n\n${SIGN_OFF}`,
      });
    const enquiryRow = row({ shipment_mode: "FCL", contact_email: "buyer@acme.example" });
    const stated = money(enquiryRow, [quote("2X40\n\n")]);
    expect(stated.offer).toMatchObject({ total: 6699, linesText: "3,282/40 port to port + 15/doc custom clearance + 120 transportation", freeDays: 14, transit: "28 days", etd: "18 NOV" });
    expect(registerMoneyOf(enquiryRow, stated.offer, null, []).prefill).toMatchObject({ sell_total: 17417 });
    const unstated = money(enquiryRow, [quote("")]);
    expect(unstated.offer).toMatchObject({ total: 3417 });
    // Then the total is not the whole shipment's: no sell to enter, and the margin says what is missing.
    expect(registerMoneyOf(enquiryRow, unstated.offer, null, []).prefill).toBeNull();
    expect(marginOf(unstated.offer, null, null, enquiryRow, null).why).toBe("The offer is OMR 3,282/40 — the number of containers is not known");
  });

  /** Our offer to the customer, as one mail of ours. */
  const offerOf = (id: string, at: string, lines: string) =>
    mail({ id, received_at: oman(at), ...ANWAR, to_emails: ["buyer@acme.example"], gmail_thread_id: "t-customer", body_text: `Dear Sir\n\nPlease find below our offer.\n\n${lines}\n\n${SIGN_OFF}` });

  it("calls an offer whole only when every firm line was multiplied out, not when the main line alone was", () => {
    // Three boxes at OMR 500 each, and handling per kilo with no weight anywhere: no total for the shipment.
    const enquiryRow = row({ shipment_mode: "FCL", qty_text: "3X40", units: 3, contact_email: "buyer@acme.example" });
    const lines = "PORT TO PORT : OMR 500.000 / 40\n\nHANDLING CHARGES : OMR 0.050 / KG";
    const { offer } = money(enquiryRow, [offerOf("w1", "2026-11-03 10:00", lines)]);
    expect(offer).toMatchObject({ currency: "OMR", whole: false, missing: ["kg"], count: 3 });
    expect(registerMoneyOf(enquiryRow, offer, null, []).prefill).toBeNull();
    expect(registerMoneyOf({ ...enquiryRow, sell_total: 1300 }, offer, null, []).differs).toBeNull();
    expect(marginOf(offer, null, null, enquiryRow, null)).toMatchObject({ figure: null, why: "The offer is OMR 500/40 — the weight is not known" });

    // With the weight stated every line is multiplied out: 3 × 500 + 0.05 × 4,000.
    const weighed = money(enquiryRow, [offerOf("w2", "2026-11-03 10:00", `${lines}\n\nGross weight 4000 kgs`)]).offer;
    expect(weighed).toMatchObject({ whole: true, missing: [], count: 3, total: 1700 });
    expect(registerMoneyOf(enquiryRow, weighed, null, []).prefill).toMatchObject({ sell_total: 4420 });

    // An air rate per kilo with no weight: the stand-in figure is the rate, never a total.
    const air = money(row({ shipment_mode: "AIR", contact_email: "buyer@acme.example" }), [offerOf("w3", "2026-11-03 10:00", "AIRPORT TO AIRPORT : OMR 2.100 / KG\n\nDO CHARGES : OMR 150.000")]).offer;
    expect(air).toMatchObject({ whole: false, missing: ["kg"], count: null, total: 2.1 });
    expect(air?.options).toMatchObject([{ whole: false, rate: { amount: 2.1, unit: "/kg" }, current: true }]);
  });

  it("gives one figure for an offer: the total only when it is for the whole shipment, else the main line's rate", () => {
    const fcl = row({ shipment_mode: "FCL", qty_text: "3X40", units: 3, contact_email: "buyer@acme.example" });
    const lines = "PORT TO PORT : OMR 500.000 / 40\n\nHANDLING CHARGES : OMR 0.050 / KG";
    // Every line multiplied out: the total, with no unit.
    const weighed = money(fcl, [offerOf("f1", "2026-11-03 10:00", `${lines}\n\nGross weight 4000 kgs`)]).offer;
    expect(weighed && offerFigureOf(weighed)).toEqual({ amount: 1700, currency: "OMR", unit: null, whole: true, dependsOn: null, text: "OMR 1,700" });
    // The boxes are counted but the kilos are not: there is no total, so the rate per box is shown with its unit.
    const boxes = money(fcl, [offerOf("f2", "2026-11-03 10:00", lines)]).offer;
    expect(boxes && offerFigureOf(boxes)).toEqual({ amount: 500, currency: "OMR", unit: "/40", whole: false, dependsOn: "the weight", text: "OMR 500/40" });
    // A rate per kilo with no weight: the rate, never "OMR 2.1" as if it were the total with the DO left out.
    const air = money(row({ shipment_mode: "AIR", contact_email: "buyer@acme.example" }), [offerOf("f3", "2026-11-03 10:00", "AIRPORT TO AIRPORT : OMR 2.100 / KG\n\nDO CHARGES : OMR 150.000")]).offer;
    expect(air && offerFigureOf(air)).toMatchObject({ amount: 2.1, unit: "/kg", whole: false, dependsOn: "the weight", text: "OMR 2.1/kg" });
    // One box and the charges beside it, the number of boxes unknown: the rate per box, not the 3,417 stand-in.
    const perBox = money(row({ shipment_mode: "FCL", contact_email: "buyer@acme.example" }), [offerOf("f4", "2026-11-03 10:00", "PORT TO PORT : OMR 3282.000 / 40\n\nTRANSPORTATION : OMR 135.000")]).offer;
    expect(perBox).toMatchObject({ whole: false, total: 3417 });
    expect(perBox && offerFigureOf(perBox)).toMatchObject({ text: "OMR 3,282/40", dependsOn: "the number of containers" });
    // An offer that somehow lacks the flag (an old saved object) counts as not whole.
    if (!air) throw new Error("no offer");
    expect(offerFigureOf({ ...air, whole: undefined } as unknown as typeof air)).toMatchObject({ whole: false, text: "OMR 2.1/kg" });
  });

  it("says what a total depends on in the order the lines need it", () => {
    expect(offerDependsOn({ missing: ["containers", "kg"] })).toBe("the number of containers and the weight");
    expect(offerDependsOn({ missing: ["cbm"] })).toBe("the volume");
    expect(offerDependsOn({ missing: [] })).toBe("the quantities");
    expect(offerDependsOn(null)).toBe("the quantities");
  });

  it("counts a rate per W/M or revenue ton on the larger of the cbm and the gross tonnes", () => {
    const enquiryRow = row({ contact_email: "buyer@acme.example" });
    const dense = money(enquiryRow, [offerOf("wm1", "2026-11-03 10:00", "PORT TO PORT : OMR 30.000 / W/M\n\nDO CHARGES : OMR 100.000\n\nVolume: 2 cbm\n\nGross weight 4000 kgs")]).offer;
    // 4 revenue tons, not 2 cbm: 30 × 4 + 100.
    expect(dense).toMatchObject({ whole: true, total: 220 });
    const light = money(enquiryRow, [offerOf("wm2", "2026-11-03 10:00", "PORT TO PORT : OMR 30.000 / W/M\n\nDO CHARGES : OMR 100.000\n\nVolume: 6 cbm\n\nGross weight 900 kgs")]).offer;
    expect(light).toMatchObject({ whole: true, total: 280 });
    const unknown = money(enquiryRow, [offerOf("wm3", "2026-11-03 10:00", "PORT TO PORT : OMR 30.000 / W/M\n\nDO CHARGES : OMR 100.000")]).offer;
    expect(unknown).toMatchObject({ whole: false, missing: ["cbm"] });
  });

  it("keeps the currency of an earlier offer written in another one", () => {
    const enquiryRow = row({ contact_email: "buyer@acme.example" });
    const first = offerOf("c1", "2026-11-03 10:00", "SEA\n\nPORT TO PORT : USD 1000");
    const revised = offerOf("c2", "2026-11-04 10:00", "SEA\n\nPORT TO PORT : OMR 370.000");
    const { offer } = money(enquiryRow, [first, revised]);
    expect(offer).toMatchObject({ currency: "OMR", total: 370 });
    expect(offer?.earlier.map((e) => [e.currency, e.amount, e.unit])).toEqual([["USD", 1000, null]]);
    // The same figure in another currency is another price: it stays.
    const same = money(enquiryRow, [offerOf("c3", "2026-11-03 10:00", "SEA\n\nPORT TO PORT : USD 370"), revised]).offer;
    expect(same?.earlier.map((e) => [e.currency, e.amount])).toEqual([["USD", 370]]);
  });

  it("reads a register kept in rials in rials, and still suggests US dollars", () => {
    const { row: enquiryRow, emails } = sl262784();
    const { offer, buy } = money(enquiryRow, emails);
    const inRials = { ...enquiryRow, currency: "OMR", agent_name: "FRONTLINE" };
    // OMR 471 and OMR 415 in the register are the e-mails' figures: nothing differs.
    expect(registerMoneyOf({ ...inRials, sell_total: 471, buy_total: 415, profit: 56 }, offer, buy, [])).toMatchObject({ hasRates: true, differs: null, slip: null, missingText: null });
    // OMR 400 is about USD 1,040 against USD 1,225: the text says it in rials, the suggestion stays in dollars.
    const low = registerMoneyOf({ ...inRials, sell_total: 400, buy_total: 415, profit: -15 }, offer, buy, []);
    expect(low.differs).toEqual({
      text: "Register sell OMR 400 (≈ USD 1,040); the e-mails say OMR 471 (≈ USD 1,225)",
      dismissId: `rates:${enquiryRow.id}:1225:`,
      prefill: { sell_total: 1225, replace: ["sell_total"], notes: ["Sell OMR 471 × 2.6 = USD 1,225, from Anwar K. S.'s e-mail of Thu 05 Nov 09:37"] },
    });
    // The buy already matches the e-mails: no update offered for the slip.
    expect(low.slip).toEqual({ text: "Sell 400 is under the buy 415: the profit is below zero", prefill: null });
    // A register in dollars reads as before.
    expect(registerMoneyOf({ ...enquiryRow, currency: "USD", sell_total: 1000 }, offer, buy, []).differs?.text).toBe("Register sell USD 1,000; the e-mails say OMR 471 (≈ USD 1,225)");
  });

  it("shows the customer's yes to an offer that is no total as the rate they took", () => {
    const enquiryRow = row({ shipment_mode: "AIR", contact_email: "buyer@acme.example" });
    const yes = mail({
      id: "y2", received_at: oman("2026-11-04 09:00"), from_email: "buyer@acme.example", from_name: "Buyer", gmail_thread_id: "t-customer",
      body_text: "Dear Anwar,\n\nPlease proceed with the shipment.\n\nRegards\nBuyer",
    });
    const { offer, trail } = money(enquiryRow, [offerOf("y1", "2026-11-03 10:00", "AIRPORT TO AIRPORT : OMR 2.100 / KG\n\nDO CHARGES : OMR 150.000"), yes]);
    expect(offer?.whole).toBe(false);
    expect(trail.points.find((p) => p.role === "yes")).toMatchObject({ label: "Yes 2.1/kg", amount: 2.1, unit: "/kg" });
  });

  it("shows an agent's rate for the size of box we offered", () => {
    const enquiryRow = row({ shipment_mode: "FCL", contact_email: "buyer@acme.example" });
    const emails = [
      mail({ id: "s1", received_at: oman("2026-11-03 09:00"), from_email: "rates@bluewave.example", gmail_thread_id: "t-agent", body_text: "Dear Anwar,\n\nO/F : USD 5600/20'DV USD 7200/40'HQ\n\nBest regards\nMinh" }),
      mail({ id: "s2", received_at: oman("2026-11-03 10:00"), ...ANWAR, to_emails: ["buyer@acme.example"], gmail_thread_id: "t-customer", body_text: `Dear Sir\n\nPlease find below our offer.\n\nPORT TO PORT : USD 8,000/40HC\n\n${SIGN_OFF}` }),
    ];
    const { trail } = money(enquiryRow, emails);
    expect(trail.points.map((p) => p.label)).toEqual(["bluewave.example 7,200/40 HQ", "Offer 8,000/40 HC"]);
  });
});

describe("validity, transit, free time, carrier, equipment, basis", () => {
  const written = oman("2026-11-05 14:49");

  it("reads a validity only where a rate stands, in every spelling of the date", () => {
    expect(validityOf("VALIDITY: NOV. 30 (PSS/BAF/EBS/WAR/FUEL VATOS)", written, true)).toEqual({ until: "2026-11-30", none: false, boilerplate: false, text: "VALIDITY: NOV. 30" });
    expect(validityOf("Validity: Upto 10th Nov", written, true)).toMatchObject({ until: "2026-11-10", none: false });
    expect(validityOf("VALID : 10.11.2026", written, true)).toMatchObject({ until: "2026-11-10" });
    expect(validityOf("Valid :until11.15", written, true)).toMatchObject({ until: "2026-11-15" });
    expect(validityOf("Validity Nov-07-2026", written, true)).toMatchObject({ until: "2026-11-07" });
    expect(validityOf("CARRIER: WY  VALIDITY: NOV.15.2026  ETD: DAILY", written, true)).toMatchObject({ until: "2026-11-15" });
    expect(validityOf("Expiry date: 30 Novembber 2026", written, true)).toMatchObject({ until: "2026-11-30" });
    expect(validityOf("Rates valid till 5 Jan", oman("2026-12-20 10:00"), true)).toMatchObject({ until: "2027-01-05" });
    expect(validityOf("The quote validity / 2 WEEKS", written, true)).toMatchObject({ until: "2026-11-19" });
    expect(validityOf("This rate is valid for 24 hour", written, true)).toMatchObject({ until: "2026-11-06", boilerplate: false });
    expect(validityOf("Rates are valid till sailing", written, true)).toMatchObject({ until: null, none: false });
    expect(validityOf("Validity: Upto 10th Nov\n30 days free", written, true)).toMatchObject({ until: "2026-11-10" });
  });

  it("tells no validity, the standard wording and a rate-less mail apart", () => {
    expect(validityOf("NOTE: Quoted rates are not valid and no validity can be provided as the charges may change vessel by vessel", written, true)).toEqual({
      until: null, none: true, boilerplate: false, text: "no validity can be provided",
    });
    expect(validityOf("All rates are subject to change without prior notice", written, true)).toMatchObject({ none: true, until: null });
    const clause = "OCEAN FREIGHT : USD 1,200/20GP\n\nAll of quotations are subject to our standard trading conditions. Unless otherwise stated, quotations are valid for 7 calendar days from issuance.";
    expect(validityOf(clause, written, true)).toMatchObject({ until: "2026-11-12", none: false, boilerplate: true });
    expect(validityOf("Your DHL tracking URL is only valid for 1 day", written, false)).toBeNull();
    expect(validityOf("DO validity till 15 Nov", written, true)).toBeNull();
    expect(validityOf("OCEAN FREIGHT : USD 1,200/20GP", written, true)).toBeNull();
  });

  it("shows an agent's standard wording as theirs and never as ended", () => {
    const standard = "\n\nAll of quotations are subject to our standard trading conditions. Unless otherwise stated, quotations are valid for 7 calendar days from issuance.";
    const rate = (body: string) => mail({ from_email: "liu@consolclub.com", received_at: oman("2026-10-20 09:00"), body_text: `Dear Anwar,\n\nO/F : USD 6,300/20GP${body}` });
    const read = (body: string) => money(row({ shipment_mode: "FCL", units: 1 }), [rate(body)]).rates[0];
    expect(read(standard).validity).toMatchObject({ until: "2026-10-27", ended: false, boilerplate: true, none: false, text: "valid until Tue 27 Oct" });
    expect(read(standard).summary).toBe("USD 6,300/20 GP · valid until Tue 27 Oct (their standard wording)");
    expect(read("\nVALID : 30.10.2026").validity).toMatchObject({ until: "2026-10-30", ended: true, daysLeft: -10, boilerplate: false, text: "ended Fri 30 Oct" });
    expect(read("").validity).toBeNull();
  });

  it("reads transit and free time only with their unit", () => {
    expect(transitOf("TT : 35 - 45 DAYS")).toBe("35–45 days");
    expect(transitOf("Weekly service (HAPAG) from Genoa - transit time 60/70 days")).toBe("60–70 days");
    expect(transitOf("TRANSIT : DIRECT FLIGHT")).toBe("direct flight");
    expect(transitOf("TRANSIT        :  25-35  DAYS FROM THE DATE OF SAILING,MAY CHANGE")).toBe("25–35 days");
    expect(transitOf("TT about 24 days")).toBe("24 days");
    expect(transitOf("Transit 3 TO 4 days")).toBe("3–4 days");
    expect(transitOf("TT: 1 day")).toBe("1 day");
    expect(transitOf("Transit Time:  est 4 - 5 days")).toBe("4–5 days");
    expect(transitOf("Please share the TT copy")).toBeNull();
    expect(transitOf("Transit time:1-2")).toBeNull();
    expect(freeDaysOf("14 DAYS FREE AT POD")).toBe(14);
    expect(freeDaysOf("FREE TIME AT POD:11 DAY DET")).toBe(11);
    expect(freeDaysOf("FREETIME: 3 DAYS")).toBe(3);
    expect(freeDaysOf("got only 10 free days @ POD")).toBeNull();
    expect(freeDaysOf("40 FT container")).toBeNull();
  });

  it("names the carrier, by a short code only in capitals after a cue word", () => {
    expect(carrierOf("With HPL door to Sohar € 12500/OTHC IG")).toBe("Hapag-Lloyd");
    expect(carrierOf("With MSK door to Sohar")).toBe("Maersk");
    expect(carrierOf("CARRIER: HL fm Genoa")).toBe("Hapag-Lloyd");
    expect(carrierOf("Airline:Y9\nROUTE:URC-MCT")).toBe("Y9");
    expect(carrierOf("CARRIER: WY (ICN-MNL-MCT)")).toBe("Oman Air");
    expect(carrierOf("Weekly service (HAPAG)  from Genoa via Tanger Med")).toBe("Hapag-Lloyd");
    expect(carrierOf("booked on MEARSK vessel")).toBe("Maersk");
    expect(carrierOf("we are on one page with hl and the pick ups")).toBeNull();
    expect(carrierOf("Sharjah, United Arab Emirates")).toBeNull();
  });

  it("names the container and leaves cargo dimensions alone", () => {
    expect(equipmentOf("SL262735 1X40 OT(HC) EX-WORKS ITALY TO SOHAR OMAN")).toBe("1x40 OT HC");
    expect(equipmentOf("1X20 OT")).toBe("1x20 OT");
    expect(equipmentOf("2 x 40'HC")).toBe("2x40 HC");
    expect(equipmentOf("rate for 40HR")).toBe("40 HC");
    expect(equipmentOf("Usd 13.700/40 OT HC")).toBe("40 OT HC");
    // A count and a size alone on their line are a container.
    expect(equipmentOf("Please find below our offer.\n1X40\nPORT TO PORT : OMR 3282.000 / 40")).toBe("1x40");
    expect(equipmentOf("1 case, 126 × 66 × 76 cm, 280 kg")).toBeNull();
    expect(equipmentOf("carton 80 x 40 x 20 cm")).toBeNull();
  });

  it("reads what a rate was worked out on", () => {
    expect(basisOf("•             Quoted rate based on volume 6 CBM | 41 Packages.")).toEqual({ cbm: 6, chargeableKg: null, grossKg: null, packages: 41, text: "6 cbm · 41 packages" });
    expect(basisOf("Quoted rate based on Chargeable weight: 16 Kgs / 1 Package.")).toEqual({ cbm: null, chargeableKg: 16, grossKg: null, packages: 1, text: "16 kg chargeable · 1 package" });
    expect(basisOf("Based on   6 CBM , pleased to offer as below")).toMatchObject({ cbm: 6 });
    expect(basisOf("Agreed rate\n\nOMR 4.5/KG\n\nCW 16 KGS")).toMatchObject({ chargeableKg: 16, grossKg: null });
    expect(basisOf("Air Freight Rates for General Cargo -01 PKG/G.W:  194 KG  //")).toMatchObject({ grossKg: 194, chargeableKg: null });
    expect(basisOf("Gross Weight 2,892. kgs")).toMatchObject({ grossKg: 2892 });
    expect(basisOf("Volume: 6.3 cbm ( stackable – non-DG ) // 9 PALLETS // 3465KGS")).toMatchObject({ cbm: 6.3, text: "6.3 cbm" });
    expect(basisOf("Please proceed this shipment.")).toBeNull();
  });
});

describe("register, agents line, lane", () => {
  it("spots a register profit that looks like a typing slip", () => {
    const sl262713 = enquiry({ reference: "SL262713", enquiry_date: "2026-10-27", quoted_date: "2026-10-28", confirmed_date: "2026-10-28", sell_total: 7000, buy_total: 610, profit: 6390 });
    expect(registerMoneyOf(sl262713, null, null, [])).toEqual({
      hasRates: true, missingText: null, differs: null, prefill: null,
      slip: { text: "Buy 610 on a sell of 7,000 looks like a slip: the profit is 91% of the sell", prefill: null },
    });
    expect(registerMoneyOf({ ...sl262713, sell_total: 500, buy_total: 700, profit: -200 }, null, null, []).slip?.text).toBe("Sell 500 is under the buy 700: the profit is below zero");
    expect(registerMoneyOf({ ...sl262713, buy_total: 6100, profit: 900 }, null, null, []).slip).toBeNull();
    // Figures the database sends as text read the same.
    const asText = { ...sl262713, sell_total: "7000.000", buy_total: "610.000", profit: "6390.000" } as unknown as EnquiryRow;
    expect(registerMoneyOf(asText, null, null, []).slip?.text).toContain("91% of the sell");
  });

  it("says when the register differs from the e-mails by more than 5%, until that is put away", () => {
    const enquiryRow = row({ quoted_date: "2026-11-03", sell_total: 1565 });
    const emails = [
      mail({ id: "r1", received_at: oman("2026-11-03 10:00"), ...ANWAR, to_emails: ["buyer@acme.example"], body_text: `Dear Sir\n\nPlease find below our offer.\n\nSEA FOB\n\nPORT TO PORT : OMR 943.000\n\n${SIGN_OFF}` }),
    ];
    const { offer } = money(enquiryRow, emails);
    const register = registerMoneyOf(enquiryRow, offer, null, []);
    expect(register).toMatchObject({ hasRates: true, missingText: null, slip: null });
    expect(register.differs).toEqual({
      text: "Register sell USD 1,565; the e-mails say OMR 943 (≈ USD 2,452)",
      dismissId: "rates:SL262700:2452:",
      prefill: { sell_total: 2452, replace: ["sell_total"], notes: ["Sell OMR 943 × 2.6 = USD 2,452, from Anwar K. S.'s e-mail of Tue 03 Nov 10:00"] },
    });
    expect(register.prefill).toMatchObject({ sell_total: 2452, replace: ["sell_total"] });
    expect(registerMoneyOf(enquiryRow, offer, null, ["rates:SL262700:2452:"]).differs).toBeNull();
    // Within 5% nothing is said; with no sell the e-mails' figure is offered.
    expect(registerMoneyOf({ ...enquiryRow, sell_total: 2400 }, offer, null, []).differs).toBeNull();
    expect(registerMoneyOf({ ...enquiryRow, sell_total: null, quoted_date: null }, offer, null, [])).toMatchObject({
      hasRates: false, missingText: "Not entered. The e-mails say sell OMR 943 (≈ USD 2,452).", differs: null,
      prefill: { sell_total: 2452, quoted_date: "2026-11-03", notes: ["Sell OMR 943 × 2.6 = USD 2,452, from Anwar K. S.'s e-mail of Tue 03 Nov 10:00"] },
    });
  });

  it("offers both sides of SL262784 for the empty register", () => {
    const { row: enquiryRow, emails } = sl262784();
    const { offer, buy } = money(enquiryRow, emails);
    expect(registerMoneyOf(enquiryRow, offer, buy, [])).toEqual({
      hasRates: false, differs: null, slip: null,
      missingText: "Not entered. The e-mails say sell OMR 471 (≈ USD 1,225), buy OMR 415 (≈ USD 1,079).",
      prefill: {
        sell_total: 1225, buy_total: 1079, agent_name: "FRONTLINE", quoted_date: "2026-11-05",
        notes: ["Sell OMR 471 × 2.6 = USD 1,225, from Anwar K. S.'s e-mail of Thu 05 Nov 09:37", "Buy OMR 415 × 2.6 = USD 1,079, agreed with Frontline, Thu 05 Nov 16:04"],
      },
    });
    const stale = registerMoneyOf({ ...enquiryRow, sell_total: 1225, buy_total: 1300, profit: -75, agent_name: "FRONTLINE" }, offer, buy, []);
    expect(stale.differs?.text).toBe("Register buy USD 1,300; agreed by e-mail OMR 415 (≈ USD 1,079) (Frontline, Thu 05 Nov)");
    expect(stale.slip).toMatchObject({ text: "Sell 1,225 is under the buy 1,300: the profit is below zero", prefill: { buy_total: 1079, replace: ["buy_total"] } });
  });

  it("says our request is not in the mailbox when only the agents' replies are filed", () => {
    const rate = (domain: string, at: string, usd: number) => mail({ from_email: `rates@${domain}`, received_at: oman(at), gmail_thread_id: `t-${domain}`, body_text: `Dear Anwar,\n\nOur rate is USD ${usd}/cbm.\n\nBest regards\nLiu` });
    const emails = [rate("consolclub.com", "2026-11-04 09:00", 450), rate("wwl.cn", "2026-11-04 10:00", 430), rate("yxcargo.com", "2026-11-04 11:00", 470), rate("sancologistics.com", "2026-11-05 09:00", 455)];
    const { rates, summary, read } = money(row(), emails);
    expect(rates.map((r) => [r.state, r.requestOnFile, r.repliedInHours])).toEqual(emails.map(() => ["rated", false, null]));
    expect(rates.filter((r) => r.lowestOnFile).map((r) => r.sideKey)).toEqual(["wwl.cn"]);
    expect(summary).toMatchObject({ writtenTo: null, replied: 4, rates: 4, declined: 0, requestOnFile: false, noReplyOnFile: [] });
    const wwl = read.sides.find((s) => s.key === "wwl.cn")!;
    expect(summary.text).toBe(`Replies on file from 4 agents · 4 rates · best on file USD 430/cbm (${wwl.name}) · our request is not in the mailbox (copy pricing@ when you ask agents)`);
    expect(summary.text).toContain("our request is not in the mailbox");
  });

  it("counts the agents we asked, who replied, declined, asked back or only acknowledged", () => {
    const agents = ["consolclub.com", "wwl.cn", "yxcargo.com", "jasclog.com", "sancologistics.com"];
    const ask = mail({
      ...MARIA, to_emails: agents.map((d) => `rates@${d}`), received_at: oman("2026-11-05 14:28"), subject: "SL262700 LCL FOB SHANGHAI CHINA TO SOHAR OMAN", gmail_thread_id: "t-ask",
      body_text: "Dear Team,\n\nPlease advise your best rates for below shipment.\n\nPOL : SHANGHAI\nPOD : SOHAR\nCOMMODITY : TILES\n\nBest Regards\n\nMaria Britto",
    });
    const reply = (domain: string, at: string, text: string) => mail({ from_email: `rates@${domain}`, from_name: "Liu", received_at: oman(at), subject: "RE: SL262700 LCL FOB SHANGHAI CHINA TO SOHAR OMAN", gmail_thread_id: `t-${domain}`, body_text: `Dear Maria,\n\n${text}\n\nBest regards\nLiu` });
    const emails = [
      ask,
      reply("consolclub.com", "2026-11-05 15:08", "Please share us the pickup address and zip code."),
      reply("wwl.cn", "2026-11-05 14:52", "Well received, we will check and revert with our best rates."),
      reply("yxcargo.com", "2026-11-06 05:39", "Sorry, we cannot quote this lane, no service from Shanghai to Sohar."),
      reply("jasclog.com", "2026-11-06 06:10", "O/F : USD 450/cbm\nTT : 28 days\nValid :until11.15"),
    ];
    const { rates, summary } = money(row(), emails);
    const by = (key: string) => rates.find((r) => r.sideKey === key)!;
    expect(rates).toHaveLength(5);
    expect(by("consolclub.com")).toMatchObject({ state: "question", summary: "Asked a question — pickup address, Thu 15:08, unanswered" });
    expect(by("consolclub.com").question).toMatchObject({ answered: false, sentence: "Please share us the pickup address and zip code." });
    expect(by("wwl.cn")).toMatchObject({ state: "acknowledged", summary: "Acknowledged Thu 14:52 · no rate yet" });
    expect(by("yxcargo.com")).toMatchObject({ state: "declined", latest: null, summary: 'Declined — "cannot quote"' });
    expect(by("yxcargo.com").options).toMatchObject([{ declined: true, declinedText: "cannot quote" }]);
    expect(by("jasclog.com")).toMatchObject({ state: "rated", repliedInHours: 16, lowestOnFile: true, summary: "USD 450/cbm · TT 28 days · valid until Sun 15 Nov" });
    expect(by("sancologistics.com")).toMatchObject({ state: "written_to", latest: null, options: [], summary: "Written to Thu 14:28 · no reply on file" });
    expect(summary).toMatchObject({ writtenTo: 5, replied: 4, rates: 1, declined: 1, requestOnFile: true, noReplyOnFile: ["sancologistics.com"] });
    expect(summary.text).toBe(`Asked 5 agents Thu 14:28 · 4 replied · 1 rate · 1 declined · best on file USD 450/cbm (${by("jasclog.com").name}) · no written reply on file from 1`);
  });

  it("gives the usual profit of a route from three priced wins", () => {
    const win = (id: string, profit: number, over: Partial<HistoryRow> = {}): HistoryRow => ({
      id, reference: id, enquiry_date: "2026-05-01", quoted_date: "2026-05-02", confirmed_date: "2026-05-03", status: "confirmed", shipment_mode: "LCL", qty_text: "LCL",
      pol: "SHANGHAI CHINA", pod: "SOHAR OMAN", customer_name: "ACME", agent_name: "FRONTLINE", buy_total: 1000, sell_total: 1000 + profit, profit, ...over,
    });
    const rows = [
      win("a", 180), win("b", 240), win("c", 254), win("d", 300), win("e", 210, { agent_name: "CONSOLE CLUB" }), win("f", 400),
      win("g", 900, { buy_total: 0 }), win("h", 900, { status: "quoted" }), win("i", 900, { shipment_mode: "FCL" }), win("SL262700", 900),
    ];
    expect(laneBenchmark(rows, { id: "SL262700", shipment_mode: "LCL" })).toEqual({
      pricedWins: 6, usualProfitUsd: 247, topAgent: { name: "Frontline", wins: 5 },
      text: "Usual profit on this route: about USD 247 (from 6 priced wins) · Frontline won 5 of them",
    });
    expect(laneBenchmark(rows.slice(0, 2), { id: "SL262700", shipment_mode: "LCL" })).toBeNull();
    expect(laneBenchmark([], { id: "SL262700", shipment_mode: "LCL" })).toBeNull();
  });
});

describe("our offer when our own mail is not filed", () => {
  it("reads it from the history a customer's reply carries below the marker", () => {
    const { row: enquiryRow, emails } = sl262784();
    // Only the customer's replies are filed: the first quotes the offer of 08:20, the nomination the final one.
    const theirs = emails.filter((e) => e.from_email === "purchase_otm@omzest.com");
    expect(theirs.every((e) => (e.body_text ?? "").includes(QUOTE_MARKER) || !/OMR/.test(e.body_text ?? "") || e.id === "sl84-08")).toBe(true);
    const { offer, read } = money({ ...enquiryRow, contact_email: "purchase_otm@omzest.com" }, theirs);
    expect(read.mails.every((m) => m.party === "customer")).toBe(true);
    expect(offer).toMatchObject({ fromQuotedHistory: true, currency: "OMR", scope: "port to port", sentAt: oman("2026-11-05 09:37"), final: true });
    expect(offer?.lines.filter((l) => !l.soft).map((l) => [l.label, l.amount])).toEqual([["Port to port", 339], ["LCL & DO", 132]]);
    expect(offer?.earlier.map((e) => e.amount)).toEqual([359]);
    expect(offer?.sentBy).toMatchObject({ name: "Anwar K. S.", email: "operation2@silverlynxoman.com" });
    expect(offer?.acceptedBy).toMatchObject({ emailId: "sl84-08" });
  });
});

describe("real mail checks", () => {
  const FAHAD = { sender_type: "staff" as const, from_email: "pricing1@silverlynxoman.com", from_name: "Fahad" };
  const CUSTOMER = "weldmax@gmail.com";
  const AGENT = "samule@consolclub.com";
  const r = () => row({ shipment_mode: "FCL", qty_text: "1X20'", units: 1, contact_email: CUSTOMER, status: "quoted", quoted_date: "2026-11-04" });
  const offerMail = mail({
    ...FAHAD, to_emails: [CUSTOMER], received_at: oman("2026-11-08 10:45"),
    body_text: "Dear Sir,\n\nPlease find the rate below:\n\nDOOR TO PORT : OMR 2510/20 GP\n\nCustom Clearance : 25\n\nTransportation To Ghala : 150\n\nDUTY&VAT : AT ACTUALS\n\nThanks Regards",
  });
  const rateMail = mail({
    from_email: AGENT, from_name: "Samule", to_emails: [FAHAD.from_email], received_at: oman("2026-11-09 12:24"),
    body_text: "Dear Team,\n\nOption2\nEXW Rate：O/F：USD5450/20GP，Truck Fee：USD230，POL Charge：USD420，Customs clearance fees：USD50/BL，Total：USD6150.\n\nPlease check and Looking forward to your reply.\n\nThanks & B.Regards !",
  });
  const agreed = mail({ ...FAHAD, to_emails: [AGENT], received_at: oman("2026-11-09 16:03"), body_text: "Dear Samule,\n\nThanks for your support. Please be informed this shipment is confirmed for rate mentioned in below trail mail.\n\nThanks Regards" });

  it("gives no margin when our offer charges clearance and transport in Oman that the agreed buy does not cover", () => {
    const { offer, buy, margin } = money(r(), [offerMail, rateMail, agreed]);
    expect(offer?.total).toBe(2685);
    expect(buy).toMatchObject({ agreed: true, total: 6150, freightOnly: true });
    expect(margin.figure).toBeNull();
    expect(margin.why).toContain("covers freight only");
  });

  it("gives no “if bought” figure from a freight rate set against those lines either", () => {
    const { margin } = money(r(), [offerMail, rateMail]);
    expect(margin.figure).toBeNull();
    expect(margin.why).toMatch(/covers the freight only/);
  });
});
