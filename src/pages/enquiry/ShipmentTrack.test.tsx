import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Journey, Milestone, MilestoneKey, Proof, SubStep } from "../../lib/enquiryBrief";
import { ShipmentTrack, stepAfterKey, trackFocus } from "./ShipmentTrack";
import type { PageActions } from "./shared";

const TODAY = "2026-11-12";

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

const proof = (emailId: string, who: string, when: string, sentence: string, file?: string): Proof => ({ emailId, who, when, sentence, file });

const node = (key: MilestoneKey, label: string, state: Milestone["state"], extra: Partial<Milestone> = {}): Milestone => ({
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

const sub = (key: SubStep["key"], label: string, tone: SubStep["tone"], emailId: string): SubStep => ({
  key,
  label,
  tone,
  proof: proof(emailId, "Ashwin Luiz (Silver Lynx)", "Thu 05 Nov, 10:10", "Kindly share the SO at the earliest"),
});

/** A sea import with the booking and the SO shown by the agent's e-mails; the latest e-mail is about the SO. */
const seaImport: Journey = {
  set: "sea_import",
  nodes: [
    node("booked", "Booked", "proven", {
      date: "2026-11-05",
      note: "Booking arranged",
      proof: proof("m-book", "Reena Aneesh (Frontline)", "Thu 05 Nov, 17:42", "We have arranged the booking with the shipper"),
      subSteps: [sub("agent_details_sent", "Agent details sent Thu 16:10", "neutral", "m-agent")],
      emailIds: ["m-book"],
    }),
    node("so", "SO released", "proven", {
      date: "2026-11-09",
      note: "SO issued to the shipper",
      proof: proof("m-so", "Reena Aneesh (Frontline)", "Mon 09 Nov, 10:58", "Agent have received the shipper's booking and issued S/O to the shipper", "BOOKING FORM -320348-.xls"),
      subSteps: [
        sub("so_requested", "SO requested Thu 10:10 · chased 6×", "warn", "m-ask"),
        sub("booking_note", "Booking note sent 4×", "neutral", "m-note"),
        sub("space_etd", "Space on the 21 Nov sailing", "good", "m-space"),
        sub("cargo_not_ready", "Cargo not ready", "bad", "m-ready"),
      ],
      emailIds: ["m-so", "m-ask"],
    }),
    node("sailed", "Sailed", "todo", { note: "ETD not advised" }),
    node("bl", "BL", "todo"),
    node("arrived", "Arrived", "todo", { note: "ETA not advised" }),
    node("can_do", "CAN / DO", "todo"),
    node("bayan", "Bayan", "todo"),
    node("delivered", "Delivered", "todo", { note: "Not written in any e-mail — confirm by phone" }),
  ],
  reached: "so",
  nowDiscussing: "so",
  chip: "SO released Mon 09 Nov · now: SO",
  cancelled: null,
};

/** A confirmed job waiting for its SO: the booking is shown, the SO is only asked for, the sailing has slipped. */
const waitingForSo: Journey = {
  set: "sea_import",
  nodes: [
    node("booked", "Booked", "proven", {
      date: "2026-10-28T06:30:00Z",
      proof: proof("m-b", "Milk Wang (Consolclub)", "Wed 28 Oct, 10:30", "Booking received, thank you for the nomination"),
      emailIds: ["m-b"],
    }),
    node("so", "SO released", "current", { subSteps: [sub("so_requested", "SO requested Thu 10:10 · chased 6×", "warn", "m-ask")], emailIds: ["m-ask", "m-ask2", "m-ask3"] }),
    node("sailed", "Sailed", "todo", { note: "ETD 21 Nov (was 06 Nov)", noteTone: "warn", emailIds: ["m-etd"] }),
    node("bl", "BL", "todo"),
    node("arrived", "Arrived", "todo", { note: "ETA not advised" }),
    node("can_do", "CAN / DO", "todo"),
    node("bayan", "Bayan", "todo"),
    node("delivered", "Delivered", "todo", { note: "Not written in any e-mail — confirm by phone" }),
  ],
  reached: "booked",
  nowDiscussing: "so",
  chip: "Booked Wed 28 Oct · now: SO",
  cancelled: null,
};

/** An air job cancelled after the AWB: no e-mail marks the collection, and the steps after the AWB no longer stand. */
const cancelledAir: Journey = {
  set: "air",
  nodes: [
    node("booked", "Booked", "proven", { date: "2026-11-02", proof: proof("m-1", "Liu Wei (Yuxing)", "Mon 02 Nov, 09:12", "Booking confirmed with the airline"), emailIds: ["m-1"] }),
    node("collected", "Collected", "unmarked"),
    node("awb", "AWB", "proven", { date: "2026-11-04", proof: proof("m-3", "Liu Wei (Yuxing)", "Wed 04 Nov, 13:05", "Please find the final AWB attached", "AWB 176-55512345.pdf"), emailIds: ["m-3"] }),
    node("departed", "Departed", "void", { emailIds: ["m-4"] }),
    node("arrived", "Arrived MCT", "void"),
    node("bayan", "Bayan", "todo"),
    node("delivered", "Delivered", "todo", { note: "Not written in any e-mail — confirm by phone" }),
  ],
  reached: "awb",
  nowDiscussing: null,
  chip: "AWB Wed 04 Nov",
  cancelled: proof("m-cancel", "Basil Iqbal (Sterling)", "Mon 09 Nov, 15:57", "Please cancel this booking, we will move it by sea"),
};

const nothingYet: Journey = {
  set: "sea_import",
  nodes: seaImport.nodes.map((n) => node(n.key, n.label, "todo", { note: n.key === "delivered" ? n.note : "" })),
  reached: null,
  nowDiscussing: null,
  chip: null,
  cancelled: null,
};

const render = (journey: Journey, selected: MilestoneKey | null = null, extra: { reference?: string; confirmedDate?: string | null } = {}) =>
  renderToStaticMarkup(<ShipmentTrack journey={journey} today={TODAY} actions={actions} selected={selected} onSelect={() => {}} {...extra} />);

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

/** The list item of one step: its button and its tooltip. */
const step = (html: string, key: MilestoneKey) => html.split("<li ").find((part) => part.includes(`data-step="${key}"`)) ?? "";

describe("ShipmentTrack", () => {
  it("shows every step of the mode with its day, its note and the e-mail that shows it", () => {
    const html = render(seaImport);
    expect(html).toMatch(/^<div id="shipment-track" role="group" aria-labelledby="shipment-track-label"/);
    expect(html).toContain('<h3 id="shipment-track-label"');
    expect(html).toContain("Shipment</h3>");
    expect(count(html, "data-step=")).toBe(8);
    for (const label of ["Booked", "SO released", "Sailed", "BL", "Arrived", "CAN / DO", "Bayan", "Delivered"]) expect(html).toContain(label);

    const so = step(html, "so");
    expect(so).toContain("bg-party-agent text-white");
    expect(so).toContain('SO released<span class="sr-only">, done, the latest e-mail is about this step</span>');
    expect(so).toContain("Mon 09 Nov");
    expect(so).toContain("SO issued to the shipper");
    expect(so).toContain('aria-describedby="shipment-step-so"');
    expect(so).toContain('id="shipment-step-so" role="tooltip"');
    expect(so).toContain("Reena Aneesh (Frontline) · Mon 09 Nov, 10:58");
    expect(so).toContain("“Agent have received the shipper&#x27;s booking and issued S/O to the shipper”");
    expect(so).toContain("BOOKING FORM -320348-.xls");
    expect(so).toContain("Press to show only the 2 e-mails about it.");
    // Where the steps run down, who wrote it is on the step itself; the tooltip floats only where they run across.
    expect(so).toContain('<span aria-hidden="true" class="block break-words text-meta tabular-nums text-ink-muted sm:hidden">Reena Aneesh (Frontline) · Mon 09 Nov, 10:58</span>');
    expect(so).toContain("sm:group-hover:block sm:group-has-[:focus-visible]:block");
    expect(so).not.toContain(" group-hover:block");

    expect(step(html, "sailed")).toContain("ETD not advised");
    expect(step(html, "delivered")).toContain("Not written in any e-mail — confirm by phone");
    expect(step(html, "delivered")).toContain("No e-mail shows this step yet.");
  });

  it("keeps one step in the tab order and marks none as pressed until one is chosen", () => {
    const html = render(seaImport);
    expect(count(html, 'tabindex="0"')).toBe(1);
    expect(step(html, "so")).toContain('tabindex="0"');
    expect(count(html, 'tabindex="-1"')).toBe(7);
    expect(count(html, 'aria-pressed="false"')).toBe(8);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain('<p role="status" class="text-meta text-ink-heading"></p>');
    expect(html).not.toContain("Show all e-mails");
  });

  it("says what the chosen step did to the conversation and how to undo it", () => {
    const html = render(seaImport, "booked");
    const booked = step(html, "booked");
    expect(booked).toContain('aria-pressed="true"');
    expect(booked).toContain('tabindex="0"');
    expect(booked).toContain("bg-selected");
    expect(booked).toContain("Press again, or Escape, to show every e-mail.");
    expect(booked).not.toContain("max-sm:hidden");
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(count(html, 'tabindex="0"')).toBe(1);
    expect(html).toContain("The conversation shows only the 1 e-mail about Booked.");
    expect(html).toContain("Show all e-mails");
    expect(text(html)).toContain("“We have arranged the booking with the shipper” · Reena Aneesh (Frontline), Thu 05 Nov, 17:42");
  });

  it("does not offer to filter to a step no e-mail mentions", () => {
    const html = render(seaImport);
    expect(step(html, "bl")).toContain('aria-disabled="true"');
    expect(step(html, "bl")).not.toContain("Press to show");
    expect(step(html, "so")).not.toContain("aria-disabled");
    expect(count(html, 'aria-disabled="true"')).toBe(6);
  });

  it("folds the steps for a phone: the done ones into one line, then the current one, then the next", () => {
    const html = render(seaImport);
    expect(html).toContain("2 steps done · Booked → SO released");
    expect(html).toContain('aria-expanded="false"');
    expect(step(html, "booked")).toContain("max-sm:hidden");
    expect(step(html, "so")).not.toContain("max-sm:hidden");
    expect(step(html, "sailed")).not.toContain("max-sm:hidden");
    expect(step(html, "sailed")).toContain('<span class="font-normal sm:hidden">Next: </span>Sailed');
    for (const key of ["bl", "arrived", "can_do", "bayan", "delivered"] as const) expect(step(html, key)).toContain("max-sm:hidden");
    expect(html).toContain("Show all steps");
    expect(count(html, "Next: ")).toBe(1);
  });

  it("shows up to three sub-steps of the current step and of the one before, each opening its e-mail", () => {
    const html = render(seaImport);
    expect(html).toContain("Agent details sent Thu 16:10");
    expect(html).toContain("SO requested Thu 10:10 · chased 6×");
    expect(html).toContain("Booking note sent 4×");
    expect(html).toContain("Space on the 21 Nov sailing");
    expect(html).not.toContain("Cargo not ready");
    expect(html).toContain('title="Ashwin Luiz (Silver Lynx) · Thu 05 Nov, 10:10 · “Kindly share the SO at the earliest”"');
    expect(html).toContain("border-await/25 bg-await-bg text-await");
  });

  it("draws a step the e-mails are about but do not show as a ring, and a slipped date in amber", () => {
    const html = render(waitingForSo);
    const so = step(html, "so");
    expect(so).toContain("border-[3px] border-party-agent");
    expect(so).toContain('SO released<span class="sr-only">, the latest e-mail is about this step</span>');
    expect(so).toContain("The latest e-mail is about this step. None shows it done yet.");
    expect(so).toContain("Press to show only the 3 e-mails about it.");
    expect(so).toContain('tabindex="0"');
    expect(step(html, "booked")).toContain("Wed 28 Oct");
    expect(step(html, "booked")).toContain("bg-party-agent/40");
    const sailed = step(html, "sailed");
    expect(sailed).toContain('<span class="block break-words text-meta font-medium text-await">ETD 21 Nov (was 06 Nov)</span>');
    expect(sailed).toContain("Next: ");
    expect(html).toContain("1 step done · Booked");
    expect(html).toContain("SO requested Thu 10:10 · chased 6×");
  });

  it("says when no e-mail marks a step, and greys the steps after a cancel sentence", () => {
    const html = render(cancelledAir);
    expect(text(html)).toContain("Cancelled or changed · “Please cancel this booking, we will move it by sea” · Basil Iqbal (Sterling), Mon 09 Nov, 15:57");
    const collected = step(html, "collected");
    expect(collected).toContain("No e-mail marks this step");
    expect(collected).toContain("border-2 border-party-agent bg-surface");
    expect(collected).toContain(", no e-mail marks this step");
    expect(collected).toContain("bg-party-agent");
    const departed = step(html, "departed");
    expect(departed).toContain(">Cancelled or changed</span>");
    expect(departed).toContain(", cancelled or changed");
    expect(departed).toContain("text-ink-muted");
    expect(departed).toContain("Next: ");
    expect(html).toContain("2 steps done · Booked → AWB");
    expect(step(html, "awb")).toContain('tabindex="0"');
    expect(step(html, "awb")).toContain("AWB 176-55512345.pdf");
  });

  it("says so in one line while no e-mail is about the shipment", () => {
    const html = render(nothingYet, null, { reference: "SL262713", confirmedDate: "2026-10-28" });
    expect(html).toMatch(/^<div id="shipment-track"/);
    expect(text(html)).toBe("ShipmentConfirmed Wed 28 Oct. Nothing after the confirmation is on file yet — mail with SL262713 in the subject will fill this in.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<ol");
    expect(text(render(nothingYet))).toBe("ShipmentNothing about the shipment is on file yet.");
  });

  it("has no filled button and no words the page avoids", () => {
    for (const html of [render(seaImport, "so"), render(waitingForSo), render(cancelledAir), render(nothingYet)]) {
      expect(html).not.toContain("bg-primary text-white");
      expect(text(html)).not.toMatch(/\b(lane|ball|relay|silent|healthy|thin|counterparts)\b/i);
    }
  });
});

describe("trackFocus", () => {
  it("is the step the latest e-mail is about, else the furthest one shown, and the step after both", () => {
    expect(trackFocus(seaImport)).toEqual({ focus: 1, next: 2 });
    expect(trackFocus(waitingForSo)).toEqual({ focus: 1, next: 2 });
    expect(trackFocus(cancelledAir)).toEqual({ focus: 2, next: 3 });
    // Talk about an earlier step does not pull the focus back from the furthest one shown.
    expect(trackFocus({ ...seaImport, nowDiscussing: "booked" })).toEqual({ focus: 1, next: 2 });
    expect(trackFocus({ ...seaImport, reached: "delivered", nowDiscussing: null })).toEqual({ focus: 7, next: -1 });
    expect(trackFocus(nothingYet)).toEqual({ focus: -1, next: 0 });
  });
});

describe("stepAfterKey", () => {
  it("moves one step with the arrows and to the ends with Home and End, without leaving the row", () => {
    expect(stepAfterKey("ArrowRight", 1, 8, false)).toBe(2);
    expect(stepAfterKey("ArrowRight", 7, 8, false)).toBe(7);
    expect(stepAfterKey("ArrowLeft", 1, 8, false)).toBe(0);
    expect(stepAfterKey("ArrowLeft", 0, 8, false)).toBe(0);
    expect(stepAfterKey("Home", 5, 8, false)).toBe(0);
    expect(stepAfterKey("End", 2, 8, false)).toBe(7);
  });

  it("uses the up and down arrows only where the steps run downwards, and leaves other keys alone", () => {
    expect(stepAfterKey("ArrowDown", 1, 3, true)).toBe(2);
    expect(stepAfterKey("ArrowUp", 1, 3, true)).toBe(0);
    expect(stepAfterKey("ArrowDown", 1, 3, false)).toBeNull();
    expect(stepAfterKey("ArrowUp", 1, 3, false)).toBeNull();
    expect(stepAfterKey("Enter", 1, 3, false)).toBeNull();
    expect(stepAfterKey("Tab", 1, 3, true)).toBeNull();
    expect(stepAfterKey("End", 0, 0, false)).toBeNull();
  });
});
