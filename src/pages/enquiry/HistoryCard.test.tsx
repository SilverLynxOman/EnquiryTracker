import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HistoryEvent, Proof } from "../../lib/enquiryBrief";
import { enquiry } from "../../lib/testFixtures";
import type { AuditEntry, FollowUpRecord } from "../../lib/types";
import { HistoryCard, historyItems } from "./HistoryCard";
import type { PageActions } from "./shared";

// The card loads the register's changes through the database module; here they are already in the cache.
vi.mock("../../lib/api", () => ({ fetchAudit: vi.fn(), fetchProfileNames: vi.fn() }));

const TODAY = "2026-11-10";

const row = enquiry({ reference: "SL262784", enquiry_date: "2026-11-04", quoted_date: "2026-11-05", customer_name: "OMAN TEXTILES" });

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

/** The ISO timestamp of an Oman wall-clock time ("2026-11-09 11:40"). */
const oman = (wall: string) => new Date(`${wall.replace(" ", "T")}:00+04:00`).toISOString();

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const change = (id: number, wall: string, over: Partial<AuditEntry> = {}): AuditEntry => ({
  id,
  enquiry_id: row.id,
  reference: row.reference,
  action: "update",
  changes: null,
  import_batch_id: null,
  changed_by: "u1",
  changed_at: oman(wall),
  ...over,
});

const audit: AuditEntry[] = [
  change(2, "2026-11-05 10:02", { changes: { quoted_date: { old: null, new: "2026-11-05" } } }),
  change(1, "2026-11-04 17:30", { action: "insert" }),
];

const chases: FollowUpRecord[] = [{ enquiry_id: row.id, sales_person_id: "s7", followed_up_on: "2026-11-07" }];

const names = new Map([["s7", "Jittu"]]);

const chased = proof("m-chase", "Maria Britto", "Sun 08 Nov, 11:13", "Kindly advise the status of our quotation");

const events: HistoryEvent[] = [
  { at: oman("2026-11-08 11:13"), kind: "chased_by_email", text: "Chased by e-mail · pricing · Sun 11:13", proof: chased },
  { at: oman("2026-11-09 13:00"), kind: "customer_chased", text: "The customer asked again (3 times)", proof: proof("m-asked", "Fahid K V (Oman Textiles)", "Mon 09 Nov, 13:00", "Kindly provide an urgent update") },
  { at: "2026-11-07", kind: "hand_over", text: "Ashwin Luiz took over from Anwar K. S.", proof: null },
  { at: oman("2026-11-09 11:40"), kind: "sent_from_app", text: "Reply sent from the app by Sahan", proof: null },
];

function render(over: { events?: HistoryEvent[]; actions?: PageActions; loaded?: boolean } = {}) {
  const client = new QueryClient();
  if (over.loaded !== false) {
    client.setQueryData(["audit", row.id], audit);
    client.setQueryData(["profile-names"], new Map([["u1", "Sahan"]]));
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <HistoryCard enquiry={row} chases={chases} names={names} today={TODAY} events={over.events} actions={over.actions} />
    </QueryClientProvider>,
  );
}

const count = (html: string, part: string) => html.split(part).length - 1;

/** The text a reader sees: no markup, nothing that is only for screen readers. */
const seen = (html: string) =>
  html
    .replace(/<span class="sr-only">.*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("HistoryCard", () => {
  it("lists the register's changes and the follow-ups as before when no e-mail events are given", () => {
    const html = render();
    const text = seen(html);
    expect(text.startsWith("History")).toBe(true);
    expect(text).toContain("· Sahan");
    expect(text).toContain("Quoted date: — → 05.11.2026");
    expect(text).toContain("Sat 07 NovFollowed up by Jittu");
    expect(text).toContain("Created");
    expect(text).toContain("Record created");
    expect(text).not.toContain("from the e-mails");
    expect(html).not.toContain("border-dashed");
    expect(html).not.toContain("<button");
  });

  it("puts what the e-mails show among them by its time, each marked as read from the e-mails", () => {
    const html = render({ events, actions });
    const text = seen(html);
    expect(count(text, "from the e-mails")).toBe(4);
    expect(count(html, "border-dashed")).toBe(4);
    // The time is said once: on the line above unless the event's own words already carry it.
    expect(text).toContain("Sun 08 Novfrom the e-mailsChased by e-mail · pricing · Sun 11:13");
    expect(text).toContain("Mon 09 Nov, 13:00from the e-mailsThe customer asked again (3 times)");
    expect(text).toContain("Sat 07 Novfrom the e-mailsAshwin Luiz took over from Anwar K. S.");
    expect(text).toContain("Mon 09 Nov, 11:40from the e-mailsReply sent from the app by Sahan");

    const order = ["The customer asked again", "Reply sent from the app", "Chased by e-mail", "Ashwin Luiz took over", "Quoted date", "Record created"].map((part) => text.indexOf(part));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(0);
  });

  it("opens the e-mail an event was read from, or says who wrote it and when where it cannot", () => {
    const linked = render({ events, actions });
    expect(count(linked, "<button")).toBe(2);
    expect(linked).toContain(`title="${chased.who} · ${chased.when} · “${chased.sentence}”"`);
    expect(linked).toContain("(from Maria Britto, Sun 08 Nov, 11:13; opens the e-mail)");

    const plain = render({ events });
    expect(plain).not.toContain("<button");
    expect(plain).toContain(`<span title="${chased.who} · ${chased.when} · “${chased.sentence}”">Chased by e-mail · pricing · Sun 11:13</span>`);
  });

  it("sorts a day without a time at noon in Oman, and what cannot be read last", () => {
    const items = historyItems(audit, chases, [...events, { at: "soon", kind: "hand_over", text: "Unreadable", proof: null }]);
    expect(items.map((one) => one.event?.text ?? (one.chase ? "follow-up" : `change ${one.audit?.id}`))).toEqual([
      "The customer asked again (3 times)",
      "Reply sent from the app by Sahan",
      "Chased by e-mail · pricing · Sun 11:13",
      "follow-up",
      "Ashwin Luiz took over from Anwar K. S.",
      "change 2",
      "change 1",
      "Unreadable",
    ]);
    expect(historyItems(audit, chases).map((one) => one.key)).toEqual(["fs72026-11-07", "a2", "a1"]);
  });

  it("waits for the register's changes before it lists anything", () => {
    const html = render({ events, actions, loaded: false });
    expect(seen(html)).toBe("HistoryLoading…");
  });
});
