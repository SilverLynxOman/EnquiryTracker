import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Margin, Move, NeedItem, NowAction, Offer, PersonRef, Proof, RegisterMoney } from "../../lib/enquiryBrief";
import type { EnquiryRow } from "../../lib/types";
import { GlanceBand, type GlanceBandProps } from "./GlanceBand";
import { NowCard } from "./NowCard";
import type { PageActions } from "./shared";

// The Now card's price-checker note comes from a module that also loads the list from the database.
vi.mock("../../lib/api", () => ({ fetchPriceCheckers: vi.fn() }));

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

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const saidYes: Move = {
  kind: "said_yes",
  icon: "check",
  tone: "good",
  word: "Said yes — not confirmed",
  why: ["Nominated Thu 05 Nov 15:11; we told Frontline to proceed 16:04.", "Nothing waits on us: our last e-mail Mon 11:15."],
  clock: null,
  sideKey: "customer",
  proof: proof("m-yes", "Fahid K V (Oman Textiles)", "Thu 05 Nov, 15:11", "You are here by nominated for this shipment"),
};

const noMail: Move = {
  kind: "no_mail",
  icon: "clock",
  tone: "neutral",
  word: "No e-mails on file",
  why: [],
  clock: "Quoted 02 Nov · waiting 7 days by the register",
  sideKey: null,
  proof: null,
};

const pricing: PersonRef = { name: "Anwar K. S.", email: "pricing@forwarder.example", staff: null };
const offerProof = proof("m-offer", "Anwar K. S.", "Thu 05 Nov, 09:37", "Our final offer is OMR 339 port to port");

const offer: Offer = {
  lines: [
    { label: "Port to port", amount: 339, currency: "OMR", unit: null, soft: false, softText: null, main: true, proof: offerProof },
    { label: "LCL and DO", amount: 132, currency: "OMR", unit: null, soft: false, softText: null, main: false, proof: offerProof },
  ],
  total: 471,
  currency: "OMR",
  whole: true,
  missing: [],
  count: null,
  twin: "≈ USD 1,225 at 2.6",
  linesText: "339 port to port + 132 LCL and DO",
  scope: "port to port",
  final: true,
  revised: false,
  basis: null,
  transit: null,
  freeDays: null,
  etd: null,
  routing: null,
  validUntil: null,
  validityStated: false,
  sentAt: "2026-11-05T05:37:00Z",
  sentBy: pricing,
  sentTo: ["buyer@customer.example"],
  proof: offerProof,
  earlier: [],
  options: [{ label: "sea", total: 471, currency: "OMR", proof: offerProof, current: true, whole: true, rate: { amount: 339, unit: null } }],
  acceptedBy: null,
  fromQuotedHistory: false,
};

const margin: Margin = {
  figure: { amount: 56, currency: "OMR", pct: 12, negative: false, text: "about OMR 56" },
  inputs: "buy OMR 415, Frontline, agreed Thu 05 Nov 16:04",
  why: null,
  notes: [],
  clash: null,
  source: "mail",
};

const noMargin: Margin = { figure: null, inputs: null, why: "Needs an offer and an agreed buy", notes: [], clash: null, source: "mail" };

const registerMoney: RegisterMoney = { hasRates: false, missingText: null, differs: null, slip: null, prefill: null };

const needs: NeedItem[] = [
  {
    id: "set-agent",
    verb: "set_agent",
    text: "Agent not in the register: the e-mails are with Frontline",
    age: null,
    tone: "neutral",
    proof: null,
    button: { id: "edit_prefilled", label: "Update agent", variant: "secondary", formPrefill: { agent_name: "FRONTLINE", notes: [] } },
    done: false,
  },
  {
    id: "answer-consolclub",
    verb: "answer",
    text: "Answer Consolclub: the pick-up address and zip code",
    age: { workingHours: 30, rawHours: 92, label: "3 working days (92 h)" },
    tone: "warn",
    proof: proof("m-question", "Lily (Consolclub)", "Wed 04 Nov, 15:08", "share us the pickup address and zip code"),
    button: { id: "reply", label: "Reply", variant: "secondary", sideKey: "agent.example" },
    done: false,
  },
  {
    id: "complaint",
    verb: "answer",
    text: "Complaint Mon 09:25 answered by Ashwin at 11:15",
    age: null,
    tone: "neutral",
    proof: null,
    button: null,
    done: true,
  },
];

const base: GlanceBandProps = {
  move: saidYes,
  offer,
  margin,
  registerMoney,
  row,
  needsYou: needs,
  now: <p>NOW NODE</p>,
  actions,
  loading: false,
  error: null,
};

const render = (props: Partial<GlanceBandProps> = {}) => renderToStaticMarkup(<GlanceBand {...base} {...props} />);

const count = (html: string, part: string) => html.split(part).length - 1;

/** The class pair of a filled button, and the ring of an outline one. */
const FILLED = "bg-primary text-white";
const OUTLINE = "ring-control";

describe("GlanceBand", () => {
  it("shows whose move it is, the offer, the margin, the Now card and what else waits", () => {
    const html = render();
    expect(html).toMatch(/<section[^>]*id="glance"[^>]*aria-label="At a glance"/);

    expect(html).toContain("Whose move");
    expect(html).toContain("Said yes — not confirmed");
    expect(html).toContain("Nominated Thu 05 Nov 15:11; we told Frontline to proceed 16:04.");
    expect(html).toContain("Nothing waits on us: our last e-mail Mon 11:15.");
    expect(html).toContain("text-confirmed");

    expect(html).toContain(">OMR</span>");
    expect(html).toContain(">471</span>");
    expect(html).toContain("339 port to port + 132 LCL and DO");
    expect(html).toContain(">final ·</span>");
    expect(html).toContain(">Thu 05 Nov, 09:37<");
    expect(html).toContain(">no validity stated</span>");
    expect(html).not.toContain("Options:");

    expect(html).toContain(">about OMR</span>");
    expect(html).toContain(">56</span>");
    expect(html).toContain("12% of the offer");
    expect(html).toContain("buy OMR 415, Frontline, agreed Thu 05 Nov 16:04");

    expect(html).toContain("NOW NODE");

    expect(html).toContain('aria-label="Needs you"');
    expect(html).toContain("Needs you<span");
    expect(html).toContain(" (2)</span>");
    expect(html).toContain("Agent not in the register: the e-mails are with Frontline");
    expect(html).toContain(">Update agent</button>");
    expect(html).toContain("Answer Consolclub: the pick-up address and zip code");
    expect(html).toContain("3 working days (92 h)");
    expect(html).toContain(">Reply</button>");
    expect(html).toContain("<s>Complaint Mon 09:25 answered by Ashwin at 11:15</s>");
    expect(html).not.toContain("Show ");

    expect(html).not.toContain(FILLED);
  });

  it("shows where each reading came from", () => {
    const html = render();
    expect(html).toContain('title="Fahid K V (Oman Textiles) · Thu 05 Nov, 15:11 · “You are here by nominated for this shipment”"');
    expect(count(html, 'title="Anwar K. S. · Thu 05 Nov, 09:37 · “Our final offer is OMR 339 port to port”"')).toBe(2);
    expect(html).toContain('title="Lily (Consolclub) · Wed 04 Nov, 15:08 · “share us the pickup address and zip code”"');
    expect(html).toContain(": show the prices");
  });

  it("holds the Now card with the page's one filled button", () => {
    const now: NowAction = {
      kind: "won_unmarked",
      tone: "good",
      title: "Won by e-mail on Thu 05 Nov — the register says awaiting quote",
      said: null,
      lines: [],
      buttons: [{ id: "confirm_job", label: "Confirm job on Thu 05 Nov", variant: "primary", date: "2026-11-05" }],
      checkLine: "Read from the e-mails — check before you click.",
    };
    const html = render({ now: <NowCard now={now} row={row} actions={actions} /> });
    expect(html).toContain("Won by e-mail on Thu 05 Nov");
    expect(count(html, 'id="now-primary"')).toBe(1);
    expect(count(html, FILLED)).toBe(1);
  });

  it("says so when nothing is on file", () => {
    const html = render({ move: noMail, offer: null, margin: noMargin, needsYou: [] });
    expect(html).toContain("No e-mails on file");
    expect(html).toContain("Quoted 02 Nov · waiting 7 days by the register");
    expect(html).toContain("No offer on file");
    expect(html).toContain("Nothing with a price went to the customer from this mailbox.");
    expect(html).toContain("—");
    expect(html).toContain("Needs an offer and an agreed buy");
    expect(html).toContain("Nothing else waits on you.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<ol");

    const quoted = render({ move: noMail, offer: null, margin: noMargin, needsYou: [], row: { ...row, status: "quoted", quoted_date: "2026-11-02" } });
    expect(quoted).toContain("Nothing waits on you.");
  });

  it("falls back to the register's sell amount when no offer is on file", () => {
    const html = render({ offer: null, margin: noMargin, row: { ...row, sell_total: 7000 } });
    expect(html).toContain(">USD</span>");
    expect(html).toContain(">7,000</span>");
    expect(html).toContain("(register)");
    expect(html).not.toContain("No offer on file");
  });

  it("lists the options and a stated validity", () => {
    const air = proof("m-air", "Anwar K. S.", "Thu 05 Nov, 10:02", "By air OMR 768");
    const html = render({
      offer: {
        ...offer,
        total: 315,
        final: false,
        revised: true,
        validUntil: "2026-11-30",
        validityStated: true,
        options: [
          { label: "sea", total: 315, currency: "OMR", proof: offerProof, current: true, whole: true, rate: { amount: 315, unit: null } },
          { label: "air", total: 768, currency: "OMR", proof: air, current: false, whole: true, rate: { amount: 768, unit: null } },
        ],
      },
    });
    expect(html).toContain(">revised ·</span>");
    expect(html).toContain(">valid until Mon 30 Nov</span>");
    expect(html).not.toContain("no validity stated");
    expect(html).toContain("Options:");
    expect(html).toContain(">sea OMR 315<");
    expect(html).toContain(">air OMR 768<");
  });

  it("shows the main line's rate with its unit, never as a total, when the offer is not for the whole shipment", () => {
    const kilo = proof("m-air-kg", "Anwar K. S.", "Thu 05 Nov, 11:20", "AIRPORT TO AIRPORT : OMR 2.100 / KG");
    const html = render({
      offer: {
        ...offer,
        lines: [
          { label: "Airport to airport", amount: 2.1, currency: "OMR", unit: "/kg", soft: false, softText: null, main: true, proof: kilo },
          { label: "DO", amount: 150, currency: "OMR", unit: null, soft: false, softText: null, main: false, proof: kilo },
        ],
        total: 2.1,
        whole: false,
        missing: ["kg"],
        twin: "≈ USD 5.46 at 2.6",
        linesText: "2.1/kg airport to airport + 150 DO",
        proof: kilo,
        options: [
          { label: "air", total: 2.1, currency: "OMR", proof: kilo, current: true, whole: false, rate: { amount: 2.1, unit: "/kg" } },
          { label: "sea", total: 471, currency: "OMR", proof: offerProof, current: false, whole: true, rate: { amount: 339, unit: null } },
        ],
      },
    });
    expect(html).toContain(">OMR</span>");
    expect(html).toContain(">2.1/kg</span>");
    expect(html).not.toContain(">2.1</span>");
    expect(html).toContain(">total depends on the weight</span>");
    expect(html).toContain("2.1/kg airport to airport + 150 DO");
    expect(html).toContain(">air OMR 2.1/kg<");
    expect(html).toContain(">sea OMR 471<");
  });

  it("shows a negative margin in red, a currency clash in place of the figure, and a register slip", () => {
    const negative = render({
      margin: { ...margin, figure: { amount: -12, currency: "OMR", pct: -3, negative: true, text: "about OMR −12" }, notes: ["converted at 2.6", "after commission OMR 16"] },
    });
    expect(negative).toMatch(/text-lost[^>]*><span[^>]*>about OMR<\/span> <span[^>]*>−12<\/span>/);
    expect(negative).toContain("−3% of the offer");
    expect(negative).toContain("converted at 2.6 · after commission OMR 16");

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
    });
    expect(clash).toContain("Check the currency");
    expect(clash).toContain("Two currencies for 8,995: MLE wrote EUR, we wrote USD");
    expect(clash).toContain("EUR · Tue 03 Nov, 14:20");
    expect(clash).toContain("USD · Tue 03 Nov, 16:05");
    expect(clash).not.toContain("Needs an offer and an agreed buy");

    const slip = render({
      margin: { figure: { amount: 6390, currency: "USD", pct: 91.3, negative: false, text: "about USD 6,390" }, inputs: "register", why: null, notes: [], clash: null, source: "register" },
      registerMoney: { ...registerMoney, hasRates: true, slip: { text: "Buy 610 on a sell of 7,000 looks like a slip", prefill: null } },
    });
    expect(slip).toContain(">6,390</span>");
    expect(slip).toContain("91% of the sell");
    expect(slip).toContain("Register: buy 610 on a sell of 7,000 looks like a slip");
  });

  it("dims the cells while the e-mails load", () => {
    const html = render({ loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Reading the e-mails…");
    expect(count(html, "opacity-60")).toBe(4);
    expect(html).not.toContain("NOW NODE");
    expect(html).not.toContain("Said yes");
    expect(html).not.toContain("471");
    expect(html).not.toContain("<button");
  });

  it("says when the e-mails could not be read and offers to try again", () => {
    const failed = { move: noMail, offer: null, margin: noMargin, needsYou: [], error: new Error("Failed to fetch") };
    const html = render({ ...failed, onRetry: () => {}, row: { ...row, sell_total: 7000 } });
    expect(html).toContain("The e-mails could not be read");
    expect(html).toContain("Failed to fetch");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No e-mails on file");
    expect(html).toContain(">7,000</span>");
    expect(html).toContain("NOW NODE");
    expect(html).toContain("Not known until the e-mails can be read.");
    expect(html).not.toContain("waits on you");

    const bare = render(failed);
    expect(bare).not.toContain("Try again");
    expect(bare).toContain("No sell amount in the register.");
    expect(bare).not.toContain("Nothing with a price went to the customer");
  });

  it("gives a viewer every reading and no action buttons", () => {
    const html = render({ needsYou: needs.map((n) => ({ ...n, button: null })) });
    expect(html).toContain("Agent not in the register: the e-mails are with Frontline");
    expect(html).toContain("Answer Consolclub: the pick-up address and zip code");
    expect(html).not.toContain("Update agent");
    expect(html).not.toContain(">Reply<");
    expect(html).not.toContain(OUTLINE);
    expect(html).not.toContain(FILLED);
  });

  it("shows three lines, open ones first, then offers the rest", () => {
    const open = (n: number): NeedItem => ({ id: `open-${n}`, verb: "update", text: `Open item ${n}`, age: null, tone: "neutral", proof: null, button: null, done: false });
    const done: NeedItem = { id: "done-1", verb: "answer", text: "Answered item", age: null, tone: "neutral", proof: null, button: null, done: true };
    const html = render({ needsYou: [done, open(1), open(2), open(3), open(4)] });
    expect(html).toContain("Open item 1");
    expect(html).toContain("Open item 3");
    expect(html).not.toContain("Open item 4");
    expect(html).not.toContain("Answered item");
    expect(html).toContain(" (4)</span>");
    expect(html).toMatch(/aria-expanded="false"[^>]*>Show 2 more</);
  });

  it("never draws a filled button in the list", () => {
    const html = render({
      needsYou: [{ ...needs[0], button: { id: "edit_prefilled", label: "Update agent", variant: "primary" } }],
    });
    expect(html).toContain(">Update agent</button>");
    expect(html).not.toContain(FILLED);
    expect(html).toContain(OUTLINE);
  });

  it("has no needs-you list on a closed enquiry", () => {
    const closed: Move = { kind: "closed", icon: "close", tone: "bad", word: "Lost", why: ["Rate too high"], clock: null, sideKey: null, proof: null };
    const html = render({ move: closed, offer: null, margin: noMargin, needsYou: [], row: { ...row, status: "lost", closure: "lost", closure_reason: "Rate too high" } });
    expect(html).toContain("Lost");
    expect(html).toContain("text-lost");
    expect(html).not.toContain("Needs you");
    expect(html).not.toContain("waits on you");
  });
});
