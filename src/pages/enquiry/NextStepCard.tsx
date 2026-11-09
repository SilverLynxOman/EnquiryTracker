import type { ReactNode } from "react";
import { Link } from "react-router";
import { shownName } from "../../components/EmailView";
import { Icon } from "../../components/icons";
import { Button, buttonClass } from "../../components/ui";
import { daysBetween, displayName } from "../../lib/display";
import { dayWithWeekday, whenSent, type CustomerStats, type EmailSuggestion } from "../../lib/enquiryDetails";
import { chasedLabel, latestFollowUps, STALE_DAYS } from "../../lib/followUps";
import { fmtDateTime, fmtMoney, fmtPercent } from "../../lib/format";
import { waitStatus } from "../../lib/quoteWindow";
import type { EnquiryRow, FollowUpRecord } from "../../lib/types";
import { quoteDeadline } from "../../lib/workdays";

type Tone = "neutral" | "primary" | "good" | "warn" | "bad" | "flag";

const TONES: Record<Tone, { box: string; label: string; quote: string }> = {
  neutral: { box: "border-line bg-table-head", label: "text-ink-muted", quote: "border-control" },
  primary: { box: "border-primary/25 bg-selected", label: "text-primary-hover", quote: "border-primary/50" },
  good: { box: "border-confirmed/25 bg-confirmed-bg", label: "text-confirmed", quote: "border-confirmed/50" },
  warn: { box: "border-await/25 bg-await-bg", label: "text-await", quote: "border-await/50" },
  bad: { box: "border-lost/25 bg-lost-bg", label: "text-lost", quote: "border-lost/50" },
  flag: { box: "border-not-genuine-line bg-not-genuine-bg", label: "text-not-genuine", quote: "border-not-genuine/50" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface NextStepProps {
  row: EnquiryRow;
  today: string;
  suggestion: EmailSuggestion | null;
  stats: CustomerStats | undefined;
  /** Follow-ups logged on this enquiry, by anyone. */
  chases: FollowUpRecord[];
  /** Sales person id → name. */
  names: Map<string, string>;
  /** The signed-in user's sales person: follow-ups are logged as them. */
  me: string | null;
  canEdit: boolean;
  editLink: string;
  quoting: boolean;
  chasing: boolean;
  reopening: boolean;
  /** Who marked it the way it is closed now, and when (from its history); null while unknown. */
  closedBy: { name: string; at: string } | null;
  onMarkQuoted: (date: string) => void;
  onConfirm: (date: string | null) => void;
  onChase: (done: boolean) => void;
  onMarkLost: () => void;
  onReopen: () => void;
}

/** What someone wrote, quoted with who and when. */
function Said({ tone, text, who, when }: { tone: Tone; text: string; who: string; when: string }) {
  return (
    <figure className={`mt-2 border-l-[3px] pl-3 ${TONES[tone].quote}`}>
      <blockquote className="text-body text-ink">“{text}”</blockquote>
      <figcaption className="mt-0.5 text-meta text-ink-muted">
        {who} · {when}
      </figcaption>
    </figure>
  );
}

interface View {
  tone: Tone;
  title: string;
  body: ReactNode;
  actions: ReactNode;
}

function senderOf(s: EmailSuggestion): string {
  return shownName(s.item.email.from_name) || s.item.email.from_email || "Someone";
}

function describe(p: NextStepProps): View {
  const { row, today, canEdit } = p;
  const customer = displayName(row.customer_name);
  const lostButton = canEdit && (
    <Button variant="ghost" onClick={p.onMarkLost}>
      Mark lost…
    </Button>
  );

  if (row.status === "new") {
    const s = p.suggestion?.kind === "mark_quoted" ? p.suggestion : null;
    if (s) {
      return {
        tone: "primary",
        title: `${senderOf(s)} e-mailed a quote`,
        body: (
          <>
            <Said tone="primary" text={s.item.excerpt} who={senderOf(s)} when={whenSent(s.item.email.received_at, today)} />
            <p className="mt-2 text-meta text-ink-heading">The register still says awaiting quote.</p>
          </>
        ),
        actions: canEdit && (
          <>
            <Button loading={p.quoting} onClick={() => p.onMarkQuoted(s.date)}>
              Mark quoted on {dayWithWeekday(s.date, today)}
            </Button>
            {lostButton}
          </>
        ),
      };
    }
    const wait = waitStatus(row.enquiry_date, today);
    const age = daysBetween(row.enquiry_date, today);
    return {
      tone: wait === "overdue" ? "bad" : wait === "due_today" ? "warn" : "primary",
      title:
        wait === "overdue"
          ? "The quote is overdue"
          : wait === "due_today"
            ? "Quote it today"
            : `Quote by the end of ${dayWithWeekday(quoteDeadline(row.enquiry_date), today)}`,
      body: (
        <p className="mt-1 text-body text-ink-heading">
          {age <= 0 ? "The enquiry came in today." : `The enquiry came in ${plural(age, "day")} ago.`} A quick quote goes out by the end of the next
          working day.
        </p>
      ),
      actions: canEdit && (
        <>
          <Button loading={p.quoting} onClick={() => p.onMarkQuoted(today)}>
            Mark quoted today
          </Button>
          {lostButton}
        </>
      ),
    };
  }

  if (row.status === "quoted") {
    const s = p.suggestion?.kind === "confirm" ? p.suggestion : null;
    if (s) {
      return {
        tone: "good",
        title: `${customer} said yes`,
        body: (
          <>
            <Said tone="good" text={s.item.excerpt} who={senderOf(s)} when={whenSent(s.item.email.received_at, today)} />
            {s.betterRate && <p className="mt-2 text-body font-medium text-await">They also ask for a better rate.</p>}
            <p className="mt-2 text-meta text-ink-heading">Read from their e-mail: check it before you confirm.</p>
          </>
        ),
        actions: canEdit && (
          <>
            <Button onClick={() => p.onConfirm(s.date)}>
              <Icon name="check" className="size-4" />
              Confirm job
            </Button>
            {lostButton}
          </>
        ),
      };
    }
    const waited = Math.max(0, daysBetween(row.quoted_date ?? row.enquiry_date, today));
    const last = latestFollowUps(p.chases).get(row.id);
    const mineToday = !!p.me && p.chases.some((c) => c.sales_person_id === p.me && c.followed_up_on === today);
    const usual = p.stats?.usualDays;
    return {
      tone: waited >= STALE_DAYS ? "warn" : "neutral",
      title: waited === 0 ? `Quoted today: waiting for ${customer}` : `Waiting ${plural(waited, "day")} for ${customer}'s answer`,
      body: (
        <ul className="mt-1 space-y-1 text-body text-ink-heading">
          {usual != null && <li>They usually confirm {usual === 0 ? "on the day of the quote" : `${plural(usual, "day")} after the quote`}.</li>}
          <li>{last ? `${chasedLabel(last.followed_up_on, today)} by ${p.names.get(last.sales_person_id) ?? "a colleague"}.` : "No follow-ups logged yet."}</li>
          {waited >= STALE_DAYS && (
            <li className="font-medium text-await">After {STALE_DAYS} days few quotes are won. If this one is dead, close it as lost.</li>
          )}
        </ul>
      ),
      actions: (
        <>
          {p.me && (
            <Button variant={mineToday ? "secondary" : "primary"} loading={p.chasing} onClick={() => p.onChase(!mineToday)} aria-pressed={mineToday}>
              <Icon name={mineToday ? "check" : "phone"} className="size-4" />
              {mineToday ? "Followed up today" : "Log a follow-up"}
            </Button>
          )}
          {canEdit && (
            <Button variant={p.me ? "secondary" : "primary"} onClick={() => p.onConfirm(null)}>
              Confirm job
            </Button>
          )}
          {lostButton}
        </>
      ),
    };
  }

  if (row.status === "confirmed") {
    const noSell = row.sell_total == null;
    return {
      tone: "good",
      title: row.confirmed_date ? `Job confirmed on ${dayWithWeekday(row.confirmed_date, today)}` : "Job confirmed",
      body: noSell ? (
        <p className="mt-1 text-body font-medium text-await">No sell amount yet, so the reports miss this job's profit.</p>
      ) : (
        <p className="mt-1 text-body text-ink-heading">
          Sell{" "}
          <b className="tabular-nums text-ink">
            {fmtMoney(row.sell_total)} {row.currency.trim()}
          </b>
          {row.profit != null && (
            <>
              , profit <b className="tabular-nums text-ink">{fmtMoney(row.profit)}</b>
              {row.sell_total ? ` (${fmtPercent(row.profit, row.sell_total)})` : ""}
            </>
          )}
          .
        </p>
      ),
      actions: canEdit && (
        <Link to={p.editLink} className={buttonClass(noSell ? "primary" : "secondary")}>
          <Icon name="edit" className="size-4" />
          {noSell ? "Add the rates" : "Edit"}
        </Link>
      ),
    };
  }

  const reason = row.closure_reason?.trim() || "No reason recorded.";
  if (row.status === "not_genuine") {
    return {
      tone: "flag",
      title: "Not a genuine enquiry",
      body: (
        <>
          <p className="mt-1 text-body font-medium text-ink">{reason}</p>
          <p className="mt-1 text-meta text-ink-muted">
            {p.closedBy && `Marked by ${p.closedBy.name}, ${fmtDateTime(p.closedBy.at)}. `}
            Not counted in enquiries, conversion, quote speed or reports.
          </p>
        </>
      ),
      actions: canEdit && (
        <Button variant="secondary" loading={p.reopening} onClick={p.onReopen}>
          Reopen
        </Button>
      ),
    };
  }
  if (row.status === "lost") {
    return {
      tone: "bad",
      title: "Closed as lost",
      body: <p className="mt-1 text-body text-ink-heading">{reason}</p>,
      actions: canEdit && (
        <Button variant="secondary" loading={p.reopening} onClick={p.onReopen}>
          Reopen
        </Button>
      ),
    };
  }
  return {
    tone: "neutral",
    title: "Cancelled",
    body: <p className="mt-1 text-body text-ink-heading">{reason}</p>,
    actions: canEdit && (
      <Link to={p.editLink} className={buttonClass("secondary")}>
        Edit
      </Link>
    ),
  };
}

/** The one thing to do next on this enquiry, and the button for it. */
export function NextStepCard(props: NextStepProps) {
  const v = describe(props);
  return (
    <section aria-labelledby="next-step-title" className={`rounded-panel border p-4 ${TONES[v.tone].box}`}>
      <div className={`text-meta font-semibold uppercase tracking-wide ${TONES[v.tone].label}`}>Next step</div>
      <h2 id="next-step-title" className="mt-1 text-title font-semibold text-ink">
        {v.title}
      </h2>
      {v.body}
      {v.actions && <div className="mt-3 flex flex-wrap gap-2">{v.actions}</div>}
    </section>
  );
}
