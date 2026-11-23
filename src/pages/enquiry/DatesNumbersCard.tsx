import { Fragment, useId, type ReactNode } from "react";
import { Icon } from "../../components/icons";
import { Card } from "../../components/ui";
import { daysBetween, fmtDayMonth, shortPort } from "../../lib/display";
import type { ActionButton, CopyTexts, DatedValue, DateFacts, PromiseMade, Proof, RefChip, Sourced, ValidityFact } from "../../lib/enquiryBrief";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import type { EnquiryRow } from "../../lib/types";
import { ActionBtn, ProofLink, proofTitle, TONE_TEXT, type PageActions } from "./shared";

// The shipment's dates as the e-mails give them (each opens the e-mail it was read from), and the numbers people
// ask for by phone or type into another system, each a button that copies it.

/** A date that moved later by more than this many days is said in amber. */
const SLIP_DAYS = 3;

/** Earlier values listed under a date that changed. */
const EARLIER_SHOWN = 2;

/** The longest promise quoted on a line. */
const PROMISE_SENTENCE = 80;

/** Kept promises named after the open ones. */
const KEPT_SHOWN = 3;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "Reena Aneesh (WWL)" → "WWL": the company when the proof names one, else the writer. */
const company = (who: string) => /\(([^()]+)\)\s*$/.exec(who)?.[1]?.trim() || who.trim();

/** "WWL, Thu 05 Nov, 16:21": who gave a value and when, in a few words. */
const source = (proof: Proof) => [company(proof.who), proof.when.trim()].filter(Boolean).join(", ");

/** A number's copy button: the page copies the value and says "{label} copied." */
export function refButton(chip: RefChip): ActionButton {
  const label = chip.copyLabel.trim() || `Copy ${chip.label} ${chip.value}`;
  return { id: "copy", label, variant: "ghost", copyText: chip.value, copiedToast: `${chip.label} copied.` };
}

/** "Copy house subject": the subject line the house writes to agents, built from the register. */
export function houseSubjectButton(copy: CopyTexts): ActionButton | null {
  const text = copy.houseSubject.trim();
  return text ? { id: "copy", label: "Copy house subject", variant: "secondary", copyText: text, copiedToast: "House subject copied." } : null;
}

/** The numbers to show: the enquiry's own reference always, first unless the brief already places it. */
export function shownRefs(refs: RefChip[], row: Pick<EnquiryRow, "reference">): RefChip[] {
  const filled = refs.filter((chip) => chip.value.trim());
  const reference = row.reference?.trim();
  if (!reference || filled.some((chip) => chip.kind === "reference")) return filled;
  return [{ kind: "reference", label: "Reference", value: reference, copyLabel: `Copy reference ${reference}`, proof: null }, ...filled];
}

/** A small amber line with a warning icon: a date that slipped, fewer free days than asked, a validity that ended. */
function Caution({ children }: { children: ReactNode }) {
  return (
    <span className="mt-0.5 flex items-start gap-1 text-meta font-medium text-await">
      <Icon name="alert" className="mt-0.5 size-3.5" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

/** One line of the dates: what it is, then what the e-mails say. */
function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="pt-px text-meta text-ink-muted" title={title}>
        {label}
      </dt>
      <dd className="min-w-0 break-words text-body text-ink">{children}</dd>
    </div>
  );
}

/**
 * A date read from an e-mail: the day (or the words found when no day could be read), the port when stated, how far
 * it moved, and the values it had before.
 */
function DateValue({ value, today, actions }: { value: DatedValue; today: string; actions: PageActions }) {
  const day = (date: string | null, text: string, long: boolean) => (date && ISO_DAY.test(date) ? (long ? dayWithWeekday(date, today) : fmtDayMonth(date, today)) : text.trim() || "date not clear");
  const moved = value.plan ? 0 : (value.slipDays ?? 0);
  const late = moved > SLIP_DAYS;
  const movedText = moved ? `${plural(Math.abs(moved), "day")} ${moved > 0 ? "later" : "earlier"} than before` : "";
  const port = shortPort(value.port);
  const rest = value.earlier.slice(EARLIER_SHOWN);
  return (
    <>
      <ProofLink proof={value.proof} actions={actions} className={`font-medium tabular-nums ${late ? "text-await" : "text-ink"}`}>
        {day(value.date, value.text, true)}
      </ProofLink>
      {port && <span className="text-ink-heading"> · {port}</span>}
      {value.plan && <span className="text-meta text-ink-muted"> · from our offer</span>}
      {movedText && (late ? <Caution>{movedText}</Caution> : <span className="block text-meta tabular-nums text-ink-muted">{movedText}</span>)}
      {value.earlier.slice(0, EARLIER_SHOWN).map((before, i) => (
        <span key={`${before.proof.emailId}-${i}`} className="block text-meta tabular-nums text-ink-muted">
          was{" "}
          <ProofLink proof={before.proof} actions={actions}>
            {day(before.date, before.text, false)}
          </ProofLink>{" "}
          ({source(before.proof)})
        </span>
      ))}
      {rest.length > 0 && (
        <span className="block text-meta text-ink-muted" title={rest.map((before) => `${day(before.date, before.text, false)} (${source(before.proof)})`).join(" · ")}>
          and {plural(rest.length, "earlier date")}
        </span>
      )}
    </>
  );
}

/** "35 days (we said) · 25–35 days (agent)". */
function Transit({ ours, agent, actions }: { ours: Sourced<string> | null; agent: Sourced<string> | null; actions: PageActions }) {
  return (
    <>
      {ours && (
        <span className="whitespace-nowrap">
          <ProofLink proof={ours.proof} actions={actions} className="tabular-nums">
            {ours.value}
          </ProofLink>{" "}
          <span className="text-ink-muted">(we said)</span>
        </span>
      )}
      {ours && agent && " · "}
      {agent && (
        <span className="whitespace-nowrap">
          <ProofLink proof={agent.proof} actions={actions} className="tabular-nums">
            {agent.value}
          </ProofLink>{" "}
          <span className="text-ink-muted">(agent)</span>
        </span>
      )}
    </>
  );
}

/** "14 asked · 11 given", and how many fewer when the agent gives less than we asked. */
function FreeDays({ asked, given, actions }: { asked: number | null; given: Sourced<number> | null; actions: PageActions }) {
  const short = asked != null && given && given.value < asked ? asked - given.value : 0;
  return (
    <>
      {asked != null && <span className="tabular-nums">{asked} asked</span>}
      {asked != null && given && " · "}
      {given && (
        <ProofLink proof={given.proof} actions={actions} className={`tabular-nums ${short ? "font-medium text-await" : ""}`}>
          {given.value} given
        </ProofLink>
      )}
      {short > 0 && <Caution>{short} fewer than asked</Caution>}
    </>
  );
}

/** "Frontline: none given" · "MLE: valid until Sun 30 Nov" · "Our offer: none stated". */
function Validity({ fact, today, actions }: { fact: ValidityFact; today: string; actions: PageActions }) {
  const who = fact.who.trim();
  const dated = !!fact.until && ISO_DAY.test(fact.until);
  const said =
    fact.text.trim() ||
    (fact.none ? "none given" : dated ? (fact.ended ? `ended ${fmtDayMonth(fact.until!, today)}` : `valid until ${dayWithWeekday(fact.until!, today)}`) : fact.until?.trim() || "none stated");
  const text = !who || said.toLowerCase().startsWith(who.toLowerCase()) ? said : `${who}: ${said}`;
  const standard = fact.boilerplate && !/standard wording/i.test(said);
  return (
    <li className="break-words">
      {fact.ended ? (
        <span className="inline-flex items-start gap-1 font-medium text-await">
          <Icon name="alert" className="mt-0.5 size-3.5" />
          <ProofLink proof={fact.proof} actions={actions} className="min-w-0 tabular-nums">
            {text}
          </ProofLink>
        </span>
      ) : (
        <ProofLink proof={fact.proof} actions={actions} className="tabular-nums">
          {text}
        </ProofLink>
      )}
      {standard && <span className="text-meta text-ink-muted"> · from their standard wording</span>}
    </li>
  );
}

/** "We said “will update by tomorrow” Sun 08 Nov, 11:28 — due Mon 09 Nov". */
function PromiseLine({ promise, today, actions }: { promise: PromiseMade; today: string; actions: PageActions }) {
  const sentence = clip(promise.sentence.trim(), PROMISE_SENTENCE);
  const dated = ISO_DAY.test(promise.due) && ISO_DAY.test(today);
  const days = dated ? daysBetween(today, promise.due) : null;
  const due = days == null ? promise.due.trim() && `due ${promise.due.trim()}` : days === 0 ? "due today" : days < 0 ? `was due ${dayWithWeekday(promise.due, today)}` : `due ${dayWithWeekday(promise.due, today)}`;
  const now = days != null && days <= 0;
  return (
    <li className="break-words">
      <ProofLink proof={promise.proof} actions={actions}>
        {promise.by === "us" ? "We said" : "They said"}
        {sentence && ` “${sentence}”`}
      </ProofLink>
      {promise.proof.when.trim() && (
        <>
          {" "}
          <span className="whitespace-nowrap text-meta tabular-nums text-ink-muted">{promise.proof.when.trim()}</span>
        </>
      )}
      {due && (now ? <Caution>{due}</Caution> : <span className="text-meta tabular-nums text-ink-muted"> — {due}</span>)}
    </li>
  );
}

/** One number: its name, its value and a copy mark. The whole of it is the button; where it was read is in the tooltip. */
function RefCopy({ chip, actions }: { chip: RefChip; actions: PageActions }) {
  const button = refButton(chip);
  return (
    <button
      type="button"
      aria-label={button.label}
      title={chip.proof ? proofTitle(chip.proof) : button.label}
      onClick={() => actions.onAction(button)}
      className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-control bg-table-head px-2 py-1 text-left text-meta ring-1 ring-inset ring-line transition-colors duration-150 hover:bg-row-hover hover:ring-control"
    >
      <span className="shrink-0 text-ink-muted">{chip.label}</span>
      <span className="min-w-0 select-text break-all font-medium tabular-nums text-ink">{chip.value}</span>
      <Icon name="copy" className="size-3.5 text-ink-muted" />
    </button>
  );
}

export interface DatesNumbersCardProps {
  dates: DateFacts;
  refs: RefChip[];
  row: EnquiryRow;
  /** Oman's date. */
  today: string;
  copy: CopyTexts;
  actions: PageActions;
}

/**
 * Dates and numbers: ETD and ETA with what they were before, cut-off, transit, free days, validity and what was
 * promised; then the reference, PO, agent job, SO, BL, container and the like, each copied with one click, and the
 * house subject.
 */
export function DatesNumbersCard({ dates, refs, row, today, copy, actions }: DatesNumbersCardProps) {
  const id = useId();
  const { etd, eta, atd, cutoff, transit, freeDays, validity, headline } = dates;
  const open = dates.promises.filter((promise) => !promise.kept);
  const kept = dates.promises.filter((promise) => promise.kept);
  const hasDates = !!(etd || eta || atd || cutoff || transit.ours || transit.agent || freeDays.asked != null || freeDays.given || validity.length || dates.promises.length);
  const chips = shownRefs(refs, row);
  const house = houseSubjectButton(copy);
  return (
    <Card title="Dates and numbers" className="@container">
      <div className="grid items-start gap-4 @min-[640px]:grid-cols-2 @min-[640px]:gap-x-8">
        <section aria-labelledby={`${id}-dates`} className="min-w-0">
          <h3 id={`${id}-dates`} className="mb-2 text-meta font-semibold text-ink-heading">
            Dates
          </h3>
          {headline?.text.trim() && (
            <p className={`mb-2 flex items-start gap-1.5 text-body font-medium tabular-nums ${TONE_TEXT[headline.tone]}`}>
              <Icon name={headline.tone === "bad" || headline.tone === "warn" ? "alert" : "clock"} className="mt-0.5 size-4" />
              <span className="min-w-0 break-words">{headline.text}</span>
            </p>
          )}
          {hasDates ? (
            <dl className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-2">
              {etd && (
                <Row label="ETD" title="Estimated time of departure">
                  <DateValue value={etd} today={today} actions={actions} />
                </Row>
              )}
              {atd && (
                <Row label="Departed" title="Actual time of departure (ATD)">
                  <DateValue value={atd} today={today} actions={actions} />
                </Row>
              )}
              {eta && (
                <Row label="ETA" title="Estimated time of arrival">
                  <DateValue value={eta} today={today} actions={actions} />
                </Row>
              )}
              {cutoff && (
                <Row label="Cut-off">
                  <ProofLink proof={cutoff.proof} actions={actions} className="tabular-nums">
                    {cutoff.value}
                  </ProofLink>
                </Row>
              )}
              {(transit.ours || transit.agent) && (
                <Row label="Transit">
                  <Transit ours={transit.ours} agent={transit.agent} actions={actions} />
                </Row>
              )}
              {(freeDays.asked != null || freeDays.given) && (
                <Row label="Free days">
                  <FreeDays asked={freeDays.asked} given={freeDays.given} actions={actions} />
                </Row>
              )}
              {validity.length > 0 && (
                <Row label="Validity">
                  <ul role="list" className="space-y-1">
                    {validity.map((fact, i) => (
                      <Validity key={`${fact.who}-${i}`} fact={fact} today={today} actions={actions} />
                    ))}
                  </ul>
                </Row>
              )}
              {dates.promises.length > 0 && (
                <Row label="Promised">
                  {open.length > 0 && (
                    <ul role="list" className="space-y-1">
                      {open.map((promise, i) => (
                        <PromiseLine key={`${promise.proof.emailId}-${i}`} promise={promise} today={today} actions={actions} />
                      ))}
                    </ul>
                  )}
                  {kept.length > 0 && (
                    <p className={`flex items-start gap-1 text-meta text-ink-muted ${open.length ? "mt-1" : ""}`}>
                      <Icon name="check" className="mt-0.5 size-3.5" />
                      <span className="min-w-0 break-words">
                        Kept:{" "}
                        {kept.slice(0, KEPT_SHOWN).map((promise, i) => (
                          <Fragment key={`${promise.proof.emailId}-${i}`}>
                            {i > 0 && " · "}
                            <ProofLink proof={promise.proof} actions={actions} className="tabular-nums">
                              {[promise.by === "us" ? "ours" : "theirs", promise.proof.when.trim()].filter(Boolean).join(", ")}
                            </ProofLink>
                          </Fragment>
                        ))}
                        {kept.length > KEPT_SHOWN && ` · and ${kept.length - KEPT_SHOWN} more`}
                      </span>
                    </p>
                  )}
                </Row>
              )}
            </dl>
          ) : (
            <p className="text-body text-ink-muted">No dates in the e-mails yet.</p>
          )}
        </section>

        <section aria-labelledby={`${id}-numbers`} className="min-w-0 border-t border-line pt-3 @min-[640px]:border-t-0 @min-[640px]:pt-0">
          <h3 id={`${id}-numbers`} className="mb-2 text-meta font-semibold text-ink-heading">
            Numbers
          </h3>
          {chips.length > 0 && (
            <ul role="list" className="flex flex-wrap gap-1.5">
              {chips.map((chip, i) => (
                <li key={`${chip.kind}-${chip.value}-${i}`} className="flex max-w-full">
                  <RefCopy chip={chip} actions={actions} />
                </li>
              ))}
            </ul>
          )}
          {house && (
            <div className={chips.length ? "mt-3" : ""}>
              <ActionBtn button={house} actions={actions} size="sm" />
              <p className="mt-1 break-words text-meta tabular-nums text-ink-muted">{house.copyText}</p>
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
