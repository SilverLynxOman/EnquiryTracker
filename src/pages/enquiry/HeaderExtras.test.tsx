import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Handler, Journey, Milestone, Proof, TruthTag as TruthTagData } from "../../lib/enquiryBrief";
import { goToNow, goToShipmentTrack, HandlerLine, JourneyChip, TruthTag } from "./HeaderExtras";

const TODAY = "2026-11-12";

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const won: TruthTagData = {
  kind: "won",
  text: "E-mails say: won Thu 05 Nov",
  proof: proof("m-yes", "Fahid K V (Oman Textiles)", "Thu 05 Nov, 15:11", "You are here by nominated for this shipment"),
};

const node = (key: Milestone["key"], label: string, state: Milestone["state"], extra: Partial<Milestone> = {}): Milestone => ({
  key,
  label,
  state,
  date: null,
  note: "",
  noteTone: null,
  proof: null,
  subSteps: [],
  emailIds: [],
  ...extra,
});

const journey: Journey = {
  set: "sea_import",
  nodes: [
    node("booked", "Booked", "proven", {
      date: "2026-11-05",
      proof: proof("m-book", "Anwar K. S. (Silver Lynx)", "Thu 05 Nov, 16:04", "Please proceed with the booking"),
      emailIds: ["m-book"],
    }),
    node("so", "SO released", "proven", {
      date: "2026-11-09",
      proof: proof("m-so", "Reena Aneesh (Frontline)", "Mon 09 Nov, 10:58", "Agent have received the shipper's booking and issued S/O to the shipper"),
      emailIds: ["m-so"],
    }),
    node("sailed", "Sailed", "todo", { note: "ETD not advised" }),
    node("bl", "BL", "current", { emailIds: ["m-bl"] }),
    node("arrived", "Arrived", "todo", { note: "ETA not advised" }),
    node("can_do", "CAN / DO", "todo"),
    node("bayan", "Bayan", "todo"),
    node("delivered", "Delivered", "todo", { note: "Not written in any e-mail — confirm by phone" }),
  ],
  reached: "so",
  nowDiscussing: "bl",
  chip: "SO released Mon 09 Nov · now: BL draft",
  cancelled: null,
};

const handler: Handler = {
  mailbox: "operation",
  name: "Ashwin Luiz",
  role: "Operations",
  since: "2026-11-07",
  previous: [{ name: "Anwar K. S.", role: "Operations", from: "2026-11-04", to: "2026-11-05" }],
  salesPerson: { name: "JITTU", mailbox: "sales7", onThread: false },
  customerGreets: "Waheed",
};

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("TruthTag", () => {
  it("says what the e-mails show as an amber button with a warning icon and where it was read", () => {
    const html = renderToStaticMarkup(<TruthTag truth={won} onGo={() => {}} />);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain("E-mails say: won Thu 05 Nov");
    expect(html).toContain("bg-await-bg text-await");
    expect(html).toContain("text-meta font-medium");
    expect(html).toContain("<svg");
    expect(html).toContain('title="Fahid K V (Oman Textiles) · Thu 05 Nov, 15:11 · “You are here by nominated for this shipment”"');
    expect(html).toContain("(go to what to do now)");
    expect(count(html, "<button")).toBe(1);
    expect(html).not.toContain("bg-primary");
  });

  it("is not there when the register and the e-mails agree", () => {
    expect(renderToStaticMarkup(<TruthTag truth={null} onGo={() => {}} />)).toBe("");
  });
});

describe("JourneyChip", () => {
  it("names the furthest step an e-mail shows and what the latest e-mail is about", () => {
    const html = renderToStaticMarkup(<JourneyChip journey={journey} onGo={() => {}} />);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain("SO released Mon 09 Nov · now: BL draft");
    expect(html).toContain("bg-party-agent-bg");
    expect(html).toContain("text-party-agent");
    expect(html).toContain("<svg");
    expect(html).toContain('title="Reena Aneesh (Frontline) · Mon 09 Nov, 10:58 · “Agent have received the shipper&#x27;s booking and issued S/O to the shipper”"');
    expect(html).toContain("(show the shipment&#x27;s steps)");
  });

  it("is not there without a journey, or while no step is shown by an e-mail", () => {
    expect(renderToStaticMarkup(<JourneyChip journey={null} onGo={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<JourneyChip journey={{ ...journey, reached: null, chip: null }} onGo={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<JourneyChip journey={{ ...journey, reached: null }} onGo={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<JourneyChip journey={{ ...journey, chip: null }} onGo={() => {}} />)).toBe("");
  });
});

describe("HandlerLine", () => {
  it("says who writes for us, since when, who wrote before, and what the sales person and the customer do", () => {
    const html = renderToStaticMarkup(<HandlerLine handler={handler} hasMail today={TODAY} />);
    expect(text(html)).toBe(
      "Handled by Ashwin Luiz (Operations) since Sat 07 Nov. Before: Anwar K. S., Wed 04 – Thu 05 Nov · Jittu not on the e-mails · The customer writes to Waheed",
    );
    expect(html).toContain('title="Before: Anwar K. S., Wed 04 – Thu 05 Nov"');
    expect(html).toContain('<span class="sr-only">. Before: Anwar K. S., Wed 04 – Thu 05 Nov</span>');
    expect(html).toContain("text-meta text-ink-muted");
    expect(html).not.toContain("<button");
  });

  it("leaves out what does not apply", () => {
    const html = renderToStaticMarkup(
      <HandlerLine handler={{ ...handler, previous: [], salesPerson: { name: "JITTU", mailbox: "sales7", onThread: true }, customerGreets: null }} hasMail today={TODAY} />,
    );
    expect(text(html)).toBe("Handled by Ashwin Luiz (Operations) since Sat 07 Nov");
    expect(html).not.toContain("title=");
    expect(text(renderToStaticMarkup(<HandlerLine handler={{ ...handler, salesPerson: null, previous: [] }} hasMail today={TODAY} />))).toBe(
      "Handled by Ashwin Luiz (Operations) since Sat 07 Nov · The customer writes to Waheed",
    );
  });

  it("reads a timestamp on the Oman calendar and shows words as they are written", () => {
    const late = renderToStaticMarkup(<HandlerLine handler={{ ...handler, since: "2026-11-06T21:30:00Z", previous: [] }} hasMail today={TODAY} />);
    expect(text(late)).toContain("since Sat 07 Nov");
    const worded = renderToStaticMarkup(
      <HandlerLine
        handler={{ ...handler, since: "Sat 07 Nov", previous: [{ name: "Maria Britto", role: "Pricing", from: "2026-11-03T05:00:00Z", to: "2026-11-03T09:00:00Z" }] }}
        hasMail
        today={TODAY}
      />,
    );
    expect(text(worded)).toContain("since Sat 07 Nov");
    expect(worded).toContain('title="Before: Maria Britto, Tue 03 Nov"');
  });

  it("says so when nobody of ours has written, and nothing when there are no e-mails", () => {
    const html = renderToStaticMarkup(<HandlerLine handler={null} hasMail today={TODAY} />);
    expect(text(html)).toBe("Nobody from our side has written yet");
    expect(renderToStaticMarkup(<HandlerLine handler={null} hasMail={false} today={TODAY} />)).toBe("");
  });
});

describe("going to a part of the page", () => {
  /** A stand-in for an element of the page. */
  function part(tabIndex: number, inside?: unknown) {
    const attrs = new Set<string>();
    return {
      tabIndex,
      scrollIntoView: vi.fn(),
      focus: vi.fn(),
      hasAttribute: (name: string) => attrs.has(name),
      setAttribute: vi.fn((name: string) => void attrs.add(name)),
      closest: () => inside ?? null,
    };
  }

  function page(parts: Record<string, ReturnType<typeof part>>, still = false) {
    vi.stubGlobal("document", { getElementById: (id: string) => parts[id] ?? null });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: still }) });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("moves the keyboard to the Now card's button and keeps it in the tab order", () => {
    const button = part(0);
    page({ "now-primary": button });
    goToNow();
    expect(button.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true, focusVisible: true });
    expect(button.setAttribute).not.toHaveBeenCalled();
  });

  it("goes to the card itself when the reader has no button there", () => {
    const card = part(-1);
    page({ "now-title": part(-1, card) });
    goToNow();
    expect(card.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
    expect(card.focus).toHaveBeenCalled();
  });

  it("shows the shipment's steps without motion when the reader asked for none, and does nothing when they are not on the page", () => {
    const track = part(-1);
    page({ "shipment-track": track }, true);
    goToShipmentTrack();
    expect(track.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
    expect(track.focus).toHaveBeenCalled();
    page({});
    expect(() => goToShipmentTrack()).not.toThrow();
    expect(() => goToNow()).not.toThrow();
  });
});
