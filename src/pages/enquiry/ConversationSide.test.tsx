import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentQuote, Cue, EnquiryBrief, MailInput, Offer, Person, Proof, Question, ReadMail, ReplyPrefill, Side, Viewer } from "../../lib/enquiryBrief";
import { enquiry } from "../../lib/testFixtures";
import { ReplyBox, replyDraftKey, type ReplyBoxPrefill } from "../inbox/ReplyBox";
import { ConversationSide, MailRow, QuestionLine, replyAction, sideChips, sideMenu, subjectChanges, type ConversationSideProps, type MailRowProps } from "./ConversationSide";
import type { PageActions } from "./shared";

// The e-mail view and the reply box load files and send through the database module; neither is called here.
vi.mock("../../lib/api", () => ({ attachmentUrl: vi.fn(), sendReply: vi.fn() }));

const TODAY = "2026-11-09";
const MAILBOX = "pricing@forwarder.example";
const FAHID = "purchase_otm@omzest.example";
const REENA = "reena@frontline.example";

const row = enquiry({ reference: "SL262784", enquiry_date: "2026-11-04", customer_name: "OMAN TEXTILES", pol: "NINGBO CHINA", pod: "SOHAR OMAN" });

const actions: PageActions = { onOpenMail: () => {}, onAction: () => {}, busy: {} };

const pricing: Viewer = { canEdit: true, canReply: true, me: null };
const sales: Viewer = { canEdit: true, canReply: false, me: "s7" };
const reader: Viewer = { canEdit: false, canReply: false, me: null };

/** The ISO timestamp of an Oman wall-clock time ("2026-11-09 09:25"). */
const oman = (wall: string) => new Date(`${wall.replace(" ", "T")}:00+04:00`).toISOString();

function message(id: string, wall: string, over: Partial<MailInput> = {}): MailInput {
  return {
    id,
    mailbox_id: null,
    gmail_message_id: `g-${id}`,
    gmail_thread_id: "t-customer",
    sender_type: "external",
    from_email: FAHID,
    from_name: "Fahid, OTM",
    to_emails: ["operation@forwarder.example"],
    cc_emails: [MAILBOX],
    subject: "RE: SL262784 // Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)",
    received_at: oman(wall),
    snippet: null,
    body_text: "Dear Ashwin,\n\nKindly check with your team and provide an urgent update on the handover status.",
    sl_refs: ["SL262784"],
    attachments: [],
    status: "linked",
    classification: "follow_up",
    match_method: "reference",
    confidence: 1,
    summary: null,
    note: null,
    suggested_enquiry_id: null,
    enquiry_id: row.id,
    draft_id: null,
    ...over,
  };
}

/** An e-mail as the brief reads it: from the customer's Fahid unless said otherwise. */
function read(id: string, wall: string, over: Partial<Omit<ReadMail, "email">> & { email?: Partial<MailInput> } = {}): ReadMail {
  const { email, ...rest } = over;
  const filed = message(id, wall, email);
  return {
    email: filed,
    id,
    at: filed.received_at,
    day: wall.slice(0, 10),
    time: wall.slice(11, 16),
    from: { name: "Fahid K V", email: FAHID, staff: null },
    party: "customer",
    toParty: null,
    sideKey: "customer",
    scope: "in",
    crossFiled: null,
    noise: null,
    siblingHint: null,
    kind: "substantive",
    clean: "",
    excerpt: "",
    isRequest: false,
    isChase: false,
    isPureChase: false,
    urgent: false,
    hold: false,
    promise: null,
    deadline: null,
    cues: [],
    money: [],
    moneyRole: null,
    milestones: [],
    files: [],
    sentFromApp: null,
    outOfHours: null,
    ...rest,
  };
}

const ashwin = { name: "Ashwin Luiz", email: "operation@forwarder.example", staff: null };
const ours = (to: ReadMail["toParty"], sideKey: string) => ({
  from: ashwin,
  party: "us" as const,
  toParty: to,
  sideKey,
  email: { sender_type: "staff" as const, from_email: ashwin.email, from_name: "Ashwin luiz", to_emails: [FAHID], cc_emails: [MAILBOX] },
});

const cue = (key: Cue["key"], label: string, tone: Cue["tone"]): Cue => ({ key, label, tone });

const proofOf = (mail: ReadMail, who: string, sentence = mail.excerpt): Proof => ({ emailId: mail.id, who, when: `Mon 09 Nov, ${mail.time}`, sentence });

// --- The customer's conversation: ten e-mails, the newest a complaint we answered with the SO. -------------------

const soToCustomer = read("c-so", "2026-11-09 11:15", {
  ...ours("customer", "customer"),
  excerpt: "Please note we have received the shipper's booking as attached and issued S/O to the shipper accordingly.",
  clean: "Please note we have received the shipper's booking as attached and issued S/O to the shipper accordingly.\n\nWe shall update you further once shipper hand over cargo",
  cues: [cue("so", "SO", "info")],
  files: [{ filename: "BOOKING FORM -320348-.xls", mime: "application/vnd.ms-excel", size: 30720, storagePath: "2026/11/x/1-BOOKING.xls", emailId: "c-so", at: oman("2026-11-09 11:15"), from: "Ashwin Luiz", sideKey: "customer", crossFiled: false }],
  sentFromApp: "Sahan",
});
const complaint = read("c-complaint", "2026-11-09 09:25", {
  excerpt: "Our vendor has informed us that the material is ready for handover, but your team is not responding.",
  clean: "Our vendor has informed us that the material is ready for handover, but your team is not responding.\n\nKindly check with your team and provide an urgent update on the handover status.",
  cues: [cue("complaint", "Complaint", "bad"), cue("urgent", "Urgent", "warn"), cue("asks", "Asks", "neutral")],
  isRequest: true,
  urgent: true,
});
const weekend = read("c-weekend", "2026-11-07 10:01", {
  ...ours("customer", "customer"),
  excerpt: "Please find below message from origin and advise to proceed further",
  outOfHours: "weekend",
});
const yes = read("c-yes", "2026-11-05 15:11", {
  excerpt: "You are here by nominated to arrange for collection of cargo immediately.",
  cues: [cue("nominated", "Says yes", "good")],
});
const finalOffer = read("c-final", "2026-11-05 09:37", {
  ...ours("customer", "customer"),
  excerpt: "Please find below our final offer.",
  clean: "Please find below our final offer.\n\nPORT TO PORT : OMR 339.000\n\nLCL + DO : OMR 132.000",
  cues: [cue("final_offer", "Offer OMR 339 · final", "primary")],
});
const older = ["08:46", "08:44", "08:20", "08:10", "08:05"].map((time, i) =>
  i % 2 === 0
    ? read(`c-old-${i}`, `2026-11-05 ${time}`, { ...ours("customer", "customer"), excerpt: `Earlier note ${i} from us` })
    : read(`c-old-${i}`, `2026-11-05 ${time}`, { excerpt: `Earlier note ${i} from them` }),
);
const firstAsk = read("c-first", "2026-11-04 14:35", {
  excerpt: "Please provide your best quotation for sea freight charges on an LCL basis.",
  email: { gmail_thread_id: "t-first", subject: "Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)" },
});
const customerMails = [soToCustomer, complaint, weekend, yes, finalOffer, ...older, firstAsk];

const openQuestion: Question = {
  id: "q:c-complaint:0",
  sentence: "Kindly check with your team and provide an urgent update on the handover status.",
  proof: proofOf(complaint, "Fahid K V (Oman Textiles)", "Kindly check with your team and provide an urgent update on the handover status."),
  age: { workingHours: 4.2, rawHours: 4.2, label: "4 working h (4 h)" },
  answered: false,
  answeredText: null,
};
const answeredQuestion: Question = {
  id: "q:c-old-1:0",
  sentence: "Please share the destination charges for our reference.",
  proof: { emailId: "c-old-1", who: "Fahid K V (Oman Textiles)", when: "Thu 05 Nov, 08:44", sentence: "Please share the destination charges for our reference." },
  age: { workingHours: 30, rawHours: 100, label: "3 working days (100 h)" },
  answered: true,
  answeredText: "answered Thu 08:46",
};

const customerSide: Side = {
  key: "customer",
  kind: "customer",
  name: "Oman Textiles",
  domain: "omzest.example",
  agentName: null,
  mails: customerMails,
  threads: [
    { id: "t-customer", subject: "RE: SL262784 // Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)", count: 10, gmailUrl: "https://mail.google.com/mail/#all/t-customer" },
    { id: "t-first", subject: "Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)", count: 1, gmailUrl: "https://mail.google.com/mail/#all/t-first" },
  ],
  lastFromThem: complaint,
  lastFromUs: soToCustomer,
  currentWriter: { name: "Fahid K V", email: FAHID, staff: null },
  state: {
    kind: "waiting_on_us",
    since: oman("2026-11-09 09:25"),
    age: { workingHours: 4.2, rawHours: 22, label: "4 working h (22 h)" },
    tone: "warn",
    text: "Waiting for us since Mon 09:25 · 4 working h (22 h)",
    proof: proofOf(complaint, "Fahid K V (Oman Textiles)"),
  },
  questions: [answeredQuestion, openQuestion],
  chase: { count: 3, since: oman("2026-11-08 08:54"), last: oman("2026-11-09 09:25"), urgent: true, unanswered: 1, text: "Asked 3 times since Sun 08:54 · last Mon 09:25 · urgent" },
  deadline: {
    at: "2026-11-09T12:00:00+04:00",
    text: "by 12:00 today",
    passed: false,
    cleared: false,
    proof: proofOf(complaint, "Fahid K V (Oman Textiles)", "Please revert by 12:00 today."),
  },
  promise: {
    by: "us",
    sentence: "We shall update you further once shipper hand over cargo",
    due: "2026-11-09",
    kept: false,
    proof: proofOf(soToCustomer, "Ashwin Luiz", "We shall update you further once shipper hand over cargo"),
  },
  replyWindow: { text: "Works Oman hours · weekend Fri–Sat" },
  holiday: null,
  agent: null,
  pausedByUs: null,
  fileCount: 2,
  hiddenCount: 0,
};

// --- An agent's conversation: Frontline, on two subjects, the SO shown by their newest e-mail. ---------------------

const reena = { name: "Reena Aneesh", email: REENA, staff: null };
const theirs = { from: reena, party: "agent" as const, sideKey: "frontline.example", email: { from_email: REENA, from_name: "Reena Aneesh", gmail_thread_id: "t-job", subject: "RE: ENQ1020126007139//ABSOH26110504//SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN" } };
const toAgent = (thread: string, subject: string) => ({
  ...ours("agent", "frontline.example"),
  email: { sender_type: "staff" as const, from_email: ashwin.email, from_name: "Ashwin luiz", to_emails: [REENA], gmail_thread_id: thread, subject },
});

const soIssued = read("a-so", "2026-11-09 10:58", {
  ...theirs,
  excerpt: "Agent have received the shipper's booking and issued S/O to the shipper accordingly.",
  clean: "Agent have received the shipper's booking and issued S/O to the shipper accordingly.\nPlease refer to the following cargo details and confirm to proceed.",
  cues: [cue("so", "SO", "info")],
  milestones: [{ key: "so", sub: null, proves: true, sentence: "issued S/O to the shipper accordingly", file: "BOOKING FORM -320348-.xls" }],
  outOfHours: null,
});
const proceed = read("a-proceed", "2026-11-09 08:10", {
  ...toAgent("t-job", "RE: ENQ1020126007139//ABSOH26110504//SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN"),
  excerpt: "Please proceed without palletization",
});
const overnight = read("a-night", "2026-11-08 05:41", { ...theirs, excerpt: "Shipper says pallet is not needed for the fabric.", outOfHours: "overnight", cues: [cue("asks", "Asks", "neutral")] });
const agreed = read("a-agreed", "2026-11-05 16:04", {
  ...toAgent("t-rates", "RE: SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN"),
  excerpt: "Please proceed this shipment.",
  cues: [cue("confirmed_to_agent", "Go-ahead", "good")],
});
const rate = read("a-rate", "2026-11-05 15:35", {
  ...theirs,
  from: { name: "Manukrishna VK", email: "manu@frontline.example", staff: null },
  email: { from_email: "manu@frontline.example", from_name: "Manukrishna VK", gmail_thread_id: "t-rates", subject: "RE: SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN" },
  excerpt: "Pls support with below: OCEAN FREIGHT : OMR 298/- All in for 6 CBM",
  cues: [cue("rate", "Rate OMR 298", "neutral")],
});

const frontlineQuote: AgentQuote = {
  sideKey: "frontline.example",
  name: "Frontline",
  domain: "frontline.example",
  state: "agreed",
  askedAt: oman("2026-11-04 18:05"),
  requestOnFile: true,
  options: [],
  latest: null,
  lowestOnFile: true,
  earlier: [309, 303],
  validity: null,
  repliedInHours: 13,
  question: null,
  summary: "OMR 309 → 303 → 298 + 117 · agreed · TT 25–35 days · no validity given",
  lastAt: oman("2026-11-09 10:58"),
};

const agentSide: Side = {
  key: "frontline.example",
  kind: "agent",
  name: "Frontline",
  domain: "frontline.example",
  agentName: "FRONTLINE",
  mails: [soIssued, proceed, overnight, agreed, rate],
  threads: [
    { id: "t-job", subject: "RE: ENQ1020126007139//ABSOH26110504//SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN", count: 3, gmailUrl: "https://mail.google.com/mail/#all/t-job" },
    { id: "t-rates", subject: "RE: SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN", count: 2, gmailUrl: "https://mail.google.com/mail/#all/t-rates" },
  ],
  lastFromThem: soIssued,
  lastFromUs: proceed,
  currentWriter: reena,
  state: {
    kind: "pass_on",
    since: oman("2026-11-09 10:58"),
    age: { workingHours: 7, rawHours: 7, label: "7 working h (7 h)" },
    tone: "bad",
    text: "SO issued Mon 10:58 · not passed on yet",
    proof: proofOf(soIssued, "Reena Aneesh (Frontline)"),
  },
  questions: [],
  chase: null,
  deadline: null,
  promise: null,
  replyWindow: { text: "Works Oman hours · weekend Fri–Sat" },
  holiday: { value: "Deepavali", proof: { emailId: "a-night", who: "Reena Aneesh (Frontline)", when: "Sun 08 Nov, 09:12", sentence: "Our office remains closed today for Deepavali." } },
  agent: frontlineQuote,
  pausedByUs: null,
  fileCount: 0,
  hiddenCount: 0,
};

const fahid: Person = {
  name: "Fahid K V",
  designation: null,
  company: "Oman Textile Mills",
  phones: [],
  wechat: null,
  email: FAHID,
  party: "customer",
  wrote: 5,
  lastWrote: oman("2026-11-09 09:25"),
  lastWeReplied: oman("2026-11-09 11:15"),
  sharedDesk: true,
  chips: [],
  localTime: null,
  canSave: true,
  prefill: { contact_name: "Fahid K V", contact_email: FAHID, notes: ["Contact from Fahid K V's e-mail of Mon 09 Nov"] },
};

const offer: Offer = {
  lines: [],
  total: 471,
  currency: "OMR",
  whole: true,
  missing: [],
  count: null,
  twin: "≈ USD 1,225 at 2.6",
  linesText: "339 port to port + 132 LCL & DO",
  scope: "port to port",
  final: true,
  revised: true,
  basis: null,
  transit: "35 days",
  freeDays: null,
  etd: null,
  routing: null,
  validUntil: null,
  validityStated: false,
  sentAt: oman("2026-11-05 09:37"),
  sentBy: { name: "Anwar K. S.", email: "operation2@forwarder.example", staff: null },
  sentTo: [FAHID],
  proof: { emailId: "c-final", who: "Anwar K. S.", when: "Thu 05 Nov, 09:37", sentence: "Please find below our final offer." },
  earlier: [],
  options: [],
  acceptedBy: null,
  fromQuotedHistory: false,
};

function briefOf(over: Partial<EnquiryBrief> = {}): EnquiryBrief {
  const sides = over.sides ?? [customerSide, agentSide];
  return {
    mails: [...new Set(sides.flatMap((s) => s.mails))],
    sides,
    hidden: { autoReplies: 0, loopIns: 0, duplicates: 0, text: "", mails: [] },
    crossFiled: [],
    move: { kind: "us_customer", icon: "clock", tone: "warn", word: "Customer is waiting for us", why: [], clock: null, sideKey: "customer", proof: null },
    now: { kind: "customer_waiting", tone: "warn", title: "Oman Textiles is waiting for us", said: null, lines: [], buttons: [], checkLine: null },
    needsYou: [],
    flags: [],
    truth: null,
    offer: null,
    agentRates: [frontlineQuote],
    agentsSummary: { writtenTo: 1, replied: 1, rates: 1, declined: 0, requestOnFile: true, noReplyOnFile: [], lowest: frontlineQuote, text: "" },
    buy: null,
    targets: [],
    margin: { figure: null, inputs: null, why: "Needs an offer and an agreed buy", notes: [], clash: null, source: "mail" },
    trail: [],
    trailSentence: null,
    registerMoney: { hasRates: false, missingText: null, differs: null, slip: null, prefill: null },
    laneBenchmark: null,
    stages: [],
    journey: {
      set: "sea_import",
      nodes: [
        { key: "booked", label: "Booked", state: "proven", date: "2026-11-05", note: "", noteTone: null, proof: null, subSteps: [], emailIds: ["a-agreed"] },
        { key: "so", label: "SO released", state: "proven", date: "2026-11-09", note: "", noteTone: null, proof: proofOf(soIssued, "Reena Aneesh (Frontline)"), subSteps: [], emailIds: ["c-so"] },
        { key: "sailed", label: "Sailed", state: "todo", date: null, note: "ETD not advised", noteTone: null, proof: null, subSteps: [], emailIds: [] },
      ],
      reached: "so",
      nowDiscussing: "so",
      chip: "SO released Mon 09 Nov · now: SO",
      cancelled: null,
    },
    dates: { etd: null, eta: null, atd: null, cutoff: null, transit: { ours: null, agent: null }, freeDays: { asked: null, given: null }, validity: [], promises: [], headline: null },
    refs: [],
    cargo: { fields: [], gaps: [], warning: null, requestBlock: "", askText: "" },
    drift: [],
    people: [
      { kind: "customer", title: "Customer", sideKey: "customer", note: null, persons: [fahid], copied: [], agentPrefill: null },
      { kind: "agent", title: "Frontline", sideKey: "frontline.example", note: "agreed", persons: [], copied: [], agentPrefill: { agent_name: "FRONTLINE", notes: ["The e-mails are with Frontline (frontline.example)"] } },
    ],
    handler: null,
    documents: [],
    statusText: null,
    copy: {
      status: null,
      offer: null,
      chase: { customer: "Dear Fahid,\n\nMay we have your confirmation on our offer?", "frontline.example": "Dear Reena,\n\nPlease advise the sailing date." },
      requestBlock: "",
      houseSubject: "SL262784 LCL FOB NINGBO CHINA TO SOHAR OMAN",
    },
    mailFollowUps: [],
    history: [],
    ...over,
  };
}

const base: ConversationSideProps = {
  side: customerSide,
  brief: briefOf(),
  row,
  today: TODAY,
  mailbox: MAILBOX,
  viewer: pricing,
  compact: false,
  folded: false,
  actions,
  openMailId: null,
  milestoneFilter: null,
  find: "",
  reply: null,
  onCloseReply: () => {},
  onSent: () => {},
};

const side = (over: Partial<ConversationSideProps> = {}) => renderToStaticMarkup(<ConversationSide {...base} {...over} />);

const rowBase: MailRowProps = { mail: complaint, side: customerSide, row, today: TODAY, mailbox: MAILBOX, viewer: pricing, compact: false, open: false, onToggle: () => {}, actions };

const mailRow = (over: Partial<MailRowProps> = {}) => renderToStaticMarkup(<MailRow {...rowBase} {...over} />);

/** The words on screen: tags dropped, entities decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const count = (html: string, part: string) => html.split(part).length - 1;

/** The ids of the e-mail rows, in the order they are listed. */
const rowIds = (html: string) => [...html.matchAll(/<li id="mail-([^"]+)"/g)].map((m) => m[1]);

/** The class pair of a filled button: the page keeps its one filled button for the Now card. */
const FILLED = "bg-primary text-white";

describe("ConversationSide", () => {
  it("says who it is with, whose move it is with both ages, and the last words from each side", () => {
    const html = side();
    const words = text(html);
    expect(html).toMatch(/<h3 id="[^"]+"><button type="button" aria-expanded="true"/);
    expect(words).toContain("Oman Textiles · Customer · 11 e-mails · 2 threads");
    expect(words).toContain("Waiting for us since Mon 09:25 · 4 working h (22 h)");
    expect(html).toContain("font-semibold text-await");
    expect(words).toContain("Them · Fahid K V · Mon 09:25");
    expect(words).toContain("“Our vendor has informed us that the material is ready for handover, but your team is not responding.”");
    expect(words).toContain("Us · Ashwin Luiz · Mon 11:15");
    expect(words).toContain("“Please note we have received the shipper's booking as attached and issued S/O to the shipper accordingly.”");
    // Both lines open their e-mail, and say who wrote it and when on hover.
    expect(html).toContain('title="Fahid K V (Oman Textiles) · Mon 09 Nov, 09:25 · “Our vendor has informed us');
    expect(html).toContain("shadow-[inset_0_3px_0_var(--color-party-customer)]");
    expect(html).not.toContain(FILLED);
  });

  it("shows only the chips that apply, each with an icon and its tone", () => {
    const words = text(side());
    expect(words).toContain("Open questions 1");
    expect(words).toContain("Wants a reply by 12:00 today");
    expect(words).toContain("Asked 3 times since Sun 08:54 · last Mon 09:25 · urgent");
    expect(words).toContain("We promised “We shall update you further once shipper hand over cargo” · Mon 09 Nov, 11:15 — due today");
    expect(words).toContain("2 files");
    expect(words).toContain("Works Oman hours · weekend Fri–Sat");
    expect(words).not.toContain("closed");

    const bare = text(side({ side: { ...customerSide, questions: [], chase: null, deadline: null, promise: null, replyWindow: null, fileCount: 0 } }));
    for (const chip of ["Open questions", "Wants a reply", "Asked 3 times", "We promised", "files", "Works Oman hours"]) expect(bare).not.toContain(chip);
  });

  it("lists the e-mails newest first under day headings, eight and then the rest", () => {
    const html = side();
    const words = text(html);
    expect(rowIds(html)).toEqual(["c-so", "c-complaint", "c-weekend", "c-yes", "c-final", "c-old-0", "c-old-1", "c-old-2"]);
    expect(html).toContain(">Show 3 older<");
    expect(words).toContain("Mon 09 Nov");
    expect(words).toContain("Sat 07 Nov · over the weekend");
    expect(words).toContain("Thu 05 Nov");
    expect(html).toMatch(/<li id="mail-c-complaint"[^>]*><button type="button" aria-expanded="false"/);
    expect(words).toContain("09:25");
    expect(html).toContain(">Customer</span>");
    expect(html).toContain(">Ours</span>");
    expect(html).toContain(">Complaint</span>");
    expect(html).toContain(">Urgent</span>");
    // A row shows two cues at most.
    expect(html).not.toContain(">Asks</span>");
    expect(html).toContain(">Offer OMR 339 · final</span>");
    expect(html).toContain(">Says yes</span>");
    expect(words).toContain("sent from the app by Sahan");
    expect(words).toContain("1 attachment");
    expect(html).not.toContain("<article");
  });

  it("gives the mailbox Reply and Reply all, and editors the menu", () => {
    const html = side();
    expect(html).toMatch(/ring-control[^>]*>Reply<\/button>/);
    expect(html).toContain(">Reply all</button>");
    expect(html).toContain('aria-label="More for Oman Textiles"');
    expect(html).not.toContain("Pricing replies from the mailbox");
    expect(html).not.toContain("Copy chase text");
    expect(html).not.toContain(FILLED);
  });

  it("gives a sales login the copy fallback in place of Reply", () => {
    const html = side({ viewer: sales });
    expect(html).toContain("Pricing replies from the mailbox");
    expect(html).toContain("Copy chase text");
    expect(html).toContain('aria-label="More for Oman Textiles"');
    expect(html).not.toContain(">Reply<");
    expect(html).not.toContain(">Reply all<");
    expect(side({ viewer: sales, brief: briefOf({ copy: { ...base.brief.copy, chase: {} } }) })).not.toContain("Copy chase text");
  });

  it("gives a viewer the reading and no action buttons", () => {
    const html = side({ viewer: reader, openMailId: "c-complaint" });
    const words = text(html);
    expect(words).toContain("Waiting for us since Mon 09:25 · 4 working h (22 h)");
    expect(words).toContain("Them · Fahid K V · Mon 09:25");
    expect(words).toContain("Open questions 1");
    expect(html).toContain("<article");
    expect(html).not.toContain(">Reply<");
    expect(html).not.toContain(">Reply all<");
    expect(html).not.toContain("More for");
    expect(html).not.toContain("Copy chase text");
    expect(html).not.toContain("Pricing replies from the mailbox");
    expect(html).not.toContain(">Answer<");
    expect(html).not.toContain(FILLED);
  });

  it("says what is missing when the customer has not written", () => {
    const quiet: Side = {
      ...customerSide,
      mails: [finalOffer],
      lastFromThem: null,
      lastFromUs: finalOffer,
      questions: [],
      chase: null,
      deadline: null,
      promise: null,
      state: { kind: "no_word", since: null, age: null, tone: "neutral", text: "No written word from them on file", proof: null },
    };
    const words = text(side({ side: quiet, brief: briefOf({ sides: [quiet], offer }) }));
    expect(words).toContain("No written word from them on file");
    expect(words).toContain(`Confirmations often come by phone or WhatsApp. Our offer of Thu 05 Nov (from Anwar K. S., Thu 05 Nov, 09:37; opens the e-mail) went to ${FAHID}.`);
    expect(count(words, "No written word")).toBe(1);
    expect(words).toContain("Us · Ashwin Luiz · Thu 09:37");
    expect(words).not.toContain("Them ·");

    // No e-mails at all: nothing to reply to, nothing to list.
    const empty: Side = { ...quiet, mails: [], threads: [], lastFromUs: null, currentWriter: null, fileCount: 0, replyWindow: null, state: { ...quiet.state, text: "" } };
    const html = side({ side: empty, brief: briefOf({ sides: [empty] }) });
    expect(text(html)).toContain("No written word from Oman Textiles on file. Confirmations often come by phone or WhatsApp.");
    expect(text(html)).toContain("Oman Textiles · Customer");
    expect(text(html)).not.toContain("e-mails");
    expect(html).not.toContain(">Reply<");
    expect(html).not.toContain("<ol");
  });

  it("heads an agent's conversation with its domain, its rates and what else applies; a wait on an agent is never red", () => {
    const html = side({ side: agentSide });
    const words = text(html);
    expect(words).toContain("Frontline · Agent · frontline.example · 5 e-mails · 2 threads");
    expect(words).toContain("SO issued Mon 10:58 · not passed on yet · 7 working h (7 h)");
    expect(html).toContain("font-semibold text-await");
    expect(html).not.toContain("text-lost");
    expect(words).toContain("OMR 309 → 303 → 298 + 117 · agreed · TT 25–35 days · no validity given");
    expect(words).toContain("Origin closed Sun 08 Nov (Deepavali)");
    expect(words).toContain("Them · Reena Aneesh · Mon 10:58");
    expect(words).toContain("Sun 08 Nov · arrived overnight");
    expect(html).toContain("shadow-[inset_0_3px_0_var(--color-party-agent)]");
    expect(html).toContain(">Agent</span>");
    // The subject the agent's job number came in with is marked where it starts.
    expect(words).toContain("Subject changed: ENQ1020126007139//ABSOH26110504//SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN");

    const paused: Side = { ...agentSide, name: "WWL", pausedByUs: { emailId: "a-proceed", who: "Ashwin Luiz", when: "Mon 09 Nov, 18:29", sentence: "Please hold this shipment." } };
    const folded = side({ side: paused, folded: true });
    expect(text(folded)).toContain("WWL · Agent · frontline.example · 5 e-mails · 2 threads · paused by us Mon 09 Nov, 18:29");
    expect(folded).toContain('title="Ashwin Luiz · Mon 09 Nov, 18:29 · “Please hold this shipment.”"');
  });

  it("folds to its header: no last words, chips, buttons or rows", () => {
    const html = side({ folded: true });
    const words = text(html);
    expect(html).toMatch(/<h3 id="[^"]+"><button type="button" aria-expanded="false"/);
    expect(words).toContain("Oman Textiles · Customer · 11 e-mails");
    expect(words).toContain("Waiting for us since Mon 09:25 · 4 working h (22 h)");
    expect(words).not.toContain("Them ·");
    expect(words).not.toContain("Open questions");
    expect(html).not.toContain(">Reply<");
    expect(rowIds(html)).toEqual([]);
  });

  it("expands the e-mail it is asked to show, from behind the older ones too", () => {
    const html = side({ openMailId: "c-first" });
    expect(rowIds(html)).toHaveLength(11);
    expect(html).toMatch(/<li id="mail-c-first"[^>]*><button type="button" aria-expanded="true"/);
    expect(count(html, "<article")).toBe(1);
    expect(html).toContain("Open in Gmail");
    expect(html).toContain(">Show the latest 8<");
    // An e-mail of another conversation changes nothing here.
    const other = side({ openMailId: "a-so" });
    expect(rowIds(other)).toHaveLength(8);
    expect(other).not.toContain("<article");
  });

  it("names the step an open e-mail shows, and replies to that very e-mail", () => {
    const html = side({ side: agentSide, openMailId: "a-so" });
    expect(text(html)).toContain("Shows: SO released");
    expect(html).toContain('title="issued S/O to the shipper accordingly · BOOKING FORM -320348-.xls"');
    expect(count(html, ">Reply</button>")).toBe(2);
    expect(count(html, ">Reply all</button>")).toBe(2);
  });

  it("shows only the e-mails that contain the words of the Find box", () => {
    const html = side({ find: "final offer" });
    expect(rowIds(html)).toEqual(["c-final"]);
    expect(html).not.toContain("older");
    expect(rowIds(side({ find: "fahid" }))).toHaveLength(5);
    const none = side({ find: "telex" });
    expect(rowIds(none)).toEqual([]);
    expect(text(none)).toContain("Nothing here says “telex”.");
    // The header stays: the filter is on the rows.
    expect(text(none)).toContain("Them · Fahid K V · Mon 09:25");
  });

  it("shows only the e-mails of a shipment step", () => {
    expect(rowIds(side({ milestoneFilter: "so" }))).toEqual(["c-so"]);
    expect(rowIds(side({ side: agentSide, milestoneFilter: "so" }))).toEqual(["a-so"]);
    const none = side({ milestoneFilter: "booked" });
    expect(rowIds(none)).toEqual([]);
    expect(text(none)).toContain("No e-mail here is about Booked.");
    // A step the track does not have filters nothing.
    expect(rowIds(side({ milestoneFilter: "bayan" }))).toHaveLength(8);
  });

  it("writes the reply under the header, starting from what the page suggests", () => {
    const reply: ReplyPrefill = {
      sideKey: "customer",
      targetEmailId: "c-complaint",
      all: true,
      to: [FAHID],
      cc: ["sales7@forwarder.example"],
      subject: "Re: SL262784 // Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)",
      message: "Dear Fahid,\n\n",
      warnings: ["raghavan_otm@omzest.example bounced on Sat 07 Nov — check the address"],
    };
    const html = side({ reply });
    expect(html).toContain('aria-label="Reply to all"');
    expect(html).toMatch(new RegExp(`<input id="reply-to"[^>]*value="${FAHID}"`));
    expect(html).toMatch(/<input id="reply-cc"[^>]*value="sales7@forwarder.example"/);
    expect(html).toMatch(/<input id="reply-subject"[^>]*value="Re: SL262784 \/\/ Request for Sea Freight Quotation - FOB Ningbo to Sohar \(LCL\)"/);
    expect(html).toMatch(/<textarea[^>]*>Dear Fahid,\n\n<\/textarea>/);
    expect(text(html)).toContain("raghavan_otm@omzest.example bounced on Sat 07 Nov — check the address");
    expect(text(html)).toContain("Quote Fahid, OTM's message");
    // The header comes first, the rows after.
    expect(html.indexOf("Them")).toBeLessThan(html.indexOf('id="reply-to"'));
    expect(html.indexOf('id="reply-to"')).toBeLessThan(html.indexOf('id="mail-c-so"'));

    // A reply for another conversation is not this one's.
    expect(side({ reply: { ...reply, sideKey: "frontline.example" } })).not.toContain('id="reply-to"');
    // The e-mail to answer is gone: say so instead of a box that cannot send.
    const gone = side({ reply: { ...reply, targetEmailId: "missing" } });
    expect(gone).not.toContain('id="reply-to"');
    expect(text(gone)).toContain("The e-mail to answer is not in this conversation any more.");
  });
});

describe("MailRow", () => {
  it("is a row that opens: when, who, what it looks like and how it starts", () => {
    const html = mailRow();
    expect(html).toMatch(/^<li id="mail-c-complaint" data-mail="c-complaint"[^>]*><button type="button" aria-expanded="false"/);
    expect(html).toContain('title="Mon 09 Nov, 09:25"');
    expect(html).toContain(">FK</span>");
    expect(html).toContain("bg-party-customer-bg text-party-customer");
    expect(text(html)).toContain("Fahid K V");
    expect(text(html)).toContain("Our vendor has informed us that the material is ready for handover");
    expect(html).not.toContain("<article");
    expect(html).not.toContain("shadow-[inset_3px");
  });

  it("opens to the whole e-mail, with Reply and Reply all for the mailbox only", () => {
    const html = mailRow({ open: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("<article");
    expect(html).toContain("Kindly check with your team and provide an urgent update on the handover status.");
    expect(html).toContain(">Reply</button>");
    expect(html).toContain(">Reply all</button>");
    expect(html).toContain("Open in Gmail");
    expect(html).not.toContain(FILLED);

    for (const viewer of [sales, reader]) {
      const read = mailRow({ open: true, viewer });
      expect(read).toContain("<article");
      expect(read).not.toContain(">Reply<");
      expect(read).not.toContain(">Reply all<");
      // Gmail is the mailbox's too.
      expect(read).not.toContain("Open in Gmail");
      expect(read).not.toContain("mail.google.com");
    }
    // An e-mail that looks like another enquiry's, or one that has no conversation, is not answered from here.
    const elsewhere = { ...complaint, scope: "cross_filed" as const, crossFiled: { why: "other_reference" as const, looksLike: "SL262790", about: null } };
    expect(mailRow({ open: true, mail: elsewhere })).not.toContain(">Reply<");
    expect(mailRow({ open: true, side: null })).not.toContain(">Reply<");
  });

  it("drops the avatar and keeps to one line when compact", () => {
    const html = mailRow({ compact: true });
    expect(html).not.toContain(">FK</span>");
    expect(html).toContain("grid-cols-[2.75rem_minmax(0,1fr)]");
    expect(html).toContain("h-6 flex-wrap");
    expect(html).toContain(">Complaint</span>");
    expect(html).toContain("truncate");
  });

  it("marks whose conversation it is in a list of every e-mail, in colour and in words", () => {
    const theirs = mailRow({ stripe: true });
    expect(theirs).toContain("shadow-[inset_3px_0_0_var(--color-party-customer)]");
    expect(text(theirs)).toContain("Oman Textiles");
    const oursToAgent = mailRow({ stripe: true, mail: proceed, side: agentSide });
    expect(oursToAgent).toContain("shadow-[inset_3px_0_0_var(--color-party-agent)]");
    expect(text(oursToAgent)).toContain("to Frontline");
    expect(oursToAgent).toContain(">Ours</span>");
    // Inside its own conversation the row says neither.
    expect(text(mailRow({ mail: proceed, side: agentSide }))).not.toContain("to Frontline");
  });

  it("says what a folded or doubtful e-mail is", () => {
    const autoReply = { ...complaint, id: "n1", scope: "noise" as const, noise: "auto_reply" as const, excerpt: "I am out of the office until Sunday." };
    const html = mailRow({ mail: autoReply, side: null });
    expect(html).toContain(">Auto-reply</span>");
    // Under no day heading, it says its day and where it came from.
    expect(text(html)).toContain("Mon 09 Nov · omzest.example");
    expect(text(mailRow({ mail: { ...complaint, siblingHint: "SL262810" } }))).toContain("May be about SL262810");
    // No new text: the subject stands in, without the enquiry's own reference.
    expect(text(mailRow({ mail: { ...complaint, excerpt: "" } }))).toContain("Request for Sea Freight Quotation - FOB Ningbo to Sohar (LCL)");
  });

  it("anchors an e-mail of ours to several agents in its own conversation only", () => {
    const other: Side = { ...agentSide, key: "wwl.example", name: "WWL" };
    const html = mailRow({ mail: proceed, side: other });
    expect(html).not.toContain('id="mail-a-proceed"');
    expect(html).toContain('data-mail="a-proceed"');
    expect(mailRow({ mail: proceed, side: agentSide })).toContain('id="mail-a-proceed"');
  });
});

describe("what the buttons of a conversation ask the page for", () => {
  it("replies on the conversation, or to one e-mail of it", () => {
    expect(replyAction("customer", false)).toEqual({ id: "reply", label: "Reply", variant: "secondary", sideKey: "customer", all: false });
    expect(replyAction("frontline.example", true, "a-so")).toEqual({ id: "reply", label: "Reply all", variant: "ghost", sideKey: "frontline.example", all: true, emailIds: ["a-so"] });
  });

  it("builds the customer's menu: copy, Gmail, who this is, and the contact for the Edit form", () => {
    const menu = sideMenu(customerSide, base.brief, row, pricing);
    expect(menu.map((entry) => entry.label)).toEqual(["Copy address", "Open in Gmail", "Treat as agent (this browser)", "Treat as shipper (this browser)", "Save Fahid K V as contact"]);
    expect(menu[0].button).toMatchObject({ id: "copy", copyText: FAHID, copiedToast: `${FAHID} copied.` });
    expect(menu[1].href).toBe("https://mail.google.com/mail/#all/t-customer");
    expect(menu[2].button).toEqual({ id: "treat_as", label: "Treat as agent", variant: "ghost", address: "omzest.example", party: "agent" });
    expect(menu[4].button).toMatchObject({ id: "edit_prefilled", formPrefill: { contact_name: "Fahid K V", contact_email: FAHID } });
    // Everything read from an e-mail goes to the Edit form or stays in this browser: no button saves by itself.
    expect(new Set(menu.flatMap((entry) => (entry.button ? [entry.button.id] : [])))).toEqual(new Set(["copy", "treat_as", "edit_prefilled"]));
  });

  it("builds an agent's menu, with the agent for the Edit form when the register does not have it", () => {
    const menu = sideMenu(agentSide, base.brief, row, pricing);
    expect(menu.map((entry) => entry.label)).toEqual(["Copy address", "Open in Gmail", "Treat as customer (this browser)", "Treat as shipper (this browser)", "Set as this enquiry's agent"]);
    expect(menu[2].button).toMatchObject({ id: "treat_as", address: "frontline.example", party: "customer" });
    expect(menu[4].button).toMatchObject({ id: "edit_prefilled", formPrefill: { agent_name: "FRONTLINE" } });

    // Without the people of the brief, the conversation's own register name is offered unless the register already has it.
    const alone = briefOf({ people: [] });
    expect(sideMenu(agentSide, alone, row, pricing).at(-1)?.button?.formPrefill).toMatchObject({ agent_name: "FRONTLINE" });
    expect(sideMenu(agentSide, alone, { ...row, agent_name: "Frontline" }, pricing).map((entry) => entry.label)).not.toContain("Set as this enquiry's agent");
    expect(sideMenu(agentSide, alone, { ...row, agent_name: "WWL" }, pricing).at(-1)?.button?.formPrefill).toMatchObject({ agent_name: "FRONTLINE", replace: ["agent_name"] });
  });

  it("keeps Gmail for the mailbox and the whole menu for those who may edit", () => {
    expect(sideMenu(customerSide, base.brief, row, sales).map((entry) => entry.label)).not.toContain("Open in Gmail");
    expect(sideMenu(customerSide, base.brief, row, sales).map((entry) => entry.label)).toContain("Copy address");
    expect(sideMenu(customerSide, base.brief, row, reader)).toEqual([]);
  });
});

describe("QuestionLine", () => {
  const line = (question: Question, canReply: boolean) => renderToStaticMarkup(<QuestionLine question={question} sideKey="customer" canReply={canReply} actions={actions} />);

  it("shows an open question with when it was asked, how long it has waited, and Answer for the mailbox", () => {
    const html = line(openQuestion, true);
    expect(text(html)).toContain("Open: “Kindly check with your team and provide an urgent update on the handover status.”");
    expect(text(html)).toContain("Mon 09 Nov, 09:25 · 4 working h (4 h)");
    expect(html).toMatch(/ring-control[^>]*>Answer<span class="sr-only">/);
    expect(html).not.toContain(FILLED);
    expect(line(openQuestion, false)).not.toContain(">Answer<");
  });

  it("ticks an answered one and offers nothing", () => {
    const html = line(answeredQuestion, true);
    expect(text(html)).toContain("Answered: “Please share the destination charges for our reference.”");
    expect(text(html)).toContain("answered Thu 08:46");
    expect(html).not.toContain(">Answer<");
  });
});

describe("sideChips", () => {
  it("colours a passed deadline and a broken promise red for the customer, amber for an agent", () => {
    const late: Side = {
      ...customerSide,
      deadline: { ...customerSide.deadline!, passed: true },
      promise: { ...customerSide.promise!, due: "2026-11-08" },
    };
    const chips = sideChips(late, TODAY);
    expect(chips.find((c) => c.key === "deadline")).toMatchObject({ text: "Reply by 12:00 today passed", tone: "bad", icon: "alert" });
    expect(chips.find((c) => c.key === "promise")).toMatchObject({ tone: "bad" });
    expect(chips.find((c) => c.key === "promise")?.text).toContain("— was due Sun 08 Nov");

    const agent = sideChips({ ...late, kind: "agent" }, TODAY);
    expect(agent.find((c) => c.key === "deadline")?.tone).toBe("warn");
    expect(agent.find((c) => c.key === "promise")?.tone).toBe("warn");
  });

  it("leaves out a deadline we answered and a promise that was kept", () => {
    const settled: Side = { ...customerSide, deadline: { ...customerSide.deadline!, cleared: true }, promise: { ...customerSide.promise!, kept: true } };
    expect(sideChips(settled, TODAY).map((c) => c.key)).toEqual(["chase", "files", "window"]);
  });
});

describe("subjectChanges", () => {
  it("marks the e-mail a new subject starts with, once, and not the conversation's first subject", () => {
    const changes = subjectChanges(agentSide.mails, "SL262784");
    // Oldest first: the rates thread opens the conversation; the agent's job subject starts with their e-mail of Sun 05:41.
    expect([...changes.keys()]).toEqual(["a-night"]);
    expect(changes.get("a-night")).toBe("ENQ1020126007139//ABSOH26110504//SL262784 // LCL FOB NINGBO CHINA TO SOHAR OMAN");
    // The customer's subject only gained our reference: not a change.
    expect(subjectChanges(customerSide.mails, "SL262784").size).toBe(0);
    expect(subjectChanges(customerSide.mails).size).toBe(1);
    expect(subjectChanges([])).toEqual(new Map());
  });
});

describe("ReplyBox", () => {
  const box = (prefill?: ReplyBoxPrefill) =>
    renderToStaticMarkup(
      <ReplyBox enquiryId={row.id} reference={row.reference} target={complaint.email} all={false} mailbox={MAILBOX} onClose={() => {}} onSent={() => {}} prefill={prefill} />,
    );

  it("starts from the e-mail when nothing is suggested: to the sender, the subject kept, an empty message", () => {
    const html = box();
    expect(html).toMatch(new RegExp(`<input id="reply-to"[^>]*value="${FAHID}"`));
    expect(html).toMatch(/<input id="reply-subject"[^>]*value="RE: SL262784 \/\/ Request for Sea Freight Quotation - FOB Ningbo to Sohar \(LCL\)"/);
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(html).not.toContain('id="reply-cc"');
    expect(html).not.toContain("Check before you send");
    expect(html).not.toContain("draft you kept");
  });

  it("starts from the suggestions it is given and shows the warnings above the fields", () => {
    const html = box({ to: ["raghavan_otm@omzest.example"], cc: [], subject: "Re: SL262784 status", message: "Dear Raghavan,", warnings: ["Fahid is away until Sunday", " "] });
    expect(html).toMatch(/<input id="reply-to"[^>]*value="raghavan_otm@omzest.example"/);
    expect(html).toMatch(/<input id="reply-subject"[^>]*value="Re: SL262784 status"/);
    expect(html).toMatch(/<textarea[^>]*>Dear Raghavan,<\/textarea>/);
    expect(html).toContain('aria-label="Check before you send"');
    expect(count(html, "<li")).toBe(1);
    expect(html.indexOf("Fahid is away until Sunday")).toBeLessThan(html.indexOf('id="reply-to"'));
    // An empty suggestion falls back to the e-mail's own sender and subject.
    const partial = box({ to: [], message: "Dear Fahid," });
    expect(partial).toMatch(new RegExp(`<input id="reply-to"[^>]*value="${FAHID}"`));
    expect(partial).toMatch(/<input id="reply-subject"[^>]*value="RE: SL262784/);
  });

  it("keeps a draft for each e-mail answered, so a reply to another e-mail does not take its place", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    try {
      const draft = (targetId: string, message: string) => JSON.stringify({ targetId, all: false, to: FAHID, cc: "", subject: "RE: SL262784", message, quote: true });
      store.set(replyDraftKey(row.id, complaint.email.id), draft(complaint.email.id, "Dear Fahid, the cargo is handed over today."));
      store.set(replyDraftKey(row.id, yes.email.id), draft(yes.email.id, "Dear Fahid, thank you for the nomination."));
      const to = (mail: ReadMail) =>
        renderToStaticMarkup(<ReplyBox enquiryId={row.id} reference={row.reference} target={mail.email} all={false} mailbox={MAILBOX} onClose={() => {}} onSent={() => {}} />);
      expect(to(complaint)).toMatch(/<textarea[^>]*>Dear Fahid, the cargo is handed over today.<\/textarea>/);
      expect(to(yes)).toMatch(/<textarea[^>]*>Dear Fahid, thank you for the nomination.<\/textarea>/);
      // An e-mail with no draft of its own starts empty.
      expect(to(weekend)).toMatch(/<textarea[^>]*><\/textarea>/);
      // The one draft kept before drafts were per e-mail still opens for the e-mail it was written to.
      store.clear();
      store.set(`reply-draft:${row.id}`, draft(complaint.email.id, "Dear Fahid, an older draft."));
      expect(to(complaint)).toMatch(/<textarea[^>]*>Dear Fahid, an older draft.<\/textarea>/);
      expect(to(yes)).toMatch(/<textarea[^>]*><\/textarea>/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
