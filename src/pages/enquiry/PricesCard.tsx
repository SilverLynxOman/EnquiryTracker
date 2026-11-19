import { useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/icons";
import { Button } from "../../components/ui";
import { describeCommission } from "../../lib/commission";
import { displayName } from "../../lib/display";
import { muscatDate } from "../../lib/emailDrafts";
import {
  offerDependsOn,
  USD_PER,
  USD_PER_OMR,
  type ActionButton,
  type AgentOption,
  type AgentQuote,
  type AgentState,
  type Buy,
  type Currency,
  type FormPrefill,
  type Margin,
  type Offer,
  type PriceLine,
  type Proof,
  type RegisterMoney,
  type Target,
  type TrailPoint,
  type ValidityFact,
  type Viewer,
} from "../../lib/enquiryBrief";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import { fmtMoney, fmtPercent, todayIso } from "../../lib/format";
import type { EnquiryRow } from "../../lib/types";
import { ActionBtn, ProofLink, proofTitle, TONE_BOX, TONE_TEXT, type PageActions } from "./shared";

// The prices of an enquiry: what we offered the customer, what agents charge, how the figures moved, what is left,
// and what the register holds. The first four are read from the e-mails; only the Edit form writes the register.

/** Points of the trail shown before "Show all n". */
const TRAIL_SHOWN = 10;

const BADGE = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-meta font-medium";
const CHIP = "inline-flex max-w-full items-start gap-1 rounded-panel px-2 py-0.5 text-meta tabular-nums";
const QUIET = "bg-table-head text-ink-heading";

/** Who named a figure, as the colour of its chip: the customer, an agent, or us (outlined). Never a state. */
const SPEAKER: Record<TrailPoint["party"], { chip: string; says: string }> = {
  customer: { chip: "bg-party-customer-bg text-party-customer", says: "Customer" },
  agent: { chip: "bg-party-agent-bg text-party-agent", says: "Agent" },
  us: { chip: "bg-surface text-ink-heading ring-1 ring-inset ring-control", says: "Ours" },
};

const AGENT_STATE: Record<AgentState, { label: string; icon: IconName; badge: string }> = {
  written_to: { label: "Written to", icon: "send", badge: QUIET },
  acknowledged: { label: "Acknowledged", icon: "clock", badge: QUIET },
  question: { label: "Asked a question", icon: "message", badge: QUIET },
  rated: { label: "Rated", icon: "tag", badge: QUIET },
  declined: { label: "Declined", icon: "ban", badge: "bg-cancelled-bg text-cancelled" },
  agreed: { label: "Agreed", icon: "check", badge: "bg-confirmed-bg text-confirmed" },
  paused: { label: "Paused by us", icon: "pause", badge: "bg-cancelled-bg text-cancelled" },
};

/** Currencies the register's rate is exact for: the rial and the dollar pegs. The rest are converted at about today's rate. */
const EXACT: ReadonlySet<Currency> = new Set<Currency>(["USD", "OMR", "AED", "SAR", "QAR"]);

/** A rate per container ("/40 HC", "/20", "/cntr"): the shipment's total is that rate times the register's units. */
const PER_CONTAINER = /^\/?\s*(?:\d{2}(?!\d)|cntr|container|ctr|cont\b|teu|unit|box)/i;

/**
 * Words of a price line typed in capitals: joining words go in lower case, short real words keep one capital, and
 * the other short ones are abbreviations (LCL, DO, CFS, FOB).
 */
const JOINING_WORDS = new Set(["TO", "AND", "OF", "PER", "AT", "BY", "IN", "ON", "FOR", "THE", "VIA", "OR", "EX", "AS", "IF"]);
const SHORT_WORDS = new Set(["AIR", "SEA", "FEE", "TAX", "DAY", "NET", "ALL", "DUE"]);
const ABBREVIATIONS = new Set(["DTHC", "OTHC", "ISPS"]);

/** 1225.5 → "1,225.5": up to three decimals, for rials. */
const figures = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** A converted amount: whole from 100 up, two decimals below (a rate per kg). */
const rounded = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });

/** "OMR 2,596/40 HC": a unit that starts with a stroke stays against the amount. */
function money(amount: number, currency: Currency, unit: string | null = null): string {
  const tail = !unit ? "" : unit.startsWith("/") ? unit : ` ${unit}`;
  return `${currency} ${figures(amount)}${tail}`;
}

/** "/40 HC" → "per 40 HC", for a column of its own. */
const unitWords = (unit: string | null) => (!unit ? "" : unit.startsWith("/") ? `per ${unit.slice(1).trim()}` : unit);

/** "2026-11-30" → "Mon 30 Nov"; anything else is shown as written. */
const dayOf = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? dayWithWeekday(value, todayIso()) : value);

/** -3.2 → "−3%", with the minus sign the figures use. */
function percent(n: number): string {
  const whole = Math.round(n);
  return `${whole < 0 ? `−${-whole}` : whole}%`;
}

/**
 * A line label typed in capitals, as names typed in capitals are shown: "PORT TO PORT" → "Port to Port",
 * "DOOR TO SOHAR PORT" → "Door to Sohar Port", "CFS CHARGES" → "CFS Charges"; "LCL + DO" stays. A label that
 * already uses lower case is left as written.
 */
function lineLabel(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || /[a-z]/.test(text)) return text;
  const out = text
    .split(" ")
    .map((word) => {
      if (JOINING_WORDS.has(word)) return word.toLowerCase();
      const letters = word.replace(/[^A-Z]/g, "");
      const isWord = SHORT_WORDS.has(word) || (letters.length > 3 && !ABBREVIATIONS.has(letters));
      return isWord ? word.toLowerCase().replace(/(^|[-/(&])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase()) : word;
    })
    .join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The same amount in the office's other currency: US dollars for rials and the rest, rials for US dollars. */
function twinOf(amount: number, currency: Currency): string {
  return currency === "USD" ? `≈ OMR ${rounded(amount / USD_PER_OMR)}` : `≈ USD ${rounded(amount * USD_PER[currency])}`;
}

/** An amount as the register keeps it, in US dollars, and the sum that got it there (empty for US dollars). */
function forRegister(amount: number, currency: Currency): { usd: number; sum: string } {
  if (currency === "USD") return { usd: amount, sum: "" };
  const usd = Math.round(amount * USD_PER[currency]);
  const about = EXACT.has(currency) ? "" : "about ";
  return { usd, sum: ` × ${about}${USD_PER[currency]} = ${about}USD ${figures(usd)}` };
}

/** Where a figure was read, for the notes above the Edit form. */
const source = (proof: Proof) => `e-mail from ${proof.who}, ${proof.when}`;

/**
 * What an offer's total waits for when it is not for the whole shipment: "the weight", "the volume and the number of
 * packages". The brief's own words, so the page and the brief's sentences say it the same way.
 */
export const dependsOn = offerDependsOn;

/** An option's figure: its total when that is for the whole shipment, else its main line's rate ("OMR 2.1/kg"). */
export function optionFigure(option: Offer["options"][number]): string {
  return option.whole ? money(option.total, option.currency) : money(option.rate.amount, option.currency, option.rate.unit);
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** An agent's name as the register knows it; a side that is only known by its mail domain or address has none. */
function registerName(name: string, domain: string): string | null {
  const text = name.trim();
  return !text || sameName(text, domain) || /^[^\s@]+\.[a-z]{2,}$/i.test(text) || text.includes("@") ? null : text;
}

/**
 * "Use as sell": the offer's total of firm lines as the register's sell, in US dollars, and the day of the offer as
 * the quoted date when the register has none. Suggestions for the Edit form: the person saves. Null when the total is
 * not for the whole shipment (a rate per kilo with no weight, one box of an unknown count): never a sell to enter.
 */
export function sellPrefill(offer: Offer, row: Pick<EnquiryRow, "sell_total" | "quoted_date" | "units">): FormPrefill | null {
  if (!offer.whole) return null;
  const { usd, sum } = forRegister(offer.total, offer.currency);
  const notes = [`Sell ${money(offer.total, offer.currency)}${sum} (${offer.fromQuotedHistory ? "our offer as quoted in the " : ""}${source(offer.proof)})`];
  const prefill: FormPrefill = { sell_total: usd, notes };
  if (row.sell_total != null) prefill.replace = ["sell_total"];
  const unit = offer.lines.find((line) => line.main)?.unit;
  const count = offer.count ?? null;
  if (unit && count != null) {
    // The total is multiplied out already: say for how many boxes, and whether the register counts the same.
    const differs = row.units != null && row.units > 0 && row.units !== count;
    notes.push(`The offer is ${unitWords(unit)}: the total is for ${count} ${count === 1 ? "container" : "containers"}${differs ? `; the register counts ${row.units} units: check which is right` : ""}`);
  }
  if (!row.quoted_date && !offer.fromQuotedHistory && !Number.isNaN(Date.parse(offer.sentAt))) {
    prefill.quoted_date = muscatDate(offer.sentAt);
    notes.push(`Quoted date ${dayOf(prefill.quoted_date)}, the day of that e-mail`);
  }
  return prefill;
}

/**
 * An agent's rate for the whole shipment. The option's total is that already (multiplied out by the brief for the
 * boxes, kilos or cbm), so it is never multiplied again. Without one, a rate written for the shipment as it is, and a
 * rate per container times the register's units (one when it has none). Null when it hangs on a weight or a volume.
 */
function shipmentTotal(option: AgentOption, units: number | null): { amount: number; each: number | null; times: number; counted: boolean } | null {
  if (option.total != null) return { amount: option.total, each: null, times: 1, counted: false };
  const each = option.main.amount;
  if (each == null) return null;
  const unit = option.main.unit;
  if (!unit) return { amount: each, each: null, times: 1, counted: false };
  if (!PER_CONTAINER.test(unit)) return null;
  const times = units != null && units > 0 ? units : 1;
  return { amount: each * times, each, times, counted: times === units };
}

/**
 * "USD 1,000/40 HC × 3": how a total for the shipment came from a rate per unit. The unit stays with the rate, never
 * with the total. Empty when the rate is for the shipment.
 */
function rateBehind(option: AgentOption, whole: { amount: number; each: number | null; times: number }): string {
  const { main } = option;
  if (!main.unit || main.amount == null) return "";
  if (whole.each != null) return `${money(whole.each, main.currency, main.unit)}${whole.times > 1 ? ` × ${whole.times}` : ""}`;
  const rate = money(main.amount, main.currency, main.unit);
  if (option.extras.some((line) => !line.soft && line.amount != null)) return `${rate} and the firm small items`;
  // With nothing beside it the count is the total over the rate: 3 boxes, 280 kg.
  const times = main.amount > 0 ? Math.round((whole.amount / main.amount) * 1000) / 1000 : 0;
  return `${rate}${times > 1 ? ` × ${figures(times)}` : ""}`;
}

/**
 * "Use as buy": the agent's figure as the register's buy, in US dollars, with the agent's name when the register
 * knows it. The agreed buy when this is the agreed agent, else their latest rate. Null when no total can be worked
 * out (a declined rate, a rate per kg).
 */
export function buyPrefill(quote: AgentQuote, buy: Buy | null, row: Pick<EnquiryRow, "buy_total" | "agent_name" | "units">): FormPrefill | null {
  const agreed = buy && buy.sideKey === quote.sideKey && buy.total != null ? buy : null;
  const notes: string[] = [];
  let buyTotal: number;
  if (agreed && agreed.total != null) {
    const { usd, sum } = forRegister(agreed.total, agreed.currency);
    buyTotal = usd;
    notes.push(`Buy ${money(agreed.total, agreed.currency)}${sum}, ${agreed.agreed ? "agreed with" : "from"} ${displayName(agreed.agentName)} (${source(agreed.proof)})`);
  } else {
    const latest = quote.latest && !quote.latest.declined ? quote.latest : null;
    const whole = latest && shipmentTotal(latest, row.units);
    if (!latest || !whole) return null;
    const { main } = latest;
    const { usd, sum } = forRegister(whole.amount, main.currency);
    buyTotal = usd;
    const behind = rateBehind(latest, whole);
    notes.push(`Buy ${money(whole.amount, main.currency)}${behind ? ` (${behind})` : ""}${sum}, ${displayName(quote.name)}'s rate${quote.state === "agreed" ? "" : ", not agreed by e-mail"} (${source(latest.proof)})`);
    if (whole.each != null && !whole.counted) notes.push("The register has no unit count: taken as one unit");
  }
  const prefill: FormPrefill = { buy_total: buyTotal, notes };
  const replace: string[] = row.buy_total != null ? ["buy_total"] : [];
  const name = registerName(agreed?.agentName ?? quote.name, quote.domain);
  if (name && !sameName(name, row.agent_name)) {
    prefill.agent_name = name;
    if (row.agent_name) replace.push("agent_name");
    notes.push(`Agent ${displayName(name)}, from the e-mails with ${quote.domain}`);
  }
  if (replace.length) prefill.replace = replace;
  return prefill;
}

/**
 * The offer as text to paste: its lines, the total when there are several, then the terms it states. Our own figures
 * only. A total that is not for the whole shipment is never written: the text says what it depends on.
 */
export function offerText(offer: Offer): string {
  const firm = offer.lines.filter((line) => !line.soft && line.amount != null);
  const soft = offer.lines.filter((line) => line.soft || line.amount == null);
  const out: string[] = [];
  for (const line of firm) if (line.amount != null) out.push(`${line.label}: ${money(line.amount, line.currency, line.unit)}`);
  for (const line of soft) {
    const word = line.softText?.trim() || (line.amount == null ? "at actuals" : "approx.");
    out.push(`${line.label}: ${line.amount == null ? word : `${word} ${money(line.amount, line.currency, line.unit)}`}`);
  }
  if (!offer.whole) out.push(`Total: depends on ${dependsOn(offer)}`);
  else if (firm.length !== 1 || firm[0].amount !== offer.total) out.push(`Total: ${money(offer.total, offer.currency)}`);
  if (offer.basis?.text) out.push(`Based on: ${offer.basis.text}`);
  if (offer.transit) out.push(`Transit time: ${offer.transit}`);
  if (offer.freeDays != null) out.push(`Free time: ${offer.freeDays} days`);
  if (offer.etd) out.push(`ETD: ${dayOf(offer.etd)}`);
  if (offer.routing) out.push(`Routing: ${offer.routing}`);
  if (offer.validUntil) out.push(`Valid until: ${dayOf(offer.validUntil)}`);
  return out.join("\n");
}

/** A part of the card under its own small heading, with a rule between the parts. */
function Block({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-4 first:pt-0 last:pb-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h3 id={id} className="text-meta font-semibold text-ink-heading">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Short parts on one line with a dot between them: the line breaks between parts. */
function Dotted({ parts, className = "" }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((part) => part != null && part !== false && part !== "");
  if (!shown.length) return null;
  return (
    <p className={`flex flex-wrap gap-x-1 ${className}`}>
      {shown.map((part, i) => (
        <span key={i} className="min-w-0 break-words">
          {part}
          {i < shown.length - 1 && " ·"}
        </span>
      ))}
    </p>
  );
}

/** One line of the offer: its label, the amount (or "at actuals"), and the unit when any line has one. */
function LineRow({ line, withUnits, twin, actions }: { line: PriceLine; withUnits: boolean; twin?: string; actions: PageActions }) {
  const firm = !line.soft && line.amount != null;
  const word = line.softText?.trim() || (line.amount == null ? "at actuals" : "approx.");
  return (
    <tr className="border-t border-line first:border-t-0">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal break-words text-ink-heading">
        {lineLabel(line.label)}
      </th>
      <td className={`py-1.5 text-right ${firm ? "whitespace-nowrap text-ink" : "text-ink-muted"}`}>
        <ProofLink proof={line.proof} actions={actions} className={firm ? "" : "break-words"}>
          {line.amount == null ? (
            word
          ) : firm ? (
            money(line.amount, line.currency)
          ) : (
            <>
              {word} <span className="whitespace-nowrap">{money(line.amount, line.currency)}</span>
            </>
          )}
        </ProofLink>
        {twin && <span className="block text-meta text-ink-muted">{twin}</span>}
      </td>
      {withUnits && <td className="w-px py-1.5 pl-2 text-left text-meta whitespace-nowrap text-ink-muted">{unitWords(line.unit)}</td>}
    </tr>
  );
}

/** What we offered the customer: the lines and their total, the terms the offer states, earlier amounts and other options. */
function Offered({ offer, row, viewer, actions }: { offer: Offer; row: EnquiryRow; viewer: Viewer; actions: PageActions }) {
  const firm = offer.lines.filter((line) => !line.soft && line.amount != null);
  const soft = offer.lines.filter((line) => line.soft || line.amount == null);
  const withUnits = offer.lines.some((line) => line.unit);
  const whole = offer.whole === true;
  // One firm line is its own total: the converted amount then sits on that line.
  const single = whole && firm.length === 1 && firm[0].amount === offer.total;
  const stamp = offer.final ? "final" : offer.revised ? "revised" : null;
  const sender = offer.sentBy.name.trim() || offer.sentBy.email || "";
  const [to, ...others] = offer.sentTo;
  const sent = offer.fromQuotedHistory
    ? "from an earlier e-mail quoted by the customer"
    : [sender, to && `to ${to}${others.length ? ` +${others.length}` : ""}`].filter(Boolean).join(" ");
  const facts: [string, string][] = [];
  if (offer.basis?.text) facts.push(["Basis", offer.basis.text]);
  if (offer.transit) facts.push(["Transit", offer.transit]);
  if (offer.freeDays != null) facts.push(["Free days", String(offer.freeDays)]);
  if (offer.etd) facts.push(["ETD", dayOf(offer.etd)]);
  if (offer.routing) facts.push(["Routing", offer.routing]);
  // A sell for the register only from a total for the whole shipment.
  const sell = viewer.canEdit ? sellPrefill(offer, row) : null;
  const useAsSell: ActionButton | null = sell ? { id: "edit_prefilled", label: "Use as sell", variant: "secondary", formPrefill: sell } : null;
  const copy: ActionButton = { id: "copy", label: "Copy offer text", variant: "secondary", copyText: offerText(offer), copiedToast: "Offer text copied." };

  return (
    <Block
      id="prices-offered"
      title="What we offered"
      aside={
        <p className="min-w-0 text-meta tabular-nums text-ink-muted">
          <ProofLink proof={offer.proof} actions={actions} className="break-words">
            {[stamp, offer.proof.when, sent].filter(Boolean).join(" · ")}
          </ProofLink>
        </p>
      }
    >
      <div className="relative">
        <table className="w-full text-body">
          <caption className="sr-only">The lines of our offer</caption>
          <tbody className="tabular-nums">
            {firm.map((line, i) => (
              <LineRow key={`firm-${i}`} line={line} withUnits={withUnits} twin={single ? offer.twin : undefined} actions={actions} />
            ))}
            {soft.map((line, i) => (
              <LineRow key={`soft-${i}`} line={line} withUnits={withUnits} actions={actions} />
            ))}
            {whole && !single && (
              <tr className="border-t border-line first:border-t-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-semibold text-ink">
                  Total of firm lines
                </th>
                <td className="py-1.5 text-right font-semibold whitespace-nowrap text-ink" title={proofTitle(offer.proof)}>
                  {money(offer.total, offer.currency)}
                  {offer.twin && <span className="block text-meta font-normal text-ink-muted">{offer.twin}</span>}
                </td>
                {withUnits && <td />}
              </tr>
            )}
            {!whole && (
              <tr className="border-t border-line first:border-t-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-semibold text-ink">
                  Total
                </th>
                <td className="py-1.5 text-right break-words text-ink-muted">depends on {dependsOn(offer)}</td>
                {withUnits && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-meta text-ink-muted">{label}</dt>
            <dd className="text-body tabular-nums text-ink">
              <ProofLink proof={offer.proof} actions={actions} className="break-words">
                {value}
              </ProofLink>
            </dd>
          </div>
        ))}
        <div className="min-w-0">
          <dt className="text-meta text-ink-muted">Validity</dt>
          <dd className="text-body tabular-nums text-ink">
            {offer.validUntil ? (
              <ProofLink proof={offer.proof} actions={actions}>
                until {dayOf(offer.validUntil)}
              </ProofLink>
            ) : offer.validityStated ? (
              <ProofLink proof={offer.proof} actions={actions}>
                stated in the e-mail
              </ProofLink>
            ) : (
              <span className="text-ink-muted">none stated</span>
            )}
          </dd>
        </div>
      </dl>

      {offer.earlier.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-1 text-meta tabular-nums text-ink-heading">
          <span>Earlier:</span>
          {offer.earlier.map((earlier, i) => (
            <span key={i} className="min-w-0 break-words">
              <ProofLink proof={earlier.proof} actions={actions}>
                {money(earlier.amount, earlier.currency, earlier.unit)} ({earlier.proof.when})
              </ProofLink>
              {i < offer.earlier.length - 1 && " ·"}
            </span>
          ))}
        </p>
      )}
      {offer.options.length > 1 && (
        <p className="mt-1 flex flex-wrap gap-x-1 text-meta tabular-nums text-ink-heading">
          <span>Options:</span>
          {offer.options.map((option, i) => (
            <span key={`${option.label}-${i}`} className="min-w-0 break-words">
              <ProofLink proof={option.proof} actions={actions} className={option.current ? "font-medium text-ink" : ""}>
                {option.label} {optionFigure(option)}
              </ProofLink>
              {i < offer.options.length - 1 && " ·"}
            </span>
          ))}
        </p>
      )}
      {offer.acceptedBy && (
        <div className="mt-3">
          <p className={`${CHIP} font-medium ${SPEAKER.customer.chip}`}>
            <Icon name="check" className="mt-0.5 size-3.5" />
            <ProofLink proof={offer.acceptedBy} actions={actions} className="min-w-0 break-words">
              Accepted by the customer {offer.acceptedBy.when}
            </ProofLink>
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {useAsSell && <ActionBtn button={useAsSell} actions={actions} size="sm" />}
        <ActionBtn button={copy} actions={actions} size="sm" />
      </div>
    </Block>
  );
}

/** How long an agent's stated validity runs: struck once it has ended, never when it is only their standard wording. */
function Validity({ validity, actions }: { validity: ValidityFact | null; actions: PageActions }) {
  if (!validity || validity.none) {
    return (
      <ProofLink proof={validity?.proof} actions={actions} className="text-ink-muted">
        no validity given
      </ProofLink>
    );
  }
  const text = validity.text.trim() || (validity.until ? `${validity.ended ? "ended" : "valid until"} ${dayOf(validity.until)}` : "validity stated");
  return (
    <ProofLink proof={validity.proof} actions={actions}>
      {validity.ended && !validity.boilerplate ? (
        <>
          <s>{text}</s>
          <span className="sr-only"> (no longer valid)</span>
        </>
      ) : (
        text
      )}
      {validity.boilerplate && " (from their standard wording)"}
    </ProofLink>
  );
}

/** "replied in 13 h": how long their first rate took, counted from our request. */
function repliedIn(hours: number): string {
  if (hours < 1) return "replied within the hour";
  return hours < 48 ? `replied in ${Math.round(hours)} h` : `replied in ${Math.round(hours / 24)} days`;
}

/** An option's price in US dollars, to put the cheapest first; those with no price or no space go last. */
function comparable(option: AgentOption): number {
  const amount = option.total ?? option.main.amount;
  return option.declined || amount == null ? Number.POSITIVE_INFINITY : amount * USD_PER[option.main.currency];
}

/** The agreed buy for the whole shipment, with what it is made of. */
function BuyLine({ buy, named, actions }: { buy: Buy; named: boolean; actions: PageActions }) {
  const label = `${buy.agreed ? "Agreed buy" : "Buy"}${named ? ` with ${displayName(buy.agentName)}` : ""}:`;
  return (
    <Dotted
      className="mt-1 text-meta tabular-nums text-ink-heading"
      parts={[
        <>
          <span className="font-medium text-ink">{label}</span>{" "}
          <ProofLink proof={buy.proof} actions={actions}>
            {buy.total != null ? money(buy.total, buy.currency) : buy.linesText}
          </ProofLink>
          {buy.total != null && buy.twin && <span className="text-ink-muted"> {buy.twin}</span>}
        </>,
        buy.total != null && buy.linesText,
      ]}
    />
  );
}

/** One agent: who, where they stand, their latest rate with its terms, and the options of the same e-mail. */
function AgentRow({ quote, buy, row, viewer, actions }: { quote: AgentQuote; buy: Buy | null; row: EnquiryRow; viewer: Viewer; actions: PageActions }) {
  const [open, setOpen] = useState(false);
  const extrasId = useId();
  const state = AGENT_STATE[quote.state];
  const asking = quote.state === "question" && !!quote.question && !quote.question.answered;
  const latest = quote.latest && !quote.latest.declined ? quote.latest : null;
  const main = latest?.main ?? null;
  const extras = latest?.extras ?? [];
  const options = quote.options.length > 1 ? [...quote.options].sort((a, b) => (comparable(a) === comparable(b) ? 0 : comparable(a) < comparable(b) ? -1 : 1)) : [];
  const terms = latest ? [latest.carrier, latest.transit && `TT ${latest.transit}`, latest.freeDays != null && `${latest.freeDays} free days`].filter(Boolean).join(" · ") : "";
  const earlier = quote.earlier.map(figures);
  const inOrder = [...earlier, main?.amount != null ? figures(main.amount) : ""].filter(Boolean).join(" → ");
  // Without a rate the brief's own sentence tells where this agent stands; it opens their question or their refusal.
  const noRateProof = quote.question?.proof ?? quote.options.find((option) => option.declined)?.proof ?? null;
  const ownBuy = buy && buy.sideKey === quote.sideKey ? buy : null;
  const prefill = viewer.canEdit ? buyPrefill(quote, buy, row) : null;
  const useAsBuy: ActionButton | null = prefill ? { id: "edit_prefilled", label: "Use as buy", variant: "secondary", formPrefill: prefill } : null;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-body font-semibold text-ink">{displayName(quote.name) || quote.domain}</span>
          <span className={`${BADGE} ${asking ? "bg-await-bg text-await" : state.badge}`}>
            <Icon name={state.icon} className="size-3.5" />
            {state.label}
          </span>
          {quote.lowestOnFile && (
            <span className={`${BADGE} bg-surface text-ink-heading ring-1 ring-inset ring-line`}>
              <span aria-hidden="true">★</span>
              lowest on file
            </span>
          )}
        </div>
        {latest && main && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-body tabular-nums">
            <ProofLink proof={main.proof} actions={actions} className={`font-semibold text-ink ${main.amount != null ? "whitespace-nowrap" : "break-words"}`}>
              {main.amount != null ? money(main.amount, main.currency, main.unit) : main.softText?.trim() || "at actuals"}
              {latest.allIn && " all in"}
            </ProofLink>
            {main.amount != null && <span className="text-meta whitespace-nowrap text-ink-muted">{twinOf(main.amount, main.currency)}</span>}
          </p>
        )}
      </div>

      {latest ? (
        <Dotted
          className="mt-1 text-meta tabular-nums text-ink-heading"
          parts={[
            terms && (
              <ProofLink proof={latest.proof} actions={actions}>
                {terms}
              </ProofLink>
            ),
            <Validity validity={quote.validity} actions={actions} />,
            quote.requestOnFile && quote.repliedInHours != null && repliedIn(quote.repliedInHours),
            earlier.length > 0 && (
              <span className="text-ink-muted" title={`Their rates in order: ${inOrder}`}>
                was {earlier.join(" → ")}
              </span>
            ),
          ]}
        />
      ) : (
        quote.summary.trim() && (
          <p className="mt-1 text-meta tabular-nums text-ink-heading">
            <ProofLink proof={noRateProof} actions={actions} className="break-words">
              {quote.summary}
            </ProofLink>
          </p>
        )
      )}
      {ownBuy && <BuyLine buy={ownBuy} named={false} actions={actions} />}

      {options.length > 0 && (
        <ul role="list" aria-label={`${displayName(quote.name) || quote.domain}: the options in their e-mail`} className="mt-2 space-y-1 border-l-2 border-line pl-3 text-meta tabular-nums">
          {options.map((option, i) => {
            const amount = option.main.amount;
            const price = amount != null ? money(amount, option.main.currency, option.main.unit) : "";
            const rest = [option.transit && `TT ${option.transit}`, option.freeDays != null && `${option.freeDays} free days`].filter(Boolean).join(" · ");
            const who = option.carrier?.trim() || `Option ${i + 1}`;
            return (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                {option.declined ? (
                  <ProofLink proof={option.proof} actions={actions} className="min-w-0 break-words text-ink-muted">
                    <span className="sr-only">Declined: </span>
                    <s>{[who, option.declinedText?.trim() || "declined"].join(" · ")}</s>
                  </ProofLink>
                ) : (
                  <>
                    <span className="min-w-0 break-words text-ink-heading">{[who, rest].filter(Boolean).join(" · ")}</span>
                    <ProofLink proof={option.proof} actions={actions} className={`text-ink ${price ? "whitespace-nowrap" : "break-words"}`}>
                      {price || option.main.softText?.trim() || "at actuals"}
                      {option.allIn && " all in"}
                    </ProofLink>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(extras.length > 0 || useAsBuy) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {useAsBuy && <ActionBtn button={useAsBuy} actions={actions} size="sm" />}
          {extras.length > 0 && (
            <Button variant="ghost" size="sm" className={useAsBuy ? "" : "-ml-2.5"} aria-expanded={open} aria-controls={extrasId} onClick={() => setOpen(!open)}>
              <Icon name={open ? "chevronDown" : "chevronRight"} className="size-3.5" />+{extras.length} small {extras.length === 1 ? "item" : "items"}
            </Button>
          )}
        </div>
      )}
      {extras.length > 0 && (
        <ul id={extrasId} role="list" hidden={!open} className="mt-1 space-y-0.5 border-l-2 border-line pl-3 text-meta tabular-nums">
          {extras.map((line, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 break-words text-ink-heading">{lineLabel(line.label)}</span>
              <ProofLink proof={line.proof} actions={actions} className={line.soft || line.amount == null ? "break-words text-ink-muted" : "whitespace-nowrap text-ink"}>
                {line.amount == null
                  ? line.softText?.trim() || "at actuals"
                  : `${line.soft ? `${line.softText?.trim() || "approx."} ` : ""}${money(line.amount, line.currency, line.unit)}`}
              </ProofLink>
            </li>
          ))}
          {latest?.total != null && main?.amount != null && latest.total !== main.amount && (
            <li className="flex flex-wrap items-baseline justify-between gap-x-3 font-medium text-ink" title={proofTitle(latest.proof)}>
              <span>With the firm ones</span>
              {/* A total for the whole shipment: never with the main line's per-unit mark. */}
              <span className="whitespace-nowrap">{money(latest.total, main.currency)}</span>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** What agents charge: one row per agent, then the figures named beside the rates (targets, a currency mix-up, a buy for freight only). */
function Agents({ agentRates, buy, targets, margin, row, viewer, actions }: Pick<PricesCardProps, "agentRates" | "buy" | "targets" | "margin" | "row" | "viewer" | "actions">) {
  const stray = buy && !agentRates.some((quote) => quote.sideKey === buy.sideKey) ? buy : null;
  const named = targets.filter((target) => target.text.trim());
  const { clash } = margin;
  const hasChips = named.length > 0 || !!clash || !!buy?.freightOnly;
  return (
    <Block id="prices-agents" title="What agents charge">
      {agentRates.length > 0 ? (
        <ul role="list" className="divide-y divide-line">
          {agentRates.map((quote) => (
            <AgentRow key={quote.sideKey} quote={quote} buy={buy} row={row} viewer={viewer} actions={actions} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-muted">No agent's rate in the e-mails yet.</p>
      )}
      {stray && <BuyLine buy={stray} named actions={actions} />}
      {hasChips && (
        <ul role="list" aria-label="Figures named beside the rates" className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          {named.map((target, i) => (
            <li key={`${target.proof.emailId}-${i}`} className={`${CHIP} ${target.who === "customer" ? SPEAKER.customer.chip : SPEAKER.us.chip}`}>
              <Icon name="target" className="mt-0.5 size-3.5" />
              <ProofLink proof={target.proof} actions={actions} className="min-w-0 break-words">
                {target.text}
              </ProofLink>
            </li>
          ))}
          {clash && (
            <li className={`${CHIP} flex-wrap gap-x-2 border ${TONE_BOX.bad} ${TONE_TEXT.bad}`}>
              <span className="inline-flex min-w-0 items-start gap-1 font-medium">
                <Icon name="alert" className="mt-0.5 size-3.5" />
                <span className="min-w-0 break-words">{clash.text}</span>
              </span>
              {clash.proofs.map((proof, i) => (
                <ProofLink key={i} proof={proof} actions={actions}>
                  {clash.currencies[i]} · {proof.when}
                </ProofLink>
              ))}
            </li>
          )}
          {buy?.freightOnly && (
            <li className={`${CHIP} border ${TONE_BOX.warn} ${TONE_TEXT.warn}`}>
              <Icon name="alert" className="mt-0.5 size-3.5" />
              <ProofLink proof={buy.proof} actions={actions} className="min-w-0 break-words">
                The buy covers freight only
              </ProofLink>
            </li>
          )}
        </ul>
      )}
    </Block>
  );
}

/** Every figure in the order it was written, coloured by who named it; each opens its e-mail. */
function Trail({ trail, sentence, actions }: { trail: TrailPoint[]; sentence: string | null; actions: PageActions }) {
  const [all, setAll] = useState(false);
  const shown = all ? trail : trail.slice(-TRAIL_SHOWN);
  return (
    <Block id="prices-trail" title="How the prices moved">
      <ol role="list" aria-label="The figures in the order they were written" className="flex flex-wrap gap-1.5">
        {shown.map((point, i) => (
          <li
            key={`${point.proof.emailId}-${point.at}-${i}`}
            className={`relative inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium tabular-nums ${SPEAKER[point.party].chip}`}
          >
            {point.marked && <Icon name="check" className="size-3.5" />}
            <ProofLink proof={point.proof} actions={actions} className="min-w-0 break-words after:absolute after:inset-0 after:rounded-full">
              <span className="sr-only">{SPEAKER[point.party].says}: </span>
              {point.label}
              {point.marked && point.role === "agreed_buy" && <span className="sr-only"> (agreed)</span>}
            </ProofLink>
          </li>
        ))}
      </ol>
      {trail.length > TRAIL_SHOWN && (
        <Button variant="ghost" size="sm" className="mt-1 -ml-2.5" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? `Show the latest ${TRAIL_SHOWN}` : `Show all ${trail.length}`}
        </Button>
      )}
      {sentence && <p className="mt-2 text-body text-ink-heading">{sentence}</p>}
    </Block>
  );
}

/**
 * What is left of the offer after the agreed buy: a figure with its two inputs, or why there is none. Red only below
 * zero. The buy it was worked out from opens the e-mail that agreed it.
 */
function MarginBlock({ margin, buy, actions }: { margin: Margin; buy: Buy | null; actions: PageActions }) {
  const { figure, clash } = margin;
  const inputs = figure && margin.inputs?.trim() ? margin.inputs.trim() : null;
  const notes = margin.notes.filter((note) => note.trim());
  return (
    <Block id="prices-margin" title="Margin">
      {clash ? (
        <p className="flex items-start gap-1.5 text-body font-semibold text-lost">
          <Icon name="alert" className="mt-0.5 size-4" />
          Check the currency
        </p>
      ) : figure ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-title font-semibold tabular-nums ${figure.negative ? "text-lost" : "text-ink"}`}>{figure.text}</span>
          <span className="text-meta tabular-nums text-ink-heading">
            {percent(figure.pct)} of the {margin.source === "register" ? "sell" : "offer"}
          </span>
        </p>
      ) : (
        <p className="break-words text-body text-ink-muted">
          <span aria-hidden="true">— </span>
          {margin.why?.trim() || "No figure"}
        </p>
      )}
      {clash && margin.why?.trim() && <p className="mt-0.5 break-words text-meta text-ink-muted">{margin.why}</p>}
      <Dotted
        className="mt-0.5 text-meta tabular-nums text-ink-muted"
        parts={[
          inputs && (
            <ProofLink proof={margin.source === "mail" ? buy?.proof : null} actions={actions}>
              {inputs}
            </ProofLink>
          ),
          ...notes,
        ]}
      />
    </Block>
  );
}

/** Buy, sell and profit as the register holds them, and where the e-mails say something else. */
function Register({ row, registerMoney, viewer, actions, fromMail }: Pick<PricesCardProps, "row" | "registerMoney" | "viewer" | "actions"> & { fromMail: boolean }) {
  const hasRates = row.buy_total != null || row.sell_total != null;
  const perUnit = (row.units ?? 0) > 1;
  const amount = (n: number | null) => (n == null ? <span className="text-ink-muted">Not entered</span> : fmtMoney(n));
  const { missingText, differs, slip } = registerMoney;
  const useThese: ActionButton | null =
    viewer.canEdit && missingText && registerMoney.prefill ? { id: "edit_prefilled", label: "Use these…", variant: "secondary", formPrefill: registerMoney.prefill } : null;
  const update: ActionButton | null = !viewer.canEdit
    ? null
    : differs
      ? { id: "edit_prefilled", label: "Update rates…", variant: "secondary", formPrefill: differs.prefill }
      : slip?.prefill
        ? { id: "edit_prefilled", label: "Update rates…", variant: "secondary", formPrefill: slip.prefill }
        : null;
  const keep: ActionButton | null = viewer.canEdit && differs ? { id: "dismiss", label: "Keep the register's", variant: "ghost", dismissId: differs.dismissId } : null;
  const noSell = !hasRates && row.status === "confirmed";

  return (
    <Block id="prices-register" title={`In the register (${row.currency.trim()})`}>
      {hasRates && (
        <table className="w-full text-body">
          <thead>
            <tr className="text-left text-meta text-ink-muted">
              <th scope="col" className="pb-1 font-medium">
                <span className="sr-only">Side</span>
              </th>
              {perUnit && (
                <th scope="col" className="pb-1 text-right font-medium">
                  Per unit
                </th>
              )}
              <th scope="col" className="pb-1 text-right font-medium">
                Total{perUnit ? ` (${row.units} units)` : ""}
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-normal text-ink-heading">
                Buy
              </th>
              {perUnit && <td className="py-1.5 text-right">{amount(row.buy_rate)}</td>}
              <td className="py-1.5 text-right">{amount(row.buy_total)}</td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-normal text-ink-heading">
                Sell
              </th>
              {perUnit && <td className="py-1.5 text-right">{amount(row.sell_rate)}</td>}
              <td className="py-1.5 text-right">{amount(row.sell_total)}</td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-semibold text-ink">
                Profit
              </th>
              {perUnit && <td />}
              <td className={`py-1.5 text-right font-semibold ${row.profit != null && row.profit < 0 ? "text-lost" : "text-ink"}`}>
                {row.profit == null ? "—" : fmtMoney(row.profit)}
                {row.profit != null && row.sell_total ? (
                  <span className="ml-1 font-normal text-ink-muted">({fmtPercent(row.profit, row.sell_total)})</span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {missingText ? (
        <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 ${hasRates ? "mt-3" : ""}`}>
          <p className="min-w-0 break-words text-body tabular-nums text-ink-heading">
            {missingText}
            {noSell && <span className="text-await"> Without a sell amount, the reports miss this job's profit.</span>}
          </p>
          {useThese && <ActionBtn button={useThese} actions={actions} size="sm" />}
        </div>
      ) : (
        !hasRates && (
          <p className="text-body text-ink-muted">
            No rates entered yet.
            {noSell && <span className="text-await"> Without a sell amount, the reports miss this job's profit.</span>}
          </p>
        )
      )}

      {differs && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-control border border-await/25 bg-await-bg px-3 py-2">
          <p className="flex min-w-0 items-start gap-1.5 text-body text-await">
            <Icon name="alert" className="mt-0.5 size-4" />
            <span className="min-w-0 break-words tabular-nums">{differs.text}</span>
          </p>
          {(update || keep) && (
            <div className="flex flex-wrap gap-2">
              {update && <ActionBtn button={update} actions={actions} size="sm" />}
              {keep && <ActionBtn button={keep} actions={actions} size="sm" />}
            </div>
          )}
        </div>
      )}
      {slip && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="flex min-w-0 items-start gap-1.5 text-meta font-medium text-await">
            <Icon name="alert" className="mt-0.5 size-3.5" />
            <span className="min-w-0 break-words tabular-nums">{slip.text}</span>
          </p>
          {update && !differs && <ActionBtn button={update} actions={actions} size="sm" />}
        </div>
      )}

      {row.commission_amount != null && (
        <p className="mt-3 border-t border-line pt-3 text-body text-ink-heading">
          Commission:{" "}
          <span className="font-medium tabular-nums text-ink">
            {describeCommission({ amount: row.commission_amount, currency: row.commission_currency ?? null, perUnit: !!row.commission_per_unit }, row.units)}
          </span>
        </p>
      )}
      {fromMail && (
        <p className="mt-3 border-t border-line pt-3 text-meta text-ink-muted">
          Read from the e-mails, so check before you save. The register keeps USD; OMR is converted at 2.6 as the register does; EUR, INR and others are
          approximate.
        </p>
      )}
    </Block>
  );
}

export interface PricesCardProps {
  row: EnquiryRow;
  /** The latest offer to the customer, read from the e-mails. */
  offer: Offer | null;
  agentRates: AgentQuote[];
  /** The buy agreed with an agent by e-mail. */
  buy: Buy | null;
  targets: Target[];
  margin: Margin;
  /** Every figure in the order it was written. */
  trail: TrailPoint[];
  trailSentence: string | null;
  registerMoney: RegisterMoney;
  viewer: Viewer;
  actions: PageActions;
}

/**
 * Prices: our offer as lines, what agents charge, how the figures moved, the margin with its two inputs, and the
 * register's buy, sell and profit. Every figure read from an e-mail opens that e-mail; a figure reaches the
 * register only through the Edit form, filled in as a suggestion for the person to save.
 */
export function PricesCard({ row, offer, agentRates, buy, targets, margin, trail, trailSentence, registerMoney, viewer, actions }: PricesCardProps) {
  const fromMail = !!offer || agentRates.length > 0 || !!buy || targets.length > 0 || trail.length > 0 || !!margin.clash;
  // The register's own profit is in its table below: the margin is said here when the e-mails give it or explain its absence.
  const showMargin = fromMail && (margin.source === "mail" || !margin.figure || !!margin.clash);
  return (
    <section id="prices" aria-labelledby="prices-title" className="scroll-mt-20 rounded-panel border border-line bg-surface">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 id="prices-title" className="text-body font-semibold text-ink">
          Prices
        </h2>
      </header>
      <div className="divide-y divide-line p-4">
        {fromMail ? (
          <>
            {offer ? (
              <Offered offer={offer} row={row} viewer={viewer} actions={actions} />
            ) : (
              <Block id="prices-offered" title="What we offered">
                <p className="text-body text-ink-muted">No offer in the e-mails yet.</p>
              </Block>
            )}
            <Agents agentRates={agentRates} buy={buy} targets={targets} margin={margin} row={row} viewer={viewer} actions={actions} />
            {trail.length > 0 && <Trail trail={trail} sentence={trailSentence} actions={actions} />}
            {showMargin && <MarginBlock margin={margin} buy={buy} actions={actions} />}
          </>
        ) : (
          <p className="pb-4 text-body text-ink-muted">No prices in the e-mails yet.</p>
        )}
        <Register row={row} registerMoney={registerMoney} viewer={viewer} actions={actions} fromMail={fromMail || !!registerMoney.missingText || !!registerMoney.differs} />
      </div>
    </section>
  );
}
