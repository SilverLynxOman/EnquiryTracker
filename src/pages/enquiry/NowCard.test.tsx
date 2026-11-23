import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ActionButton, NowAction, Tone } from "../../lib/enquiryBrief";
import type { EnquiryRow, PriceChecker } from "../../lib/types";
import { NowCard } from "./NowCard";
import type { PageActions } from "./shared";

// The price-checker note's module also loads the list from the database; the card never calls it.
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
  currency: "USD",
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

const confirm: ActionButton = {
  id: "confirm_job",
  label: "Confirm job on Thu 05 Nov",
  variant: "primary",
  date: "2026-11-05",
  formPrefill: { quoted_date: "2026-11-05", sell_total: 1225, buy_total: 1079, agent_name: "FRONTLINE", notes: ["Sell OMR 471 × 2.6 = USD 1,225"] },
};

const won: NowAction = {
  kind: "won_unmarked",
  tone: "good",
  title: "Won by e-mail on Thu 05 Nov — the register says awaiting quote",
  said: { text: "You are here by nominated for this shipment", who: "Fahid K V (Oman Textiles)", when: "Thu 05 Nov, 15:11", emailId: "m-yes" },
  lines: [
    { text: "They also ask for a better rate.", tone: "warn" },
    { text: "Offer OMR 471, buy OMR 415 agreed with Frontline.", tone: null },
  ],
  buttons: [confirm, { id: "mark_quoted", label: "Mark quoted only", variant: "secondary", date: "2026-11-05" }, { id: "mark_lost", label: "Mark lost…", variant: "ghost" }],
  checkLine: "Read from the e-mails — check before you click.",
};

const toQuote: NowAction = {
  kind: "to_quote",
  tone: "primary",
  title: "Quote by the end of Thu 05 Nov",
  said: null,
  lines: [],
  buttons: [{ id: "mark_quoted", label: "Mark quoted today", variant: "primary", date: "2026-11-04" }],
  checkLine: null,
};

const render = (now: NowAction, extra: { checker?: PriceChecker; row?: EnquiryRow; actions?: PageActions } = {}) =>
  renderToStaticMarkup(<NowCard now={now} row={extra.row ?? row} checker={extra.checker} actions={extra.actions ?? actions} />);

const count = (html: string, part: string) => html.split(part).length - 1;

/** The class pair of a filled button. */
const FILLED = "bg-primary text-white";

/** The opening tag of the card's primary button. */
const primaryTag = (html: string) => /<button[^>]*id="now-primary"[^>]*>/.exec(html)?.[0] ?? "";

describe("NowCard", () => {
  it("says what to do now, what was written, and holds the one filled button", () => {
    const html = render(won);
    expect(html).toContain(">Now</p>");
    expect(html).toContain('<h2 id="now-title"');
    expect(html).toContain("Won by e-mail on Thu 05 Nov — the register says awaiting quote");
    expect(html).toContain("“You are here by nominated for this shipment”");
    expect(html).toContain("Fahid K V (Oman Textiles) · Thu 05 Nov, 15:11");
    expect(html).toContain("They also ask for a better rate.");
    expect(html).toContain("Offer OMR 471, buy OMR 415 agreed with Frontline.");
    expect(html).toContain("Read from the e-mails — check before you click.");
    expect(html).toContain("Mark quoted only");
    expect(html).toContain("Mark lost…");
    expect(html).toContain("bg-confirmed-bg");
    expect(count(html, FILLED)).toBe(1);
    expect(html).toMatch(/<button[^>]*id="now-primary"[^>]*>Confirm job on Thu 05 Nov<\/button>/);
    expect(primaryTag(html)).toContain(FILLED);
    expect(primaryTag(html)).toContain("w-full sm:w-auto");
  });

  it("opens the quoted e-mail from the caption", () => {
    const html = render(won);
    expect(html).toMatch(/<figcaption[^>]*><button[^>]*title="Fahid K V \(Oman Textiles\) · Thu 05 Nov, 15:11 · “You are here by nominated for this shipment”"/);
    expect(html).toContain("opens the e-mail");
  });

  it("gives a viewer the reading and no action buttons", () => {
    const html = render({ ...won, buttons: [], checkLine: null });
    expect(html).toContain("Won by e-mail on Thu 05 Nov");
    expect(html).toContain("“You are here by nominated for this shipment”");
    expect(html).not.toContain('id="now-primary"');
    expect(html).not.toContain("Confirm job");
    expect(html).not.toContain("Mark lost");
    expect(html).not.toContain(FILLED);
    // The only button left opens the quoted e-mail.
    expect(count(html, "<button")).toBe(1);
  });

  it("renders the barest state: a title and its button", () => {
    const html = render(toQuote);
    expect(html).toContain("Quote by the end of Thu 05 Nov");
    expect(html).toContain("bg-selected");
    expect(html).not.toContain("<figure");
    expect(html).not.toContain("<ul");
    expect(html).toMatch(/id="now-primary"[^>]*>Mark quoted today</);
    expect(count(html, "<button")).toBe(1);
  });

  it("tints every tone, the info tone included", () => {
    const grounds: Record<Tone, string> = {
      neutral: "bg-table-head",
      primary: "bg-selected",
      good: "bg-confirmed-bg",
      warn: "bg-await-bg",
      bad: "bg-lost-bg",
      flag: "bg-not-genuine-bg",
      info: "bg-lane-mail-bg",
    };
    for (const [tone, ground] of Object.entries(grounds) as [Tone, string][]) {
      const html = render({ ...toQuote, tone, buttons: [] });
      expect(html).toContain(ground);
      expect(html).toContain("shadow-[inset_0_3px_0_var(--color-");
    }
    expect(render({ ...toQuote, tone: "info", buttons: [] })).toContain("text-lane-mail");
  });

  it("draws a second primary button as an outline", () => {
    const html = render({ ...toQuote, buttons: [...toQuote.buttons, { id: "confirm_job", label: "Confirm job", variant: "primary" }] });
    expect(count(html, FILLED)).toBe(1);
    expect(count(html, 'id="now-primary"')).toBe(1);
    expect(html).toMatch(/ring-control[^>]*>Confirm job</);
  });

  it("shows a spinner on the button whose action is running", () => {
    const html = render(won, { actions: { ...actions, busy: { confirm_job: true } } });
    expect(primaryTag(html)).toContain('aria-busy="true"');
    expect(primaryTag(html)).toContain("disabled");
    expect(count(html, 'aria-busy="true"')).toBe(1);
  });

  it("warns about a price checker only while the enquiry awaits a quote", () => {
    const checker: PriceChecker = { customer_id: "c1", quotes: 14, last_win: "2025-03-02" };
    const waiting = render(toQuote, { checker });
    expect(waiting).toContain("Price checker:");
    expect(waiting).toContain("Worth asking for the cargo-ready date and commodity before working on rates.");
    expect(render(toQuote, { checker, row: { ...row, status: "quoted", quoted_date: "2026-11-05" } })).not.toContain("Price checker:");
  });
});
