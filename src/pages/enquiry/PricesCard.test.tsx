import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentOption, AgentQuote, Buy, Margin, Offer, PersonRef, PriceLine, Proof, RegisterMoney, Target, TrailPoint, Viewer } from "../../lib/enquiryBrief";
import type { EnquiryRow } from "../../lib/types";
import { buyPrefill, offerText, PricesCard, sellPrefill, type PricesCardProps } from "./PricesCard";
import type { PageActions } from "./shared";

const row: EnquiryRow = {
  id: "e1",
  reference: "SL262784",
  enquiry_date: "2026-11-04",
  quoted_date: null,
  confirmed_date: null,
  closure: null,
  closure_reason: null,
  status: "new",
  customer_id: "c1",
  subject: null,
  trade_type: "IMP",
  qty_text: null,
  shipment_mode: "LCL",
  units: null,
  container_type: null,
  currency: "USD ",
  buy_rate: null,
  buy_total: null,
  sell_rate: null,
  sell_total: null,
  profit: null,
  pol: "NINGBO",
  pod: "SOHAR",
  agent_id: null,
  sales_person_id: null,
  remarks: null,
  contact_id: null,
  requirements: null,
  source: "email",
  import_batch_id: null,
  created_at: "2026-11-04T06:00:00Z",
  created_by: null,
  updated_at: "2026-11-04T06:00:00Z",
  updated_by: null,
  customer_name: "OMAN TEXTILES",
  agent_name: null,
  sales_person_name: "JITTU",
  contact_name: null,
  contact_email: null,
  contact_phone: null,
};

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };
const editor: Viewer = { canEdit: true, canReply: true, me: null };
const reader: Viewer = { canEdit: false, canReply: false, me: null };

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const line = (label: string, amount: number | null, from: Proof, more: Partial<PriceLine> = {}): PriceLine => ({
  label,
  amount,
  currency: "OMR",
  unit: null,
  soft: false,
  softText: null,
  main: false,
  proof: from,
  ...more,
});

const pricing: PersonRef = { name: "Anwar K. S.", email: "pricing@forwarder.example", staff: null };
const firstOffer = proof("m-offer-1", "Anwar K. S.", "Thu 05 Nov, 08:20", "SEA FOB PORT TO PORT : OMR 359.000");
const offerProof = proof("m-offer", "Anwar K. S.", "Thu 05 Nov, 09:37", "Our final offer is OMR 339 port to port");
const addOn = proof("m-addon", "Anwar K. S.", "Thu 05 Nov, 10:03", "LCL + DO : OMR 132");
const yes = proof("m-yes", "Fahid K V (Oman Textiles)", "Thu 05 Nov, 15:11", "You are here by nominated for this shipment");

const offer: Offer = {
  lines: [
    line("PORT TO PORT", 339, offerProof, { main: true }),
    line("LCL + DO", 132, addOn),
    line("CFS CHARGES", null, offerProof, { soft: true, softText: "at actuals" }),
  ],
  total: 471,
  currency: "OMR",
  whole: true,
  missing: [],
  count: null,
  twin: "≈ USD 1,225 at 2.6",
  linesText: "339 port to port + 132 LCL & DO",
  scope: "port to port",
  final: true,
  revised: false,
  basis: { cbm: 6, chargeableKg: null, grossKg: null, packages: 41, text: "6 CBM, 41 packages" },
  transit: "35 days",
  freeDays: 14,
  etd: "2026-11-19",
  routing: "via Jebel Ali",
  validUntil: null,
  validityStated: false,
  sentAt: "2026-11-05T05:37:00Z",
  sentBy: pricing,
  sentTo: ["buyer@customer.example", "manager@customer.example"],
  proof: offerProof,
  earlier: [{ amount: 359, currency: "OMR", unit: null, proof: firstOffer }],
  options: [{ label: "sea", total: 471, currency: "OMR", proof: offerProof, current: true, whole: true, rate: { amount: 339, unit: null } }],
  acceptedBy: yes,
  fromQuotedHistory: false,
};

const airProof = proof("m-air-kg", "Anwar K. S.", "Thu 05 Nov, 11:20", "AIRPORT TO AIRPORT : OMR 2.100 / KG");

/** An air offer per kilo with the weight not known: its total is only the rate, never the shipment's. */
const airByTheKilo: Offer = {
  ...offer,
  lines: [line("AIRPORT TO AIRPORT", 2.1, airProof, { main: true, unit: "/kg" }), line("DO CHARGES", 150, airProof)],
  total: 2.1,
  whole: false,
  missing: ["kg"],
  twin: "≈ USD 5.46 at 2.6",
  linesText: "2.1/kg airport to airport + 150 DO",
  scope: "airport to airport",
  basis: null,
  transit: null,
  freeDays: null,
  etd: null,
  routing: null,
  proof: airProof,
  earlier: [],
  options: [{ label: "air", total: 2.1, currency: "OMR", proof: airProof, current: true, whole: false, rate: { amount: 2.1, unit: "/kg" } }],
  acceptedBy: null,
};

const rate3 = proof("m-rate-3", "Reena Aneesh (Frontline)", "Thu 05 Nov, 14:40", "Revised O/F OMR 298");
const agree = proof("m-agree", "Anwar K. S.", "Thu 05 Nov, 16:04", "Please proceed with OMR 298 + 117");

/**
 * An agent's option as the brief reads it: a rate per unit has no total until the shipment's count, weight or volume
 * is known, and then the total is for the whole shipment.
 */
const option = (main: PriceLine, more: Partial<AgentOption> = {}): AgentOption => ({
  carrier: null,
  main,
  extras: [],
  total: main.unit ? null : main.amount,
  transit: null,
  freeDays: null,
  allIn: false,
  declined: false,
  declinedText: null,
  proof: main.proof,
  ...more,
});

const quote = (sideKey: string, name: string, more: Partial<AgentQuote> = {}): AgentQuote => ({
  sideKey,
  name,
  domain: sideKey,
  state: "rated",
  askedAt: null,
  requestOnFile: false,
  options: [],
  latest: null,
  lowestOnFile: false,
  earlier: [],
  validity: null,
  repliedInHours: null,
  question: null,
  summary: "",
  lastAt: "2026-11-05T10:40:00Z",
  ...more,
});

const frontlineRate = option(line("OCEAN FREIGHT", 298, rate3, { main: true }), {
  extras: [line("LCL + DO", 117, rate3), line("DOCUMENTATION", 5, rate3, { soft: true, softText: "approx." })],
  total: 415,
  transit: "25–35 days",
  freeDays: 14,
});

const frontline = quote("frontline.example", "FRONTLINE", {
  state: "agreed",
  askedAt: "2026-11-04T14:28:00Z",
  requestOnFile: true,
  options: [frontlineRate],
  latest: frontlineRate,
  lowestOnFile: true,
  earlier: [309, 303],
  validity: { who: "Frontline", until: null, daysLeft: null, ended: false, none: true, boilerplate: false, text: "no validity can be provided", proof: rate3 },
  repliedInHours: 13,
  summary: "OMR 309 → 303 → 298 + 117 · agreed · TT 25–35 days · no validity given",
});

const kmtcProof = proof("m-cc", "Lily (Consolclub)", "Sat 07 Nov, 08:12", "KMTC USD 6300/20, CMA USD 6150/20, MAERSK : NO SPACE");
const usd = (amount: number) => line("O/F", amount, kmtcProof, { currency: "USD", unit: "/20", main: true });
const kmtc = option(usd(6300), { carrier: "KMTC", transit: "28 days", freeDays: 11 });
const cma = option(usd(6150), { carrier: "CMA", transit: "35 days" });
const maersk = option(line("O/F", null, kmtcProof, { currency: "USD", main: true }), { carrier: "MAERSK", total: null, declined: true, declinedText: "no space" });

const consolclub = quote("consolclub.example", "CONSOLE CLUB", {
  options: [kmtc, maersk, cma],
  latest: kmtc,
  validity: { who: "Console Club", until: "2026-11-30", daysLeft: 18, ended: false, none: false, boilerplate: false, text: "valid until Mon 30 Nov", proof: kmtcProof },
  repliedInHours: 20,
  summary: "USD 6,300/20 · TT 28 days",
});

const refusal = proof("m-wwl", "Kevin (wwl.example)", "Thu 05 Nov, 11:02", "Sorry, no space on this sailing");
const wwl = quote("wwl.example", "wwl.example", {
  state: "declined",
  options: [option(line("O/F", null, refusal, { main: true }), { total: null, declined: true, declinedText: "no space on this sailing" })],
  summary: "Declined — “no space on this sailing”",
});

const asked = proof("m-q", "Milk (Yuxing)", "Wed 04 Nov, 15:08", "share us the pickup address and zip code");
const yuxing = quote("yuxing.example", "YUXING", {
  state: "question",
  question: { id: "q1", sentence: "share us the pickup address and zip code", proof: asked, age: { workingHours: 30, rawHours: 92, label: "3 working days (92 h)" }, answered: false, answeredText: null },
  summary: "Asked a question — pick-up address, Wed 15:08, unanswered",
});

const buy: Buy = {
  agreed: true,
  agentName: "FRONTLINE",
  sideKey: "frontline.example",
  total: 415,
  currency: "OMR",
  twin: "≈ USD 1,079",
  linesText: "298 ocean freight + 117 LCL & DO",
  freightOnly: false,
  proof: agree,
};

const targets: Target[] = [
  {
    who: "customer",
    amount: 105,
    currency: "OMR",
    none: false,
    agentName: null,
    text: "The customer's target: OMR 105 (Wed 04 Nov)",
    proof: proof("m-target", "Fahid K V (Oman Textiles)", "Wed 04 Nov, 12:10", "our target is OMR 105"),
  },
  {
    who: "us_to_agent",
    amount: 285,
    currency: "OMR",
    none: false,
    agentName: "Frontline",
    text: "We asked Frontline for OMR 285",
    proof: proof("m-push", "Anwar K. S.", "Thu 05 Nov, 11:30", "Please match OMR 285"),
  },
];

const margin: Margin = {
  figure: { amount: 56, currency: "OMR", pct: 12, negative: false, text: "about OMR 56" },
  inputs: "buy OMR 415, Frontline, agreed Thu 05 Nov 16:04",
  why: null,
  notes: [],
  clash: null,
  source: "mail",
};
const noMargin: Margin = { figure: null, inputs: null, why: "Needs an offer and an agreed buy", notes: [], clash: null, source: "mail" };

const point = (label: string, party: TrailPoint["party"], role: TrailPoint["role"], amount: number, from: Proof, marked = false): TrailPoint => ({
  at: "2026-11-05T05:00:00Z",
  party,
  role,
  label,
  amount,
  currency: "OMR",
  unit: null,
  marked,
  proof: from,
});

const trail: TrailPoint[] = [
  point("Frontline 309", "agent", "agent_rate", 309, proof("m-rate-1", "Reena Aneesh (Frontline)", "Thu 05 Nov, 07:11", "O/F OMR 309")),
  point("Offer 359", "us", "offer", 359, firstOffer),
  point("Offer 339 · final", "us", "offer", 339, offerProof),
  point("Yes 471", "customer", "yes", 471, yes, true),
  point("→ Frontline 285", "us", "push_to_agent", 285, targets[1].proof),
  point("Frontline 303", "agent", "agent_rate", 303, proof("m-rate-2", "Reena Aneesh (Frontline)", "Thu 05 Nov, 12:05", "O/F OMR 303")),
  point("Frontline 298", "agent", "agreed_buy", 298, agree, true),
];

const empty: RegisterMoney = { hasRates: false, missingText: null, differs: null, slip: null, prefill: null };

const notEntered: RegisterMoney = {
  ...empty,
  missingText: "Not entered. The e-mails say sell OMR 471 (≈ USD 1,225), buy OMR 415 (≈ USD 1,079).",
  prefill: { sell_total: 1225, buy_total: 1079, agent_name: "FRONTLINE", notes: ["Sell OMR 471 × 2.6 = USD 1,225", "Buy OMR 415 × 2.6 = USD 1,079"] },
};

const full: PricesCardProps = {
  row,
  offer,
  agentRates: [frontline, consolclub, wwl, yuxing],
  buy,
  targets,
  margin,
  trail,
  trailSentence: "Down OMR 20 for the customer, down OMR 11 from Frontline.",
  registerMoney: notEntered,
  viewer: editor,
  actions,
};

const bare: PricesCardProps = { ...full, offer: null, agentRates: [], buy: null, targets: [], margin: noMargin, trail: [], trailSentence: null, registerMoney: empty };

const html = (props: Partial<PricesCardProps> = {}) => renderToStaticMarkup(<PricesCard {...full} {...props} />);

/** What the page says to a screen reader, without its markup. */
const spoken = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

/** What the page shows: the same without the words kept for screen readers. */
const words = (markup: string) => spoken(markup.replace(/<!-- -->/g, "").replace(/<span class="sr-only">[^<]*<\/span>/g, ""));

const render = (props: Partial<PricesCardProps> = {}) => words(html(props));

const count = (text: string, part: string) => text.split(part).length - 1;

/** The class pair of a filled button. */
const FILLED = "bg-primary text-white";

// Days are worded against today (the year shows once it is not this one), so the clock stands still here.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T08:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("PricesCard", () => {
  it("shows our offer as lines with its total, terms, earlier amount and the customer's yes", () => {
    const markup = html();
    const text = words(markup);
    expect(markup).toMatch(/<section id="prices" aria-labelledby="prices-title"/);
    expect(text).toContain("What we offered");
    expect(text).toContain("final · Thu 05 Nov, 09:37 · Anwar K. S. to buyer@customer.example +1");

    expect(text).toContain("Port to Port OMR 339");
    expect(text).toContain("LCL + DO OMR 132");
    expect(text).toContain("CFS Charges at actuals");
    expect(text).toContain("Total of firm lines OMR 471 ≈ USD 1,225 at 2.6");
    expect(text.indexOf("OMR 132")).toBeLessThan(text.indexOf("at actuals"));

    expect(text).toContain("Basis 6 CBM, 41 packages");
    expect(text).toContain("Transit 35 days");
    expect(text).toContain("Free days 14");
    expect(text).toContain("ETD Thu 19 Nov");
    expect(text).toContain("Routing via Jebel Ali");
    expect(text).toContain("Validity none stated");

    expect(text).toContain("Earlier: OMR 359 (Thu 05 Nov, 08:20)");
    expect(text).not.toContain("Options:");
    expect(text).toContain("Accepted by the customer Thu 05 Nov, 15:11");
    expect(markup).toContain(">Use as sell</button>");
    expect(text).toContain("Copy offer text");
    expect(markup).not.toContain(FILLED);
  });

  it("shows what each agent charges, where they stand and the options of one e-mail", () => {
    const text = render();
    expect(text).toContain("What agents charge");
    expect(text).toContain("Frontline Agreed ★ lowest on file OMR 298 ≈ USD 775");
    expect(text).toContain("TT 25–35 days · 14 free days");
    expect(text).toContain("no validity given");
    expect(text).toContain("replied in 13 h");
    expect(text).toContain("was 309 → 303");
    expect(text).toContain("Agreed buy: OMR 415 ≈ USD 1,079 · 298 ocean freight + 117 LCL & DO");
    expect(text).toContain("+2 small items");
    expect(text).toContain("LCL + DO OMR 117");
    expect(text).toContain("Documentation approx. OMR 5");
    expect(text).toContain("With the firm ones OMR 415");

    expect(text).toContain("Console Club Rated USD 6,300/20 ≈ OMR 2,423");
    expect(text).toContain("KMTC · TT 28 days · 11 free days");
    expect(text).toContain("valid until Mon 30 Nov");
    // Our request to them is not on file: how long they took is not said.
    expect(text).not.toContain("replied in 20 h");
    // The options of their e-mail, cheapest first, the one without space last.
    const options = ["CMA · TT 35 days USD 6,150/20", "KMTC · TT 28 days · 11 free days USD 6,300/20", "MAERSK · no space"].map((part) => text.indexOf(part));
    expect(options.every((at) => at > 0)).toBe(true);
    expect([...options].sort((a, b) => a - b)).toEqual(options);
    expect(html()).toContain("<s>MAERSK · no space</s>");

    expect(text).toContain("wwl.example Declined");
    expect(text).toContain("Declined — “no space on this sailing”");
    expect(text).toContain("Yuxing Asked a question");
    expect(text).toContain("Asked a question — pick-up address, Wed 15:08, unanswered");
    expect(html()).toMatch(/bg-await-bg text-await"><svg[^>]*>.*?<\/svg>Asked a question/);

    // One for each agent with a total that can be worked out: the agreed one and the rate per container.
    expect(count(html(), ">Use as buy</button>")).toBe(2);
    expect(text).toContain("The customer's target: OMR 105 (Wed 04 Nov)");
    expect(text).toContain("We asked Frontline for OMR 285");
  });

  it("shows how the figures moved, the margin with its inputs, and what the register lacks", () => {
    const markup = html();
    const text = words(markup);
    expect(text).toContain("How the prices moved");
    const read = spoken(markup);
    const order = ["Frontline 309", "Offer 359", "Offer 339 · final", "Yes 471", "→ Frontline 285", "Frontline 303", "Frontline 298"].map((label) => read.indexOf(`: ${label}`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toMatch(/bg-party-agent-bg text-party-agent">[\s\S]*?Frontline 309/);
    expect(markup).toMatch(/bg-party-customer-bg text-party-customer"><svg[\s\S]*?Yes 471/);
    expect(read).toContain("Customer: Yes 471");
    expect(read).toContain("Agent: Frontline 298 (agreed)");
    expect(read).toContain("Ours: Offer 339 · final");
    expect(text).not.toContain("Show all");
    expect(text).toContain("Down OMR 20 for the customer, down OMR 11 from Frontline.");

    expect(text).toContain("Margin about OMR 56 12% of the offer");
    expect(text).toContain("buy OMR 415, Frontline, agreed Thu 05 Nov 16:04");
    // The buy behind the margin opens the e-mail that agreed it.
    expect(markup).toMatch(/title="Anwar K\. S\. · Thu 05 Nov, 16:04 · “Please proceed with OMR 298 \+ 117”"[^>]*>buy OMR 415, Frontline, agreed Thu 05 Nov 16:04/);
    expect(markup).not.toMatch(/text-lost[^"]*">about OMR 56/);

    expect(text).toContain("In the register (USD)");
    expect(text).toContain("Not entered. The e-mails say sell OMR 471 (≈ USD 1,225), buy OMR 415 (≈ USD 1,079).");
    expect(text).toContain("Use these…");
    expect(text).not.toContain("No rates entered yet.");
    expect(text).toContain("Read from the e-mails, so check before you save. The register keeps USD; OMR is converted at 2.6 as the register does");
    expect(markup).not.toContain("<table class=\"w-full text-body\"><thead");
  });

  it("says where every reading came from", () => {
    const markup = html();
    expect(markup).toContain('title="Anwar K. S. · Thu 05 Nov, 10:03 · “LCL + DO : OMR 132”"');
    expect(markup).toContain('title="Anwar K. S. · Thu 05 Nov, 08:20 · “SEA FOB PORT TO PORT : OMR 359.000”"');
    expect(markup).toContain('title="Fahid K V (Oman Textiles) · Thu 05 Nov, 15:11 · “You are here by nominated for this shipment”"');
    expect(markup).toContain('title="Reena Aneesh (Frontline) · Thu 05 Nov, 14:40 · “Revised O/F OMR 298”"');
    expect(markup).toContain('title="Anwar K. S. · Thu 05 Nov, 16:04 · “Please proceed with OMR 298 + 117”"');
    expect(markup).toContain('title="Milk (Yuxing) · Wed 04 Nov, 15:08 · “share us the pickup address and zip code”"');
    expect(markup).toContain('title="Their rates in order: 309 → 303 → 298"');
  });

  it("says so when nothing is on file", () => {
    const markup = html(bare);
    const text = words(markup);
    expect(markup).toContain('id="prices"');
    expect(text).toContain("No prices in the e-mails yet.");
    expect(text).toContain("No rates entered yet.");
    expect(text).not.toContain("What we offered");
    expect(text).not.toContain("Margin");
    expect(text).not.toContain("Read from the e-mails");
    expect(text).not.toContain("reports miss");
    expect(markup).not.toContain("<button");

    expect(render({ ...bare, row: { ...row, status: "confirmed", confirmed_date: "2026-11-06" } })).toContain("No rates entered yet. Without a sell amount, the reports miss this job's profit.");
  });

  it("names the half that is missing", () => {
    const ratesOnly = render({ offer: null, buy: null, targets: [], trail: [], trailSentence: null, margin: noMargin, registerMoney: empty });
    expect(ratesOnly).toContain("No offer in the e-mails yet.");
    expect(ratesOnly).toContain("Console Club");
    expect(ratesOnly).toContain("— Needs an offer and an agreed buy");
    expect(ratesOnly).not.toContain("How the prices moved");

    const offerOnly = render({ agentRates: [], buy: null, targets: [], trail: [], trailSentence: null, margin: noMargin, registerMoney: empty });
    expect(offerOnly).toContain("Port to Port OMR 339");
    expect(offerOnly).toContain("No agent's rate in the e-mails yet.");
  });

  it("gives a reader without rights every reading and only the copy button", () => {
    const markup = html({
      viewer: reader,
      registerMoney: {
        ...notEntered,
        differs: { text: "Register buy USD 7,000; agreed by e-mail USD 6,300/20 (Consolclub, Sat 07 Nov)", prefill: { buy_total: 6300, replace: ["buy_total"], notes: [] }, dismissId: "rates-buy" },
        slip: { text: "Profit is 91% of the sell — buy 610 looks like a slip.", prefill: { buy_total: 6300, notes: [] } },
      },
    });
    const text = words(markup);
    expect(text).toContain("Port to Port OMR 339");
    expect(text).toContain("Frontline Agreed");
    expect(text).toContain("Register buy USD 7,000; agreed by e-mail USD 6,300/20 (Consolclub, Sat 07 Nov)");
    expect(text).toContain("Profit is 91% of the sell — buy 610 looks like a slip.");
    expect(text).toContain("Copy offer text");
    for (const label of ["Use as sell", "Use as buy", "Use these…", "Update rates…", "Keep the register's"]) expect(text).not.toContain(label);
    expect(markup).not.toContain(FILLED);
  });

  it("keeps the register's table, and offers to update or keep it where the e-mails differ", () => {
    const markup = html({
      row: { ...row, status: "confirmed", confirmed_date: "2026-10-28", units: 2, buy_rate: 305, buy_total: 610, sell_rate: 3500, sell_total: 7000, profit: 6390, commission_amount: 40, commission_currency: "OMR", commission_per_unit: true },
      margin: { figure: { amount: 6390, currency: "USD", pct: 91.3, negative: false, text: "about USD 6,390" }, inputs: "register", why: null, notes: [], clash: null, source: "register" },
      registerMoney: {
        hasRates: true,
        missingText: null,
        differs: { text: "Register buy USD 610; agreed by e-mail USD 6,300/20 (Consolclub, Sat 07 Nov)", prefill: { buy_total: 12600, replace: ["buy_total"], notes: ["Buy USD 6,300/20 × 2"] }, dismissId: "rates-buy" },
        slip: { text: "Profit is 91% of the sell — buy 610 looks like a slip.", prefill: null },
        prefill: null,
      },
    });
    const text = words(markup);
    expect(text).toContain("Per unit");
    expect(text).toContain("Total (2 units)");
    expect(text).toContain("Buy 305 610");
    expect(text).toContain("Sell 3,500 7,000");
    expect(text).toContain("Profit 6,390 (91.3%)");
    expect(text).toContain("Commission: OMR 40 per container × 2 = OMR 80");
    expect(text).toContain("Register buy USD 610; agreed by e-mail USD 6,300/20 (Consolclub, Sat 07 Nov)");
    expect(count(markup, ">Update rates…</button>")).toBe(1);
    expect(markup).toMatch(/text-ink-heading hover:bg-row-hover[^>]*>Keep the register&#x27;s<\/button>/);
    expect(text).toContain("Profit is 91% of the sell — buy 610 looks like a slip.");
    // The register's own profit stands in its table: no second figure.
    expect(markup).not.toContain('id="prices-margin"');
    expect(text).not.toContain("Use these…");
    expect(markup).not.toContain(FILLED);

    const loss = html({ row: { ...row, buy_total: 900, sell_total: 800, profit: -100 }, registerMoney: { ...empty, hasRates: true } });
    expect(loss).toMatch(/font-semibold text-lost">-100/);
  });

  it("offers to update a slip on its own line when nothing else differs", () => {
    const markup = html({
      row: { ...row, buy_total: 610, sell_total: 7000, profit: 6390 },
      registerMoney: { hasRates: true, missingText: null, differs: null, slip: { text: "Profit is 91% of the sell — buy 610 looks like a slip.", prefill: { buy_total: 6300, replace: ["buy_total"], notes: [] } }, prefill: null },
    });
    expect(count(markup, ">Update rates…</button>")).toBe(1);
    expect(markup).not.toContain("Keep the register");
  });

  it("colours a margin only when it is below zero, and puts a currency mix-up in its place", () => {
    const negative = html({ margin: { ...margin, figure: { amount: -12, currency: "OMR", pct: -3, negative: true, text: "about OMR −12" }, notes: ["converted at 2.6", "after commission OMR 16"] } });
    expect(negative).toMatch(/text-lost">about OMR −12</);
    expect(words(negative)).toContain("−3% of the offer");
    expect(words(negative)).toContain("buy OMR 415, Frontline, agreed Thu 05 Nov 16:04 · converted at 2.6 · after commission OMR 16");

    const clash = render({
      margin: {
        ...noMargin,
        clash: {
          amount: 8995,
          currencies: ["EUR", "USD"],
          text: "Two currencies for 8,995: MLE wrote EUR, we wrote USD",
          proofs: [proof("m-eur", "Marco (MLE)", "Tue 03 Nov, 14:20", "EUR 8,995 all in"), proof("m-usd", "Anwar K. S.", "Tue 03 Nov, 16:05", "USD 8,995 as agreed")],
        },
      },
      buy: { ...buy, freightOnly: true },
    });
    expect(clash).toContain("Check the currency");
    expect(clash).toContain("Two currencies for 8,995: MLE wrote EUR, we wrote USD");
    expect(clash).toContain("EUR · Tue 03 Nov, 14:20");
    expect(clash).toContain("USD · Tue 03 Nov, 16:05");
    expect(clash).toContain("The buy covers freight only");
  });

  it("lists the options, a stated validity, and an offer read from the customer's reply", () => {
    const air = proof("m-air", "Anwar K. S.", "Thu 05 Nov, 10:02", "AIR DOOR TO DOOR : OMR 768.000");
    const text = render({
      offer: {
        ...offer,
        lines: [
          line("SEA FOB PORT TO PORT", 315, offerProof, { main: true }),
          line("O/F SURCHARGE", 12, offerProof, { soft: true, softText: "approx." }),
          line("Port handling at Sohar", null, offerProof, { soft: true }),
        ],
        total: 315,
        twin: "≈ USD 819 at 2.6",
        final: false,
        revised: true,
        validUntil: "2026-11-30",
        validityStated: true,
        earlier: [],
        acceptedBy: null,
        fromQuotedHistory: true,
        options: [
          { label: "sea", total: 315, currency: "OMR", proof: offerProof, current: true, whole: true, rate: { amount: 315, unit: null } },
          { label: "air", total: 768, currency: "OMR", proof: air, current: false, whole: true, rate: { amount: 768, unit: null } },
        ],
      },
    });
    expect(text).toContain("revised · Thu 05 Nov, 09:37 · from an earlier e-mail quoted by the customer");
    // One firm line is its own total.
    // Labels typed in capitals are shown as names are; one that already uses lower case is left as written.
    expect(text).toContain("Sea FOB Port to Port OMR 315 ≈ USD 819 at 2.6");
    expect(text).toContain("O/F Surcharge approx. OMR 12");
    expect(text).toContain("Port handling at Sohar at actuals");
    expect(text).not.toContain("Total of firm lines");
    expect(text).toContain("Validity until Mon 30 Nov");
    expect(text).toContain("Options: sea OMR 315 · air OMR 768");
    expect(text).not.toContain("Earlier:");
    expect(text).not.toContain("Accepted by the customer");
  });

  it("never shows a rate per kilo with no weight as a total, and offers no sell from it", () => {
    const markup = html({ offer: { ...airByTheKilo, options: [...airByTheKilo.options, { label: "sea", total: 471, currency: "OMR", proof: offerProof, current: false, whole: true, rate: { amount: 339, unit: null } }] } });
    const text = words(markup);
    expect(text).toContain("Airport to Airport OMR 2.1 per kg");
    expect(text).toContain("DO Charges OMR 150");
    expect(text).not.toContain("Total of firm lines");
    expect(text).toContain("Total depends on the weight");
    // No twin of a figure that is not the total.
    expect(text).not.toContain("≈ USD 5.46");
    expect(text).toContain("Options: air OMR 2.1/kg · sea OMR 471");
    expect(markup).not.toContain(">Use as sell</button>");
    expect(text).toContain("Copy offer text");
  });

  it("shows an earlier offer in the currency it was written in", () => {
    const usdFirst = proof("m-usd", "Anwar K. S.", "Wed 04 Nov, 10:00", "PORT TO PORT : USD 1000");
    const text = render({ offer: { ...offer, earlier: [{ amount: 1000, currency: "USD", unit: null, proof: usdFirst }] } });
    expect(text).toContain("Earlier: USD 1,000 (Wed 04 Nov, 10:00)");
    expect(text).not.toContain("OMR 1,000");
  });

  it("shows an agent's total for the shipment without the rate's per-unit mark", () => {
    const winco = option(line("Ocean freight", 1000, kmtcProof, { currency: "USD", unit: "/40 HC", main: true }), { total: 3100, extras: [line("THC", 100, kmtcProof, { currency: "USD" })] });
    const text = render({ agentRates: [quote("winco.example", "WINCO", { options: [winco], latest: winco })], buy: null, row: { ...row, units: 3 } });
    expect(text).toContain("Winco Rated USD 1,000/40 HC");
    expect(text).toContain("With the firm ones USD 3,100");
    expect(text).not.toContain("USD 3,100/40 HC");
  });

  it("strikes a validity that has ended, but never their standard wording", () => {
    const ended = html({
      agentRates: [{ ...consolclub, validity: { who: "Console Club", until: "2026-11-07", daysLeft: -5, ended: true, none: false, boilerplate: false, text: "ended 07 Nov", proof: kmtcProof } }],
    });
    expect(ended).toContain("<s>ended 07 Nov</s>");
    expect(spoken(ended)).toContain("ended 07 Nov (no longer valid)");

    const standard = html({
      agentRates: [{ ...consolclub, validity: { who: "Console Club", until: "2026-11-07", daysLeft: -5, ended: true, none: false, boilerplate: true, text: "valid for 7 days", proof: kmtcProof } }],
    });
    expect(standard).not.toContain("<s>valid for 7 days</s>");
    expect(words(standard)).toContain("valid for 7 days (from their standard wording)");
  });

  it("shows the latest ten points of a long trail and offers the rest", () => {
    const long = Array.from({ length: 14 }, (_, i) => point(`Frontline ${400 - i}`, "agent", "agent_rate", 400 - i, rate3));
    const markup = html({ trail: long, trailSentence: null });
    const text = words(markup);
    expect(text).not.toContain("Frontline 400");
    expect(text).not.toContain("Frontline 397");
    expect(text).toContain("Frontline 396");
    expect(text).toContain("Frontline 387");
    expect(markup).toMatch(/aria-expanded="false"[^>]*>Show all 14</);
    expect(text).not.toContain("Down OMR");
  });

  it("uses the page's words", () => {
    for (const text of [spoken(html()), spoken(html(bare))]) expect(text).not.toMatch(/\b(lane|ball|relay|silent|healthy|thin|counterparts)\b/i);
  });
});

describe("sellPrefill", () => {
  it("turns the offer into the register's sell in USD and says where it came from", () => {
    expect(sellPrefill(offer, row)).toEqual({
      sell_total: 1225,
      quoted_date: "2026-11-05",
      notes: ["Sell OMR 471 × 2.6 = USD 1,225 (e-mail from Anwar K. S., Thu 05 Nov, 09:37)", "Quoted date Thu 05 Nov, the day of that e-mail"],
    });
  });

  it("replaces a sell the register holds, and keeps its quoted date", () => {
    const prefill = sellPrefill(offer, { ...row, sell_total: 1300, quoted_date: "2026-11-04" });
    expect(prefill?.replace).toEqual(["sell_total"]);
    expect(prefill?.quoted_date).toBeUndefined();
    expect(prefill?.notes).toHaveLength(1);
  });

  it("keeps a USD offer as written and marks other currencies as about", () => {
    const dollars = sellPrefill({ ...offer, total: 7000.5, currency: "USD" }, row);
    expect(dollars?.sell_total).toBe(7000.5);
    expect(dollars?.notes[0]).toBe("Sell USD 7,000.5 (e-mail from Anwar K. S., Thu 05 Nov, 09:37)");

    const euros = sellPrefill({ ...offer, total: 8995, currency: "EUR" }, row);
    expect(euros?.sell_total).toBe(9715);
    expect(euros?.notes[0]).toContain("Sell EUR 8,995 × about 1.08 = about USD 9,715");
  });

  // The brief multiplies a rate per container out before it calls a total whole: 2 × OMR 2,596 for two boxes. The
  // old fixture (one box's 2,596 with the register at 2 units) was a total that is not whole, which now gets no sell.
  it("takes no date from an offer read in the customer's reply, and says how many containers a total is for", () => {
    const quoted = sellPrefill({ ...offer, fromQuotedHistory: true }, row);
    expect(quoted?.quoted_date).toBeUndefined();
    expect(quoted?.notes[0]).toContain("(our offer as quoted in the e-mail from Anwar K. S., Thu 05 Nov, 09:37)");

    const perBox = { ...offer, lines: [line("DOOR TO PORT", 2596, offerProof, { main: true, unit: "/40 HC" })], total: 5192, count: 2 };
    const two = sellPrefill(perBox, { ...row, units: 2 });
    expect(two?.sell_total).toBe(13499);
    expect(two?.notes).toContain("The offer is per 40 HC: the total is for 2 containers");

    // The offer states one box while the register counts two: the person decides which is right.
    const one = sellPrefill({ ...perBox, total: 2596, count: 1 }, { ...row, units: 2 });
    expect(one?.sell_total).toBe(6750);
    expect(one?.notes).toContain("The offer is per 40 HC: the total is for 1 container; the register counts 2 units: check which is right");
  });

  it("gives no sell when the total is not for the whole shipment", () => {
    expect(sellPrefill(airByTheKilo, row)).toBeNull();
    expect(sellPrefill({ ...offer, whole: undefined } as unknown as typeof offer, row)).toBeNull();
  });
});

describe("buyPrefill", () => {
  it("uses the agreed buy for the agreed agent, with the agent's register name", () => {
    expect(buyPrefill(frontline, buy, row)).toEqual({
      buy_total: 1079,
      agent_name: "FRONTLINE",
      notes: ["Buy OMR 415 × 2.6 = USD 1,079, agreed with Frontline (e-mail from Anwar K. S., Thu 05 Nov, 16:04)", "Agent Frontline, from the e-mails with frontline.example"],
    });
  });

  it("multiplies a rate per container by the register's units and says it is not agreed", () => {
    const prefill = buyPrefill(consolclub, buy, { ...row, units: 2 });
    expect(prefill?.buy_total).toBe(12600);
    expect(prefill?.agent_name).toBe("CONSOLE CLUB");
    // The unit stays with the rate, never with the total.
    expect(prefill?.notes[0]).toBe("Buy USD 12,600 (USD 6,300/20 × 2), Console Club's rate, not agreed by e-mail (e-mail from Lily (Consolclub), Sat 07 Nov, 08:12)");

    const one = buyPrefill(consolclub, null, row);
    expect(one?.buy_total).toBe(6300);
    expect(one?.notes).toContain("The register has no unit count: taken as one unit");
  });

  it("never multiplies again a total the brief already worked out for the shipment", () => {
    // Winco: USD 1,000 per 40 HC; for 3 boxes the brief's total is USD 3,000.
    const winco = option(line("Ocean freight", 1000, kmtcProof, { currency: "USD", unit: "/40 HC", main: true }), { total: 3000 });
    const prefill = buyPrefill(quote("winco.example", "WINCO", { options: [winco], latest: winco }), null, { ...row, units: 3 });
    expect(prefill?.buy_total).toBe(3000);
    expect(prefill?.notes[0]).toBe("Buy USD 3,000 (USD 1,000/40 HC × 3), Winco's rate, not agreed by e-mail (e-mail from Lily (Consolclub), Sat 07 Nov, 08:12)");
    expect(prefill?.notes).not.toContain("The register has no unit count: taken as one unit");

    // With a firm small item beside the rate the total holds it too.
    const withThc = option(winco.main, { total: 3100, extras: [line("THC", 100, kmtcProof, { currency: "USD" })] });
    const thc = buyPrefill(quote("winco.example", "WINCO", { options: [withThc], latest: withThc }), null, { ...row, units: 3 });
    expect(thc?.buy_total).toBe(3100);
    expect(thc?.notes[0]).toMatch(/^Buy USD 3,100 \(USD 1,000\/40 HC and the firm small items\), Winco's rate/);

    // A rate per kilo whose weight the brief knew has a total too.
    const perKg = option(line("A/F", 5.4, kmtcProof, { currency: "USD", unit: "/kg", main: true }), { total: 1512 });
    const air = buyPrefill(quote("air.example", "AIR AGENT", { options: [perKg], latest: perKg }), null, row);
    expect(air?.buy_total).toBe(1512);
    expect(air?.notes[0]).toMatch(/^Buy USD 1,512 \(USD 5\.4\/kg × 280\), Air Agent's rate/);
  });

  it("uses a rate for the shipment with its firm small items", () => {
    const prefill = buyPrefill(frontline, null, row);
    expect(prefill?.buy_total).toBe(1079);
    expect(prefill?.notes[0]).toBe("Buy OMR 415 × 2.6 = USD 1,079, Frontline's rate (e-mail from Reena Aneesh (Frontline), Thu 05 Nov, 14:40)");
  });

  it("replaces what the register holds only where it differs", () => {
    const prefill = buyPrefill(frontline, buy, { ...row, buy_total: 900, agent_name: "WWL" });
    expect(prefill?.replace).toEqual(["buy_total", "agent_name"]);
    const same = buyPrefill(frontline, buy, { ...row, agent_name: "Frontline" });
    expect(same?.agent_name).toBeUndefined();
    expect(same?.replace).toBeUndefined();
  });

  it("offers nothing without a total, and no agent name for a side known only by its domain", () => {
    expect(buyPrefill(wwl, buy, row)).toBeNull();
    expect(buyPrefill(yuxing, buy, row)).toBeNull();
    const perKg = option(line("A/F", 5.4, kmtcProof, { currency: "USD", unit: "/kg", main: true }));
    expect(buyPrefill(quote("air.example", "AIR AGENT", { options: [perKg], latest: perKg }), null, row)).toBeNull();

    const unnamed = buyPrefill(quote("rates@agent.example", "rates@agent.example", { options: [kmtc], latest: kmtc }), null, { ...row, units: 1 });
    expect(unnamed?.buy_total).toBe(6300);
    expect(unnamed?.agent_name).toBeUndefined();
  });
});

describe("offerText", () => {
  it("writes the offer's own lines and terms, and nothing about the buy", () => {
    expect(offerText(offer)).toBe(
      ["PORT TO PORT: OMR 339", "LCL + DO: OMR 132", "CFS CHARGES: at actuals", "Total: OMR 471", "Based on: 6 CBM, 41 packages", "Transit time: 35 days", "Free time: 14 days", "ETD: Thu 19 Nov", "Routing: via Jebel Ali"].join("\n"),
    );
    const dated = offerText({ ...offer, lines: [line("DOOR TO PORT", 2596, offerProof, { main: true, unit: "/40 HC" })], total: 2596, count: 1, basis: null, transit: null, freeDays: null, etd: null, routing: null, validUntil: "2026-11-30" });
    expect(dated).toBe(["DOOR TO PORT: OMR 2,596/40 HC", "Valid until: Mon 30 Nov"].join("\n"));
  });

  it("writes no total that is not for the whole shipment, and says what it depends on", () => {
    expect(offerText(airByTheKilo)).toBe(["AIRPORT TO AIRPORT: OMR 2.1/kg", "DO CHARGES: OMR 150", "Total: depends on the weight"].join("\n"));
    const boxes = offerText({ ...airByTheKilo, lines: [line("PORT TO PORT", 500, offerProof, { main: true, unit: "/40" })], total: 500, missing: ["containers", "kg"] });
    expect(boxes).toBe(["PORT TO PORT: OMR 500/40", "Total: depends on the number of containers and the weight"].join("\n"));
  });
});
