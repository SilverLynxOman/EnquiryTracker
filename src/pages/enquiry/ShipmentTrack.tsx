import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import { muscatDate } from "../../lib/emailDrafts";
import type { Journey, Milestone, MilestoneKey, SubStep } from "../../lib/enquiryBrief";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import { ProofLink, TONE_BOX, TONE_TEXT, type PageActions } from "./shared";

type StepState = Milestone["state"];

/** Sub-steps shown for one step. */
const SUB_STEPS = 3;

/** What a screen reader hears after a step's name. */
const STATE_TEXT: Record<StepState, string> = {
  proven: ", done",
  current: ", the latest e-mail is about this step",
  unmarked: ", no e-mail marks this step",
  todo: ", not yet",
  void: ", cancelled or changed",
};

/** What a step says under its name when the brief gives it no note of its own. */
const STATE_NOTE: Partial<Record<StepState, string>> = {
  unmarked: "No e-mail marks this step",
  void: "Cancelled or changed",
};

/** What the tooltip of a step says when no e-mail shows it. */
const STATE_TIP: Record<StepState, string> = {
  proven: "An e-mail shows this step.",
  current: "The latest e-mail is about this step. None shows it done yet.",
  unmarked: "No e-mail marks this step. A later step is shown by one.",
  todo: "No e-mail shows this step yet.",
  void: "Cancelled or changed.",
};

const LABEL_TEXT: Record<StepState, string> = {
  proven: "text-ink",
  current: "text-party-agent",
  unmarked: "text-ink-heading",
  todo: "text-ink-muted",
  void: "text-ink-muted",
};

/** The box of a step's tooltip: it floats over the page, so it has a shadow, as menus do. */
const TIP_BOX = "block rounded-control border border-line bg-surface px-2.5 py-1.5 text-meta text-ink-heading shadow-[0_8px_24px_rgba(25,36,59,0.14)]";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A day as the brief gives it (a date or a timestamp) → "Mon 09 Nov" on the Oman calendar; words stay as written. */
function dayText(value: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const timed = value.length > 10 && !Number.isNaN(Date.parse(value));
  return dayWithWeekday(timed ? muscatDate(value) : value, today);
}

/** Whether pressing a step can show anything: an e-mail mentions it or shows it. */
const hasMail = (node: Milestone) => node.emailIds.length > 0 || !!node.proof;

/**
 * The steps a phone shows first: the one the latest e-mail is about, unless an e-mail already shows a later one (then
 * that furthest one), and the one after it. The steps before fold into one line and the steps after wait behind "Show all steps". An index is -1
 * when there is no such step.
 */
export function trackFocus(journey: Journey): { focus: number; next: number } {
  const at = (key: MilestoneKey | null) => (key ? journey.nodes.findIndex((n) => n.key === key) : -1);
  const reached = at(journey.reached);
  const discussed = at(journey.nowDiscussing);
  const focus = discussed >= 0 && discussed >= reached ? discussed : reached >= 0 ? reached : journey.nodes.findIndex((n) => n.state === "current");
  const next = Math.max(focus, reached) + 1;
  return { focus, next: next < journey.nodes.length ? next : -1 };
}

/**
 * Where a key moves the keyboard among `count` steps, from the step at `at`: the arrows one step (up and down too
 * where the steps run downwards), Home and End to the ends. Null for any other key, or when there are no steps.
 */
export function stepAfterKey(key: string, at: number, count: number, vertical: boolean): number | null {
  if (count < 1) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || (vertical && key === "ArrowDown")) return Math.min(count - 1, at + 1);
  if (key === "ArrowLeft" || (vertical && key === "ArrowUp")) return Math.max(0, at - 1);
  return null;
}

function Marker({ state, discussed }: { state: StepState; discussed: boolean }) {
  if (state === "proven") {
    return (
      <span
        aria-hidden="true"
        className={`flex size-5 shrink-0 items-center justify-center rounded-full bg-party-agent text-white ${discussed ? "ring-[3px] ring-party-agent/25" : ""}`}
      >
        <Icon name="check" className="size-3" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border-[3px] border-party-agent bg-surface">
        <span className="size-1.5 rounded-full bg-party-agent" />
      </span>
    );
  }
  if (state === "unmarked") return <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-party-agent bg-surface" />;
  if (state === "void") return <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-line bg-table-head" />;
  return <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-line bg-surface" />;
}

/** A smaller thing the e-mails show around a step ("SO requested Thu 10:10 · chased 6×"): it opens its e-mail. */
function SubStepChip({ step, actions }: { step: SubStep; actions: PageActions }) {
  const late = step.tone === "warn" || step.tone === "bad";
  return (
    <span className={`inline-flex max-w-full items-start gap-1 rounded-panel border px-2 py-0.5 text-meta tabular-nums ${TONE_BOX[step.tone]} ${TONE_TEXT[step.tone]}`}>
      {late && <Icon name="alert" className="mt-0.5 size-3.5" />}
      {step.tone === "good" && <Icon name="check" className="mt-0.5 size-3.5" />}
      <ProofLink proof={step.proof} actions={actions} className="min-w-0 break-words">
        {step.label}
      </ProofLink>
    </span>
  );
}

/** What a step's tooltip says: the e-mail that shows it, or why none does, and what pressing the step does. */
function StepTip({ node, pressable, pressed }: { node: Milestone; pressable: boolean; pressed: boolean }) {
  const { proof } = node;
  const hint = !pressable
    ? null
    : pressed
      ? "Press again, or Escape, to show every e-mail."
      : node.emailIds.length
        ? `Press to show only the ${plural(node.emailIds.length, "e-mail")} about it.`
        : "Press to show only the e-mails about it.";
  return (
    <span className={TIP_BOX}>
      {proof ? (
        <>
          <span className="block font-medium tabular-nums text-ink">
            {proof.who} · {proof.when}
          </span>
          {proof.sentence && <span className="block break-words">“{proof.sentence}”</span>}
          {proof.file && (
            <span className="flex items-start gap-1 text-ink-muted">
              <Icon name="paperclip" className="mt-0.5 size-3.5" />
              <span className="min-w-0 break-all">{proof.file}</span>
            </span>
          )}
        </>
      ) : (
        <span className="block">{STATE_TIP[node.state]}</span>
      )}
      {hint && <span className="mt-1 block text-ink-muted">{hint}</span>}
    </span>
  );
}

export interface ShipmentTrackProps {
  journey: Journey;
  today: string;
  actions: PageActions;
  /** The step the conversation is filtered to. */
  selected: MilestoneKey | null;
  /** Filters the conversation to the e-mails about a step; null shows them all again. */
  onSelect: (key: MilestoneKey | null) => void;
  /** The enquiry's reference and confirmation day, for the line shown while no e-mail is about the shipment. */
  reference?: string;
  confirmedDate?: string | null;
}

/**
 * The shipment's steps for its mode, each with its day and the e-mail that shows it. A step is done only when an
 * e-mail from outside or a file says so. Pressing a step filters the conversation to the e-mails about it. From 640 px
 * the steps run across; on a phone they run down, with the steps before the current one folded into one line.
 */
export function ShipmentTrack({ journey, today, actions, selected, onSelect, reference, confirmedDate }: ShipmentTrackProps) {
  const { nodes } = journey;
  const root = useRef<HTMLDivElement>(null);
  const filterNote = useRef<HTMLDivElement>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [active, setActive] = useState<MilestoneKey | null>(null);
  const [quiet, setQuiet] = useState(false);

  // Escape puts an open tooltip away wherever the keyboard is, until the pointer or the keyboard moves to a step again.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setQuiet(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const cancelled = journey.cancelled && (
    <p className="flex items-start gap-1.5 text-meta text-ink-heading">
      <Icon name="ban" className="mt-0.5 size-3.5 text-cancelled" />
      <span className="min-w-0 break-words">
        <span className="font-medium">Cancelled or changed</span>
        {" · "}
        <ProofLink proof={journey.cancelled} actions={actions}>
          {journey.cancelled.sentence ? `“${journey.cancelled.sentence}” · ` : ""}
          {journey.cancelled.who}, {journey.cancelled.when}
        </ProofLink>
      </span>
    </p>
  );

  const shell = "grid scroll-mt-16 gap-x-4 gap-y-2 xl:grid-cols-[4.5rem_minmax(0,1fr)]";
  const empty = nodes.every((n) => n.state === "todo");
  const heading = (
    // Beside the steps the name sits level with the first marker.
    <h3 id="shipment-track-label" className={`text-meta font-medium text-ink-muted ${empty || cancelled ? "" : "xl:pt-1.5"}`}>
      Shipment
    </h3>
  );

  if (empty) {
    const nothing = confirmedDate ? "Nothing after the confirmation is on file yet" : "Nothing about the shipment is on file yet";
    return (
      <div id="shipment-track" role="group" aria-labelledby="shipment-track-label" className={shell}>
        {heading}
        <div className="min-w-0 space-y-1">
          {cancelled}
          <p className="break-words text-meta text-ink-muted">
            {confirmedDate && <span className="tabular-nums">Confirmed {dayText(confirmedDate, today)}. </span>}
            {nothing}
            {reference ? ` — mail with ${reference} in the subject will fill this in.` : "."}
          </p>
        </div>
      </div>
    );
  }

  const { focus, next } = trackFocus(journey);
  // The latest e-mail's step is marked only when no later step is shown yet: talk about the booking after the SO
  // is out is not where the shipment stands.
  const reachedAt = journey.reached ? nodes.findIndex((n) => n.key === journey.reached) : -1;
  const chosen = nodes.find((n) => n.key === selected) ?? null;
  // On a phone the steps before the next one fold away, except the one in focus; the steps after it wait.
  const isEarlier = (i: number) => i !== focus && (next < 0 || i < next);
  const isLater = (i: number) => next >= 0 && i > next;
  const earlier = nodes.filter((_, i) => isEarlier(i));
  const later = nodes.filter((_, i) => isLater(i));
  const allOpen = (showEarlier || !earlier.length) && (showLater || !later.length);

  const proven = nodes.filter((n) => n.state === "proven");
  const summary = proven.length
    ? `${plural(proven.length, "step")} done · ${proven[0].label}${proven.length > 1 ? ` → ${proven[proven.length - 1].label}` : ""}`
    : plural(earlier.length, "earlier step");

  // One step is in the tab order: the pressed one, else the one last moved to, else the one in focus.
  const tabStop = chosen?.key ?? (nodes.some((n) => n.key === active) ? active : nodes[Math.max(focus, 0)].key);
  const around = [nodes[focus - 1], nodes[focus]].filter((n): n is Milestone => !!n && n.subSteps.length > 0);

  /** Shows every e-mail again. The line that says what is shown goes away, so a keyboard on it returns to its step. */
  function clear() {
    if (!selected) return;
    const leaving = !!filterNote.current?.contains(document.activeElement);
    const step = root.current?.querySelector<HTMLButtonElement>(`button[data-step="${selected}"]`);
    onSelect(null);
    if (leaving) step?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLOListElement>) {
    // Only the steps on screen: a phone folds some away.
    const steps = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-step]")].filter((b) => b.offsetParent !== null);
    const vertical = steps.length > 1 && Math.round(steps[0].getBoundingClientRect().left) === Math.round(steps[1].getBoundingClientRect().left);
    const to = stepAfterKey(event.key, steps.findIndex((b) => b === document.activeElement), steps.length, vertical);
    if (to == null) return;
    event.preventDefault();
    steps[to].focus();
  }

  return (
    <div
      id="shipment-track"
      ref={root}
      role="group"
      aria-labelledby="shipment-track-label"
      className={shell}
      onKeyDown={(event) => {
        if (event.key === "Escape") clear();
      }}
    >
      {heading}
      <div className="min-w-0">
        {cancelled && <div className="mb-2">{cancelled}</div>}

        {earlier.length > 0 && (
          <div className="mb-1 sm:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2.5 max-w-full"
              aria-expanded={showEarlier}
              onClick={() => {
                setShowEarlier(!showEarlier);
                setActive(null);
              }}
            >
              <Icon name={showEarlier ? "chevronDown" : "chevronRight"} className="size-3.5" />
              <span className="min-w-0 truncate">{summary}</span>
            </Button>
          </div>
        )}

        <ol
          role="list"
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            // Once the keyboard leaves the steps, the way back in is the pressed step or the one in focus.
            if (!event.currentTarget.contains(event.relatedTarget)) setActive(null);
          }}
          className="-mx-2 flex flex-col sm:grid sm:grid-cols-4 sm:gap-y-2 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none"
        >
          {nodes.map((node, i) => {
            const after = nodes[i + 1];
            const pressed = node.key === selected;
            const pressable = hasMail(node);
            const discussed = node.key === journey.nowDiscussing && i >= reachedAt;
            // A pressed step, or the one the keyboard is on, never folds away.
            const folded = !pressed && node.key !== active && ((isEarlier(i) && !showEarlier) || (isLater(i) && !showLater));
            const note = node.note.trim() || STATE_NOTE[node.state] || "";
            // The line to the next step is coloured once an e-mail shows that step or a later one.
            const line = !after ? null : after.state === "proven" || after.state === "unmarked" ? "bg-party-agent" : after.state === "current" ? "bg-party-agent/40" : "bg-line";
            const tipId = `shipment-step-${node.key}`;
            // The tooltip opens towards the middle of the row, so it never leaves the panel.
            const tipSide = `${i % 4 >= 2 ? "sm:max-lg:right-0 sm:max-lg:left-auto" : ""} ${i >= nodes.length / 2 ? "lg:right-0 lg:left-auto" : ""}`;
            return (
              <li key={node.key} onMouseEnter={() => setQuiet(false)} className={`group relative min-w-0 ${folded ? "max-sm:hidden" : ""}`}>
                <button
                  type="button"
                  data-step={node.key}
                  aria-pressed={pressed}
                  aria-disabled={pressable ? undefined : true}
                  aria-describedby={tipId}
                  tabIndex={node.key === tabStop ? 0 : -1}
                  onFocus={() => {
                    setActive(node.key);
                    setQuiet(false);
                  }}
                  onClick={() => pressable && onSelect(pressed ? null : node.key)}
                  // A flex box at every width: a button laid out as a block centres what it holds, and the markers must stay level.
                  className={`flex h-full w-full gap-3 rounded-control px-2 pt-1.5 text-left transition-colors duration-150 sm:flex-col sm:gap-0 sm:pb-1.5 ${
                    pressed ? "bg-selected ring-1 ring-inset ring-primary/40" : pressable ? "hover:bg-row-hover" : "cursor-default"
                  }`}
                >
                  <span className="flex flex-col items-center sm:flex-row">
                    <Marker state={node.state} discussed={discussed} />
                    {line && <span aria-hidden="true" className={`my-1 min-h-2 w-0.5 flex-1 sm:my-0 sm:-mr-2 sm:ml-2 sm:h-0.5 sm:min-h-0 sm:w-auto ${line}`} />}
                  </span>
                  <span className="block min-w-0 flex-1 pb-3 sm:mt-1.5 sm:flex-none sm:pb-0">
                    <span className="flex flex-wrap items-baseline gap-x-2 sm:block">
                      <span className={`text-body font-semibold sm:block ${LABEL_TEXT[node.state]}`}>
                        {i === next && !showLater && <span className="font-normal sm:hidden">Next: </span>}
                        {node.label}
                        <span className="sr-only">
                          {STATE_TEXT[node.state]}
                          {discussed && node.state !== "current" && ", the latest e-mail is about this step"}
                        </span>
                      </span>{" "}
                      {node.date && <span className="text-meta tabular-nums text-ink-heading sm:block">{dayText(node.date, today)}</span>}
                    </span>
                    {note && <span className={`block break-words text-meta ${node.noteTone ? `font-medium ${TONE_TEXT[node.noteTone]}` : "text-ink-muted"}`}>{note}</span>}
                    {/* Running down there is room to say who wrote it; running across the tooltip does, and a screen reader hears the tooltip. */}
                    {node.proof && (
                      <span aria-hidden="true" className="block break-words text-meta tabular-nums text-ink-muted sm:hidden">
                        {node.proof.who} · {node.proof.when}
                      </span>
                    )}
                  </span>
                </button>
                {/* The tooltip floats over the row above, so it shows only where the steps run across. */}
                <div
                  id={tipId}
                  role="tooltip"
                  className={`absolute bottom-full left-0 z-20 hidden w-64 pb-1 ${tipSide} ${quiet ? "" : "sm:group-hover:block sm:group-has-[:focus-visible]:block"}`}
                >
                  <StepTip node={node} pressable={pressable} pressed={pressed} />
                </div>
              </li>
            );
          })}
        </ol>

        {later.length > 0 && (
          <div className="sm:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2.5"
              aria-expanded={allOpen}
              onClick={() => {
                setShowEarlier(!allOpen);
                setShowLater(!allOpen);
                setActive(null);
              }}
            >
              {allOpen ? "Show fewer steps" : "Show all steps"}
            </Button>
          </div>
        )}

        {around.length > 0 && (
          <ul role="list" aria-label="Around these steps" className="mt-2 space-y-1">
            {around.map((node) => (
              <li key={node.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-meta font-medium text-ink-muted">{node.label}</span>
                {node.subSteps.slice(0, SUB_STEPS).map((step, i) => (
                  <SubStepChip key={`${step.key}-${i}`} step={step} actions={actions} />
                ))}
              </li>
            ))}
          </ul>
        )}

        <div ref={filterNote} className={chosen ? "mt-2 space-y-1" : ""}>
          <div className={chosen ? "flex flex-wrap items-center gap-x-2 gap-y-1" : ""}>
            <p role="status" className="text-meta text-ink-heading">
              {chosen &&
                (chosen.emailIds.length
                  ? `The conversation shows only the ${plural(chosen.emailIds.length, "e-mail")} about ${chosen.label}.`
                  : `The conversation shows only the e-mails about ${chosen.label}.`)}
            </p>
            {chosen && (
              <Button variant="ghost" size="sm" className="max-sm:-ml-2.5" onClick={clear}>
                Show all e-mails
              </Button>
            )}
          </div>
          {chosen?.proof && (
            <p className="break-words text-meta text-ink-muted">
              <ProofLink proof={chosen.proof} actions={actions}>
                {chosen.proof.sentence ? `“${chosen.proof.sentence}” · ` : ""}
                {chosen.proof.who}, {chosen.proof.when}
                {chosen.proof.file ? ` · ${chosen.proof.file}` : ""}
              </ProofLink>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
