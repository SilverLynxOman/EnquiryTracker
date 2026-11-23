import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentQuote,
  AgentState,
  CrossFiledGroup,
  Cue,
  EnquiryBrief,
  Flag,
  MailInput,
  MilestoneKey,
  Proof,
  ReadMail,
  ReplyPrefill,
  Side,
  SideKind,
  Viewer,
} from "../../lib/enquiryBrief";
import type { EnquiryRow } from "../../lib/types";
import {
  agentColumn,
  chaseTargets,
  ConversationBoard,
  cueChips,
  EverythingList,
  foldedKeys,
  hiddenLabel,
  mailMatches,
  replySpot,
  setAsideButtons,
  startView,
  viewForMail,
  viewOptions,
  type ConversationBoardProps,
  type RowContext,
} from "./ConversationBoard";
import type { PageActions } from "./shared";

interface SideStubProps {
  side: Side;
  compact: boolean;
  folded: boolean;
  openMailId: string | null;
  milestoneFilter: MilestoneKey | null;
  find: string;
  reply: ReplyPrefill | null;
}

interface RowStubProps {
  mail: ReadMail;
  side: Side | null;
  compact: boolean;
  open: boolean;
  stripe?: boolean;
}

// One conversation and one e-mail row, reduced to what the board hands them.
vi.mock("./ConversationSide", () => ({
  ConversationSide: (p: SideStubProps) => (
    <article
      data-stub={p.side.key}
      data-folded={String(p.folded)}
      data-compact={String(p.compact)}
      data-find={p.find}
      data-reply={p.reply?.targetEmailId ?? ""}
      data-step={p.milestoneFilter ?? ""}
      data-open-mail={p.openMailId ?? ""}
    >
      {p.side.name}
    </article>
  ),
  MailRow: (p: RowStubProps) => (
    <li id={`mail-${p.mail.id}`} data-open={String(p.open)} data-stripe={String(!!p.stripe)} data-row-side={p.side?.key ?? ""}>
      {p.mail.from.name}: {p.mail.excerpt}
    </li>
  ),
}));

const today = "2026-11-10";

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

const manager: Viewer = { canEdit: true, canReply: true, me: null };
const sales: Viewer = { canEdit: true, canReply: false, me: "sp1" };
const reader: Viewer = { canEdit: false, canReply: false, me: null };

const proof = (emailId: string, who: string, when: string, sentence: string): Proof => ({ emailId, who, when, sentence });

const cue = (key: Cue["key"], label: string): Cue => ({ key, label, tone: "neutral" });

interface MailSpec {
  /** Oman time, "2026-11-09 09:25". */
  at: string;
  from: string;
  address: string;
  sideKey: string;
  party?: ReadMail["party"];
  toParty?: ReadMail["toParty"];
  subject?: string;
  thread?: string;
  text: string;
  cues?: Cue[];
  scope?: ReadMail["scope"];
  noise?: ReadMail["noise"];
  crossFiled?: ReadMail["crossFiled"];
  siblingHint?: string;
  files?: string[];
}

/** One e-mail as the brief reads it. */
function mail(id: string, spec: MailSpec): ReadMail {
  const [day, time] = spec.at.split(" ");
  const at = new Date(`${day}T${time}:00+04:00`).toISOString();
  const party = spec.party ?? "customer";
  const email: MailInput = {
    id,
    mailbox_id: "mb1",
    gmail_message_id: `g-${id}`,
    gmail_thread_id: spec.thread ?? "t1",
    sender_type: party === "us" ? "staff" : "external",
    from_email: spec.address,
    from_name: spec.from,
    to_emails: party === "us" ? ["someone@outside.example"] : ["pricing@forwarder.example"],
    cc_emails: [],
    subject: spec.subject ?? "SL262784 LCL NINGBO TO SOHAR",
    received_at: at,
    snippet: spec.text,
    body_text: spec.text,
    sl_refs: [],
    attachments: [],
    status: "linked",
    classification: "follow_up",
    match_method: "reference",
    confidence: null,
    summary: null,
    note: null,
    suggested_enquiry_id: null,
    enquiry_id: "e1",
    draft_id: null,
  };
  return {
    email,
    id,
    at,
    day,
    time,
    from: { name: spec.from, email: spec.address, staff: null },
    party,
    toParty: spec.toParty ?? null,
    sideKey: spec.sideKey,
    scope: spec.scope ?? "in",
    crossFiled: spec.crossFiled ?? null,
    noise: spec.noise ?? null,
    siblingHint: spec.siblingHint ?? null,
    kind: "substantive",
    clean: spec.text,
    excerpt: spec.text,
    isRequest: false,
    isChase: false,
    isPureChase: false,
    urgent: false,
    hold: false,
    promise: null,
    deadline: null,
    cues: spec.cues ?? [],
    money: [],
    moneyRole: null,
    milestones: [],
    files: (spec.files ?? []).map((filename) => ({
      filename,
      mime: "application/pdf",
      size: 1000,
      storagePath: null,
      emailId: id,
      at,
      from: spec.from,
      sideKey: spec.sideKey,
      crossFiled: false,
    })),
    sentFromApp: null,
    outOfHours: null,
  };
}

const us = { from: "Anwar K. S.", address: "pricing@forwarder.example", party: "us" as const };
const fahid = { from: "Fahid K V", address: "buyer@customer.example", sideKey: "customer" };
const reena = { from: "Reena Aneesh", address: "reena@frontline.example", sideKey: "frontline.example", party: "agent" as const, thread: "t2" };
const other = { why: "other_reference" as const, looksLike: "SL262790", about: "40 HQ Qingdao → Sohar" };
const otherSubject = "RE: SL262790 QINGDAO - SOHAR 40 HQ";

const w2 = mail("w2", { ...us, at: "2026-11-09 18:29", sideKey: "wwl.example", toParty: "agent", thread: "t3", text: "Please hold this shipment for now." });
const u2 = mail("u2", { ...us, at: "2026-11-09 11:15", sideKey: "customer", toParty: "customer", text: "The SO was issued to the shipper today.", cues: [cue("so", "SO")] });
const a2 = mail("a2", { ...reena, at: "2026-11-09 10:58", text: "Agent have received the booking and issued S/O to the shipper.", cues: [cue("so", "SO")], files: ["BOOKING FORM -320348-.xls"] });
const c2 = mail("c2", { ...fahid, at: "2026-11-09 09:25", text: "It seems your team is not responding.", cues: [cue("complaint", "Complaint")], siblingHint: "SL262810" });
const n1 = mail("n1", { ...fahid, at: "2026-11-08 07:10", text: "I am out of the office until Tuesday.", scope: "noise", noise: "auto_reply" });
const b1 = mail("b1", { from: "Mail Delivery Subsystem", address: "mailer-daemon@mail.example", at: "2026-11-07 08:24", sideKey: "customer", party: "other", text: "Your message was blocked.", scope: "noise", noise: "bounce", cues: [cue("bounce", "Bounced")] });
const x2 = mail("x2", { from: "Hui Min", address: "ops@consolclub.example", at: "2026-11-06 12:00", sideKey: "consolclub.example", party: "agent", thread: "t9", subject: otherSubject, text: "BL drafts OK, please confirm.", scope: "cross_filed", crossFiled: other });
const x1 = mail("x1", { from: "Hui Min", address: "ops@consolclub.example", at: "2026-11-06 10:00", sideKey: "consolclub.example", party: "agent", thread: "t9", subject: otherSubject, text: "SO attached for the 40 HQ.", scope: "cross_filed", crossFiled: other });
const n2 = mail("n2", { ...reena, from: "Milk", at: "2026-11-05 16:06", text: "++ Reena pls.", scope: "noise", noise: "loop_in" });
const c1 = mail("c1", { ...fahid, at: "2026-11-05 15:11", text: "You are here by nominated for this shipment.", cues: [cue("yes", "Says yes")] });
const u1 = mail("u1", { ...us, at: "2026-11-05 09:37", sideKey: "customer", toParty: "customer", text: "Our final offer is OMR 339 port to port.", cues: [cue("final_offer", "Offer OMR 339 · final")] });
const a1 = mail("a1", { ...reena, at: "2026-11-05 07:11", text: "We can offer OMR 298 ocean freight, telex release included.", cues: [cue("rate", "Rate OMR 298")] });
const w1 = mail("w1", { from: "Li Wei", address: "liwei@wwl.example", at: "2026-11-04 19:39", sideKey: "wwl.example", party: "agent", thread: "t3", text: "Rate USD 450 per cbm.", cues: [cue("rate", "Rate USD 450/cbm")] });
const r1 = mail("r1", { ...us, at: "2026-11-04 14:28", sideKey: "frontline.example", toParty: "agent", thread: "t4", text: "Please quote LCL Ningbo to Sohar.", cues: [cue("rate_request", "Rate request")] });
const i1 = mail("i1", { from: "Jittu", address: "jittu@forwarder.example", at: "2026-11-04 13:00", sideKey: "internal", party: "us", toParty: "internal", thread: "t5", text: "New enquiry from Oman Textiles, please quote." });

const rateProof = proof("a1", "Reena Aneesh (Frontline)", "Thu 05 Nov, 07:11", "We can offer OMR 298 ocean freight");

function quote(sideKey: string, name: string, state: AgentState, lastAt: string, rate: Proof | null = null): AgentQuote {
  const main = rate && { label: "Ocean freight", amount: 298, currency: "OMR" as const, unit: null, soft: false, softText: null, main: true, proof: rate };
  const latest = rate && main ? { carrier: null, main, extras: [], total: 298, transit: null, freeDays: null, allIn: false, declined: false, declinedText: null, proof: rate } : null;
  return {
    sideKey,
    name,
    domain: sideKey,
    state,
    askedAt: r1.at,
    requestOnFile: true,
    options: latest ? [latest] : [],
    latest,
    lowestOnFile: !!latest,
    earlier: [],
    validity: null,
    repliedInHours: null,
    question: null,
    summary: "",
    lastAt,
  };
}

function side(key: string, kind: SideKind, name: string, mails: ReadMail[], extra: Partial<Side> = {}): Side {
  const threads = [...new Set(mails.map((m) => m.email.gmail_thread_id))].map((id) => {
    const inThread = mails.filter((m) => m.email.gmail_thread_id === id);
    return { id, subject: inThread[0].email.subject ?? "", count: inThread.length, gmailUrl: `https://mail.google.com/mail/#all/${id}` };
  });
  return {
    key,
    kind,
    name,
    domain: kind === "customer" || kind === "internal" ? null : key,
    agentName: null,
    mails,
    threads,
    lastFromThem: mails.find((m) => m.party !== "us") ?? null,
    lastFromUs: mails.find((m) => m.party === "us") ?? null,
    currentWriter: null,
    state: { kind: "nothing_pending", since: null, age: null, tone: "neutral", text: "Nothing pending", proof: null },
    questions: [],
    chase: null,
    deadline: null,
    promise: null,
    replyWindow: null,
    holiday: null,
    agent: null,
    pausedByUs: null,
    fileCount: 0,
    hiddenCount: 0,
    ...extra,
  };
}

const customer = side("customer", "customer", "Oman Textiles", [u2, c2, c1, u1], { hiddenCount: 1 });
const frontline = side("frontline.example", "agent", "Frontline", [a2, a1, r1], { agent: quote("frontline.example", "Frontline", "agreed", a2.at, rateProof), hiddenCount: 1 });
const wwl = side("wwl.example", "agent", "WWL", [w2, w1, r1], {
  agent: quote("wwl.example", "WWL", "paused", w2.at),
  pausedByUs: proof("w2", "Anwar K. S.", "Mon 09 Nov, 18:29", "Please hold this shipment for now."),
});
const consol = side("consolclub.example", "agent", "Consolclub", [r1], { agent: quote("consolclub.example", "Consolclub", "written_to", r1.at) });
const yuxing = side("yuxing.example", "agent", "Yuxing", [r1], { agent: quote("yuxing.example", "Yuxing", "written_to", r1.at) });
const internal = side("internal", "internal", "Our side", [i1]);

const lookAlike: CrossFiledGroup = {
  looksLike: "SL262790",
  about: "40 HQ Qingdao → Sohar",
  why: "other_reference",
  threadIds: ["t9"],
  mails: [x2, x1],
  text: "2 e-mails look like SL262790 (40 HQ Qingdao → Sohar)",
};

const wrongFlag: Flag = {
  id: "wrong-SL262790",
  kind: "wrong_enquiry",
  tone: "warn",
  icon: "flag",
  label: "2 e-mails look like SL262790",
  sentence: "40 HQ Qingdao → Sohar",
  who: "",
  when: "",
  proof: null,
  cleared: false,
  clearedText: null,
  buttons: [
    { id: "open_mail", label: "Show e-mail", variant: "ghost", emailIds: ["x2"] },
    { id: "move_mails", label: "Move to SL262790", variant: "primary", reference: "SL262790", emailIds: ["x2", "x1"] },
    { id: "keep_thread", label: "Keep here", variant: "secondary", threadIds: ["t9"] },
  ],
};

/** A brief with nothing read: what the page builds for an enquiry without e-mails. */
const blank: EnquiryBrief = {
  mails: [],
  sides: [side("customer", "customer", "Oman Textiles", [])],
  hidden: { autoReplies: 0, loopIns: 0, duplicates: 0, text: "", mails: [] },
  crossFiled: [],
  move: { kind: "no_mail", icon: "clock", tone: "neutral", word: "No e-mails on file", why: [], clock: null, sideKey: null, proof: null },
  now: { kind: "to_quote", tone: "primary", title: "Quote by the end of Thu 05 Nov", said: null, lines: [], buttons: [], checkLine: null },
  needsYou: [],
  flags: [],
  truth: null,
  offer: null,
  agentRates: [],
  agentsSummary: { writtenTo: null, replied: 0, rates: 0, declined: 0, requestOnFile: false, noReplyOnFile: [], lowest: null, text: "" },
  buy: null,
  targets: [],
  margin: { figure: null, inputs: null, why: "Needs an offer and an agreed buy", notes: [], clash: null, source: "mail" },
  trail: [],
  trailSentence: null,
  registerMoney: { hasRates: false, missingText: null, differs: null, slip: null, prefill: null },
  laneBenchmark: null,
  stages: [],
  journey: null,
  dates: { etd: null, eta: null, atd: null, cutoff: null, transit: { ours: null, agent: null }, freeDays: { asked: null, given: null }, validity: [], promises: [], headline: null },
  refs: [],
  cargo: { fields: [], gaps: [], warning: null, requestBlock: "", askText: "" },
  drift: [],
  people: [],
  handler: null,
  documents: [],
  statusText: null,
  copy: { status: null, offer: null, chase: {}, requestBlock: "", houseSubject: "" },
  mailFollowUps: [],
  history: [],
};

/** SL262784 as the mailbox holds it: the customer, four agents, a forward of our own, and what is folded away or set aside. */
const full: EnquiryBrief = {
  ...blank,
  mails: [w2, u2, a2, c2, n1, b1, x2, x1, n2, c1, u1, a1, w1, r1, i1],
  sides: [customer, wwl, frontline, consol, yuxing, internal],
  hidden: { autoReplies: 1, loopIns: 1, duplicates: 0, text: "1 auto-reply and 1 'adding a colleague' note hidden", mails: [n1, n2] },
  crossFiled: [lookAlike],
  move: { kind: "said_yes", icon: "check", tone: "good", word: "Said yes — not confirmed", why: [], clock: null, sideKey: "customer", proof: null },
  flags: [wrongFlag],
  agentsSummary: {
    writtenTo: 4,
    replied: 2,
    rates: 2,
    declined: 0,
    requestOnFile: true,
    noReplyOnFile: ["consolclub.example", "yuxing.example"],
    lowest: frontline.agent,
    text: "Asked 4 agents Wed 14:28 · 2 replied · 2 rates · best on file OMR 298 (Frontline) · no written reply on file from 2",
  },
  journey: {
    set: "sea_import",
    nodes: [
      { key: "booked", label: "Booked", state: "proven", date: "2026-11-05", note: "", noteTone: null, proof: null, subSteps: [], emailIds: ["c1"] },
      {
        key: "so",
        label: "SO released",
        state: "proven",
        date: "2026-11-09",
        note: "",
        noteTone: null,
        proof: proof("a2", "Reena Aneesh (Frontline)", "Mon 09 Nov, 10:58", "issued S/O to the shipper"),
        subSteps: [],
        emailIds: ["a2", "u2"],
      },
      { key: "sailed", label: "Sailed", state: "todo", date: null, note: "ETD not advised", noteTone: null, proof: null, subSteps: [], emailIds: [] },
    ],
    reached: "so",
    nowDiscussing: "so",
    chip: "SO released Mon 09 Nov · now: SO",
    cancelled: null,
  },
  copy: { ...blank.copy, chase: { "consolclub.example": "Dear Hui Min, may we have your rate?" } },
};

const board = (over: Partial<ConversationBoardProps> = {}) =>
  renderToStaticMarkup(
    <ConversationBoard
      brief={full}
      row={row}
      today={today}
      mailbox="pricing@forwarder.example"
      loading={false}
      error={null}
      viewer={manager}
      actions={actions}
      openMailId={null}
      milestoneFilter={null}
      reply={null}
      onCloseReply={() => {}}
      onSent={() => {}}
      {...over}
    />,
  );

/** The text a reader sees, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const count = (html: string, part: string) => html.split(part).length - 1;

/** The conversations rendered, in order, each with what the board handed it. */
const stubs = (html: string) => [...html.matchAll(/<article data-stub="([^"]+)" data-folded="(\w+)" data-compact="(\w+)" data-find="([^"]*)" data-reply="([^"]*)" data-step="([^"]*)" data-open-mail="([^"]*)"/g)].map(
  ([, key, folded, compact, find, reply, step, openMail]) => ({ key, folded: folded === "true", compact: compact === "true", find, reply, step, openMail }),
);

const rows: RowContext = {
  row,
  today,
  mailbox: null,
  viewer: manager,
  compact: false,
  actions,
  open: new Set(["a2"]),
  onToggle: () => {},
  sideOf: (m) => full.sides.find((s) => s.key === m.sideKey) ?? null,
};

describe("ConversationBoard", () => {
  it("shows the customer beside the agents, the agreed agent first and the paused one folded", () => {
    const html = board();
    expect(html).toMatch(/^<section id="conversation"/);
    expect(text(html)).toContain("Conversation · 15 e-mails · 2 hidden");
    expect(stubs(html).map((s) => s.key)).toEqual(["customer", "frontline.example", "wwl.example", "consolclub.example", "yuxing.example"]);
    expect(stubs(html).filter((s) => s.folded).map((s) => s.key)).toEqual(["wwl.example"]);
    expect(stubs(html).every((s) => !s.compact && !s.reply && !s.find && !s.step)).toBe(true);
    expect(html).toContain("@min-[880px]:grid-cols-2");
    // Each conversation sits in a wrapper the board can scroll to.
    expect(html).toContain('data-side="frontline.example"');
  });

  it("offers the views with their counts, side by side pressed", () => {
    const html = board();
    const switcher = /<div role="group" aria-label="View".*?<\/div>/.exec(html)?.[0] ?? "";
    expect(text(switcher)).toBe("Side by sideCustomer · 4Agents · 5Our side · 1Everything");
    expect(count(switcher, 'aria-pressed="true"')).toBe(1);
    expect(switcher).toMatch(/aria-pressed="true"[^>]*>Side by side</);
    expect(count(switcher, 'tabindex="0"')).toBe(1);
    expect(html).toContain('placeholder="Find"');
    expect(html).toContain('aria-label="Open in Gmail"');
  });

  it("says what the agents were asked, links the rate to its e-mail and offers to chase those without a reply", () => {
    const html = board();
    expect(text(html)).toContain("Asked 4 agents Wed 14:28 · 2 replied · 2 rates · best on file OMR 298 (Frontline)");
    expect(html).toMatch(/<button type="button" title="Reena Aneesh \(Frontline\) · Thu 05 Nov, 07:11 · “We can offer OMR 298 ocean freight”"[^>]*>best on file OMR 298 \(Frontline\)/);
    expect(html).toContain(">Chase those 2<");
    expect(chaseTargets(full).map((s) => s.name)).toEqual(["Consolclub", "Yuxing"]);
  });

  it("sets another enquiry's e-mails aside, greyed under their subject, with Move and Keep here", () => {
    const html = board();
    expect(text(html)).toContain("2 e-mails look like SL262790 (40 HQ Qingdao → Sohar) · left out of what this page reads");
    expect(text(html)).toContain("RE: SL262790 QINGDAO - SOHAR 40 HQ");
    // They belong to no conversation of this enquiry.
    expect(html).toMatch(/<ol role="list" class="opacity-60"><li id="mail-x2" data-open="false" data-stripe="false" data-row-side="">.*?<li id="mail-x1"/);
    expect(html).toMatch(/ring-control[^>]*>Move to SL262790</);
    expect(html).toContain(">Keep here<");
    // A long group shows its newest three until asked for all.
    const four: CrossFiledGroup = { ...lookAlike, mails: [x2, x1, { ...x1, id: "x0" }, { ...x1, id: "x00" }], text: "4 e-mails look like SL262790" };
    const long = board({ brief: { ...full, crossFiled: [four] } });
    expect(long).toContain('id="mail-x0"');
    expect(long).not.toContain('id="mail-x00"');
    expect(long).toMatch(/aria-expanded="false"[^>]*>Show all 4</);
  });

  it("folds the noise into one row, closed until asked for", () => {
    const html = board();
    expect(text(html)).toContain("1 auto-reply and 1 'adding a colleague' note hidden");
    expect(html).toMatch(/aria-expanded="false"[^>]*>Show<span class="sr-only"> the hidden e-mails</);
    expect(html).not.toContain('id="mail-n1"');
    // A bounce is in no conversation: it shows under Everything.
    expect(html).not.toContain('id="mail-b1"');
    // No strip above the conversations while nothing is filtered.
    expect(html).not.toContain("bg-table-head px-4");
  });

  it("has no filled button", () => {
    expect(board()).not.toContain("bg-primary");
  });

  it("hands a reply to the conversation it belongs to, and unfolds that one", () => {
    const reply: ReplyPrefill = { sideKey: "wwl.example", targetEmailId: "w1", all: false, to: ["liwei@wwl.example"], cc: [], subject: "RE: SL262784", message: "Dear Li Wei,", warnings: [] };
    const got = stubs(board({ reply }));
    expect(got.filter((s) => s.reply).map((s) => [s.key, s.reply])).toEqual([["wwl.example", "w1"]]);
    expect(got.find((s) => s.key === "wwl.example")?.folded).toBe(false);
  });

  it("unfolds the conversation that holds the e-mail to show, and passes the e-mail on", () => {
    const got = stubs(board({ openMailId: "w1" }));
    expect(got.find((s) => s.key === "wwl.example")).toMatchObject({ folded: false, openMail: "w1" });
    expect(got.every((s) => s.openMail === "w1")).toBe(true);
  });

  it("filters to a shipment step: says so, offers Clear, and puts away what is not about it", () => {
    const html = board({ milestoneFilter: "so", onClearMilestone: () => {} });
    expect(text(html)).toContain("Showing the e-mails about SO released");
    expect(html).toMatch(/>Clear<span class="sr-only"> the step, to show every e-mail</);
    expect(stubs(html).every((s) => s.step === "so")).toBe(true);
    expect(html).not.toContain("look like SL262790");
    expect(html).not.toContain("hidden</p>");
    // Without a way to clear it, the line stands alone; a step the track does not have filters nothing.
    expect(board({ milestoneFilter: "so" })).not.toContain(">Clear<");
    expect(text(board({ milestoneFilter: "bayan" }))).not.toContain("Showing the e-mails about");
  });

  it("says that no e-mails are filed yet, with the reference to copy", () => {
    const html = board({ brief: blank });
    expect(text(html)).toContain("No e-mails are filed here yet. Mail whose subject carries SL262784 is added automatically.");
    expect(html).toContain("Copy reference");
    expect(text(html)).not.toContain("e-mails ·");
    expect(html).not.toContain('aria-label="View"');
    expect(html).not.toContain('placeholder="Find"');
    expect(stubs(html)).toEqual([]);
    expect(count(html, "<button")).toBe(1);
  });

  it("shows a spinner while the e-mails load and an alert with Try again when they fail", () => {
    const loading = board({ brief: blank, loading: true });
    expect(loading).toContain("Loading e-mails…");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain("No e-mails are filed here yet");
    const failed = board({ brief: blank, error: new Error("timeout"), onRetry: () => {} });
    expect(failed).toContain('role="alert"');
    expect(text(failed)).toContain("The e-mails could not be loaded. timeout");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("No e-mails are filed here yet");
    // E-mails already on screen stay there when a refresh fails.
    expect(stubs(board({ error: new Error("timeout") }))).toHaveLength(5);
  });

  it("gives a viewer every reading and no way to move, keep, chase or open Gmail", () => {
    const html = board({ viewer: reader });
    expect(text(html)).toContain("2 e-mails look like SL262790");
    expect(text(html)).toContain("best on file OMR 298 (Frontline)");
    expect(html).not.toContain("Move to");
    expect(html).not.toContain("Keep here");
    expect(html).not.toContain("Chase");
    expect(html).not.toContain("Open in Gmail");
    expect(setAsideButtons(lookAlike, full.flags, reader)).toEqual([]);
  });

  it("gives a sales login Keep here, and leaves moving, chasing and Gmail to the mailbox", () => {
    const html = board({ viewer: sales });
    expect(html).toContain(">Keep here<");
    expect(html).not.toContain("Move to");
    expect(html).not.toContain("Chase");
    expect(html).not.toContain("Open in Gmail");
  });

  it("lets a button with a long name wrap inside its box at phone width, never spill out of it", () => {
    // A free-mail agent's conversation is named by its whole address.
    const gmail = "frontline.shipping.operations@gmail.com";
    const loner = { ...consol, name: gmail };
    const brief = { ...full, sides: full.sides.map((s) => (s.key === consol.key ? loner : s)), agentsSummary: { ...full.agentsSummary, noReplyOnFile: [consol.key] } };
    const html = board({ brief });
    expect(html).toMatch(new RegExp(`<button type="button" class="[^"]*max-w-full whitespace-normal wrap-anywhere[^"]*">Chase ${gmail.replace(/\./g, "\\.")}</button>`));
    // The buttons the brief hands the board wrap the same way; a short label stays on one line at the usual height.
    expect(html).toMatch(/class="[^"]*wrap-anywhere[^"]*min-h-8[^"]*">Move to SL262790</);
    expect(html).not.toMatch(/whitespace-nowrap[^"]*">(Chase|Move to)/);
  });

  it("says when no agent has written", () => {
    const html = board({ brief: { ...full, sides: [customer, internal], mails: [u2, c2, c1, u1, i1], crossFiled: [], hidden: blank.hidden } });
    expect(text(html)).toContain("No agent has written yet. If agents were asked from another mailbox, copy pricing@forwarder.example so their replies are filed here.");
    expect(text(html)).toContain("Agents · 0");
    expect(text(html)).not.toContain("Asked 4 agents");
  });
});

describe("the board's views", () => {
  it("leaves both columns out on a phone and names them for what they are when stacked", () => {
    expect(viewOptions(full, "phone").map((o) => o.key)).toEqual(["customer", "agents", "ours", "all"]);
    expect(viewOptions(full, "stacked")[0]).toEqual({ key: "both", label: "Both", count: null });
    expect(viewOptions(full, "wide").map((o) => [o.label, o.count])).toEqual([
      ["Side by side", null],
      ["Customer", 4],
      ["Agents", 5],
      ["Our side", 1],
      ["Everything", null],
    ]);
    expect(viewOptions(blank, "wide").map((o) => o.key)).toEqual(["both", "customer", "agents", "all"]);
  });

  it("opens side by side, and on a phone on the conversation whose move it is", () => {
    expect(startView(full, false)).toBe("both");
    expect(startView(full, true)).toBe("customer");
    expect(startView({ ...full, move: { ...full.move, sideKey: "frontline.example" } }, true)).toBe("agents");
    expect(startView({ ...full, move: { ...full.move, sideKey: null }, sides: [side("customer", "customer", "Oman Textiles", []), frontline] }, true)).toBe("agents");
    expect(startView(blank, true)).toBe("customer");
  });

  it("finds the view that shows an e-mail", () => {
    expect(viewForMail(full, "a1", "both", false)).toBe("both");
    expect(viewForMail(full, "a1", "customer", false)).toBe("both");
    expect(viewForMail(full, "a1", "customer", true)).toBe("agents");
    expect(viewForMail(full, "c1", "agents", true)).toBe("customer");
    expect(viewForMail(full, "i1", "both", false)).toBe("ours");
    // A mail of ours to several agents is in each of their conversations.
    expect(viewForMail(full, "r1", "agents", true)).toBe("agents");
    // A bounce is in no conversation; a folded e-mail sits under the views that hold its conversation.
    expect(viewForMail(full, "b1", "both", false)).toBe("all");
    expect(viewForMail(full, "n2", "both", false)).toBe("both");
    expect(viewForMail(full, "n2", "customer", false)).toBe("all");
    // Another enquiry's e-mails are under every view; Everything shows the rest.
    expect(viewForMail(full, "x1", "customer", true)).toBe("customer");
    expect(viewForMail(full, "c1", "all", false)).toBe("all");
    expect(viewForMail(full, "nowhere", "agents", false)).toBe("agents");
  });

  it("brings a reply that is asked for into view, again when it is asked for again", () => {
    // In a view without its conversation: switch to one that has it, and scroll to the reply.
    expect(replySpot(full, "frontline.example", "customer", false)).toEqual({ view: "both", spot: { side: "frontline.example", reply: true } });
    expect(replySpot(full, "frontline.example", "customer", true)).toEqual({ view: "agents", spot: { side: "frontline.example", reply: true } });
    // Everything lists rows, not conversations: the reply box is in the conversation's view.
    expect(replySpot(full, "customer", "all", false)).toEqual({ view: "both", spot: { side: "customer", reply: true } });
    // Already in view: no switch, but the reply is still brought back into sight.
    expect(replySpot(full, "frontline.example", "both", false)).toEqual({ view: null, spot: { side: "frontline.example", reply: true } });
    expect(replySpot(full, "frontline.example", "agents", true)).toEqual({ view: null, spot: { side: "frontline.example", reply: true } });
    expect(replySpot(full, "nowhere.example", "both", false)).toBeNull();
  });

  it("orders the agents column and folds it by the room there is", () => {
    const column = agentColumn(full.sides);
    expect(column.map((s) => s.name)).toEqual(["Frontline", "WWL", "Consolclub", "Yuxing"]);
    expect([...foldedKeys(column, false)]).toEqual(["wwl.example"]);
    // Stacked, only the conversation with the newest e-mail stays open.
    expect([...foldedKeys(column, true)]).toEqual(["frontline.example", "consolclub.example", "yuxing.example"]);
    const declined = side("sanco.example", "agent", "Sanco", [r1], { agent: quote("sanco.example", "Sanco", "declined", r1.at) });
    expect([...foldedKeys([frontline, declined], false)]).toEqual(["sanco.example"]);
    expect(full.sides.map((s) => s.key)).toEqual(["customer", "wwl.example", "frontline.example", "consolclub.example", "yuxing.example", "internal"]);
  });

  it("matches the Find box against who wrote, the subject, the text, the cues and the files", () => {
    expect(mailMatches(a1, "telex")).toBe(true);
    expect(mailMatches(a1, "  TELEX  reena ")).toBe(true);
    expect(mailMatches(a1, "telex fahid")).toBe(false);
    expect(mailMatches(a2, "booking form")).toBe(true);
    expect(mailMatches(u1, "final")).toBe(true);
    expect(mailMatches(x1, "sl262790")).toBe(true);
    expect(mailMatches(c1, "")).toBe(true);
  });

  it("words the folded row for the e-mails under one view", () => {
    expect(hiddenLabel([n1, n2])).toBe("1 auto-reply and 1 'adding a colleague' note hidden");
    expect(hiddenLabel([n1])).toBe("1 auto-reply hidden");
    expect(hiddenLabel([n1, { ...n1, id: "n3" }, { ...n2, noise: "duplicate" }])).toBe("2 auto-replies and 1 duplicate hidden");
    expect(hiddenLabel([])).toBe("");
  });

  it("takes the buttons of a group from its flag, never filled, by what the reader may do", () => {
    const fromFlag = setAsideButtons(lookAlike, [wrongFlag], manager);
    expect(fromFlag.map((b) => [b.id, b.variant])).toEqual([
      ["move_mails", "secondary"],
      ["keep_thread", "secondary"],
    ]);
    expect(fromFlag[0]).toMatchObject({ reference: "SL262790", emailIds: ["x2", "x1"] });
    expect(fromFlag[1]).toBe(wrongFlag.buttons[2]);
    expect(setAsideButtons(lookAlike, [wrongFlag], sales).map((b) => b.label)).toEqual(["Keep here"]);
    // Without a flag the board builds them from the group.
    expect(setAsideButtons(lookAlike, [], manager)).toEqual([
      { id: "move_mails", label: "Move to SL262790", variant: "secondary", reference: "SL262790", emailIds: ["x2", "x1"] },
      { id: "keep_thread", label: "Keep here", variant: "ghost", threadIds: ["t9"] },
    ]);
    const unknown: CrossFiledGroup = { ...lookAlike, looksLike: null, why: "unknown_sender", text: "2 e-mails may not belong here" };
    expect(setAsideButtons(unknown, [], manager).map((b) => [b.id, b.label])).toEqual([
      ["keep_thread", "Keep here"],
      ["wrong_enquiry", "Wrong enquiry"],
    ]);
    expect(setAsideButtons(unknown, [], sales).map((b) => b.id)).toEqual(["keep_thread"]);
  });
});

describe("EverythingList", () => {
  const everything = full.mails.filter((m) => m.scope === "in" || m.noise === "bounce");
  const list = (over: Partial<Parameters<typeof EverythingList>[0]> = {}) =>
    renderToStaticMarkup(
      <EverythingList mails={everything} capped all={false} onAll={() => {}} chips={cueChips(everything)} chip={null} onChip={() => {}} list={rows} {...over} />,
    );

  it("lists the newest eight under day headings, striped, with the rest behind a button", () => {
    const html = list();
    expect(everything).toHaveLength(11);
    expect(count(html, "<li ")).toBe(8);
    expect(text(html)).toContain("Mon 09 Nov");
    expect(text(html)).toContain("Thu 05 Nov");
    expect(html).toMatch(/<li id="mail-w2" data-open="false" data-stripe="true" data-row-side="wwl.example">/);
    expect(html).toMatch(/<li id="mail-a2" data-open="true"/);
    // A bounce is a row here; the folded and the set-aside e-mails are not.
    expect(html).toContain('id="mail-b1"');
    expect(html).not.toContain('id="mail-n1"');
    expect(html).not.toContain('id="mail-x1"');
    expect(html).toMatch(/aria-expanded="false"[^>]*>Show 3 older</);
    expect(count(list({ all: true }), "<li ")).toBe(11);
    expect(list({ all: true })).toContain("Show the latest 8");
  });

  it("offers a chip for each kind of cue its rows show", () => {
    expect(cueChips(everything)).toEqual([
      { label: "Offer", count: 1 },
      { label: "Rate", count: 2 },
      { label: "Rate request", count: 1 },
      { label: "Says yes", count: 1 },
      { label: "Complaint", count: 1 },
      { label: "SO", count: 2 },
      { label: "Bounced", count: 1 },
    ]);
    const html = list({ chip: "Rate", mails: [a1, w1], capped: false });
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Rate<span[^>]*>2</);
    expect(count(html, "<li ")).toBe(2);
    expect(html).not.toContain("older");
  });
});
