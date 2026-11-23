import { useState, type ReactNode } from "react";
import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import { offerFigureOf, type ActionButton, type Margin, type Move, type NeedItem, type Offer, type RegisterMoney } from "../../lib/enquiryBrief";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import { errorMessage, fmtMoney, todayIso } from "../../lib/format";
import type { EnquiryRow } from "../../lib/types";
import { optionFigure } from "./PricesCard";
import { ActionBtn, ProofLink, proofTitle, TONE_TEXT, type PageActions } from "./shared";

/** Needs-you lines shown before "Show n more". */
const SHOWN = 3;

const CELL = "min-w-0 bg-surface px-4 py-3";
const LABEL = "text-meta font-medium text-ink-muted";
/** A cell that answers a click anywhere: its button's ::after covers it. */
const CLICKABLE = "relative transition-colors duration-150 hover:bg-row-hover";
const COVER = "after:absolute after:inset-0";
/** Above a cell's cover, so a value keeps its own click and tooltip. */
const ABOVE = "relative z-10";
/** A line of short parts that wraps between them, never inside one. */
const PARTS = "flex flex-wrap gap-x-1 text-meta tabular-nums text-ink-heading";

/** Whose move it is while we are the ones to act: the Now card then holds that action. */
const OURS: ReadonlySet<Move["kind"]> = new Set(["us_customer", "us_agent", "said_yes", "looks_won", "quoted_unmarked", "pass_on", "rate_in_hand"]);

/** 1225.5 → "1,225.5": up to three decimals, for rials. */
const figures = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** "2026-11-30" → "Mon 30 Nov"; anything else is shown as written. */
const dayOf = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? dayWithWeekday(value, todayIso()) : value);

/** -3.2 → "−3%", with the minus sign the figures use. */
function percent(n: number): string {
  const whole = Math.round(n);
  return `${whole < 0 ? `−${-whole}` : whole}%`;
}

/** "about OMR 56" → ["about OMR", "56"]: the words are set small before the number. */
function splitFigure(text: string): [string, string] {
  const m = /^(.*?)\s*([-−]?\d[\d,.]*)$/.exec(text.trim());
  return m ? [m[1], m[2]] : ["", text];
}

/** Only the Now card holds a filled button. */
const outlined = (button: ActionButton): ActionButton => (button.variant === "primary" ? { ...button, variant: "secondary" } : button);

/** Brings the Prices card into view and moves the keyboard there. */
function showPrices() {
  const prices = document.getElementById("prices");
  if (!prices) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  prices.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  if (!prices.hasAttribute("tabindex")) prices.setAttribute("tabindex", "-1");
  prices.focus({ preventScroll: true });
}

/** A dash for a value that is not there, said in words to screen readers. */
function Dash({ className, means }: { className: string; means: string }) {
  return (
    <dd className={`mt-1 text-ink-muted ${className}`}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{means}</span>
    </dd>
  );
}

/** A cell while the e-mails load. */
function Waiting({ label, className }: { label: string; className: string }) {
  return (
    <dl className={className}>
      <dt className={LABEL}>{label}</dt>
      <Dash className="text-title opacity-60" means="Loading" />
    </dl>
  );
}

function MoveCell({ move, actions, loading, error, onRetry }: Pick<GlanceBandProps, "move" | "actions" | "loading" | "error" | "onRetry">) {
  const shell = `${CELL} order-1 col-span-2 sm:col-span-1 lg:order-none`;
  if (loading) return <Waiting label="Whose move" className={shell} />;
  if (error) {
    return (
      <dl className={shell}>
        <dt className={LABEL}>Whose move</dt>
        <dd className="mt-1 flex items-start gap-2 text-title font-semibold text-lost">
          <Icon name="alert" className="mt-1 size-4" />
          The e-mails could not be read
        </dd>
        <dd className="mt-1 break-words text-meta text-ink-muted">{errorMessage(error)}</dd>
        {onRetry && (
          <dd className="mt-2">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <Icon name="refresh" className="size-3.5" />
              Try again
            </Button>
          </dd>
        )}
      </dl>
    );
  }
  const plain = move.tone === "neutral";
  return (
    <dl className={`${shell} ${move.proof ? CLICKABLE : ""}`}>
      <dt className={LABEL}>Whose move</dt>
      <dd className={`mt-1 flex items-start gap-2 text-title font-semibold ${plain ? "text-ink" : TONE_TEXT[move.tone]}`}>
        <Icon name={move.icon} className={`mt-1 size-4 ${plain ? "text-ink-muted" : ""}`} />
        <ProofLink proof={move.proof} actions={actions} className={`min-w-0 break-words ${move.proof ? COVER : ""}`}>
          {move.word}
        </ProofLink>
      </dd>
      {move.why.map((line, i) => (
        <dd key={i} className="mt-1 break-words text-body text-ink-heading">
          {line}
        </dd>
      ))}
      {move.clock && <dd className="mt-1 text-meta tabular-nums text-ink-muted">{move.clock}</dd>}
    </dl>
  );
}

/** The cell's figure, as the button that brings the Prices card into view. */
function PricesButton({ currency, amount, note, title }: { currency: string; amount: string; note?: string; title?: string }) {
  return (
    <button type="button" title={title} onClick={showPrices} className={`flex flex-wrap items-baseline gap-x-1.5 rounded-[3px] text-left ${COVER}`}>
      <span className="text-meta font-medium text-ink-muted">{currency}</span>{" "}
      <span className="text-dial font-semibold text-ink">{amount}</span>{" "}
      {note && <span className="text-meta text-ink-muted">{note}</span>}
      <span className="sr-only">: show the prices</span>
    </button>
  );
}

function OfferCell({ offer, row, actions, loading, error }: Pick<GlanceBandProps, "offer" | "row" | "actions" | "loading" | "error">) {
  const shell = `${CELL} order-3 lg:order-none`;
  if (loading) return <Waiting label="Offer" className={shell} />;
  if (offer) {
    const stamp = offer.final ? "final" : offer.revised ? "revised" : null;
    const validity = offer.validUntil ? `valid until ${dayOf(offer.validUntil)}` : offer.validityStated ? null : "no validity stated";
    // A total that is not for the whole shipment is never the headline: the main line's rate is, with its unit. The
    // brief's own figure, so this cell and its sentences ("We sent …") show the same one.
    const figure = offerFigureOf(offer);
    const headline = {
      currency: figure.currency,
      amount: `${figures(figure.amount)}${figure.unit ?? ""}`,
      note: figure.dependsOn ? `total depends on ${figure.dependsOn}` : undefined,
    };
    return (
      <dl className={`${shell} ${CLICKABLE}`}>
        <dt className={LABEL}>Offer</dt>
        <dd className="mt-1">
          <PricesButton currency={headline.currency} amount={headline.amount} note={headline.note} title={proofTitle(offer.proof)} />
        </dd>
        {offer.linesText && <dd className="mt-0.5 break-words text-meta text-ink-heading">{offer.linesText}</dd>}
        <dd className={`mt-0.5 ${PARTS}`}>
          {stamp && <span>{stamp} ·</span>}
          <span>
            <ProofLink proof={offer.proof} actions={actions} className={ABOVE}>
              {offer.proof.when}
            </ProofLink>
            {validity && " ·"}
          </span>
          {validity && <span className={offer.validUntil ? "" : "text-ink-muted"}>{validity}</span>}
        </dd>
        {offer.options.length > 1 && (
          <dd className={`mt-0.5 ${PARTS}`}>
            <span>Options:</span>
            {offer.options.map((option, i) => (
              <span key={`${option.label}-${i}`}>
                <ProofLink proof={option.proof} actions={actions} className={`${ABOVE} ${option.current ? "font-medium text-ink" : ""}`}>
                  {option.label} {optionFigure(option)}
                </ProofLink>
                {i < offer.options.length - 1 && " ·"}
              </span>
            ))}
          </dd>
        )}
      </dl>
    );
  }
  if (row.sell_total != null) {
    return (
      <dl className={`${shell} ${CLICKABLE}`}>
        <dt className={LABEL}>Offer</dt>
        <dd className="mt-1">
          <PricesButton currency={row.currency.trim()} amount={fmtMoney(row.sell_total)} note="(register)" />
        </dd>
      </dl>
    );
  }
  return (
    <dl className={shell}>
      <dt className={LABEL}>Offer</dt>
      {error ? (
        <>
          <Dash className="text-dial" means="No figure" />
          <dd className="mt-0.5 text-meta text-ink-muted">No sell amount in the register.</dd>
        </>
      ) : (
        <>
          <dd className="mt-1 text-title font-semibold text-ink-muted">No offer on file</dd>
          <dd className="mt-0.5 text-meta text-ink-muted">Nothing with a price went to the customer from this mailbox.</dd>
        </>
      )}
    </dl>
  );
}

/** "Buy 610 on a sell of 7,000 looks like a slip" → "Register: buy 610 on a sell of 7,000 looks like a slip". */
function registerLine(text: string): string {
  return /^register\b/i.test(text) ? text : `Register: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function MarginCell({ margin, registerMoney, actions, loading }: Pick<GlanceBandProps, "margin" | "registerMoney" | "actions" | "loading">) {
  const shell = `${CELL} order-4 lg:order-none`;
  if (loading) return <Waiting label="Margin" className={shell} />;
  const { clash, figure } = margin;
  const [words, number] = figure ? splitFigure(figure.text) : ["", ""];
  return (
    <dl className={shell}>
      <dt className={LABEL}>Margin</dt>
      {clash ? (
        <>
          <dd className="mt-1 flex items-start gap-2 text-title font-semibold text-lost">
            <Icon name="alert" className="mt-1 size-4" />
            Check the currency
          </dd>
          <dd className="mt-1 break-words text-meta text-ink-heading">{clash.text}</dd>
          <dd className="mt-0.5 flex flex-wrap gap-x-3 text-meta tabular-nums text-ink-heading">
            {clash.proofs.map((proof, i) => (
              <ProofLink key={i} proof={proof} actions={actions}>
                {clash.currencies[i]} · {proof.when}
              </ProofLink>
            ))}
          </dd>
        </>
      ) : figure ? (
        <>
          <dd className={`mt-1 flex flex-wrap items-baseline gap-x-1.5 ${figure.negative ? "text-lost" : "text-ink"}`}>
            {words && <span className={`text-meta font-medium ${figure.negative ? "" : "text-ink-muted"}`}>{words}</span>}{" "}
            <span className="text-dial font-semibold">{number}</span>
          </dd>
          <dd className="mt-0.5 text-meta text-ink-heading">
            {percent(figure.pct)} of the {margin.source === "register" ? "sell" : "offer"}
          </dd>
          {margin.inputs && <dd className="mt-0.5 break-words text-meta text-ink-muted">{margin.inputs}</dd>}
        </>
      ) : (
        <>
          <Dash className="text-dial" means="No figure" />
          {margin.why && <dd className="mt-0.5 break-words text-meta text-ink-muted">{margin.why}</dd>}
        </>
      )}
      {margin.notes.length > 0 && <dd className="mt-0.5 break-words text-meta text-ink-muted">{margin.notes.join(" · ")}</dd>}
      {registerMoney.slip && (
        <dd className="mt-1 flex items-start gap-1.5 text-meta font-medium text-await">
          <Icon name="alert" className="mt-0.5 size-3.5" />
          <span className="min-w-0 break-words">{registerLine(registerMoney.slip.text)}</span>
        </dd>
      )}
    </dl>
  );
}

/** One line of the needs-you list: its number or a check, what it is, how long it has waited, and its button. */
function NeedLine({ item, number, actions }: { item: NeedItem; number: number; actions: PageActions }) {
  const button = item.done ? null : item.button;
  const pad = button ? "py-1.5" : "py-0.5";
  const late = item.tone === "warn" || item.tone === "bad";
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]">
      {item.done ? (
        <Icon name="check" className="mt-1 size-4 text-confirmed" />
      ) : (
        <span className={`${pad} text-body tabular-nums text-ink-muted`}>{number}</span>
      )}
      {item.done ? (
        <span className="py-0.5 break-words text-body text-ink-muted" title={item.proof ? proofTitle(item.proof) : undefined}>
          <span className="sr-only">Done: </span>
          <s>{item.text}</s>
        </span>
      ) : (
        <span className={`${pad} flex min-w-0 flex-wrap items-baseline gap-x-2 break-words text-body text-ink`}>
          <ProofLink proof={item.proof} actions={actions} className="min-w-0">
            {item.text}
          </ProofLink>{" "}
          {item.age && (
            <span className={`inline-flex items-center gap-1 whitespace-nowrap text-meta tabular-nums ${late ? `font-medium ${TONE_TEXT[item.tone]}` : "text-ink-muted"}`}>
              {late && <Icon name="clock" className="size-3.5" />}
              {item.age.label}
            </span>
          )}
        </span>
      )}
      {button && (
        <span className="col-start-2 sm:col-start-3">
          <ActionBtn button={outlined(button)} actions={actions} size="sm" />
        </span>
      )}
    </li>
  );
}

/** The band's footer: what else waits on the reader, open items first, done ones struck. */
function NeedsYou({
  items,
  move,
  row,
  actions,
  loading,
  failed,
}: {
  items: NeedItem[];
  move: Move;
  row: EnquiryRow;
  actions: PageActions;
  loading: boolean;
  /** The e-mails could not be read, so an empty list proves nothing. */
  failed: boolean;
}) {
  const [all, setAll] = useState(false);
  const shell = "grid gap-x-4 gap-y-1 border-t border-line px-4 py-3 lg:grid-cols-[7rem_minmax(0,1fr)]";
  if (loading) {
    return (
      <div className={shell}>
        <div className={LABEL}>Needs you</div>
        <p role="status" className="flex items-center gap-2 text-meta text-ink-muted">
          <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
          Reading the e-mails…
        </p>
      </div>
    );
  }
  const open = items.filter((i) => !i.done);
  const ordered = [...open, ...items.filter((i) => i.done)];
  if (!ordered.length) {
    if (move.kind === "closed") return null;
    const ours = OURS.has(move.kind) || (move.kind === "no_mail" && row.status === "new");
    return (
      <div className={shell}>
        <div className={LABEL}>Needs you</div>
        <p className="text-meta text-ink-muted">
          {failed ? "Not known until the e-mails can be read." : ours ? "Nothing else waits on you." : "Nothing waits on you."}
        </p>
      </div>
    );
  }
  const more = ordered.length - SHOWN;
  // The label sits on the first line's text, which starts lower when that line has a button.
  const firstHasButton = !ordered[0].done && !!ordered[0].button;
  return (
    <div className={shell}>
      <div className={`${LABEL} ${firstHasButton ? "lg:pt-1.5" : "lg:pt-0.5"}`}>
        Needs you{open.length > 0 && <span className="tabular-nums"> ({open.length})</span>}
      </div>
      <div className="min-w-0">
        <ol role="list" aria-label="Needs you" className="space-y-1">
          {(all ? ordered : ordered.slice(0, SHOWN)).map((item) => (
            <NeedLine key={item.id} item={item} number={open.indexOf(item) + 1} actions={actions} />
          ))}
        </ol>
        {more > 0 && (
          <Button variant="ghost" size="sm" className="mt-1 -ml-2.5" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show ${more} more`}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface GlanceBandProps {
  move: Move;
  offer: Offer | null;
  margin: Margin;
  registerMoney: RegisterMoney;
  /** The register's sell amount stands in for the offer when none is on file. */
  row: EnquiryRow;
  needsYou: NeedItem[];
  /** The Now card. */
  now: ReactNode;
  actions: PageActions;
  /** The e-mails are still loading. */
  loading: boolean;
  /** Set when the e-mails could not be loaded. */
  error: unknown;
  onRetry?: () => void;
}

/**
 * The enquiry at a glance: whose move it is, what was offered, what is left of it, and the one thing to do now, with
 * whatever else waits on the reader underneath.
 */
export function GlanceBand({ move, offer, margin, registerMoney, row, needsYou, now, actions, loading, error, onRetry }: GlanceBandProps) {
  return (
    <section id="glance" aria-label="At a glance" aria-busy={loading || undefined} className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <MoveCell move={move} actions={actions} loading={loading} error={error} onRetry={onRetry} />
        <OfferCell offer={offer} row={row} actions={actions} loading={loading} error={error} />
        <MarginCell margin={margin} registerMoney={registerMoney} actions={actions} loading={loading} />
        <div className="order-2 col-span-2 grid min-w-0 bg-surface sm:col-span-1 lg:order-none">
          {loading ? (
            <div className="px-4 py-3">
              <p className="text-meta font-semibold text-ink-muted">Now</p>
              <p className="mt-1 text-title text-ink-muted opacity-60">
                <span aria-hidden="true">—</span>
                <span className="sr-only">Loading</span>
              </p>
            </div>
          ) : (
            now
          )}
        </div>
      </div>
      <NeedsYou items={needsYou} move={move} row={row} actions={actions} loading={loading} failed={!!error} />
    </section>
  );
}
