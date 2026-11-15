import { PriceCheckerNote } from "../../components/PriceChecker";
import type { ActionButton, NowAction, Proof, Tone } from "../../lib/enquiryBrief";
import type { EnquiryRow, PriceChecker } from "../../lib/types";
import { ActionBtn, ProofLink, TONE_TEXT, type PageActions } from "./shared";

/** The card in each tone: its ground, the 3 px edge on top, the kicker's colour and the rule beside a quoted sentence. */
const TONES: Record<Tone, { ground: string; edge: string; label: string; quote: string }> = {
  neutral: { ground: "bg-table-head", edge: "shadow-[inset_0_3px_0_var(--color-control)]", label: "text-ink-muted", quote: "border-control" },
  primary: { ground: "bg-selected", edge: "shadow-[inset_0_3px_0_var(--color-primary)]", label: "text-primary-hover", quote: "border-primary/50" },
  good: { ground: "bg-confirmed-bg", edge: "shadow-[inset_0_3px_0_var(--color-confirmed-dot)]", label: "text-confirmed", quote: "border-confirmed/50" },
  warn: { ground: "bg-await-bg", edge: "shadow-[inset_0_3px_0_var(--color-await-dot)]", label: "text-await", quote: "border-await/50" },
  bad: { ground: "bg-lost-bg", edge: "shadow-[inset_0_3px_0_var(--color-lost-dot)]", label: "text-lost", quote: "border-lost/50" },
  flag: { ground: "bg-not-genuine-bg", edge: "shadow-[inset_0_3px_0_var(--color-not-genuine-dot)]", label: "text-not-genuine", quote: "border-not-genuine/50" },
  info: { ground: "bg-lane-mail-bg", edge: "shadow-[inset_0_3px_0_var(--color-lane-mail)]", label: "text-lane-mail", quote: "border-lane-mail/50" },
};

/** What someone wrote, quoted with who and when; the caption opens the e-mail it was read from. */
function Said({ tone, said, actions }: { tone: Tone; said: NonNullable<NowAction["said"]>; actions: PageActions }) {
  const proof: Proof = { emailId: said.emailId, who: said.who, when: said.when, sentence: said.text };
  return (
    <figure className={`mt-2 border-l-[3px] pl-3 ${TONES[tone].quote}`}>
      <blockquote className="break-words text-body text-ink">“{said.text}”</blockquote>
      <figcaption className="mt-0.5 text-meta tabular-nums text-ink-muted">
        <ProofLink proof={proof} actions={actions}>
          {said.who} · {said.when}
        </ProofLink>
      </figcaption>
    </figure>
  );
}

/** The page has one filled button: a second primary in the list is drawn as an outline. */
const outlined = (button: ActionButton): ActionButton => (button.variant === "primary" ? { ...button, variant: "secondary" } : button);

/**
 * The one thing to do now on this enquiry, and the button for it. It fills the Now cell of the glance band: tinted
 * in its tone, with the tone's edge on top.
 */
export function NowCard({
  now,
  checker,
  row,
  actions,
}: {
  now: NowAction;
  /** Set when the customer is a price checker (src/lib/priceCheckers.ts): said before anyone works on rates. */
  checker?: PriceChecker;
  row: EnquiryRow;
  actions: PageActions;
}) {
  const tone = TONES[now.tone];
  const primaryAt = now.buttons.findIndex((b) => b.variant === "primary");
  return (
    <section aria-labelledby="now-title" className={`min-w-0 px-4 py-3 ${tone.ground} ${tone.edge}`}>
      <p className={`text-meta font-semibold ${tone.label}`}>Now</p>
      <h2 id="now-title" className="mt-1 break-words text-title font-semibold text-ink">
        {now.title}
      </h2>
      {now.said && <Said tone={now.tone} said={now.said} actions={actions} />}
      {now.lines.length > 0 && (
        <ul className="mt-2 space-y-1 text-body">
          {now.lines.map((line, i) => (
            <li key={i} className={`break-words ${line.tone ? `font-medium ${TONE_TEXT[line.tone]}` : "text-ink-heading"}`}>
              {line.text}
            </li>
          ))}
        </ul>
      )}
      {checker && row.status === "new" && (
        <PriceCheckerNote info={checker} className="mt-2.5">
          Worth asking for the cargo-ready date and commodity before working on rates.
        </PriceCheckerNote>
      )}
      {now.buttons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {now.buttons.map((button, i) =>
            i === primaryAt ? (
              <ActionBtn key={`${button.id}-${i}`} button={button} actions={actions} id="now-primary" full />
            ) : (
              <ActionBtn key={`${button.id}-${i}`} button={outlined(button)} actions={actions} />
            ),
          )}
        </div>
      )}
      {now.checkLine && <p className="mt-2 text-meta text-ink-muted">{now.checkLine}</p>}
    </section>
  );
}
