import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CargoCheck, CargoField, Drift, FormPrefill, Proof, Viewer } from "../../lib/enquiryBrief";
import { askButton, cargoDrift, CargoCard, driftButtons, requestBlockButton, shownFields, type CargoCardProps } from "./CargoCard";
import type { PageActions } from "./shared";

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

const pricing: Viewer = { canEdit: true, canReply: true, me: null };
const sales: Viewer = { canEdit: true, canReply: false, me: "s7" };
const reader: Viewer = { canEdit: false, canReply: false, me: null };

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const request = proof("m-request", "Maria Britto", "Wed 04 Nov, 18:05", "DIMENSIONS: 260 x 350 x 50 cm");
const customer = proof("m-customer", "Fahid K V (Oman Textiles)", "Mon 09 Nov, 09:25", "The material is polyester yarn on 7 pallets");
const agent = proof("m-agent", "Sunny Wang (Consolclub)", "Mon 09 Nov, 14:08", "SL262713 1X40 OT HC FOB QINGDAO CHINA TO SOHAR OMAN");

const field = (key: CargoField["key"], label: string, value: string | null, source: string | null, from: Proof | null, required: boolean): CargoField => ({ key, label, value, source, proof: from, required });

const REQUEST_BLOCK = "POL: NINGBO CHINA\nPOD: SOHAR OMAN\nUNIT: LCL\nCOMMODITY: Polyester yarn\nDIMENSIONS: 260 x 350 x 50 cm\nGR. WT.:\nPICK UP ADDRESS:\n14 days free detention at destination; MBL seaway or telex";
const ASK = "Could you please share:\n1. The gross weight\n2. The pick-up address";

const cargo: CargoCheck = {
  fields: [
    field("commodity", "Commodity", "Polyester yarn", "the customer, Mon 09:25", customer, true),
    field("packages", "Packages", "7 pallets", "the customer, Mon 09:25", customer, false),
    field("gross_weight", "Gross weight", null, null, null, true),
    field("volume", "Volume", "12.4 cbm", "read by AI", null, true),
    field("dimensions", "Dimensions", "260 × 350 × 50 cm", "our request, Wed 18:05", request, false),
    field("incoterm", "Incoterm", "EXW", "requirements", null, false),
    field("pickup_address", "Pick-up address", " ", null, null, true),
    field("hs_code", "HS code", null, null, null, false),
    field("temperature", "Temperature", null, null, null, false),
  ],
  gaps: ["gross_weight", "pickup_address"],
  warning: "Check the dimensions: 260 × 350 × 50 cm for 150 kg looks like a typo.",
  requestBlock: REQUEST_BLOCK,
  askText: ASK,
};

const nothing: CargoCheck = {
  fields: [field("commodity", "Commodity", null, null, null, true), field("volume", "Volume", null, null, null, true), field("hs_code", "HS code", null, null, null, false)],
  gaps: ["commodity", "volume"],
  warning: null,
  requestBlock: "POL: NINGBO CHINA\nPOD: SOHAR OMAN\nUNIT: LCL",
  askText: "Could you please share:\n1. The commodity\n2. The volume",
};

const quantityFill: FormPrefill = { qty_text: "1X40 OT HC", replace: ["qty_text"], notes: ["Quantity 1×40 OT HC, from Sunny Wang's e-mail of Mon 09 Nov 14:08"] };
const agentFill: FormPrefill = { agent_name: "FRONTLINE", notes: ["Agent Frontline: the buy was agreed with them on Thu 05 Nov"] };

const change = (id: string, kind: Drift["kind"], text: string, register: string, mail: string, over: Partial<Drift> = {}): Drift => ({ id, kind, text, register, mail, proof: agent, prefill: null, buttonLabel: "", ...over });

const quantity = change("drift-quantity", "quantity", "E-mails say 1×40 OT HC; the register says 1×20 OT", "1×20 OT", "1×40 OT HC", { prefill: quantityFill, buttonLabel: "Update…" });
const agentChange = change("drift-agent", "agent", "The e-mails are with Frontline; the register has no agent", "", "Frontline", { prefill: agentFill, buttonLabel: "Update agent" });
const dateOrder = change("drift-dates", "date_order", "Confirmed 11 Apr is before the enquiry date — a typo?", "11 Apr", "", { proof: null });

const drift: Drift[] = [
  quantity,
  change("drift-status", "status", "E-mails say won; the register says quoted", "quoted", "won"),
  agentChange,
  change("drift-sell", "sell", "E-mails say sell OMR 471; the register says USD 1,100", "USD 1,100", "OMR 471"),
  change("drift-buy", "buy", "E-mails say buy OMR 415; the register has none", "", "OMR 415"),
  change("drift-contact", "contact", "Our offer went to purchase_otm@omzest.example; the contact is another address", "", "purchase_otm@omzest.example"),
  dateOrder,
];

const render = (over: Partial<CargoCardProps> = {}) => renderToStaticMarkup(<CargoCard cargo={cargo} drift={drift} viewer={pricing} actions={actions} {...over} />);

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees: no markup, nothing that is only for screen readers. */
const seen = (html: string) =>
  html
    .replace(/<span class="sr-only">.*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

const title = (p: Proof) => `title="${p.who} · ${p.when} · “${p.sentence}”"`;

describe("CargoCard", () => {
  it("lists what is known about the cargo with where each fact was read", () => {
    const text = seen(render());
    expect(text.startsWith("CargoCommodityPolyester yarnthe customer, Mon 09:25")).toBe(true);
    expect(text).toContain("Packages7 palletsthe customer, Mon 09:25");
    expect(text).toContain("Volume12.4 cbmread by AI");
    expect(text).toContain("Dimensions260 × 350 × 50 cmour request, Wed 18:05");
    expect(text).toContain("IncotermEXWrequirements");
    expect(text).not.toContain("Nothing about the cargo in the e-mails yet.");
  });

  it("says Not known, in amber with an icon, for what this shipment needs and nobody gave", () => {
    const html = render();
    const text = seen(html);
    expect(text).toContain("Gross weightNot known");
    expect(text).toContain("Pick-up addressNot known");
    expect(count(text, "Not known")).toBe(2);
    expect(count(html, 'gap-1 font-medium text-await"><svg')).toBe(2);
    // A fact the shipment does not need is left out while nobody gave it.
    expect(text).not.toContain("HS code");
    expect(text).not.toContain("Temperature");
    expect(shownFields(cargo).map((one) => one.key)).toEqual(["commodity", "packages", "gross_weight", "volume", "dimensions", "incoterm", "pickup_address"]);
  });

  it("opens the e-mail a fact was read from, and leaves the register's and the AI's as plain text", () => {
    const html = render({ drift: [] });
    expect(count(html, title(customer))).toBe(2);
    expect(count(html, title(request))).toBe(1);
    expect(html).toContain("(from Maria Britto, Wed 04 Nov, 18:05; opens the e-mail)");
    expect(html).toContain('<span class="">12.4 cbm</span>');
    expect(html).toContain('<span class="">EXW</span>');
  });

  it("warns in amber, with an icon, when the dimensions do not fit the weight", () => {
    const html = render();
    expect(html).toMatch(/bg-await-bg[^"]*text-await"><svg[^>]*>.*?<\/svg><span[^>]*>Check the dimensions: 260 × 350 × 50 cm for 150 kg looks like a typo\.<\/span>/);
    expect(seen(render({ cargo: { ...cargo, warning: null } }))).not.toContain("Check the dimensions");
  });

  it("gives everyone the request block, and the questions as a reply or as a copy", () => {
    const withMailbox = seen(render());
    expect(withMailbox).toContain("Copy request blockAsk the customer");
    expect(withMailbox).not.toContain("Copy the questions");

    const withoutMailbox = seen(render({ viewer: sales }));
    expect(withoutMailbox).toContain("Copy request blockCopy the questions");
    expect(withoutMailbox).not.toContain("Ask the customer");

    expect(requestBlockButton(cargo)).toEqual({ id: "copy", label: "Copy request block", variant: "secondary", copyText: REQUEST_BLOCK, copiedToast: "Request block copied." });
    expect(requestBlockButton({ ...cargo, requestBlock: "  " })).toBeNull();
    expect(askButton(cargo, pricing)).toEqual({ id: "reply", label: "Ask the customer", variant: "secondary", sideKey: "customer", copyText: ASK });
    expect(askButton(cargo, sales)).toEqual({ id: "copy", label: "Copy the questions", variant: "secondary", copyText: ASK, copiedToast: "Questions copied." });
    expect(askButton(cargo, reader)).toEqual({ id: "copy", label: "Copy the questions", variant: "secondary", copyText: ASK, copiedToast: "Questions copied." });
    expect(askButton({ ...cargo, askText: "" }, pricing)).toBeNull();
    expect(seen(render({ cargo: { ...cargo, askText: "" } }))).not.toContain("Ask the customer");
  });

  it("lists what the e-mails changed about the shipment, the agent and the dates, and nothing else", () => {
    const html = render();
    const text = seen(html);
    expect(text).toContain("What the e-mails changed");
    expect(text).toContain("E-mails say 1×40 OT HC; the register says 1×20 OT");
    expect(text).toContain("The e-mails are with Frontline; the register has no agent");
    expect(text).toContain("Confirmed 11 Apr is before the enquiry date — a typo?");
    expect(text).not.toContain("E-mails say won");
    expect(text).not.toContain("OMR 471");
    expect(text).not.toContain("OMR 415");
    expect(text).not.toContain("purchase_otm@omzest.example");
    expect(cargoDrift(drift).map((one) => one.id)).toEqual(["drift-quantity", "drift-agent", "drift-dates"]);
    // The part read from the e-mails opens the e-mail: the quantity and the agent's name.
    expect(html).toMatch(/E-mails say <button[^>]*>1×40 OT HC<span class="sr-only">/);
    expect(count(html, title(agent))).toBe(2);
    expect(seen(render({ drift: [drift[1], drift[3]] }))).not.toContain("What the e-mails changed");
  });

  it("offers Update… and Keep the register's to those who may edit, and only the reading to a viewer", () => {
    const text = seen(render());
    expect(text).toContain("E-mails say 1×40 OT HC; the register says 1×20 OTUpdate…Keep the register's");
    expect(text).toContain("the register has no agentUpdate agentKeep the register's");
    // Nothing to fill in for a date that only looks wrong.
    expect(text).toMatch(/a typo\?Keep the register's$/);
    expect(count(text, "Keep the register's")).toBe(3);

    expect(driftButtons(quantity, pricing)).toEqual([
      { id: "edit_prefilled", label: "Update…", variant: "secondary", formPrefill: quantityFill },
      { id: "dismiss", label: "Keep the register's", variant: "ghost", dismissId: "drift-quantity" },
    ]);
    expect(driftButtons({ ...quantity, buttonLabel: " " }, sales)[0].label).toBe("Update…");
    expect(driftButtons(dateOrder, pricing)).toEqual([{ id: "dismiss", label: "Keep the register's", variant: "ghost", dismissId: "drift-dates" }]);
    expect(driftButtons(quantity, reader)).toEqual([]);

    const viewer = render({ viewer: reader });
    expect(seen(viewer)).toContain("E-mails say 1×40 OT HC; the register says 1×20 OT");
    expect(seen(viewer)).not.toContain("Update");
    expect(seen(viewer)).not.toContain("Keep the register's");
    expect(seen(viewer)).not.toContain("Ask the customer");
    // What is left for a viewer copies or opens an e-mail: nothing changes anything.
    expect(seen(viewer)).toContain("Copy request blockCopy the questions");
  });

  it("holds no filled button, and shows a spinner on the button whose action is running", () => {
    expect(render()).not.toContain("bg-primary");
    expect(count(render({ actions: { ...actions, busy: { reply: true } } }), 'aria-busy="true"')).toBe(1);
  });

  it("says so when the e-mails give nothing about the cargo, and keeps the request block", () => {
    const html = render({ cargo: nothing, drift: [] });
    expect(seen(html)).toBe("CargoNothing about the cargo in the e-mails yet.Not known: Commodity · VolumeCopy request block");
    expect(count(html, "<button")).toBe(1);
    expect(html).not.toContain("<dl");

    const bare = render({ cargo: { fields: [], gaps: [], warning: null, requestBlock: "", askText: "" }, drift: [], viewer: reader });
    expect(seen(bare)).toBe("CargoNothing about the cargo in the e-mails yet.");
    expect(bare).not.toContain("<button");
  });

  it("uses none of the words kept off the screen", () => {
    expect(seen(render())).not.toMatch(/\b(lane|ball|relay|silent|healthy|thin|counterparts)\b/i);
  });
});
