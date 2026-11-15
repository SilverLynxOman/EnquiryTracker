// The shapes of everything the enquiry page reads from an enquiry's e-mails (see docs/DESIGN.md, Enquiry page).
// Types only: the rules live beside this file and are assembled by buildBrief in ../enquiryBrief.ts.

import type { EmailMessage, EmailReply, EnquiryRow, FollowUpRecord, HistoryRow, PriceChecker } from "../types";
import type { Stage } from "../enquiryDetails";

/* ───────────── 1. Input ───────────── */

/** ai_result.shipment as the classifier writes it (present on AI-classified mail only). */
export interface AiShipment {
  commodity?: string | null; packages?: string | null; weight?: string | null; volume?: string | null;
  dimensions?: string | null; incoterm?: string | null; cargo_ready?: string | null;
  special_requirements?: string | null; other_details?: string | null;
  pol?: string | null; pod?: string | null; qty_text?: string | null; shipment_mode?: string | null; trade_type?: string | null;
}
export type MailInput = EmailMessage & { ai_result?: { summary?: string | null; shipment?: AiShipment | null } | null };

/** What the signed-in person may do. canReply = canEdit && seesAll (they send as the pricing mailbox). */
export interface Viewer { canEdit: boolean; canReply: boolean; /** Their sales person id, when linked. */ me: string | null }

export type Party = "us" | "customer" | "agent" | "shipper" | "carrier" | "other";
export type OtherParty = Exclude<Party, "us">;

/** Choices kept in this browser for one enquiry (localStorage; may be empty). */
export interface BriefOverrides {
  /** Lower-case address or domain → party ("Treat as…"). Wins over every rule. */
  party: Record<string, OtherParty>;
  /** gmail_thread_ids the person kept here: never flagged as another enquiry's again. */
  keptThreads: string[];
  /** Ids of NeedItems, Flags and suggestions put away ("Done by phone", "Not won yet", "Keep the register's", Dismiss). */
  dismissed: string[];
}

export interface BriefInput {
  row: EnquiryRow;
  /** Every e-mail filed to the enquiry, any order. */
  emails: MailInput[];
  followUps: FollowUpRecord[];
  /** Replies sent from the app (email_replies), to mark "sent from the app by …". */
  replies?: EmailReply[];
  /** auth user id → name, for replies. */
  profileNames?: Map<string, string>;
  /** sales person id → display name, for follow-ups. */
  salesPersonNames?: Map<string, string>;
  /** The customer's enquiries this year (for the sibling hint). */
  customerHistory?: HistoryRow[];
  /** The same POL and POD this year (for the lane line). */
  laneHistory?: HistoryRow[];
  /** Agent names in the register, to map a domain to a name. */
  agentNames?: string[];
  checker?: PriceChecker;
  /** The watched mailbox's address (never a recipient). */
  mailbox?: string | null;
  /** ISO timestamp; the Oman clock is derived from it. */
  now: string;
  viewer: Viewer;
  overrides?: BriefOverrides;
}

/* ───────────── 2. Small shared shapes ───────────── */

export type Tone = "neutral" | "primary" | "good" | "warn" | "bad" | "flag" | "info";
export type IconKey = "clock" | "check" | "arrowRight" | "pause" | "message" | "alert" | "flag" | "ban" | "close" | "ship" | "send" | "phone" | "target" | "tag";

/** Where a value was read: always shown with the value. */
export interface Proof {
  emailId: string;
  /** "Reena Aneesh (Frontline)". */
  who: string;
  /** "Mon 09 Nov, 10:58" (Oman). */
  when: string;
  /** The sentence it was read from, ≤ 200 chars, cleaned. */
  sentence: string;
  /** The attachment that shows it, when a file does. */
  file?: string;
}
export interface Sourced<T> { value: T; proof: Proof }

/** A wait, in working hours and in real hours; both are always shown. */
export interface Age {
  /** Sun–Thu 08:00–18:00 Oman count 1, Saturday 08:00–18:00 counts 0.5, Friday 0. */
  workingHours: number;
  rawHours: number;
  /** "35 min" · "4 working h (22 h)" · "3 working days (92 h)". */
  label: string;
}

export type ActionId =
  | "mark_quoted" | "confirm_job" | "edit_prefilled" | "edit" | "reply" | "log_follow_up" | "undo_follow_up"
  | "mark_lost" | "not_genuine" | "reopen" | "copy" | "open_mail" | "move_mails" | "wrong_enquiry"
  | "keep_thread" | "dismiss" | "treat_as";

export interface ActionButton {
  id: ActionId;
  label: string;
  variant: "primary" | "secondary" | "ghost";
  /** mark_quoted, confirm_job: the day to record. */
  date?: string;
  /** confirm_job, edit_prefilled. */
  formPrefill?: FormPrefill;
  /** reply, when the brief already knows what to say (the Now card, a need item, the status text). */
  replyPrefill?: ReplyPrefill;
  /**
   * reply from a conversation's own Reply button: the side, reply-all, and the chosen e-mail in emailIds[0] when a
   * row was picked. The page builds the defaults (replyDefaults).
   */
  sideKey?: string; all?: boolean;
  /** copy: the text and the toast ("Status text copied."). */
  copyText?: string; copiedToast?: string;
  /** open_mail, move_mails, wrong_enquiry. */
  emailIds?: string[];
  /** move_mails: the reference to move to. keep_thread: thread ids. dismiss: the id put away. treat_as: address and party. */
  reference?: string; threadIds?: string[]; dismissId?: string; address?: string; party?: OtherParty;
}

/** Suggestions for the Edit form; the person saves. Amounts are USD as the register keeps them. */
export interface FormPrefill {
  quoted_date?: string; confirmed_date?: string;
  sell_total?: number; buy_total?: number;
  agent_name?: string;
  qty_text?: string; shipment_mode?: string; trade_type?: string; pol?: string; pod?: string;
  contact_name?: string; contact_email?: string; contact_phone?: string;
  /** Fields that may replace a value already in the register (rates updates, drift). */
  replace?: string[];
  /** Shown above the form: "Sell OMR 471 × 2.6 = USD 1,225, from Anwar K. S.'s e-mail of Thu 05 Nov 09:37". */
  notes: string[];
}

export interface ReplyPrefill {
  sideKey: string;
  /** The e-mail answered (the side's latest substantive one unless a row was chosen). */
  targetEmailId: string;
  all: boolean;
  to: string[]; cc: string[];
  subject: string;
  /** Starts "Dear {first name},"; may carry a quoted question, the status text or the cargo questions. */
  message: string;
  /** "purchase@… bounced on Sat 08 Nov — check the address". */
  warnings: string[];
}

/* ───────────── 3. E-mails as read ───────────── */

export type NoiseKind = "auto_reply" | "loop_in" | "duplicate" | "bounce";
export type CrossFiledWhy = "other_reference" | "contradicts_register" | "unknown_sender";
export interface CrossFiled { why: CrossFiledWhy; /** The other enquiry's reference, when the subject names one. */ looksLike: string | null; /** "40 HQ Qingdao → Sohar" from its house subject. */ about: string | null }

export interface PersonRef { name: string; email: string | null; staff: StaffMember | null }
export interface StaffMember { mailbox: string; name: string; role: "Operations" | "Pricing" | "Sales" | "Customer service" | "Customs clearance" | "Accounts" | "Management"; /** Register name of the sales person, when one. */ salesName?: string; handles: boolean }

export type CueKey =
  | "offer" | "final_offer" | "rate" | "rate_request" | "target" | "push" | "agreed_buy" | "accepts" | "yes" | "nominated"
  | "confirmed_to_agent" | "approves" | "asks" | "chase" | "agent_chasing" | "promise" | "ack" | "hold" | "complaint" | "urgent"
  | "declined" | "question" | "bounce" | "auto_reply" | "extra_charge" | "paperwork"
  | "booking" | "so" | "space_etd" | "sailed" | "bl_draft" | "bl_ok" | "telex" | "originals" | "pre_alert" | "eta" | "arrived"
  | "can_do" | "bayan" | "docs" | "delivery" | "payment" | "dn" | "cod" | "detention" | "awb" | "waybill";
export interface Cue { key: CueKey; /** "Offer OMR 339 · final", "Says yes", "SO". */ label: string; tone: Tone }

export interface PromiseMade { by: "us" | "them"; sentence: string; /** Oman day it falls due: the day named, else the next working day. */ due: string; kept: boolean; proof: Proof }
export interface Deadline { /** ISO timestamp in Oman time. */ at: string; /** "by 12:00 today". */ text: string; passed: boolean; /** We wrote to that side after it. */ cleared: boolean; proof: Proof }

export interface ReadMail {
  email: MailInput;
  id: string;
  at: string; day: string; time: string;
  from: PersonRef;
  /** The sender's party. */
  party: Party;
  /** Our mails: the party written to; "internal" when no outside address is on it. Null for theirs. */
  toParty: OtherParty | "internal" | null;
  /** The Side it belongs to. */
  sideKey: string;
  /** "in" feeds every rule; "cross_filed" and "noise" feed none. */
  scope: "in" | "cross_filed" | "noise";
  crossFiled: CrossFiled | null;
  noise: NoiseKind | null;
  /** Another open enquiry of the same customer this may be about. A warning only: the mail stays in scope, but can never be the yes. */
  siblingHint: string | null;
  kind: "substantive" | "ack";
  /** New text after cleaning, line breaks kept. */
  clean: string;
  /** ≤ 200 chars, greeting removed. */
  excerpt: string;
  isRequest: boolean; isChase: boolean; isPureChase: boolean; urgent: boolean; hold: boolean;
  promise: PromiseMade | null;
  deadline: Deadline | null;
  /** By priority; the row shows the first two. */
  cues: Cue[];
  money: MoneyToken[];
  moneyRole: MoneyRole | null;
  milestones: MilestoneHit[];
  /** Attachments without signature images. */
  files: DocFile[];
  /** Who sent it from the app, when it was. */
  sentFromApp: string | null;
  outOfHours: "overnight" | "weekend" | null;
}

/* ───────────── 4. The conversations ───────────── */

export type SideKind = "customer" | "agent" | "carrier" | "shipper" | "other" | "internal";
export type SideStateKind = "waiting_on_us" | "said_yes" | "on_hold" | "they_promised" | "rate_in_hand" | "pass_on" | "waiting_on_them" | "nothing_pending" | "no_word";

export interface SideState {
  kind: SideStateKind;
  since: string | null;
  age: Age | null;
  tone: Tone;
  /** "Waiting for us since Mon 14:12 · 4 working h (22 h)". */
  text: string;
  proof: Proof | null;
}
export interface Question { id: string; sentence: string; proof: Proof; age: Age; answered: boolean; /** "answered Thu 08:46". */ answeredText: string | null }
export interface ChaseRun { /** Their chases in the last 10 days. */ count: number; since: string; last: string; urgent: boolean; /** Their mails at the end with no substantive mail of ours after. */ unanswered: number; text: string }
export interface ReplyWindow { /** "Usually writes 05:00–09:00 Oman · weekend Sat–Sun". */ text: string }

export interface Side {
  /** "customer", "internal", or the counterpart's domain (the exact address for free mail). */
  key: string;
  kind: SideKind;
  /** Customer name, the register agent's name when matched, else the domain. */
  name: string;
  domain: string | null;
  /** Register agent name this domain maps to. */
  agentName: string | null;
  /** In-scope mails and acks, newest first. */
  mails: ReadMail[];
  threads: { id: string; subject: string; count: number; gmailUrl: string }[];
  lastFromThem: ReadMail | null;
  lastFromUs: ReadMail | null;
  /** Who a reply goes to. */
  currentWriter: PersonRef | null;
  state: SideState;
  questions: Question[];
  chase: ChaseRun | null;
  deadline: Deadline | null;
  /** The newest open promise on this side (ours or theirs). */
  promise: PromiseMade | null;
  replyWindow: ReplyWindow | null;
  holiday: Sourced<string> | null;
  /** Agent sides: their rates and state. */
  agent: AgentQuote | null;
  /** Our "Please hold this shipment" to this agent. */
  pausedByUs: Proof | null;
  fileCount: number;
  hiddenCount: number;
}

export interface HiddenCounts { autoReplies: number; loopIns: number; duplicates: number; /** "3 auto-replies, 1 'adding a colleague' note and 1 duplicate hidden". */ text: string; mails: ReadMail[] }
export interface CrossFiledGroup { looksLike: string | null; about: string | null; why: CrossFiledWhy; threadIds: string[]; mails: ReadMail[]; /** "8 e-mails look like SL262790 (40 HQ Qingdao → Sohar)". */ text: string }

/* ───────────── 5. Money ───────────── */

export type Currency = "OMR" | "USD" | "EUR" | "INR" | "AED" | "GBP" | "CNY" | "SEK" | "ZAR" | "SAR" | "QAR";
export type MoneyRole = "offer" | "agent_rate" | "target" | "push_to_agent" | "agreed_buy" | "customer_echo" | "customer_counter" | "extra" | "paperwork";

export interface MoneyToken {
  currency: Currency; amount: number; raw: string;
  /** "/40 OT HC", "/kg", "/cbm", "/cntr"; null for the shipment. */
  unit: string | null;
  /** "x 7 PALLET" → 7. */
  multiplier: number | null;
  /** The line label before it ("PORT TO PORT", "LCL + DO"). */
  label: string | null;
  /** At actuals, approx., if applicable, subject to. Listed, never summed. */
  soft: boolean;
  allIn: boolean;
  sentence: string;
  index: number;
}
export interface PriceLine { label: string; amount: number | null; currency: Currency; unit: string | null; soft: boolean; /** "at actuals", "approx." */ softText: string | null; main: boolean; proof: Proof }

/** What a total waits for when a line is priced per unit: the weight, the volume, the number of containers or of packages. */
export type MissingBasis = "kg" | "cbm" | "containers" | "packages";

export interface Offer {
  lines: PriceLine[];
  /**
   * Main line plus firm add-ons, in the offer's currency: for the whole shipment only when `whole` is true. Otherwise
   * a stand-in that is never a total (one box and the charges beside it, else the main line's rate per unit).
   */
  total: number; currency: Currency;
  /**
   * True only when every firm line was multiplied out for the shipment (per box, kilo, cbm or package).
   */
  whole: boolean;
  /** What the total waits for when it is not whole, in the order the lines need it; empty when whole. */
  missing: MissingBasis[];
  /** The number of containers the total was worked out for when a line is priced per container: as the offer states it, else the register's. */
  count: number | null;
  /** "≈ USD 1,225 at 2.6" (OMR) or "≈ OMR 2,692" (USD). */
  twin: string;
  /** "339 port to port + 132 LCL & DO". */
  linesText: string;
  /** "port to port", "door to door", mode word when stated. */
  scope: string;
  final: boolean; revised: boolean;
  basis: Basis | null;
  transit: string | null; freeDays: number | null; etd: string | null; routing: string | null;
  validUntil: string | null; validityStated: boolean;
  sentAt: string; sentBy: PersonRef; sentTo: string[];
  proof: Proof;
  /** Earlier main-line amounts of the same option, oldest first, each in the currency and per the unit it was written in. */
  earlier: { amount: number; currency: Currency; unit: string | null; proof: Proof }[];
  /**
   * Other options offered (sea / air, port to port / door to door); includes this one. `whole` and `total` as on the
   * offer; `rate` is the option's main line, what is shown when its total is not for the whole shipment.
   */
  options: { label: string; total: number; currency: Currency; proof: Proof; current: boolean; whole: boolean; rate: { amount: number; unit: string | null } }[];
  /** The customer repeated our price when accepting. */
  acceptedBy: Proof | null;
  /** Read from the quoted history of a customer's reply (our own offer mail is not filed). */
  fromQuotedHistory: boolean;
}
/** The one figure that stands for an offer (offerFigureOf), and what its total waits for when that is not whole. */
export interface OfferFigure {
  amount: number;
  currency: Currency;
  /** The main line's unit ("/kg", "/40") when the figure is its rate; null for a total for the whole shipment. */
  unit: string | null;
  whole: boolean;
  /** "the weight": what the total waits for; null when the figure is the total for the whole shipment. */
  dependsOn: string | null;
  /** "OMR 1,700", or "OMR 2.1/kg" when the total is not for the whole shipment. */
  text: string;
}
export interface Basis { cbm: number | null; chargeableKg: number | null; grossKg: number | null; packages: number | null; text: string }

export type AgentState = "written_to" | "acknowledged" | "question" | "rated" | "declined" | "agreed" | "paused";
export interface AgentOption { carrier: string | null; main: PriceLine; extras: PriceLine[]; total: number | null; transit: string | null; freeDays: number | null; allIn: boolean; declined: boolean; /** "no space". */ declinedText: string | null; proof: Proof }
export interface ValidityFact { who: string; until: string | null; daysLeft: number | null; ended: boolean; /** "no validity can be provided". */ none: boolean; /** From their standard wording, dated from the mail. */ boilerplate: boolean; text: string; proof: Proof | null }
export interface AgentQuote {
  sideKey: string; name: string; domain: string;
  state: AgentState;
  /** When our request to them is on file. */
  askedAt: string | null; requestOnFile: boolean;
  options: AgentOption[];
  /** Their latest option used for comparison. */
  latest: AgentOption | null;
  /** Lowest comparable main line on file across agents. */
  lowestOnFile: boolean;
  /** Earlier main amounts, oldest first: 309, 303. */
  earlier: number[];
  validity: ValidityFact | null;
  /** Hours from our request to their first rate; only when the request is on file. */
  repliedInHours: number | null;
  question: Question | null;
  /** "OMR 309 → 303 → 298 + 117 · agreed · TT 25–35 days · no validity given". */
  summary: string;
  lastAt: string;
}
export interface AgentsSummary { writtenTo: number | null; replied: number; rates: number; declined: number; requestOnFile: boolean; /** Sides we wrote to with no reply on file. */ noReplyOnFile: string[]; lowest: AgentQuote | null; text: string }

export interface Buy {
  agreed: boolean;
  agentName: string; sideKey: string;
  /** Main plus firm add-ons, multiplied out; null when a per-kg or per-cbm rate has no basis. */
  total: number | null; currency: Currency; twin: string | null;
  /** "298 ocean freight + 117 LCL & DO" / "USD 5.4/kg × ? kg". */
  linesText: string;
  /** The buy has no trucking or destination line while the offer is door to door. */
  freightOnly: boolean;
  proof: Proof;
}
export interface Target { who: "customer" | "us_to_agent"; amount: number | null; currency: Currency | null; /** "we don't have a target". */ none: boolean; agentName: string | null; text: string; proof: Proof }

export interface Margin {
  /** Null unless there is an offer, an agreed buy (or both register totals), matching scopes, a known basis and no currency clash. */
  figure: { amount: number; currency: "OMR" | "USD"; pct: number; negative: boolean; /** "about OMR 56". */ text: string } | null;
  /** "buy OMR 415, Frontline, agreed Thu 05 Nov 16:04". */
  inputs: string | null;
  /** When figure is null: "Needs an offer and an agreed buy" / "about OMR 142 if bought at USD 6,150 (Consolclub, not agreed)" / "USD 5.4/kg × ? kg — the weight is not known". */
  why: string | null;
  /** "converted at 2.6", "EUR converted at about 1.08 — check", "after commission OMR 16". */
  notes: string[];
  clash: CurrencyClash | null;
  source: "mail" | "register";
}
export interface CurrencyClash { amount: number; currencies: [Currency, Currency]; text: string; proofs: [Proof, Proof] }

export interface TrailPoint { at: string; party: "customer" | "agent" | "us"; role: MoneyRole | "yes"; /** "Frontline 298", "Offer 339 · final", "→ Frontline 285", "Yes 471". */ label: string; amount: number | null; currency: Currency | null; unit: string | null; marked: boolean; proof: Proof }

export interface RegisterMoney {
  hasRates: boolean;
  /** "Not entered. The e-mails say sell OMR 471 (≈ USD 1,225), buy OMR 415 (≈ USD 1,079)." */
  missingText: string | null;
  /** Register and mail differ by more than 5%. */
  differs: { text: string; prefill: FormPrefill; dismissId: string } | null;
  /** Register profit above 60% of the sell or below 0. */
  slip: { text: string; prefill: FormPrefill | null } | null;
  /** For "Use these…": both sides from the mail. */
  prefill: FormPrefill | null;
}
export interface LaneBenchmark { pricedWins: number; usualProfitUsd: number; topAgent: { name: string; wins: number } | null; text: string }

/* ───────────── 6. Progress and shipment ───────────── */

export interface BriefStage extends Stage {
  /** Read from an e-mail; the register does not show it yet (dashed marker). */
  byMail: boolean;
  proof: Proof | null;
  /** "E-mail says Thu 05 Nov 13:45" when the register's date differs. */
  registerNote: string | null;
}

export type ModeSet = "sea_import" | "sea_export" | "air" | "courier";
export type MilestoneKey = "booked" | "so" | "gate_in" | "collected" | "awb" | "waybill" | "picked_up" | "in_transit" | "sailed" | "departed" | "bl" | "arrived" | "can_do" | "bayan" | "delivered";
export type SubStepKey =
  | "agent_details_sent" | "shipper_details_sent" | "booking_note" | "so_requested" | "space_etd" | "carrier_change" | "cargo_not_ready" | "stuffed"
  | "bl_draft" | "bl_ok_ours" | "bl_approved" | "bl_final" | "telex" | "seaway" | "originals" | "pre_alert"
  | "can" | "do" | "manifest" | "freight_certificate" | "docs_to_clearance" | "authorization" | "hs_brand" | "duty"
  | "delivery_requested" | "dn" | "invoice" | "payment" | "cod" | "detention";
export interface MilestoneHit { key: MilestoneKey | null; sub: SubStepKey | null; /** An external mail or a file states it happened. Our own text never does. */ proves: boolean; sentence: string; file: string | null }
export interface SubStep { key: SubStepKey; /** "SO requested Thu 10:10 · chased 6×". */ label: string; tone: Tone; proof: Proof }
export interface Milestone {
  key: MilestoneKey; label: string;
  /** unmarked: a later step is proven and no e-mail marks this one. void: after a cancel sentence. */
  state: "proven" | "current" | "unmarked" | "todo" | "void";
  date: string | null;
  note: string; noteTone: Tone | null;
  proof: Proof | null;
  subSteps: SubStep[];
  /** Ids of the mails that mention it (for the conversation filter). */
  emailIds: string[];
}
export interface Journey {
  set: ModeSet;
  nodes: Milestone[];
  /** Furthest proven step. */
  reached: MilestoneKey | null;
  /** The step the latest in-scope mail is about. */
  nowDiscussing: MilestoneKey | null;
  /** "SO released Mon 09 Nov · now: BL draft". */
  chip: string | null;
  /** A cancel or re-booking sentence on a confirmed job. */
  cancelled: Proof | null;
}

export interface DatedValue { /** ISO date, or null when the text could not be read. */ date: string | null; text: string; port: string | null; proof: Proof; /** Earlier distinct values, newest first. */ earlier: { date: string | null; text: string; proof: Proof }[]; /** Days moved against the previous value. */ slipDays: number | null; /** In our own quote: a plan, not a slip. */ plan: boolean }
export interface DateFacts {
  etd: DatedValue | null; eta: DatedValue | null; atd: DatedValue | null;
  cutoff: Sourced<string> | null;
  transit: { ours: Sourced<string> | null; agent: Sourced<string> | null };
  freeDays: { asked: number | null; given: Sourced<number> | null };
  validity: ValidityFact[];
  promises: PromiseMade[];
  /** "ETD in 2 days" / "ETD 06 Nov passed — no sailing confirmed". */
  headline: { text: string; tone: Tone } | null;
}
export type RefKind = "reference" | "po" | "agent_job" | "so" | "booking" | "mbl" | "hbl" | "container" | "vessel" | "carrier" | "awb" | "waybill" | "customs_code";
export interface RefChip { kind: RefKind; /** "SO". */ label: string; value: string; /** "Copy SO number KMTCTAO8748592". */ copyLabel: string; proof: Proof | null }

/* ───────────── 7. Cargo, drift, people, documents ───────────── */

export type CargoKey = "commodity" | "packages" | "gross_weight" | "chargeable_weight" | "volume" | "dimensions" | "equipment" | "incoterm" | "pickup_address" | "cargo_ready" | "stackable_dg" | "hs_code" | "temperature";
export interface CargoField { key: CargoKey; label: string; value: string | null; /** "our request, Wed 18:05" · "requirements" · "read by AI". */ source: string | null; proof: Proof | null; required: boolean }
export interface CargoCheck { fields: CargoField[]; gaps: CargoKey[]; warning: string | null; requestBlock: string; askText: string }

export type DriftKind = "status" | "quoted_date" | "confirmed_date" | "sell" | "buy" | "quantity" | "incoterm" | "route" | "mode" | "direction" | "agent" | "date_order" | "contact";
export interface Drift { id: string; kind: DriftKind; /** "E-mails say 1×40 OT HC; the register says 1×20 OT". */ text: string; register: string; mail: string; proof: Proof | null; prefill: FormPrefill | null; buttonLabel: string }

export interface Phone {
  label: "mobile" | "office" | "fax" | "phone"; display: string; /** Digits with country code, for tel: and wa.me. */ digits: string; whatsapp: boolean;
  /** WhatsApp is guessed from an Omani mobile, not stated by the writer: shown "WhatsApp?". */
  whatsappGuessed?: boolean;
}
export interface Contact { name: string | null; designation: string | null; company: string | null; phones: Phone[]; wechat: string | null }
export interface Person extends Contact {
  email: string;
  party: Party;
  wrote: number;
  lastWrote: string | null; lastWeReplied: string | null;
  /** A role mailbox (purchase@, sales3@). */
  sharedDesk: boolean;
  /** "added by Manu Thu 16:06", "out of office", "bounced". */
  chips: string[];
  /** "Ningbo 15:32". */
  localTime: string | null;
  /** Customer person not yet the enquiry's contact. */
  canSave: boolean;
  /** For "Save as contact". */
  prefill: FormPrefill | null;
}
export interface PeopleBlock { kind: SideKind | "us"; title: string; sideKey: string | null; /** "agreed", "paused by us Mon 18:29", "declined". */ note: string | null; persons: Person[]; copied: { name: string; email: string }[]; /** Agent block: "Set as this enquiry's agent". */ agentPrefill: FormPrefill | null }
export interface Handler {
  mailbox: string; name: string; role: string; since: string;
  previous: { name: string; role: string; from: string; to: string }[];
  salesPerson: { name: string; mailbox: string | null; onThread: boolean } | null;
  /** The name the customer's greetings use, when two or more agree and it is not the handler. */
  customerGreets: string | null;
}

export type DocKind = "booking_so" | "bl_awb" | "pre_alert_can" | "customs_do" | "invoice_payment" | "packing" | "quote" | "photo" | "other";
export type DocSubKind = "draft" | "final" | "telex_seaway" | "original" | "debit_note" | "invoice" | "payment" | "so" | "booking" | "bayan" | "do" | "can" | "coo" | null;
export interface DocFile { filename: string; mime: string; size: number; storagePath: string | null; emailId: string; at: string; from: string; sideKey: string; crossFiled: boolean }
export interface DocGroup { kind: DocKind; subKind: DocSubKind; /** "BL draft". */ label: string; latest: DocFile; /** Distinct sizes of the same normalised name. */ version: number; sentTimes: number; files: DocFile[] }

/* ───────────── 8. What the page says ───────────── */

export type MoveKind =
  | "us_customer" | "us_agent" | "said_yes" | "looks_won" | "quoted_unmarked" | "pass_on" | "rate_in_hand" | "on_hold"
  | "waiting_on_them" | "they_promised" | "agents_owe" | "quiet" | "nothing_pending" | "no_mail" | "closed";
export interface Move {
  kind: MoveKind; icon: IconKey; tone: Tone;
  /** "Customer is waiting for us". */
  word: string;
  /** One or two lines: who, what they want (quoted), a deadline. */
  why: string[];
  /** "since Mon 14:12 · 4 working h (22 h)"; null when there is no clock. */
  clock: string | null;
  sideKey: string | null;
  proof: Proof | null;
}

export type NowKind =
  | "closed" | "customer_waiting" | "won_unmarked" | "said_yes" | "looks_won" | "quoted_unmarked" | "agent_question" | "pass_on"
  | "rate_in_hand" | "on_hold" | "validity_ended" | "waiting_rates" | "to_quote" | "waiting_customer"
  | "confirmed_no_sell" | "confirmed_rates" | "confirmed_waiting_agent" | "confirmed";
export interface NowAction {
  kind: NowKind; tone: Tone; title: string;
  said: { text: string; who: string; when: string; emailId: string } | null;
  lines: { text: string; tone: Tone | null }[];
  /** At most one primary. Empty for viewers. */
  buttons: ActionButton[];
  checkLine: string | null;
}

export type NeedVerb = "answer" | "chase" | "pass_on" | "update" | "save_contact" | "set_agent" | "move" | "reconfirm" | "tell_customer" | "promise_due";
export interface NeedItem {
  id: string; verb: NeedVerb;
  /** "Answer Consolclub: 'share us the pickup address and zip code'". */
  text: string;
  age: Age | null; tone: Tone;
  proof: Proof | null;
  button: ActionButton | null;
  /** Answered, kept or passed on within the last calendar day: shown struck. */
  done: boolean;
}

export type FlagKind = "hold" | "cancelled" | "urgent" | "complaint" | "bounced" | "out_of_office" | "currency_clash" | "deadline" | "wrong_enquiry" | "holiday";
export interface Flag { id: string; kind: FlagKind; tone: Tone; icon: IconKey; label: string; sentence: string; who: string; when: string; proof: Proof | null; cleared: boolean; clearedText: string | null; buttons: ActionButton[] }

export interface TruthTag { kind: "won" | "quoted" | "hold"; /** "E-mails say: won Thu 05 Nov". */ text: string; proof: Proof }
export interface StatusText { text: string; facts: Sourced<string>[]; builtFrom: number; warning: string | null }
export interface CopyTexts { status: string | null; offer: string | null; chase: Record<string, string>; requestBlock: string; houseSubject: string }
export interface MailFollowUp { day: string; by: string; proof: Proof; withChaseWords: boolean }
export interface HistoryEvent { at: string; kind: "chased_by_email" | "customer_chased" | "hand_over" | "sent_from_app"; text: string; proof: Proof | null }

export interface EnquiryBrief {
  /** Every filed mail, newest first, with scope, party, cues. */
  mails: ReadMail[];
  /** Customer first, then agent, carrier, shipper and other sides by newest mail, internal last. */
  sides: Side[];
  hidden: HiddenCounts;
  crossFiled: CrossFiledGroup[];
  move: Move;
  now: NowAction;
  needsYou: NeedItem[];
  flags: Flag[];
  truth: TruthTag | null;
  offer: Offer | null;
  agentRates: AgentQuote[];
  agentsSummary: AgentsSummary;
  buy: Buy | null;
  targets: Target[];
  margin: Margin;
  trail: TrailPoint[];
  trailSentence: string | null;
  registerMoney: RegisterMoney;
  laneBenchmark: LaneBenchmark | null;
  stages: BriefStage[];
  /** Null unless the job is confirmed or the mail shows a yes. */
  journey: Journey | null;
  dates: DateFacts;
  refs: RefChip[];
  cargo: CargoCheck;
  drift: Drift[];
  people: PeopleBlock[];
  handler: Handler | null;
  documents: DocGroup[];
  statusText: StatusText | null;
  copy: CopyTexts;
  mailFollowUps: MailFollowUp[];
  history: HistoryEvent[];
}

/* ───────────── 9. Shapes used by the helpers ───────────── */

export interface PartyContext { row: Pick<EnquiryRow, "customer_name" | "contact_email" | "agent_name" | "reference">; overrides?: BriefOverrides; agentNames?: string[]; /** Addresses that received our offer; addresses that received our rate request; addresses in a shipper block. Filled by buildBrief's first pass. */ offerRecipients?: Set<string>; requestRecipients?: Set<string>; shipperAddresses?: Set<string> }

export interface WonCue { kind: "customer_yes" | "confirmed_to_agent" | "thanks_for_confirmation" | "agent_details_sent"; day: string; betterRate: boolean; /** The customer repeated an amount that is not this offer's. */ amountMismatch: boolean; proof: Proof }
