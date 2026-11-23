import { Icon } from "../../components/icons";
import { displayName } from "../../lib/display";
import { muscatDate } from "../../lib/emailDrafts";
import type { Handler, Journey, TruthTag as TruthTagData } from "../../lib/enquiryBrief";
import { dayWithWeekday } from "../../lib/enquiryDetails";
import { todayIso } from "../../lib/format";
import { proofTitle } from "./shared";

// What the enquiry's header adds from the e-mails: where they contradict the register, how far the shipment is,
// and who on our side writes.

/** A small tag that is a button: the height of the status badge, with a taller area to press. */
const TAG =
  "relative inline-flex max-w-full items-start gap-1 rounded-panel px-2 py-0.5 text-left text-meta font-medium ring-1 ring-inset transition-colors duration-150 after:absolute after:inset-x-0 after:-inset-y-1";

/** Brings a part of the page into view and moves the keyboard to it. */
function goTo(target: HTMLElement | null | undefined) {
  if (!target) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  const options: FocusOptions & { focusVisible?: boolean } = { preventScroll: true, focusVisible: true };
  target.focus(options);
}

/** Moves the keyboard to the Now card's button; to the card itself when the reader has no button there. */
export function goToNow() {
  goTo(document.getElementById("now-primary") ?? document.getElementById("now-title")?.closest("section") ?? document.getElementById("glance"));
}

/** Brings the shipment's steps into view. */
export function goToShipmentTrack() {
  goTo(document.getElementById("shipment-track"));
}

/** Where the e-mails say more than the register does ("E-mails say: won Thu 05 Nov"). It leads to the Now card. */
export function TruthTag({ truth, onGo = goToNow }: { truth: TruthTagData | null; onGo?: () => void }) {
  if (!truth) return null;
  return (
    <button type="button" title={proofTitle(truth.proof)} onClick={onGo} className={`${TAG} bg-await-bg text-await ring-await/30 hover:ring-await/70`}>
      <Icon name="alert" className="mt-0.5 size-3.5" />
      <span className="min-w-0 break-words">
        {truth.text}
        <span className="sr-only"> (go to what to do now)</span>
      </span>
    </button>
  );
}

/** The furthest step of the shipment an e-mail shows, and what the latest e-mail is about. It leads to the steps. */
export function JourneyChip({ journey, onGo = goToShipmentTrack }: { journey: Journey | null; onGo?: () => void }) {
  if (!journey?.chip || !journey.reached) return null;
  const proof = journey.nodes.find((node) => node.key === journey.reached)?.proof;
  return (
    <button
      type="button"
      title={proof ? proofTitle(proof) : undefined}
      onClick={onGo}
      className={`${TAG} bg-party-agent-bg tabular-nums text-party-agent ring-party-agent/25 hover:ring-party-agent/60`}
    >
      <Icon name="ship" className="mt-0.5 size-3.5" />
      <span className="min-w-0 break-words">
        {journey.chip}
        <span className="sr-only"> (show the shipment's steps)</span>
      </span>
    </button>
  );
}

/** A day as the brief gives it (a date, a timestamp, or words already) → "Sat 07 Nov", on the Oman calendar. */
function dayText(value: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const timed = value.length > 10 && !Number.isNaN(Date.parse(value));
  return dayWithWeekday(timed ? muscatDate(value) : value, today);
}

/** "Wed 04 – Thu 05 Nov", or the one day when both are the same. */
function daySpan(from: string, to: string, today: string): string {
  const first = dayText(from, today);
  const last = dayText(to, today);
  if (first === last) return first;
  const parts = /^(\w{3} \d{2}) (.+)$/.exec(first);
  return parts && last.endsWith(` ${parts[2]}`) ? `${parts[1]} – ${last}` : `${first} – ${last}`;
}

/** Who on our side writes on this enquiry, since when, and whether the sales person is on the e-mails. */
export function HandlerLine({
  handler,
  hasMail,
  today = todayIso(),
}: {
  handler: Handler | null;
  /** Any e-mail is filed to the enquiry. */
  hasMail: boolean;
  today?: string;
}) {
  if (!handler) return hasMail ? <p className="text-meta text-ink-muted">Nobody from our side has written yet</p> : null;
  const before = handler.previous.length ? `Before: ${handler.previous.map((p) => `${p.name}, ${daySpan(p.from, p.to, today)}`).join("; ")}` : null;
  const sales = handler.salesPerson && !handler.salesPerson.onThread ? displayName(handler.salesPerson.name).split(" ")[0] : "";
  const greets = handler.customerGreets?.trim();
  const more = [sales && `${sales} not on the e-mails`, greets && `The customer writes to ${greets}`].filter((part): part is string => !!part);
  return (
    <p className="flex min-w-0 flex-wrap gap-x-1 text-meta text-ink-muted">
      <span className="min-w-0 break-words" title={before ?? undefined}>
        Handled by <span className="font-medium text-ink-heading">{handler.name}</span>
        {handler.role && ` (${handler.role})`}
        {handler.since && <span className="tabular-nums">{` since ${dayText(handler.since, today)}`}</span>}
        {before && <span className="sr-only">{`. ${before}`}</span>}
        {more.length > 0 && " · "}
      </span>
      {more.map((part, i) => (
        <span key={part} className="min-w-0 break-words">
          {i < more.length - 1 ? `${part} · ` : part}
        </span>
      ))}
    </p>
  );
}
